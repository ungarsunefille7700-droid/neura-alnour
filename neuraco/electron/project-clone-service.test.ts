// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  repositoryNameFromUrl,
  validateGitRepositoryUrl
} from './project-clone-service';

describe('NeuraCo Git repository cloning boundary', () => {
  it('accepts a public HTTPS Git URL and extracts its repository name', () => {
    expect(repositoryNameFromUrl('https://github.com/octocat/Hello-World.git'))
      .toBe('Hello-World');
    expect(validateGitRepositoryUrl('https://gitlab.com/group/project'))
      .toBeInstanceOf(URL);
  });

  it('rejects credentials, non-HTTPS protocols and incomplete URLs', () => {
    expect(() => validateGitRepositoryUrl('git@github.com:owner/repo.git')).toThrow(/URL|HTTPS/i);
    expect(() => validateGitRepositoryUrl('http://github.com/owner/repo.git')).toThrow(/HTTPS/i);
    expect(() => validateGitRepositoryUrl('https://token@github.com/owner/repo.git'))
      .toThrow(/identifiant/i);
    expect(() => validateGitRepositoryUrl('https://github.com/')).toThrow(/nom/i);
  });
});
