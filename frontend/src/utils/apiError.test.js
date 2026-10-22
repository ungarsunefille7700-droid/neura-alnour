import { apiErrorMessage } from './apiError';

describe('apiErrorMessage', () => {
  test('turns a FastAPI 422 validation array into text (payload captured from /api/auth/register)', () => {
    const error = {
      response: {
        status: 422,
        data: {
          detail: [{
            type: 'value_error',
            loc: ['body', 'email'],
            msg: 'value is not a valid email address: An email address must have an @-sign.',
            input: 'x',
            ctx: { reason: 'An email address must have an @-sign.' }
          }]
        }
      }
    };
    const message = apiErrorMessage(error, 'Erreur lors de l’inscription');
    // A string, never the raw objects that crashed the toast renderer.
    expect(typeof message).toBe('string');
    expect(message).toContain('valid email address');
  });

  test('keeps string details and object messages, falls back otherwise', () => {
    expect(apiErrorMessage({ response: { data: { detail: 'Identifiants invalides' } } }, 'x')).toBe('Identifiants invalides');
    expect(apiErrorMessage({ response: { data: { detail: { message: 'Quota atteint' } } } }, 'x')).toBe('Quota atteint');
    expect(apiErrorMessage(new Error('Network Error'), 'Erreur de connexion')).toBe('Erreur de connexion');
  });
});
