import type {
  NeuraCoAgentModel,
  NeuraCoCommunicationStyle,
  NeuraCoEffortLevel,
  NeuraCoResponseSpeed,
  NeuraCoTaskCategory,
  NeuraCoTaskMode,
  NeuraCoTaskRoutingAgent,
  NeuraCoTaskRoutingPreview,
  NeuraCoTaskRoutingRequest
} from './ipc-contract';
import { isNeuraCoAgentModel } from './model-utils';
import { BUILT_IN_AGENTS } from './multi-agent-service';

type RoutedMode = Exclude<NeuraCoTaskMode, 'automatic'>;

const EFFORT_LABELS: Record<NeuraCoEffortLevel, string> = {
  rapid: 'Rapide',
  normal: 'Normal',
  deep: 'Approfondi',
  maximum: 'Maximum'
};

const STYLE_LABELS: Record<NeuraCoCommunicationStyle, string> = {
  direct: 'Direct et court',
  normal: 'Normal',
  detailed: 'Détaillé',
  pedagogical: 'Pédagogique'
};

const EFFORT_CONFIGURATION: Record<NeuraCoEffortLevel, {
  verificationPasses: number;
  maxOutputTokens: number;
  costFactor: number;
  budgetFactor: number;
}> = {
  rapid: {
    verificationPasses: 1,
    maxOutputTokens: 3_500,
    costFactor: 0.65,
    budgetFactor: 0.7
  },
  normal: {
    verificationPasses: 2,
    maxOutputTokens: 7_000,
    costFactor: 1,
    budgetFactor: 1
  },
  deep: {
    verificationPasses: 3,
    maxOutputTokens: 11_000,
    costFactor: 1.55,
    budgetFactor: 1.5
  },
  maximum: {
    verificationPasses: 4,
    maxOutputTokens: 16_000,
    costFactor: 2.25,
    budgetFactor: 2
  }
};

interface CategoryRule {
  label: string;
  terms: string[];
  extensions?: string[];
  agents: string[];
  tools: string[];
}

const CATEGORY_RULES: Record<NeuraCoTaskCategory, CategoryRule> = {
  code: {
    label: 'Développement',
    terms: [
      'code', 'coder', 'programme', 'script', 'api', 'backend', 'serveur',
      'base de donnees', 'database', 'bug', 'erreur', 'stack trace', 'exception',
      'corrige', 'implemente', 'fonctionnalite', 'refactor', 'typescript',
      'javascript', 'python', 'java', 'php', 'c#', 'c++', 'sql'
    ],
    extensions: [
      '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.php', '.cs', '.cpp',
      '.c', '.go', '.rs', '.sql', '.rb', '.swift', '.kt'
    ],
    agents: ['architect', 'developer', 'tests'],
    tools: ['project-context', 'code', 'terminal', 'tests', 'git']
  },
  cowork: {
    label: 'Cowork',
    terms: [
      'document', 'docx', 'word', 'pdf', 'presentation', 'powerpoint', 'pptx',
      'tableur', 'excel', 'xlsx', 'csv', 'rapport', 'livrable', 'documentation',
      'organise les dossiers', 'renomme les fichiers', 'compare les documents',
      'resume ce document', 'extraire les donnees'
    ],
    extensions: [
      '.docx', '.pdf', '.pptx', '.xlsx', '.csv', '.md', '.rtf', '.odt'
    ],
    agents: ['cowork', 'documentation'],
    tools: ['project-context', 'documentation', 'files', 'office-preview']
  },
  research: {
    label: 'Recherche',
    terms: [
      'recherche', 'cherche sur internet', 'sources', 'source officielle',
      'benchmark', 'veille', 'actualite', 'compare les offres', 'rapport de recherche',
      'documentation officielle', 'web'
    ],
    agents: ['explorer', 'documentation'],
    tools: ['search', 'browser', 'documentation']
  },
  '3d': {
    label: '3D',
    terms: [
      '3d', 'blender', '3ds max', '3dsmax', 'modele 3d', 'mesh', 'maillage',
      'texture', 'materiau', 'uv', 'rig', 'animation 3d', 'fbx', 'glb', 'gltf',
      'obj', 'rendu 3d'
    ],
    extensions: ['.blend', '.max', '.fbx', '.glb', '.gltf', '.obj', '.stl'],
    agents: ['blender-3d', 'reviewer'],
    tools: ['project-context', '3d', 'Blender', '3ds Max', 'review']
  },
  fivem: {
    label: 'FiveM',
    terms: [
      'fivem', 'qbcore', 'esx', 'txadmin', 'fxmanifest', 'gta rp', 'serveur rp',
      'resource fivem', 'script lua'
    ],
    extensions: ['.lua'],
    agents: ['fivem', 'developer', 'tests'],
    tools: ['project-context', 'code', 'terminal', 'tests', 'FiveM', 'txAdmin']
  },
  frontend: {
    label: 'Interface Web',
    terms: [
      'frontend', 'interface web', 'page web', 'ui', 'ux', 'react', 'next.js',
      'vue', 'angular', 'css', 'tailwind', 'responsive', 'accessibilite',
      'navigateur', 'design de la page', 'composant'
    ],
    extensions: ['.tsx', '.jsx', '.css', '.scss', '.html', '.vue', '.svelte'],
    agents: ['frontend', 'browser', 'tests'],
    tools: ['project-context', 'code', 'browser', 'tests']
  },
  audit: {
    label: 'Audit',
    terms: [
      'audit', 'revue de code', 'review', 'securite', 'vulnerabilite',
      'vulnerabilites', 'faille', 'secret expose', 'performance', 'regression',
      'code mort', 'dependance dangereuse', 'accessibilite'
    ],
    agents: ['reviewer', 'security', 'tests'],
    tools: ['project-context', 'review', 'security', 'tests', 'git']
  }
};

const MODE_LABELS: Record<RoutedMode, string> = {
  question: 'Question',
  plan: 'Plan',
  code: 'Code',
  cowork: 'Cowork',
  research: 'Recherche',
  '3d': '3D',
  fivem: 'FiveM',
  frontend: 'Frontend + Navigateur',
  audit: 'Révision + Sécurité',
  mixed: 'Tâche mixte'
};

const REQUESTED_MODES = new Set<NeuraCoTaskRoutingRequest['requestedMode']>([
  'automatic',
  'question',
  'plan',
  'code',
  'cowork',
  'research',
  '3d',
  'fivem',
  'frontend',
  'audit'
]);

const normalize = (value: string): string => (
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
);

const roundCredits = (value: number): number => Math.round(value * 100) / 100;

const scoreCategories = (
  content: string,
  filePaths: string[]
): Array<{ id: NeuraCoTaskCategory; score: number }> => {
  const normalized = normalize(content);
  const normalizedFiles = filePaths.map((file) => normalize(file));
  return (Object.entries(CATEGORY_RULES) as Array<
    [NeuraCoTaskCategory, CategoryRule]
  >).map(([id, rule]) => {
    const termHits = rule.terms.reduce(
      (total, term) => total + (normalized.includes(normalize(term)) ? 1 : 0),
      0
    );
    const extensionHits = (rule.extensions || []).reduce(
      (total, extension) => total + (
        normalizedFiles.some((file) => file.endsWith(extension)) ? 1 : 0
      ),
      0
    );
    return {
      id,
      score: termHits * 3 + extensionHits * 2
    };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
};

const isPlanningRequest = (content: string): boolean => {
  const normalized = normalize(content);
  return [
    'fais un plan',
    'cree un plan',
    'propose un plan',
    'analyse avant de modifier',
    'sans modifier',
    'ne modifie rien'
  ].some((term) => normalized.includes(term));
};

const isWorkRequest = (content: string): boolean => {
  const normalized = normalize(content);
  return [
    'ajoute', 'cree', 'modifie', 'corrige', 'implemente', 'genere', 'produis',
    'organise', 'renomme', 'analyse le projet', 'audite', 'audit', 'teste',
    'recherche', 'construis', 'developpe', 'supprime', 'compare'
  ].some((term) => normalized.includes(term));
};

const selectMode = (
  request: NeuraCoTaskRoutingRequest,
  scored: Array<{ id: NeuraCoTaskCategory; score: number }>
): RoutedMode => {
  const requestedMode = REQUESTED_MODES.has(request.requestedMode)
    ? request.requestedMode
    : 'automatic';
  if (requestedMode !== 'automatic') return requestedMode;
  if (isPlanningRequest(request.content)) return 'plan';
  if (!isWorkRequest(request.content) && scored.length === 0) return 'question';
  if (scored.length === 0) return 'code';
  const significant = scored.filter((item) => (
    item.score >= Math.max(3, scored[0].score * 0.55)
  ));
  if (significant.length > 1) return 'mixed';
  return scored[0].id;
};

const categoriesForMode = (
  mode: RoutedMode,
  scored: Array<{ id: NeuraCoTaskCategory; score: number }>
): Array<{ id: NeuraCoTaskCategory; score: number }> => {
  if (mode === 'question' || mode === 'plan') return [];
  if (mode !== 'mixed') {
    return [{
      id: mode,
      score: scored.find((item) => item.id === mode)?.score || 3
    }];
  }
  return scored
    .filter((item) => item.score >= Math.max(3, scored[0].score * 0.55))
    .slice(0, 4);
};

const agentInfo = (agentIds: string[]): NeuraCoTaskRoutingAgent[] => {
  const lookup = new Map(BUILT_IN_AGENTS.map((agent) => [agent.id, agent]));
  return [...new Set(agentIds)].slice(0, 8).flatMap((id) => {
    const agent = lookup.get(id);
    return agent ? [{
      id: agent.id,
      name: agent.name,
      role: agent.role
    }] : [];
  });
};

const agentsForEffort = (
  baseAgentIds: string[],
  effort: NeuraCoEffortLevel
): string[] => {
  const unique = [...new Set(baseAgentIds)];
  if (effort === 'rapid' && unique.length > 2) {
    const primary = unique.find((id) => ![
      'architect',
      'documentation',
      'browser',
      'reviewer',
      'security',
      'tests'
    ].includes(id)) || unique[0];
    const validator = unique.includes('tests')
      ? 'tests'
      : unique.find((id) => id !== primary);
    return [primary, validator].filter((id): id is string => Boolean(id));
  }
  if (effort === 'deep') {
    return [...new Set([...unique, 'tests', 'reviewer'])].slice(0, 8);
  }
  if (effort === 'maximum') {
    return [...new Set([
      ...unique,
      'tests',
      'reviewer',
      'security',
      'documentation'
    ])].slice(0, 8);
  }
  return unique;
};

const complexityOf = (
  request: NeuraCoTaskRoutingRequest,
  categories: Array<{ id: NeuraCoTaskCategory; score: number }>,
  agentCount: number
): NeuraCoTaskRoutingPreview['complexity'] => {
  const normalized = normalize(request.content);
  const complexTerms = [
    'projet complet', 'application complete', 'architecture', 'migration',
    'plusieurs fichiers', 'de bout en bout', 'production', 'securite avancee'
  ];
  const score = (
    Math.min(3, Math.floor(request.content.length / 1200))
    + Math.min(3, Math.floor(request.filePaths.length / 4))
    + Math.min(2, request.imageCount)
    + Math.max(0, categories.length - 1)
    + Math.max(0, agentCount - 3)
    + (complexTerms.some((term) => normalized.includes(term)) ? 3 : 0)
  );
  if (score >= 6) return 'complex';
  if (score >= 2) return 'standard';
  return 'simple';
};

const primaryModelFor = (
  categories: NeuraCoTaskCategory[],
  imageCount: number,
  effort: NeuraCoEffortLevel,
  preferredModel: NeuraCoAgentModel = 'auto'
): NeuraCoTaskRoutingPreview['primaryModel'] => {
  if (preferredModel !== 'auto') return preferredModel;
  if (effort === 'rapid') return 'gemini-2.5-flash';
  if (effort === 'maximum') {
    return imageCount > 0 || categories.includes('3d') || categories.includes('frontend')
      ? 'gpt-4o'
      : 'claude-sonnet-4-5';
  }
  if (effort === 'deep' && categories.length === 0) return 'gpt-4o';
  if (imageCount > 0 || categories.includes('3d') || categories.includes('frontend')) {
    return 'gpt-4o';
  }
  if (
    categories.includes('code')
    || categories.includes('fivem')
    || categories.includes('audit')
  ) {
    return 'claude-sonnet-4-5';
  }
  return 'gemini-2.5-flash';
};

export const routeTask = (
  request: NeuraCoTaskRoutingRequest
): NeuraCoTaskRoutingPreview => {
  if (
    !request
    || typeof request.content !== 'string'
    || !request.content.trim()
    || !Array.isArray(request.filePaths)
  ) {
    throw new Error('Demande de routage NeuraCo invalide.');
  }
  const scored = scoreCategories(request.content, request.filePaths);
  const effort: NeuraCoEffortLevel = [
    'rapid',
    'normal',
    'deep',
    'maximum'
  ].includes(String(request.effort))
    ? request.effort as NeuraCoEffortLevel
    : 'normal';
  const communicationStyle: NeuraCoCommunicationStyle = [
    'direct',
    'normal',
    'detailed',
    'pedagogical'
  ].includes(String(request.communicationStyle))
    ? request.communicationStyle as NeuraCoCommunicationStyle
    : 'normal';
  const preferredModel: NeuraCoAgentModel = isNeuraCoAgentModel(request.preferredModel)
    ? request.preferredModel
    : 'auto';
  const responseSpeed: NeuraCoResponseSpeed = request.responseSpeed === 'fast'
    ? 'fast'
    : 'standard';
  const effortConfiguration = EFFORT_CONFIGURATION[effort];
  const mode = selectMode(request, scored);
  const selectedCategories = categoriesForMode(mode, scored);
  const categoryIds = selectedCategories.map((item) => item.id);
  const baseAgentIds = mode === 'question' || mode === 'plan'
    ? []
    : selectedCategories.flatMap((item) => CATEGORY_RULES[item.id].agents);
  const agentIds = agentsForEffort(baseAgentIds, effort);
  const agents = agentInfo(agentIds);
  const tools = [...new Set(
    selectedCategories.flatMap((item) => CATEGORY_RULES[item.id].tools)
  )];
  if (mode === 'question') tools.push('project-context');
  if (mode === 'plan') tools.push('project-context', 'reasoning');
  tools.push(`verification-pass-${effortConfiguration.verificationPasses}`);
  const categories = selectedCategories.map((item) => ({
    id: item.id,
    label: CATEGORY_RULES[item.id].label,
    confidence: Math.min(100, Math.max(35, 35 + item.score * 8))
  }));
  const complexity = complexityOf(request, selectedCategories, agents.length);
  const complexityFactor = complexity === 'complex' ? 2 : complexity === 'standard' ? 1.35 : 1;
  const model = primaryModelFor(
    categoryIds,
    Math.max(0, request.imageCount || 0),
    effort,
    preferredModel
  );
  const maxOutputTokens = responseSpeed === 'fast'
    ? Math.min(4_096, effortConfiguration.maxOutputTokens)
    : effortConfiguration.maxOutputTokens;
  const modelFactor = model === 'claude-sonnet-4-5'
    ? 1.25
    : model === 'gpt-4o'
      ? 1.15
      : model === 'gemini-2.5-flash'
        ? 0.65
        : 1.25;
  const agentFactor = Math.max(1, agents.length);
  const contentFactor = Math.max(1, request.content.length / 1600);
  const estimatedMinimumCredits = roundCredits(
    Math.max(
      0.2,
      0.45
      * modelFactor
      * complexityFactor
      * agentFactor
      * contentFactor
      * effortConfiguration.costFactor
    )
  );
  const estimatedMaximumCredits = roundCredits(
    Math.max(
      estimatedMinimumCredits + 0.25,
      estimatedMinimumCredits * (1.8 + agentFactor * 0.12)
    )
  );
  const suggestedBudget = Math.min(
    100,
    Math.max(
      3,
      Math.ceil(
        Math.max(1, agents.length)
        * 5
        * complexityFactor
        * effortConfiguration.budgetFactor
      )
    )
  );
  const reason = mode === 'question'
    ? 'La demande ne contient pas d’action de modification détectée.'
    : mode === 'plan'
      ? 'La demande exige une analyse ou un plan sans exécution.'
      : mode === 'mixed'
        ? `La tâche combine ${categories.map((item) => item.label).join(', ')}.`
        : `La demande correspond principalement au mode ${MODE_LABELS[mode]}.`;
  return {
    mode,
    modeLabel: MODE_LABELS[mode],
    reason,
    categories,
    agents,
    tools,
    primaryModel: model,
    responseSpeed,
    effort,
    effortLabel: EFFORT_LABELS[effort],
    communicationStyle,
    communicationStyleLabel: STYLE_LABELS[communicationStyle],
    verificationPasses: effortConfiguration.verificationPasses,
    maxOutputTokens,
    effortEffects: [
      `${effortConfiguration.verificationPasses} passe(s) de vérification`,
      `${agents.length || 1} agent(s) ou assistant principal`,
      `${maxOutputTokens.toLocaleString('fr-FR')} jetons de sortie maximum`,
      `Vitesse de réponse : ${responseSpeed === 'fast' ? 'rapide' : 'standard'}`,
      `Modèle demandé : ${model}`
    ],
    complexity,
    execution: mode === 'question' || mode === 'plan' ? 'chat' : 'multi_agent',
    suggestedBudget,
    estimatedMinimumCredits,
    estimatedMaximumCredits,
    estimateSource: 'local',
    requiresConfirmation: true
  };
};
