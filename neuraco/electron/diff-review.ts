import type {
  NeuraCoReviewDiffFile,
  NeuraCoReviewDiffHunk,
  NeuraCoReviewDiffLine
} from './ipc-contract';

const filePathFromHeader = (value: string): string => (
  value.replace(/^"(.*)"$/, '$1').replace(/\\(["\\])/g, '$1')
);

const hunkId = (
  filePath: string,
  oldStart: number,
  newStart: number,
  index: number
): string => `${filePath}:${oldStart}:${newStart}:${index}`;

export const parseUnifiedDiff = (patch: string): NeuraCoReviewDiffFile[] => {
  const files: NeuraCoReviewDiffFile[] = [];
  let currentFile: NeuraCoReviewDiffFile | undefined;
  let currentHunk: NeuraCoReviewDiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  const finishHunk = () => {
    if (!currentFile || !currentHunk) return;
    currentHunk.addedLines = currentHunk.lines.filter(
      (line) => line.kind === 'addition'
    ).length;
    currentHunk.removedLines = currentHunk.lines.filter(
      (line) => line.kind === 'deletion'
    ).length;
    currentFile.addedLines += currentHunk.addedLines;
    currentFile.removedLines += currentHunk.removedLines;
    currentFile.hunks.push(currentHunk);
    currentHunk = undefined;
  };

  const finishFile = () => {
    finishHunk();
    if (currentFile) files.push(currentFile);
    currentFile = undefined;
  };

  for (const rawLine of String(patch || '').split(/\r?\n/)) {
    const fileHeader = rawLine.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (fileHeader) {
      finishFile();
      const oldPath = filePathFromHeader(fileHeader[1]);
      const newPath = filePathFromHeader(fileHeader[2]);
      currentFile = {
        path: newPath,
        oldPath,
        newPath,
        changeKind: 'modified',
        addedLines: 0,
        removedLines: 0,
        hunks: []
      };
      continue;
    }
    if (!currentFile) continue;
    if (rawLine.startsWith('new file mode ') || rawLine === '--- /dev/null') {
      currentFile.changeKind = 'created';
      continue;
    }
    if (rawLine.startsWith('deleted file mode ') || rawLine === '+++ /dev/null') {
      currentFile.changeKind = 'deleted';
      currentFile.path = currentFile.oldPath;
      continue;
    }
    if (rawLine.startsWith('rename from ')) {
      currentFile.changeKind = 'renamed';
      currentFile.oldPath = filePathFromHeader(rawLine.slice('rename from '.length));
      continue;
    }
    if (rawLine.startsWith('rename to ')) {
      currentFile.changeKind = 'renamed';
      currentFile.newPath = filePathFromHeader(rawLine.slice('rename to '.length));
      currentFile.path = currentFile.newPath;
      continue;
    }

    const hunkHeader = rawLine.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
    );
    if (hunkHeader) {
      finishHunk();
      oldLine = Number(hunkHeader[1]);
      newLine = Number(hunkHeader[3]);
      currentHunk = {
        id: hunkId(currentFile.path, oldLine, newLine, currentFile.hunks.length),
        filePath: currentFile.path,
        header: rawLine,
        oldStart: oldLine,
        oldLines: Number(hunkHeader[2] || 1),
        newStart: newLine,
        newLines: Number(hunkHeader[4] || 1),
        addedLines: 0,
        removedLines: 0,
        decision: 'pending',
        lines: []
      };
      continue;
    }
    if (!currentHunk || rawLine === '\\ No newline at end of file') continue;

    let line: NeuraCoReviewDiffLine | undefined;
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      line = {
        kind: 'addition',
        newLine,
        content: rawLine.slice(1)
      };
      newLine += 1;
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      line = {
        kind: 'deletion',
        oldLine,
        content: rawLine.slice(1)
      };
      oldLine += 1;
    } else if (rawLine.startsWith(' ')) {
      line = {
        kind: 'context',
        oldLine,
        newLine,
        content: rawLine.slice(1)
      };
      oldLine += 1;
      newLine += 1;
    }
    if (line) currentHunk.lines.push(line);
  }
  finishFile();
  return files;
};
