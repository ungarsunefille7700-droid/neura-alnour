import type { NeuraCoProjectFile } from '../electron/ipc-contract';

export interface NeuraCoEditorDocument {
  file: NeuraCoProjectFile;
  value: string;
}

export interface NeuraCoEditorSession {
  activePath?: string;
  documents: NeuraCoEditorDocument[];
}

export const EMPTY_EDITOR_SESSION: NeuraCoEditorSession = {
  documents: []
};

export const activeEditorDocument = (
  session: NeuraCoEditorSession
): NeuraCoEditorDocument | undefined => (
  session.documents.find((document) => document.file.relativePath === session.activePath)
);

export const openEditorDocument = (
  session: NeuraCoEditorSession,
  file: NeuraCoProjectFile
): NeuraCoEditorSession => {
  const existing = session.documents.find(
    (document) => document.file.relativePath === file.relativePath
  );
  return {
    activePath: file.relativePath,
    documents: existing
      ? session.documents
      : [...session.documents, { file, value: file.content }]
  };
};

export const selectEditorDocument = (
  session: NeuraCoEditorSession,
  relativePath: string
): NeuraCoEditorSession => (
  session.documents.some((document) => document.file.relativePath === relativePath)
    ? { ...session, activePath: relativePath }
    : session
);

export const updateEditorDocument = (
  session: NeuraCoEditorSession,
  relativePath: string,
  value: string
): NeuraCoEditorSession => ({
  ...session,
  documents: session.documents.map((document) => (
    document.file.relativePath === relativePath
      ? { ...document, value }
      : document
  ))
});

export const markEditorDocumentSaved = (
  session: NeuraCoEditorSession,
  relativePath: string,
  file: NeuraCoProjectFile
): NeuraCoEditorSession => ({
  ...session,
  documents: session.documents.map((document) => (
    document.file.relativePath === relativePath
      ? { file, value: file.content }
      : document
  ))
});

export const closeEditorDocument = (
  session: NeuraCoEditorSession,
  relativePath: string
): NeuraCoEditorSession => {
  const closingIndex = session.documents.findIndex(
    (document) => document.file.relativePath === relativePath
  );
  if (closingIndex < 0) return session;
  const documents = session.documents.filter(
    (document) => document.file.relativePath !== relativePath
  );
  if (session.activePath !== relativePath) return { ...session, documents };
  const next = documents[Math.min(closingIndex, documents.length - 1)];
  return {
    activePath: next?.file.relativePath,
    documents
  };
};

export const isEditorDocumentDirty = (document: NeuraCoEditorDocument): boolean => (
  document.value !== document.file.content
);
