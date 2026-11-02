function csvCell(value) {
  let text=String(value??'');
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}

export function formatHeapCsv(kind, rows) {
  const comparison=kind==='comparison';
  const header=comparison
    ?['Class','Baseline object count','Current object count','Object count delta','Object count delta %','Field / element bytes delta','Field / element bytes delta %','Comparable']
    :['Class','Object count','Field / element payload bytes'];
  const notes=comparison
    ?'# Byte deltas are HPROF field/element payload only; they exclude object headers and alignment and are not shallow or retained size.\n# Class-name matching can be ambiguous across class loaders; ambiguous rows are marked not comparable.'
    :'# Byte values are HPROF field/element payload only; they exclude object headers and alignment and are not shallow or retained size.';
  return `\uFEFF${notes}\r\n${header.map(csvCell).join(',')}\r\n${rows.map(row=>row.map(csvCell).join(',')).join('\r\n')}${rows.length?'\r\n':''}`;
}
