export type CliCommand =
  | 'chat'
  | 'open'
  | 'plan'
  | 'run'
  | 'review'
  | 'agents'
  | 'status'
  | 'resume'
  | 'stop'
  | 'login'
  | 'logout'
  | 'help';

export type CliModel =
  | 'auto'
  | 'claude-sonnet-4-5'
  | 'gpt-4o'
  | 'gemini-2.5-flash';

export interface ParsedCliArguments {
  command: CliCommand;
  positionals: string[];
  model: CliModel;
  agent: string;
  budget?: number;
  attachments: string[];
  executionMode: 'local' | 'cloud';
  readOnly: boolean;
  automatic: boolean;
  nonInteractive: boolean;
  json: boolean;
}

const COMMANDS = new Set<CliCommand>([
  'chat',
  'open',
  'plan',
  'run',
  'review',
  'agents',
  'status',
  'resume',
  'stop',
  'login',
  'logout',
  'help'
]);

const MODELS = new Set<CliModel>([
  'auto',
  'claude-sonnet-4-5',
  'gpt-4o',
  'gemini-2.5-flash'
]);

const requireValue = (args: string[], index: number, option: string): string => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`L'option ${option} nécessite une valeur.`);
  }
  return value;
};

export const parseCliArguments = (argv: string[]): ParsedCliArguments => {
  const args = [...argv];
  let command: CliCommand = 'chat';
  if (args[0] && !args[0].startsWith('-')) {
    const requested = args.shift() as CliCommand;
    if (!COMMANDS.has(requested)) {
      throw new Error(`Commande NeuraCo inconnue: ${requested}`);
    }
    command = requested;
  }

  const parsed: ParsedCliArguments = {
    command,
    positionals: [],
    model: 'auto',
    agent: 'assistant',
    attachments: [],
    executionMode: 'local',
    readOnly: false,
    automatic: false,
    nonInteractive: false,
    json: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      parsed.positionals.push(value);
      continue;
    }
    if (value === '--read-only') {
      parsed.readOnly = true;
      continue;
    }
    if (value === '--cloud') {
      parsed.executionMode = 'cloud';
      continue;
    }
    if (value === '--local') {
      parsed.executionMode = 'local';
      continue;
    }
    if (value === '--auto') {
      parsed.automatic = true;
      continue;
    }
    if (value === '--non-interactive') {
      parsed.nonInteractive = true;
      continue;
    }
    if (value === '--json') {
      parsed.json = true;
      continue;
    }
    if (value === '--model') {
      const model = requireValue(args, index, value) as CliModel;
      if (!MODELS.has(model)) throw new Error(`Modèle NeuraCo invalide: ${model}`);
      parsed.model = model;
      index += 1;
      continue;
    }
    if (value === '--agent') {
      const agent = requireValue(args, index, value).trim();
      if (!/^[A-Za-z0-9_-]{2,80}$/.test(agent)) {
        throw new Error('Identifiant d’agent NeuraCo invalide.');
      }
      parsed.agent = agent;
      index += 1;
      continue;
    }
    if (value === '--budget') {
      const budget = Number(requireValue(args, index, value));
      if (!Number.isInteger(budget) || budget < 1 || budget > 100) {
        throw new Error('Le budget doit être un entier entre 1 et 100.');
      }
      parsed.budget = budget;
      index += 1;
      continue;
    }
    if (value === '--attach') {
      parsed.attachments.push(requireValue(args, index, value));
      if (parsed.attachments.length > 16) {
        throw new Error('Vous pouvez joindre au maximum seize fichiers.');
      }
      index += 1;
      continue;
    }
    throw new Error(`Option NeuraCo inconnue: ${value}`);
  }

  if (parsed.readOnly && parsed.automatic) {
    throw new Error('Les modes --read-only et --auto ne peuvent pas être combinés.');
  }
  if (parsed.nonInteractive && command === 'chat' && parsed.positionals.length === 0) {
    throw new Error('Le mode non interactif nécessite une instruction.');
  }
  return parsed;
};
