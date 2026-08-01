import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  NeuraCoNativeDocumentDraft,
  NeuraCoNativeDocumentFormat
} from './ipc-contract';
import {
  nativeDocumentBuffer,
  previewNativeDocument,
  writeNativeDocument
} from './native-document-service';

const roots: string[] = [];

const draft = (
  format: NeuraCoNativeDocumentFormat,
  content = '# Rapport\n\n- Élément vérifié\n- Résultat concret'
): NeuraCoNativeDocumentDraft => ({
  title: 'Rapport NeuraCo',
  description: 'Document de validation',
  format,
  content,
  author: 'NeuraCo'
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

describe('native document service', () => {
  it('generates actual DOCX, PDF and PPTX containers', async () => {
    const docx = await nativeDocumentBuffer(draft('docx'));
    const pdf = await nativeDocumentBuffer(draft('pdf'));
    const pptx = await nativeDocumentBuffer(draft(
      'pptx',
      '# Introduction\n- Premier point\n---\n# Résultats\n- Test réussi'
    ));
    expect(docx.subarray(0, 2).toString()).toBe('PK');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pptx.subarray(0, 2).toString()).toBe('PK');
    expect(docx.byteLength).toBeGreaterThan(1_000);
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    expect(pptx.byteLength).toBeGreaterThan(1_000);
  });

  it('generates a real XLSX workbook and previews tabular data', async () => {
    const source = 'Nom,Statut\nTests,Réussis\nBuild,Réussi';
    const xlsx = await nativeDocumentBuffer(draft('xlsx', source));
    const preview = previewNativeDocument(draft('xlsx', source));
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
    expect(preview.mimeType).toContain('spreadsheetml');
    expect(preview.previewHtml).toContain('<table>');
    expect(preview.previewHtml).toContain('Réussis');
    expect(preview.itemCount).toBe(3);
  });

  it('validates JSON and produces native text formats without renaming', async () => {
    const json = await nativeDocumentBuffer(draft('json', '{"ok":true,"count":2}'));
    const csv = await nativeDocumentBuffer(draft('csv', 'a,b\n1,2'));
    const markdown = await nativeDocumentBuffer(draft('markdown'));
    const html = await nativeDocumentBuffer(draft(
      'html',
      '<html><head></head><body><script>alert(1)</script><p>Valide</p></body></html>'
    ));
    expect(JSON.parse(json.toString('utf8'))).toEqual({ ok: true, count: 2 });
    expect(csv.toString('utf8')).toMatch(/^\uFEFFa,b\r\n1,2/);
    expect(markdown.toString('utf8')).toContain('# Rapport');
    expect(html.toString('utf8')).toContain('Content-Security-Policy');
    expect(html.toString('utf8')).not.toContain('<script>');
    expect(() => previewNativeDocument(draft('json', '{invalide'))).toThrow(/JSON/i);
  });

  it('writes atomically and returns verifiable size and checksum', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'neuraco-native-doc-'));
    roots.push(root);
    const target = path.join(root, 'rapport.docx');
    const result = await writeNativeDocument(draft('docx'), target);
    const saved = await readFile(target);
    expect(result.path).toBe(target);
    expect(result.size).toBe(saved.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.subarray(0, 2).toString()).toBe('PK');
    await expect(writeNativeDocument(
      draft('pdf'),
      path.join(root, 'faux-document.docx')
    )).rejects.toThrow(/extension/i);
  });
});
