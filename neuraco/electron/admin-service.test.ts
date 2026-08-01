import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiRequest } = vi.hoisted(() => ({
  authenticatedApiRequest: vi.fn()
}));

vi.mock('./auth-service', () => ({ authenticatedApiRequest }));

import {
  getAdminState,
  listAdminUsers,
  updateAdminConfig,
  updateAdminIncident
} from './admin-service';

describe('admin service', () => {
  beforeEach(() => authenticatedApiRequest.mockReset());

  it('uses only authenticated founder administration routes', async () => {
    authenticatedApiRequest.mockResolvedValue({ role: 'founder' });
    await getAdminState();
    expect(authenticatedApiRequest).toHaveBeenCalledWith(
      '/founder-admin/neuraco/config'
    );

    await listAdminUsers('member+test@example.com');
    expect(authenticatedApiRequest).toHaveBeenLastCalledWith(
      '/founder-admin/users?limit=100&search=member%2Btest%40example.com'
    );

    await updateAdminIncident('incident / 1', { status: 'resolved' });
    expect(authenticatedApiRequest).toHaveBeenLastCalledWith(
      '/founder-admin/neuraco/incidents/incident%20%2F%201',
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved' })
      }
    );
  });

  it('rejects an unreasoned configuration change before any network request', () => {
    expect(() => updateAdminConfig({
      expected_revision: 2,
      reason: 'x'
    })).toThrow('invalide');
    expect(authenticatedApiRequest).not.toHaveBeenCalled();
  });

  it('forwards the expected revision and audit reason unchanged', async () => {
    authenticatedApiRequest.mockResolvedValue({ ok: true });
    const update = {
      expected_revision: 8,
      reason: 'Revision tarifaire validee',
      maintenance: { enabled: false, message: 'Disponible' }
    };
    await updateAdminConfig(update);
    expect(authenticatedApiRequest).toHaveBeenCalledWith(
      '/founder-admin/neuraco/config',
      { method: 'PUT', body: JSON.stringify(update) }
    );
  });
});
