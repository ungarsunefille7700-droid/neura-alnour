import { describe, expect, it } from 'vitest';
import {
  checkpointTriggerForCommand,
  commandNeedsProjectCheckpoint
} from './checkpoint-policy';

describe('checkpoint automation policy', () => {
  it.each([
    ['npm install', 'installation'],
    ['pip install fastapi', 'installation'],
    ['alembic upgrade head', 'migration'],
    ['npx prisma db push', 'migration'],
    ['Remove-Item -Recurse src', 'risky_command']
  ] as const)('creates a checkpoint before %s', (command, trigger) => {
    expect(commandNeedsProjectCheckpoint(command)).toBe(true);
    expect(checkpointTriggerForCommand(command)).toBe(trigger);
  });

  it('does not checkpoint a harmless read-only command', () => {
    expect(commandNeedsProjectCheckpoint('git status')).toBe(false);
  });
});
