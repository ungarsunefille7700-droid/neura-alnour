// Readable plan names (the stored ids are internal: pro, neura_plus...).
export const PLAN_LABELS = {
  free: 'Gratuit',
  mongo: 'Mongo',
  pro: 'Plus',
  developer: 'Développeur',
  neura_plus: 'Neura+',
  neura_ultra: 'Neura Ultra',
  comme_toi: 'Comme Toi',
};

export const planLabel = (plan) => PLAN_LABELS[plan] || 'Gratuit';
