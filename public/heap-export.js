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

function markdownCell(value) {
  return String(value??'—').replaceAll('\\','\\\\').replaceAll('|','\\|').replace(/\r?\n/g,'<br>');
}

export function formatHeapMarkdown(kind, rows) {
  const comparison=kind==='comparison';
  const title=comparison?'# HPROF snapshot comparison':'# HPROF class statistics';
  const header=comparison
    ?['Class','Baseline object count','Current object count','Object count delta','Object count delta %','Field / element bytes delta','Field / element bytes delta %','Comparable']
    :['Class','Object count','Field / element payload bytes'];
  const notes=comparison
    ?['Byte deltas are HPROF field/element payload only; they exclude object headers and alignment and are not shallow or retained size.','Class-name matching can be ambiguous across class loaders; ambiguous rows are marked not comparable.']
    :['Byte values are HPROF field/element payload only; they exclude object headers and alignment and are not shallow or retained size.'];
  return `${title}\n\n${notes.map(note=>`> ${note}`).join('\n')}\n\n| ${header.map(markdownCell).join(' | ')} |\n| ${header.map(()=> '---').join(' | ')} |\n${rows.map(row=>`| ${row.map(markdownCell).join(' | ')} |`).join('\n')}${rows.length?'\n':''}`;
}

export function formatHeapJson(kind, rows) {
  const comparison=kind==='comparison';
  const columns=comparison
    ?['className','baselineObjectCount','currentObjectCount','objectCountDelta','objectCountDeltaPercent','fieldElementBytesDelta','fieldElementBytesDeltaPercent','comparable']
    :['className','objectCount','fieldElementPayloadBytes'];
  const notes=comparison
    ?['Byte deltas are HPROF field/element payload only; they exclude object headers and alignment and are not shallow or retained size.','Class-name matching can be ambiguous across class loaders; ambiguous rows have comparable=false and null comparison values.']
    :['Byte values are HPROF field/element payload only; they exclude object headers and alignment and are not shallow or retained size.'];
  const normalizedRows=rows.map(row=>{
    const values=comparison
      ?[row[0],...row.slice(1,7).map(value=>value===''||value===null?null:value),row[7]==='yes']
      :row;
    return Object.fromEntries(columns.map((column,index)=>[column,values[index]??null]));
  });
  return `${JSON.stringify({schemaVersion:1,kind,columns,notes,rows:normalizedRows},null,2)}\n`;
}
