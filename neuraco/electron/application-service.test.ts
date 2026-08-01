import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateApplicationTarget } from './application-service';

const project = {
  id: 'project-1',
  name: 'Demo',
  rootPath: path.resolve('C:\\projects\\demo')
};

describe('NeuraCo application allowlist', () => {
  it('allows only targets located in the active project', () => {
    const inside = path.join(project.rootPath, 'src', 'App.tsx');
    expect(validateApplicationTarget(project, inside)).toBe(path.resolve(inside));
    expect(validateApplicationTarget(project)).toBeUndefined();
  });

  it('rejects a target outside the active project', () => {
    expect(() => validateApplicationTarget(
      project,
      path.resolve('C:\\projects\\other\\secret.txt')
    )).toThrow(/hors du projet/i);
  });
});
