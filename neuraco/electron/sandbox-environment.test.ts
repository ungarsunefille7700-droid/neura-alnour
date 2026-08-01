// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSandboxedEnvironment,
  isSensitiveEnvironmentName
} from './sandbox-environment';

describe('NeuraCo sandboxed process environment', () => {
  it('removes secrets, provider credentials and database connections', () => {
    const environment = createSandboxedEnvironment({
      PATH: 'C:\\Windows',
      LANG: 'fr_FR.UTF-8',
      GEMINI_API_KEY: 'hidden',
      GITHUB_TOKEN: 'hidden',
      DATABASE_URL: 'postgres://hidden',
      SSH_AUTH_SOCK: 'hidden',
      CUSTOM_PASSWORD: 'hidden'
    });
    expect(environment).toEqual({
      PATH: 'C:\\Windows',
      LANG: 'fr_FR.UTF-8',
      NEURACO_SANDBOX: '1'
    });
  });

  it('does not allow an override to reintroduce a protected variable', () => {
    const environment = createSandboxedEnvironment(
      { PATH: 'safe' },
      { API_TOKEN: 'hidden', FORCE_COLOR: '1' }
    );
    expect(environment.API_TOKEN).toBeUndefined();
    expect(environment.FORCE_COLOR).toBe('1');
    expect(isSensitiveEnvironmentName('STRIPE_API_KEY')).toBe(true);
    expect(isSensitiveEnvironmentName('PATH')).toBe(false);
  });
});
