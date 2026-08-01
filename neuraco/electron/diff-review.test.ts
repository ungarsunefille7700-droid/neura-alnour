import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './diff-review';

const PATCH = [
  'diff --git a/src/old.ts b/src/new.ts',
  'similarity index 70%',
  'rename from src/old.ts',
  'rename to src/new.ts',
  '--- a/src/old.ts',
  '+++ b/src/new.ts',
  '@@ -2,3 +2,4 @@ export const value = 1;',
  ' context',
  '-before',
  '+after',
  '+added',
  ' tail',
  'diff --git a/src/created.ts b/src/created.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/created.ts',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
  'diff --git a/src/deleted.ts b/src/deleted.ts',
  'deleted file mode 100644',
  '--- a/src/deleted.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-gone'
].join('\n');

describe('parseUnifiedDiff', () => {
  it('parses rename, create and delete metadata with stable hunks', () => {
    const files = parseUnifiedDiff(PATCH);

    expect(files.map((file) => ({
      path: file.path,
      kind: file.changeKind,
      added: file.addedLines,
      removed: file.removedLines
    }))).toEqual([
      { path: 'src/new.ts', kind: 'renamed', added: 2, removed: 1 },
      { path: 'src/created.ts', kind: 'created', added: 2, removed: 0 },
      { path: 'src/deleted.ts', kind: 'deleted', added: 0, removed: 1 }
    ]);
    expect(files[0].hunks[0]).toMatchObject({
      id: 'src/new.ts:2:2:0',
      decision: 'pending',
      oldStart: 2,
      newStart: 2
    });
  });

  it('assigns old and new line numbers without inventing missing sides', () => {
    const lines = parseUnifiedDiff(PATCH)[0].hunks[0].lines;

    expect(lines[0]).toMatchObject({ kind: 'context', oldLine: 2, newLine: 2 });
    expect(lines[1]).toMatchObject({ kind: 'deletion', oldLine: 3 });
    expect(lines[1].newLine).toBeUndefined();
    expect(lines[2]).toMatchObject({ kind: 'addition', newLine: 3 });
    expect(lines[2].oldLine).toBeUndefined();
  });
});
