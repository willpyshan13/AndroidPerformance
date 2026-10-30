import { open } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';

const schemes = new Map([[0x7109871a, 'v2'], [0xf05368c0, 'v3'], [0x1b93ad61, 'v3.1']]);
function lengthFields(buffer) {
  const result = []; let offset = 0;
  while (offset < buffer.length) {
    if (offset + 4 > buffer.length || result.length >= 256) throw new Error('签名字段长度无效');
    const size = buffer.readUInt32LE(offset); offset += 4;
    if (size > buffer.length - offset) throw new Error('签名字段越界');
    result.push(buffer.subarray(offset, offset + size)); offset += size;
  }
  return result;
}
export function certificateInfo(der, scheme, signer = 1, chainIndex = 0) {
  const cert = new X509Certificate(der), key = cert.publicKey;
  return { scheme, signer, chainIndex, subject: cert.subject, issuer: cert.issuer, serialNumber: cert.serialNumber,
    validFrom: new Date(cert.validFrom).toISOString(), validTo: new Date(cert.validTo).toISOString(),
    sha256: cert.fingerprint256, sha1: cert.fingerprint, keyType: key.asymmetricKeyType,
    keyBits: key.asymmetricKeyDetails?.modulusLength ?? null, curve: key.asymmetricKeyDetails?.namedCurve ?? null };
}
export function certificatesFromSigningValue(value, scheme) {
  const firstField = bytes => {
    if (bytes.length < 4 || bytes.readUInt32LE(0) > bytes.length - 4) throw new Error('签名字段越界');
    return bytes.subarray(4, 4 + bytes.readUInt32LE(0));
  };
  const signers = lengthFields(firstField(value));
  return signers.flatMap((signer, i) => {
    // v2/v3 signed-data both begin with length-prefixed digest and certificate sequences.
    const signedData = firstField(signer);
    if (!signedData || signedData.length < 8) throw new Error('缺少 signer signed-data');
    const digestsLength = signedData.readUInt32LE(0), certOffset = 4 + digestsLength;
    if (certOffset + 4 > signedData.length) throw new Error('证书列表越界');
    const certsLength = signedData.readUInt32LE(certOffset), start = certOffset + 4;
    if (start + certsLength > signedData.length) throw new Error('证书列表长度无效');
    return lengthFields(signedData.subarray(start, start + certsLength)).map((der, index) => certificateInfo(der, scheme, i + 1, index));
  });
}

// Minimal bounded DER reader for PKCS#7 SignedData certificate containers (v1).
function derChildren(buffer, start = 0, end = buffer.length) {
  const nodes = [];
  for (let offset = start; offset < end;) {
    if (offset + 2 > end || nodes.length >= 512) throw new Error('PKCS#7 DER 数据无效');
    const begin = offset, tag = buffer[offset++]; let size = buffer[offset++];
    if (size & 0x80) {
      const count = size & 0x7f;
      if (count < 1 || count > 4 || offset + count > end) throw new Error('不支持的 DER 长度');
      size = 0; for (let i = 0; i < count; i++) size = size * 256 + buffer[offset++];
    }
    if (offset + size > end) throw new Error('DER 字段越界');
    nodes.push({ tag, start: begin, content: offset, end: offset + size }); offset += size;
  }
  return nodes;
}
export function certificatesFromPkcs7(buffer) {
  const root = derChildren(buffer)[0]; if (root?.tag !== 0x30) throw new Error('不是 PKCS#7 序列');
  const content = derChildren(buffer, root.content, root.end).find(n => n.tag === 0xa0);
  if (!content) throw new Error('缺少 SignedData');
  const signed = derChildren(buffer, content.content, content.end)[0];
  const certs = derChildren(buffer, signed.content, signed.end).find(n => n.tag === 0xa0);
  if (!certs) return [];
  return derChildren(buffer, certs.content, certs.end).filter(n => n.tag === 0x30)
    .map((node, i) => certificateInfo(buffer.subarray(node.start, node.end), 'v1', 1, i));
}

async function readAt(handle, length, position) {
  const bytes = Buffer.alloc(length); let offset = 0;
  while (offset < length) { const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset); if (!bytesRead) throw new Error('APK 签名块截断'); offset += bytesRead; }
  return bytes;
}
export async function readApkSigningBlock(path, size) {
  const result = { detectedSchemes: [], certificates: [], blockBytes: 0, warnings: [], verification: 'not-performed' };
  const handle = await open(path, 'r');
  try {
    const tailLength = Math.min(size, 65557), tail = await readAt(handle, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { eocd = i; break; }
    if (eocd < 0) throw new Error('找不到 ZIP 结束记录');
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (centralOffset === 0xffffffff) { result.warnings.push('ZIP64 容器未解析 APK Signing Block'); return result; }
    if (centralOffset < 24 || centralOffset > size) return result;
    const footer = await readAt(handle, 24, centralOffset - 24);
    if (footer.subarray(8).toString() !== 'APK Sig Block 42') return result;
    const blockSize = footer.readBigUInt64LE(0);
    if (blockSize < 24n || blockSize > 16n * 1024n * 1024n || blockSize + 8n > BigInt(centralOffset)) throw new Error('APK Signing Block 超出 16 MB 限制或长度无效');
    const block = await readAt(handle, Number(blockSize) + 8, centralOffset - Number(blockSize) - 8);
    if (block.readBigUInt64LE(0) !== blockSize) throw new Error('APK 签名块头尾长度不一致');
    result.blockBytes = block.length;
    for (let offset = 8; offset < block.length - 24;) {
      if (offset + 12 > block.length - 24) throw new Error('签名 ID-value 字段截断');
      const pairSize = block.readBigUInt64LE(offset); offset += 8;
      if (pairSize < 4n || pairSize > BigInt(block.length - 24 - offset)) throw new Error('签名 ID-value 字段越界');
      const scheme = schemes.get(block.readUInt32LE(offset));
      if (scheme) {
        result.detectedSchemes.push(scheme);
        try { result.certificates.push(...certificatesFromSigningValue(block.subarray(offset + 4, offset + Number(pairSize)), scheme)); }
        catch (error) { result.warnings.push(`${scheme} 证书解析失败：${error.message}`); }
      }
      offset += Number(pairSize);
    }
    result.detectedSchemes = [...new Set(result.detectedSchemes)]; return result;
  } catch (error) { result.warnings.push(error.message); return result; }
  finally { await handle.close(); }
}
