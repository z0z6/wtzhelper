'use strict';
// Zamiana modelu dokumentu (plan / ocena) na plik DOCX oraz na HTML (podgląd i druk do PDF).
// Rodzaje bloków: meta, title, field, heading, subheading, body, bullet, note, table, sign, council, footnote, p.
const JSZip = require('jszip');

const FONT_FALLBACK = {
  'Times New Roman': "'Times New Roman', 'Liberation Serif', Tinos, 'Nimbus Roman', serif",
  Cambria: "Cambria, Caladea, 'Times New Roman', 'Liberation Serif', serif",
  Calibri: "Calibri, Carlito, 'Segoe UI', 'Liberation Sans', Arial, sans-serif",
  Arial: "Arial, 'Liberation Sans', Helvetica, sans-serif"
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cm = (v) => Math.round(v * 567); // twipy

// Wspólne parametry akapitu zależne od rodzaju (w punktach).
function paraStyle(b, f) {
  const base = { size: f.size, before: 0, after: 0, line: 1, indentFirst: 0, left: 0, hanging: 0, keepNext: false };
  switch (b.kind) {
    case 'meta': return { ...base, after: b.spaceAfter || 0 };
    case 'title': return { ...base, size: f.size + 2, before: 12, after: 18, keepNext: true };
    case 'field': return { ...base, after: 3, line: 1.15 };
    case 'heading': return { ...base, before: 14, after: 4, keepNext: true };
    case 'subheading': return { ...base, before: 8, after: 2, keepNext: true };
    case 'note': return { ...base, size: f.size - 2, before: 4, after: 4, line: 1.1 };
    case 'cell': return { ...base, size: b.small ? f.size - 2 : f.size - 1, line: 1.05 };
    case 'council': return { ...base, before: 16, after: 0 };
    case 'p': return { ...base, before: b.spaceBefore || 0 };
    case 'body': return { ...base, after: 4, line: f.lineSpacing, indentFirst: f.indent ? 1.25 : 0 };
    case 'bullet': return { ...base, after: 2, line: f.lineSpacing, left: 1.25, hanging: 0.6 };
    case 'sign': return { ...base, before: b.first ? 44 : 0, left: 8.5, keepNext: true };
    case 'footnote': return { ...base, size: f.size - 2, before: b.first ? 28 : 0 };
    default: return base;
  }
}

// ───────────────────────────── DOCX ─────────────────────────────

function runXml(r, st, font) {
  const sz = Math.round(st.size * 2);
  const props = `<w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}" w:eastAsia="${esc(font)}"/>${r.bold ? '<w:b/><w:bCs/>' : ''}${r.italic ? '<w:i/><w:iCs/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="pl-PL"/></w:rPr>`;
  return `<w:r>${props}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}

function paraXml(b, f) {
  const st = paraStyle(b, f);
  const ind = [];
  if (st.left) ind.push(`w:left="${cm(st.left)}"`);
  if (st.hanging) ind.push(`w:hanging="${cm(st.hanging)}"`);
  if (st.indentFirst) ind.push(`w:firstLine="${cm(st.indentFirst)}"`);
  const pPr = `<w:pPr>${st.keepNext ? '<w:keepNext/><w:keepLines/>' : ''}<w:spacing w:before="${Math.round(st.before * 20)}" w:after="${Math.round(st.after * 20)}" w:line="${Math.round(st.line * 240)}" w:lineRule="auto"/>${ind.length ? `<w:ind ${ind.join(' ')}/>` : ''}<w:jc w:val="${b.align || 'left'}"/></w:pPr>`;
  let runs = b.runs.map((r) => runXml(r, st, f.font)).join('');
  if (b.kind === 'bullet') runs = runXml({ text: '–' }, st, f.font) + '<w:r><w:tab/></w:r>' + runs;
  return `<w:p>${pPr}${runs}</w:p>`;
}

function cellParas(cell, st, f, opts = {}) {
  // komórka: tekst (wiersze = akapity) albo lista fragmentów { text, bold, italic }
  const items = Array.isArray(cell) ? cell : [{ text: cell == null ? '' : String(cell) }];
  const paras = [];
  for (const it of items) {
    const parts = String(it.text || '').split(/\r?\n/);
    for (const t of parts) paras.push({ ...it, text: t, bold: it.bold || opts.bold });
  }
  if (!paras.length) paras.push({ text: '' });
  const jc = opts.center ? 'center' : 'left';
  return paras.map((r) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.round(st.line * 240)}" w:lineRule="auto"/><w:jc w:val="${jc}"/></w:pPr>${r.text ? runXml(r, st, f.font) : ''}</w:p>`).join('');
}

function tableXml(b, f, usable) {
  const st = paraStyle({ kind: 'cell', small: b.small }, f);
  const total = b.cols.reduce((s, c) => s + (c.w || 1), 0);
  const widths = b.cols.map((c) => Math.floor(usable * (c.w || 1) / total));
  const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('');
  const tc = (content, i, o = {}) => `<w:tc><w:tcPr><w:tcW w:w="${o.span ? usable : widths[i]}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${b.cols.length}"/>` : ''}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}</w:tcPr>${cellParas(content, st, f, o)}</w:tc>`;
  const head = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${b.cols.map((c, i) => tc(c.text, i, { bold: true, fill: 'E7E7E7', center: true })).join('')}</w:tr>`;
  const rows = b.rows.map((r) => (r && r.section
    ? `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tc(r.section, 0, { span: true, bold: true, fill: 'F3F3F3' })}</w:tr>`
    : `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => tc(c, i)).join('')}</w:tr>`)).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${usable}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="30" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head}${rows}</w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr></w:p>`;
}

async function renderDocx(model, meta = {}) {
  const f = model.format;
  const m = cm(f.marginCm);
  const pageW = f.landscape ? 16838 : 11906, pageH = f.landscape ? 11906 : 16838;
  const usable = pageW - 2 * m;
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${model.blocks.map((b) => (b.kind === 'table' ? tableXml(b, f, usable) : paraXml(b, f))).join('')}<w:sectPr><w:pgSz w:w="${pageW}" w:h="${pageH}"${f.landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(f.font)}" w:hAnsi="${esc(f.font)}" w:cs="${esc(f.font)}" w:eastAsia="${esc(f.font)}"/><w:sz w:val="${f.size * 2}"/><w:szCs w:val="${f.size * 2}"/><w:lang w:val="pl-PL" w:eastAsia="pl-PL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normalny"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${NS}><w:defaultTabStop w:val="708"/><w:autoHyphenation w:val="0"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title || 'Dokument WTZ')}</dc:title><dc:creator>${esc(meta.author || '')}</dc:creator><dc:language>pl-PL</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`);
  zip.file('word/document.xml', document);
  zip.file('word/styles.xml', styles);
  zip.file('word/settings.xml', settings);
  zip.file('docProps/core.xml', core);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ───────────────────────────── HTML (PDF) ─────────────────────────────

function paraHtml(b, f) {
  const st = paraStyle(b, f);
  const css = [
    `font-size:${st.size}pt`, `margin:${st.before}pt 0 ${st.after}pt ${st.left}cm`, `line-height:${(st.line * 1.15).toFixed(3)}`,
    `text-align:${b.align === 'both' ? 'justify' : b.align || 'left'}`
  ];
  if (st.indentFirst) css.push(`text-indent:${st.indentFirst}cm`);
  if (st.hanging) css.push(`text-indent:-${st.hanging}cm`);
  if (st.keepNext) css.push('break-after:avoid', 'break-inside:avoid');
  const run = (r) => { let t = esc(r.text); if (r.italic) t = `<i>${t}</i>`; if (r.bold) t = `<b>${t}</b>`; return t; };
  let inner = b.runs.map(run).join('');
  if (b.kind === 'bullet') inner = `<span style="display:inline-block;width:${st.hanging}cm;text-indent:0">–</span>` + inner;
  return `<p class="k-${b.kind}" style="${css.join(';')}">${inner}</p>`;
}

function renderHtml(model, { title = 'Dokument WTZ' } = {}) {
  const f = model.format;
  const font = FONT_FALLBACK[f.font] || `'${f.font}', serif`;
  return `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
@page { size: A4${f.landscape ? ' landscape' : ''}; margin: ${f.marginCm}cm; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: ${font}; font-size: ${f.size}pt; color: #000; -webkit-print-color-adjust: exact; hyphens: none; }
p { margin: 0; orphans: 2; widows: 2; }
tr { break-inside: avoid; } thead { display: table-header-group; }
</style></head><body>${model.blocks.map((b) => blockHtml(b, f)).join('\n')}</body></html>`;
}

function cellHtml(cell) {
  const items = Array.isArray(cell) ? cell : [{ text: cell == null ? '' : String(cell) }];
  return items.map((it) => { let t = esc(it.text || '').replace(/\r?\n/g, '<br>'); if (it.italic) t = `<i>${t}</i>`; if (it.bold) t = `<b>${t}</b>`; return t; }).join('<br>');
}

function tableHtml(b, f) {
  const st = paraStyle({ kind: 'cell', small: b.small }, f);
  const total = b.cols.reduce((s, c) => s + (c.w || 1), 0);
  const td = `border:0.5pt solid #000;padding:2pt 4pt;vertical-align:top;font-size:${st.size}pt;line-height:1.2;text-align:left;word-wrap:break-word`;
  const cols = b.cols.map((c) => `<col style="width:${((c.w || 1) * 100 / total).toFixed(2)}%">`).join('');
  const head = `<tr>${b.cols.map((c) => `<th style="${td};background:#e7e7e7;text-align:center">${cellHtml(c.text)}</th>`).join('')}</tr>`;
  const rows = b.rows.map((r) => (r && r.section
    ? `<tr><td colspan="${b.cols.length}" style="${td};background:#f3f3f3;font-weight:bold">${esc(r.section)}</td></tr>`
    : `<tr>${r.map((c) => `<td style="${td}">${cellHtml(c)}</td>`).join('')}</tr>`)).join('');
  return `<table class="k-table" style="width:100%;border-collapse:collapse;table-layout:fixed;margin:2pt 0 6pt"><colgroup>${cols}</colgroup><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

const blockHtml = (b, f) => (b.kind === 'table' ? tableHtml(b, f) : paraHtml(b, f));
const renderBody = (model) => model.blocks.map((b) => blockHtml(b, model.format)).join('\n');

module.exports = { renderDocx, renderHtml, renderBody, paraStyle, FONT_FALLBACK };
