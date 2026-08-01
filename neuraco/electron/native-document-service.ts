import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from 'docx';
import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import PptxGenJS from 'pptxgenjs';
import type {
  NeuraCoNativeDocumentDraft,
  NeuraCoNativeDocumentExport,
  NeuraCoNativeDocumentFormat,
  NeuraCoNativeDocumentPreview
} from './ipc-contract';
import { redactSecrets } from './secret-redaction';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_TABLE_ROWS = 10_000;
const MAX_TABLE_COLUMNS = 200;
const MAX_SLIDES = 100;
const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "script-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ');

const FORMAT_INFO: Record<
  NeuraCoNativeDocumentFormat,
  { extension: string; mimeType: string }
> = {
  docx: {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  },
  pdf: { extension: 'pdf', mimeType: 'application/pdf' },
  pptx: {
    extension: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  },
  xlsx: {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  },
  csv: { extension: 'csv', mimeType: 'text/csv' },
  markdown: { extension: 'md', mimeType: 'text/markdown' },
  html: { extension: 'html', mimeType: 'text/html' },
  json: { extension: 'json', mimeType: 'application/json' }
};

const safeText = (value: unknown, label: string, max: number): string => {
  const result = redactSecrets(String(value || '')).trim().slice(0, max);
  if (!result) throw new Error(`${label} est obligatoire.`);
  return result;
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const normalizeDraft = (
  input: NeuraCoNativeDocumentDraft
): NeuraCoNativeDocumentDraft => {
  if (!input || !Object.hasOwn(FORMAT_INFO, input.format)) {
    throw new Error('Format de document invalide.');
  }
  const content = redactSecrets(String(input.content || '')).trim();
  if (!content) throw new Error('Le contenu du document est obligatoire.');
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new Error('Le document dépasse la limite de 2 Mo.');
  }
  if (input.format === 'json') {
    try {
      JSON.parse(content);
    } catch {
      throw new Error('Le contenu JSON est invalide.');
    }
  }
  return {
    title: safeText(input.title, 'Titre', 180),
    description: redactSecrets(String(input.description || '')).trim().slice(0, 1_000),
    format: input.format,
    content,
    author: redactSecrets(String(input.author || '')).trim().slice(0, 120)
  };
};

export const nativeDocumentDigest = (
  input: NeuraCoNativeDocumentDraft
): string => createHash('sha256')
  .update(JSON.stringify(normalizeDraft(input)))
  .digest('hex');

const secureHtml = (html: string): string => {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const withoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\b(?:src|href)\s*=\s*["']https?:[^"']*["']/gi, '');
  if (/<head[\s>]/i.test(withoutScripts)) {
    return withoutScripts.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
  }
  return `<!doctype html><html><head>${csp}<meta charset="utf-8"></head><body>${withoutScripts}</body></html>`;
};

const lines = (content: string): string[] => (
  content.replace(/\r\n/g, '\n').split('\n')
);

const parseRows = (content: string): string[][] => {
  const first = lines(content).find((line) => line.trim()) || '';
  const delimiter = first.includes('\t')
    ? '\t'
    : first.split(';').length > first.split(',').length
      ? ';'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row.slice(0, MAX_TABLE_COLUMNS));
      row = [];
      cell = '';
      if (rows.length >= MAX_TABLE_ROWS) break;
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row.slice(0, MAX_TABLE_COLUMNS));
  }
  if (rows.length === 0) throw new Error('Aucune ligne tabulaire valide.');
  return rows;
};

interface SlideSource {
  title: string;
  body: string[];
}

const parseSlides = (draft: NeuraCoNativeDocumentDraft): SlideSource[] => (
  draft.content
    .split(/\n-{3,}\n/g)
    .map((section, index) => {
      const sectionLines = lines(section).filter((line) => line.trim());
      const rawTitle = sectionLines.shift() || `${draft.title} ${index + 1}`;
      return {
        title: rawTitle.replace(/^#+\s*/, '').slice(0, 180),
        body: sectionLines.slice(0, 20).map((line) => (
          line.replace(/^[-*]\s*/, '').slice(0, 500)
        ))
      };
    })
    .filter((slide) => slide.title || slide.body.length > 0)
    .slice(0, MAX_SLIDES)
);

const paragraphPreview = (content: string): string => lines(content).map((line) => {
  const safe = escapeHtml(line.replace(/^#+\s*/, ''));
  if (/^#\s/.test(line)) return `<h1>${safe}</h1>`;
  if (/^##\s/.test(line)) return `<h2>${safe}</h2>`;
  if (/^###\s/.test(line)) return `<h3>${safe}</h3>`;
  if (/^[-*]\s/.test(line)) return `<li>${escapeHtml(line.replace(/^[-*]\s*/, ''))}</li>`;
  return line.trim() ? `<p>${safe}</p>` : '<br>';
}).join('');

const previewShell = (draft: NeuraCoNativeDocumentDraft, body: string): string => (
  `<!doctype html><html><head>`
  + `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`
  + '<meta charset="utf-8"><style>'
  + 'body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#18201e;background:#fff;line-height:1.55}'
  + 'h1{font-size:28px;margin:0 0 8px}h2{font-size:20px;margin-top:24px}'
  + '.meta{color:#65716d;font-size:13px;margin-bottom:24px}'
  + 'table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccd5d2;padding:7px;text-align:left}'
  + 'th{background:#edf4f1}.slide{border:1px solid #ccd5d2;padding:20px;margin:12px 0;min-height:120px}'
  + 'pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f4;padding:16px}'
  + '</style></head><body>'
  + `<h1>${escapeHtml(draft.title)}</h1>`
  + `<div class="meta">${escapeHtml(draft.format.toUpperCase())}`
  + `${draft.description ? ` · ${escapeHtml(draft.description)}` : ''}</div>`
  + body
  + '</body></html>'
);

export const previewNativeDocument = (
  input: NeuraCoNativeDocumentDraft
): NeuraCoNativeDocumentPreview => {
  const draft = normalizeDraft(input);
  const info = FORMAT_INFO[draft.format];
  const warnings: string[] = [];
  let body = '';
  let itemCount = 0;
  if (draft.format === 'html') {
    body = secureHtml(draft.content);
    itemCount = lines(draft.content).length;
    return {
      previewId: nativeDocumentDigest(draft),
      format: draft.format,
      extension: info.extension,
      mimeType: info.mimeType,
      previewHtml: body,
      itemCount,
      warnings,
      validatedAt: new Date().toISOString()
    };
  }
  if (draft.format === 'csv' || draft.format === 'xlsx') {
    const rows = parseRows(draft.content);
    itemCount = rows.length;
    body = `<table>${rows.map((row, rowIndex) => (
      `<tr>${row.map((cell) => (
        `${rowIndex === 0 ? '<th>' : '<td>'}${escapeHtml(cell)}${rowIndex === 0 ? '</th>' : '</td>'}`
      )).join('')}</tr>`
    )).join('')}</table>`;
  } else if (draft.format === 'pptx') {
    const slides = parseSlides(draft);
    itemCount = slides.length;
    body = slides.map((slide, index) => (
      `<section class="slide"><small>Diapositive ${index + 1}</small>`
      + `<h2>${escapeHtml(slide.title)}</h2>`
      + `<ul>${slide.body.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      + '</section>'
    )).join('');
  } else if (draft.format === 'json') {
    const normalized = JSON.stringify(JSON.parse(draft.content), null, 2);
    itemCount = Array.isArray(JSON.parse(draft.content))
      ? JSON.parse(draft.content).length
      : Object.keys(JSON.parse(draft.content)).length;
    body = `<pre>${escapeHtml(normalized)}</pre>`;
  } else {
    itemCount = lines(draft.content).filter((line) => line.trim()).length;
    body = paragraphPreview(draft.content);
  }
  if (itemCount === 0) warnings.push('Le document ne contient aucun élément visible.');
  return {
    previewId: nativeDocumentDigest(draft),
    format: draft.format,
    extension: info.extension,
    mimeType: info.mimeType,
    previewHtml: previewShell(draft, body),
    itemCount,
    warnings,
    validatedAt: new Date().toISOString()
  };
};

const docxBuffer = async (draft: NeuraCoNativeDocumentDraft): Promise<Buffer> => {
  const children = lines(draft.content).map((line) => {
    const heading = /^###\s/.test(line)
      ? HeadingLevel.HEADING_3
      : /^##\s/.test(line)
        ? HeadingLevel.HEADING_2
        : /^#\s/.test(line)
          ? HeadingLevel.HEADING_1
          : undefined;
    const text = line.replace(/^#{1,3}\s*/, '').replace(/^[-*]\s*/, '');
    return new Paragraph({
      heading,
      bullet: /^[-*]\s/.test(line) ? { level: 0 } : undefined,
      children: [new TextRun(text)]
    });
  });
  const document = new Document({
    creator: draft.author || 'NeuraCo',
    title: draft.title,
    description: draft.description,
    sections: [{ children }]
  });
  return Packer.toBuffer(document);
};

const findPdfFont = async (): Promise<Buffer | undefined> => {
  const candidates = process.platform === 'win32'
    ? [
      'C:\\Windows\\Fonts\\segoeui.ttf',
      'C:\\Windows\\Fonts\\arial.ttf',
      'C:\\Windows\\Fonts\\tahoma.ttf'
    ]
    : [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf'
    ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return await readFile(candidate);
    } catch {
      // Try the next local font.
    }
  }
  return undefined;
};

const pdfBuffer = async (draft: NeuraCoNativeDocumentDraft): Promise<Buffer> => {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const fontBytes = await findPdfFont();
  const font: PDFFont = fontBytes
    ? await document.embedFont(new Uint8Array(fontBytes), { subset: true })
    : await document.embedFont(StandardFonts.Helvetica);
  const pageSize: [number, number] = [595.28, 841.89];
  let page = document.addPage(pageSize);
  let y = 795;
  const draw = (value: string, size: number, color = rgb(0.08, 0.12, 0.11)) => {
    const chunks = value.match(new RegExp(`.{1,${size >= 18 ? 48 : 88}}(?:\\s|$)|.{1,88}$`, 'gu'))
      || [value];
    for (const chunk of chunks) {
      if (y < 55) {
        page = document.addPage(pageSize);
        y = 795;
      }
      page.drawText(chunk.trim(), { x: 48, y, size, font, color });
      y -= size * 1.55;
    }
  };
  draw(draft.title, 22, rgb(0.04, 0.42, 0.34));
  y -= 8;
  for (const line of lines(draft.content)) {
    if (!line.trim()) {
      y -= 8;
      continue;
    }
    draw(line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '• '), /^#/.test(line) ? 16 : 10);
  }
  document.setTitle(draft.title);
  document.setAuthor(draft.author || 'NeuraCo');
  document.setSubject(draft.description || '');
  return Buffer.from(await document.save());
};

const pptxBuffer = async (draft: NeuraCoNativeDocumentDraft): Promise<Buffer> => {
  const presentation = new PptxGenJS();
  presentation.layout = 'LAYOUT_WIDE';
  presentation.author = draft.author || 'NeuraCo';
  presentation.subject = draft.description || '';
  presentation.title = draft.title;
  presentation.company = 'NeuraCo';
  const sources = parseSlides(draft);
  for (const source of sources) {
    const slide = presentation.addSlide();
    slide.background = { color: 'F7FAF9' };
    slide.addText(source.title, {
      x: 0.65,
      y: 0.45,
      w: 12,
      h: 0.65,
      fontFace: 'Aptos Display',
      fontSize: 26,
      bold: true,
      color: '146B59',
      margin: 0
    });
    slide.addText(source.body.map((text) => ({
      text,
      options: { bullet: { indent: 16 }, breakLine: true }
    })), {
      x: 0.8,
      y: 1.4,
      w: 11.6,
      h: 5.3,
      fontFace: 'Aptos',
      fontSize: 18,
      color: '25302D',
      breakLine: true,
      valign: 'top',
      margin: 0.08
    });
  }
  if (sources.length === 0) presentation.addSlide();
  return presentation.write({ outputType: 'nodebuffer' }) as Promise<Buffer>;
};

const xlsxBuffer = async (draft: NeuraCoNativeDocumentDraft): Promise<Buffer> => {
  const rows = parseRows(draft.content);
  const columnName = (index: number): string => {
    let value = index + 1;
    let name = '';
    while (value > 0) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  };
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const lastCell = `${columnName(maxColumns - 1)}${rows.length}`;
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const width = Math.max(
      10,
      Math.min(50, ...rows.slice(0, 500).map((row) => String(row[index] || '').length + 2))
    );
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');
  const sheetRows = rows.map((row, rowIndex) => (
    `<row r="${rowIndex + 1}">`
    + row.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? ' s="1"' : '';
      return `<c r="${reference}" t="inlineStr"${style}>`
        + `<is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
    }).join('')
    + '</row>'
  )).join('');
  const now = new Date().toISOString();
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    + '</Relationships>');
  zip.file('docProps/core.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${escapeXml(draft.title)}</dc:title>`
    + `<dc:creator>${escapeXml(draft.author || 'NeuraCo')}</dc:creator>`
    + `<dc:description>${escapeXml(draft.description || '')}</dc:description>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
    + '</cp:coreProperties>');
  zip.file('docProps/app.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
    + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + '<Application>NeuraCo</Application></Properties>');
  zip.file('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Données" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '</Relationships>');
  zip.file('xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font>'
    + '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF146B59"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>');
  zip.file('xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<dimension ref="A1:${lastCell}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${columns}</cols><sheetData>${sheetRows}</sheetData>`
    + `<autoFilter ref="A1:${columnName(maxColumns - 1)}1"/>`
    + '</worksheet>');
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
};

export const nativeDocumentBuffer = async (
  input: NeuraCoNativeDocumentDraft
): Promise<Buffer> => {
  const draft = normalizeDraft(input);
  if (draft.format === 'docx') return docxBuffer(draft);
  if (draft.format === 'pdf') return pdfBuffer(draft);
  if (draft.format === 'pptx') return pptxBuffer(draft);
  if (draft.format === 'xlsx') return xlsxBuffer(draft);
  if (draft.format === 'html') return Buffer.from(secureHtml(draft.content), 'utf8');
  if (draft.format === 'json') {
    return Buffer.from(`${JSON.stringify(JSON.parse(draft.content), null, 2)}\n`, 'utf8');
  }
  if (draft.format === 'csv') {
    parseRows(draft.content);
    return Buffer.from(`\uFEFF${draft.content.replace(/\r?\n/g, '\r\n')}\r\n`, 'utf8');
  }
  return Buffer.from(draft.content, 'utf8');
};

export const writeNativeDocument = async (
  input: NeuraCoNativeDocumentDraft,
  targetPath: string
): Promise<NeuraCoNativeDocumentExport> => {
  const draft = normalizeDraft(input);
  const info = FORMAT_INFO[draft.format];
  const resolved = path.resolve(targetPath);
  if (path.extname(resolved).toLowerCase() !== `.${info.extension}`) {
    throw new Error(`L’extension attendue est .${info.extension}.`);
  }
  const buffer = await nativeDocumentBuffer(draft);
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${randomUUID()}.tmp`;
  await writeFile(temporary, buffer, { mode: 0o600 });
  try {
    await rename(temporary, resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EEXIST', 'EPERM'].includes(code || '')) throw error;
    await rm(resolved, { force: true });
    await rename(temporary, resolved);
  }
  return {
    path: resolved,
    format: draft.format,
    mimeType: info.mimeType,
    size: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    createdAt: new Date().toISOString()
  };
};

export const nativeDocumentInfo = (
  format: NeuraCoNativeDocumentFormat
): { extension: string; mimeType: string } => {
  if (!Object.hasOwn(FORMAT_INFO, format)) throw new Error('Format invalide.');
  return FORMAT_INFO[format];
};
