function csvCell(value) {
  let text=String(value??'');
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}

export function formatTraceQueryCsv(columns,rows,{maxRows=500}={}) {
  if(!Number.isInteger(maxRows)||maxRows<0||maxRows>2000||!Array.isArray(columns)||columns.length<1||columns.length>50||!Array.isArray(rows)||rows.length>maxRows)throw new Error('Trace query CSV exceeds the supported result bounds');
  if(rows.some(row=>!Array.isArray(row)||row.length!==columns.length))throw new Error('Trace query CSV rows do not match the result columns');
  return `\uFEFF${[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')}${rows.length?'\r\n':''}`;
}
