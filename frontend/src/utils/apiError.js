export const apiErrorMessage = (error, fallback = 'Une erreur est survenue') => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (typeof detail?.message === 'string') return detail.message;
  if (Array.isArray(detail)) return detail.map(item => item.msg).filter(Boolean).join(', ') || fallback;
  return fallback;
};
