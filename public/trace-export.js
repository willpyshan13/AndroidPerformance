function csvCell(value) {
  let text=String(value??'');
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}

export function formatTraceQueryCsv(columns,rows) {
  if(!Array.isArray(columns)||columns.length<1||columns.length>50||!Array.isArray(rows)||rows.length>500)throw new Error('Trace query CSV exceeds the supported result bounds');
  if(rows.some(row=>!Array.isArray(row)||row.length!==columns.length))throw new Error('Trace query CSV rows do not match the result columns');
  return `\uFEFF${[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')}${rows.length?'\r\n':''}`;
}
