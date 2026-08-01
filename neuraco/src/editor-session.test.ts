import { describe, expect, it } from 'vitest';
import type { NeuraCoProjectFile } from '../electron/ipc-contract';
import {
  EMPTY_EDITOR_SESSION,
  activeEditorDocument,
  closeEditorDocument,
  isEditorDocumentDirty,
  markEditorDocumentSaved,
  openEditorDocument,
  selectEditorDocument,
  updateEditorDocument
} from './editor-session';

const file = (relativePath: string, content: string): NeuraCoProjectFile => ({
  relativePath,
  content,
  language: 'typescript',
  size: content.length,
  modifiedAt: '2026-07-29T10:00:00.000Z'
});

describe('editor session', () => {
  it('keeps unsaved values when another file is opened and selected', () => {
    let session = openEditorDocument(EMPTY_EDITOR_SESSION, file('src/a.ts', 'a'));
    session = updateEditorDocument(session, 'src/a.ts', 'a changed');
    session = openEditorDocument(session, file('src/b.ts', 'b'));

    expect(activeEditorDocument(session)?.file.relativePath).toBe('src/b.ts');
    session = selectEditorDocument(session, 'src/a.ts');
    expect(activeEditorDocument(session)?.value).toBe('a changed');
    expect(isEditorDocumentDirty(activeEditorDocument(session)!)).toBe(true);
  });

  it('marks only the saved document clean', () => {
    let session = openEditorDocument(EMPTY_EDITOR_SESSION, file('a.ts', 'a'));
    session = updateEditorDocument(session, 'a.ts', 'changed');
    session = openEditorDocument(session, file('b.ts', 'b'));
    session = updateEditorDocument(session, 'b.ts', 'other');
    session = markEditorDocumentSaved(session, 'a.ts', file('a.ts', 'changed'));

    expect(isEditorDocumentDirty(session.documents[0])).toBe(false);
    expect(isEditorDocumentDirty(session.documents[1])).toBe(true);
  });

  it('selects the adjacent tab when the active document closes', () => {
    let session = openEditorDocument(EMPTY_EDITOR_SESSION, file('a.ts', 'a'));
    session = openEditorDocument(session, file('b.ts', 'b'));
    session = openEditorDocument(session, file('c.ts', 'c'));
    session = selectEditorDocument(session, 'b.ts');
    session = closeEditorDocument(session, 'b.ts');

    expect(session.documents.map((document) => document.file.relativePath)).toEqual([
      'a.ts',
      'c.ts'
    ]);
    expect(session.activePath).toBe('c.ts');
  });
});
