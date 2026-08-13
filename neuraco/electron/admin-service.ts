import { authenticatedApiRequest } from './auth-service';
import type {
  NeuraCoAdminConfigUpdate,
  NeuraCoAdminCreditAdjustment,
  NeuraCoAdminIncident,
  NeuraCoAdminIncidentCreate,
  NeuraCoAdminIncidentUpdate,
  NeuraCoAdminLedgerResult,
  NeuraCoAdminLog,
  NeuraCoAdminPricingHistory,
  NeuraCoAdminPromotion,
  NeuraCoAdminPromotionCreate,
  NeuraCoAdminRefundRecord,
  NeuraCoAdminState,
  NeuraCoAdminUser,
  NeuraCoRuntimePolicy
} from './ipc-contract';

const RUNTIME_POLICY_TIMEOUT_MS = 12 * 1000;

const json = (method: 'POST' | 'PUT' | 'PATCH', body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body)
});

export const getRuntimePolicy = (): Promise<NeuraCoRuntimePolicy> => (
  authenticatedApiRequest('/neuraco/runtime-policy', {}, RUNTIME_POLICY_TIMEOUT_MS)
);

export const getAdminState = (): Promise<NeuraCoAdminState> => (
  authenticatedApiRequest('/founder-admin/neuraco/config')
);

export const updateAdminConfig = (
  update: NeuraCoAdminConfigUpdate
): Promise<{ ok: boolean; config: NeuraCoAdminState['config'] }> => {
  if (!update || !Number.isInteger(update.expected_revision) || update.reason.trim().length < 3) {
    throw new Error('Modification administrateur NeuraCo invalide.');
  }
  return authenticatedApiRequest(
    '/founder-admin/neuraco/config',
    json('PUT', update)
  );
};

export const getAdminPricingHistory = (): Promise<NeuraCoAdminPricingHistory[]> => (
  authenticatedApiRequest('/founder-admin/neuraco/pricing-history')
);

export const listAdminUsers = (search = ''): Promise<NeuraCoAdminUser[]> => {
  const term = search.trim().slice(0, 120);
  return authenticatedApiRequest(
    `/founder-admin/users?limit=100&search=${encodeURIComponent(term)}`
  );
};

export const listAdminLogs = (): Promise<NeuraCoAdminLog[]> => (
  authenticatedApiRequest('/founder-admin/logs')
);

export const listAdminIncidents = (): Promise<NeuraCoAdminIncident[]> => (
  authenticatedApiRequest('/founder-admin/neuraco/incidents')
);

export const createAdminIncident = (
  request: NeuraCoAdminIncidentCreate
): Promise<{ ok: boolean; incident: NeuraCoAdminIncident }> => (
  authenticatedApiRequest(
    '/founder-admin/neuraco/incidents',
    json('POST', request)
  )
);

export const updateAdminIncident = (
  incidentId: string,
  request: NeuraCoAdminIncidentUpdate
): Promise<{ ok: boolean; incident_id: string; status: string }> => (
  authenticatedApiRequest(
    `/founder-admin/neuraco/incidents/${encodeURIComponent(incidentId)}`,
    json('PATCH', request)
  )
);

export const listAdminPromotions = (): Promise<NeuraCoAdminPromotion[]> => (
  authenticatedApiRequest('/founder-admin/neuraco/promotions')
);

export const createAdminPromotion = (
  request: NeuraCoAdminPromotionCreate
): Promise<{ ok: boolean; promotion: NeuraCoAdminPromotion }> => (
  authenticatedApiRequest(
    '/founder-admin/neuraco/promotions',
    json('POST', request)
  )
);

export const updateAdminPromotion = (
  promotionId: string,
  active: boolean
): Promise<{ ok: boolean; promotion_id: string; active: boolean }> => (
  authenticatedApiRequest(
    `/founder-admin/neuraco/promotions/${encodeURIComponent(promotionId)}`,
    json('PATCH', { active })
  )
);

export const adjustAdminCredits = (
  request: NeuraCoAdminCreditAdjustment
): Promise<NeuraCoAdminLedgerResult> => (
  authenticatedApiRequest(
    '/founder-admin/neuraco/credits/adjust',
    json('POST', request)
  )
);

export const recordAdminRefund = (
  request: NeuraCoAdminRefundRecord
): Promise<NeuraCoAdminLedgerResult> => (
  authenticatedApiRequest(
    '/founder-admin/neuraco/refunds',
    json('POST', request)
  )
);
