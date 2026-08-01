import type { NeuraCoCheckpointTrigger } from './ipc-contract';
import { isSensitiveTerminalCommand } from './permission-service';

const INSTALLATION_COMMAND = /\b(npm|pnpm|yarn|pip|poetry|composer)\s+(install|add|update)\b/i;
const MIGRATION_COMMAND = /\b(migrate|migration|upgrade|alembic|prisma\s+db|sequelize\s+db)\b/i;

export const commandNeedsProjectCheckpoint = (command: string): boolean => (
  isSensitiveTerminalCommand(command)
  || INSTALLATION_COMMAND.test(command)
  || MIGRATION_COMMAND.test(command)
);

export const checkpointTriggerForCommand = (
  command: string
): NeuraCoCheckpointTrigger => {
  if (INSTALLATION_COMMAND.test(command)) return 'installation';
  if (MIGRATION_COMMAND.test(command)) return 'migration';
  return 'risky_command';
};
