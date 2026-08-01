import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoProjectSnapshot,
  NeuraCoReviewItem
} from '../electron/ipc-contract';
import ReviewQueuePanel from './ReviewQueuePanel';

const review: NeuraCoReviewItem = {
  id: 'review_12345678',
  source: 'git',
  sourceId: 'agent/feature',
  projectId: 'project-1',
  projectName: 'Portail',
  task: 'Revoir la branche',
  agent: 'Réviseur Git',
  createdAt: '2026-07-29T10:00:00.000Z',
  updatedAt: '2026-07-29T10:00:00.000Z',
  durationMs: 1200,
  creditsUsed: 0.2,
  files: [{
    path: 'src/new.ts',
    changeKind: 'renamed',
    decision: 'pending'
  }],
  tests: [],
  risk: 'low',
  risks: [],
  permissions: ['mode:safe_auto'],
  status: 'pending',
  comments: [],
  summary: 'Un fichier renommé et corrigé.',
  result: 'Revue prête.',
  branch: 'agent/feature',
  diff: {
    branch: 'agent/feature',
    baseBranch: 'main',
    filesChanged: 1,
    insertions: 1,
    deletions: 1,
    stat: '1 file changed',
    patch: 'diff --git a/src/old.ts b/src/new.ts',
    truncated: false
  },
  diffFiles: [{
    path: 'src/new.ts',
    oldPath: 'src/old.ts',
    newPath: 'src/new.ts',
    changeKind: 'renamed',
    addedLines: 1,
    removedLines: 1,
    hunks: [{
      id: 'src/new.ts:2:2:0',
      filePath: 'src/new.ts',
      header: '@@ -2 +2 @@',
      oldStart: 2,
      oldLines: 1,
      newStart: 2,
      newLines: 1,
      addedLines: 1,
      removedLines: 1,
      decision: 'pending',
      lines: [
        { kind: 'deletion', oldLine: 2, content: 'const oldValue = true;' },
        { kind: 'addition', newLine: 2, content: 'const newValue = true;' }
      ]
    }]
  }]
};

const snapshot = {
  project: {
    id: 'project-1',
    name: 'Portail',
    rootPath: 'C:\\projects\\portail'
  },
  files: [],
  indexedFiles: 0,
  excludedEntries: 0,
  truncated: false
} as NeuraCoProjectSnapshot;

describe('ReviewQueuePanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: Partial<NeuraCoDesktopApi>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    api = {
      listReviewQueue: vi.fn().mockResolvedValue([review]),
      decideAllReviewChanges: vi.fn().mockResolvedValue({
        ...review,
        files: [{ ...review.files[0], decision: 'accepted' }]
      })
    };
    window.neuraco = api as NeuraCoDesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete window.neuraco;
  });

  it('renders structured before/after review and exposes real review actions', async () => {
    const onOpenFile = vi.fn();
    await act(async () => {
      root.render(
        <ReviewQueuePanel
          snapshot={snapshot}
          emergencyStopped={false}
          onProjectRefresh={vi.fn()}
          onStatus={vi.fn()}
          onOpenFile={onOpenFile}
        />
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Différences avant / après');
    expect(container.textContent).toContain('src/old.ts → src/new.ts');
    expect(container.textContent).toContain('const oldValue = true;');
    expect(container.textContent).toContain('const newValue = true;');
    expect(container.textContent).toContain('Accepter le bloc');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.review-files > div > button')?.click();
    });
    expect(onOpenFile).toHaveBeenCalledWith('src/new.ts');

    await act(async () => {
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Accepter tout')
      )?.click();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.decideAllReviewChanges).toHaveBeenCalledWith({
      itemId: review.id,
      decision: 'accepted'
    });
  });
});
