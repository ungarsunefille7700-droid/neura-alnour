import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MultiAgentService,
  parseOrchestratorPlan,
  planConflictFreeWaves,
  planDependencyWaves
} from './multi-agent-service';

const temporaryDirectories: string[] = [];

const temporaryStore = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-agents-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'agents.json');
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {
      recursive: true,
      force: true
    }))
  );
});

describe('multi-agent planning', () => {
  it('keeps only existing files and the declared budget', () => {
    const plan = parseOrchestratorPlan(
      JSON.stringify({
        summary: 'Plan',
        risks: ['Conflit'],
        tasks: [
          {
            id: 'front',
            agentRole: 'Frontend',
            objective: 'Vérifier le composant',
            files: ['src/App.tsx', '.env'],
            budget: 4
          },
          {
            id: 'tests',
            agentRole: 'Tests',
            objective: 'Proposer les tests',
            files: ['src/App.tsx'],
            dependencies: ['front'],
            acceptanceCriteria: ['Le test couvre le contrat'],
            budget: 8
          }
        ]
      }),
      ['src/App.tsx'],
      4,
      6
    );

    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].files).toEqual(['src/App.tsx']);
    expect(plan.tasks[0].budget + plan.tasks[1].budget).toBe(6);
    expect(plan.tasks[1].dependencies).toEqual(['front']);
    expect(plan.tasks[1].acceptanceCriteria).toEqual(['Le test couvre le contrat']);
  });

  it('never schedules two tasks touching the same file in one wave', () => {
    const waves = planConflictFreeWaves([
      { id: 'a', files: ['src/App.tsx'] },
      { id: 'b', files: ['backend/server.py'] },
      { id: 'c', files: ['src/App.tsx'] }
    ]);

    expect(waves).toEqual([['a', 'b'], ['c']]);
  });

  it('respects dependencies and reports cycles without looping', () => {
    expect(planDependencyWaves([
      { id: 'analysis', files: ['src/App.tsx'], dependencies: [] },
      { id: 'tests', files: ['tests/App.test.tsx'], dependencies: ['analysis'] },
      { id: 'docs', files: ['README.md'], dependencies: [] }
    ])).toEqual({
      waves: [['analysis', 'docs'], ['tests']],
      blocked: []
    });

    expect(planDependencyWaves([
      { id: 'a', files: [], dependencies: ['b'] },
      { id: 'b', files: [], dependencies: ['a'] }
    ])).toEqual({
      waves: [],
      blocked: ['a', 'b']
    });
  });
});

describe('MultiAgentService', () => {
  it('persists validated custom agents without changing built-in agents', async () => {
    const storePath = await temporaryStore();
    const service = new MultiAgentService({ storePath });

    await service.saveAgent({
      id: 'my-auditor',
      name: 'Mon auditeur',
      role: 'Audit ciblé',
      instructions: 'Vérifie le contrat.',
      model: 'gpt-4o',
      tools: ['review'],
      allowedApplications: [],
      allowedFolders: ['src'],
      budget: 9,
      autonomy: 'scoped',
      memory: 'project',
      color: '#123456',
      icon: 'scan'
    });

    const agents = await service.listAgents();
    expect(agents.some((agent) => agent.id === 'architect' && agent.builtIn)).toBe(true);
    expect(agents.find((agent) => agent.id === 'my-auditor')).toMatchObject({
      model: 'gpt-4o',
      budget: 9,
      builtIn: false
    });
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toHaveLength(1);
  });

  it('orchestrates specialists, real metadata and an independent review', async () => {
    const storePath = await temporaryStore();
    const calls: Array<Record<string, unknown>> = [];
    const executePhase = vi.fn(async (body: Record<string, unknown>) => {
      calls.push(body);
      const phase = body.phase as 'orchestrator' | 'specialist' | 'reviewer';
      const message = phase === 'orchestrator'
        ? JSON.stringify({
          summary: 'Séparer frontend et backend',
          risks: ['Contrat API'],
          tasks: [
            {
              id: 'frontend-task',
              agentRole: 'Frontend',
              objective: 'Analyser le composant',
              files: ['src/App.tsx'],
              budget: 3
            },
            {
              id: 'backend-task',
              agentRole: 'Backend',
              objective: 'Analyser la route',
              files: ['backend/server.py'],
              budget: 3
            }
          ]
        })
        : phase === 'reviewer'
          ? 'Revue indépendante: le contrat doit rester cohérent.'
          : `Résultat concret de ${body.agent_name}.`;
      return {
        message,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        model_display: 'Claude Sonnet 4.5',
        task_id: body.task_id as string,
        agent_id: body.agent_id as string,
        agent_name: body.agent_name as string,
        phase,
        files_used: [],
        budget: body.budget as number,
        duration_ms: 12,
        entitlement_plan: 'neura_plus',
        usage: {
          credits_consumed: phase === 'orchestrator'
            ? 0.3
            : phase === 'reviewer'
              ? 0.2
              : 0.25,
          input_tokens: 120,
          output_tokens: 80
        }
      };
    });
    const service = new MultiAgentService({ storePath, executePhase });
    const progress: string[] = [];
    const result = await service.run({
      objective: 'Vérifier le contrat entre le frontend et le backend.',
      projectId: '0123456789abcdef01234567',
      projectName: 'NeuraCo test',
      selectedAgentIds: ['frontend', 'backend'],
      maxAgents: 2,
      budget: 8,
      files: [
        { path: 'src/App.tsx', content: 'export default function App() {}' },
        { path: 'backend/server.py', content: 'app = FastAPI()' }
      ]
    }, new AbortController().signal, (event) => progress.push(event.phase));

    expect(calls.map((call) => call.phase)).toEqual([
      'orchestrator',
      'specialist',
      'specialist',
      'reviewer'
    ]);
    expect(result.tasks.map((task) => task.agentId)).toEqual(['frontend', 'backend']);
    expect(result.tasks.every((task) => task.model === 'claude-sonnet-4-5')).toBe(true);
    expect(result.review).toContain('Revue indépendante');
    expect(result.creditsConsumed).toBe(1);
    expect(result.tasks.every((task) => task.creditsConsumed === 0.25)).toBe(true);
    expect(progress).toContain('completed');
  });

  it('transmits bounded coordination between dependent agents and releases files', async () => {
    const storePath = await temporaryStore();
    const calls: Array<Record<string, unknown>> = [];
    const executePhase = vi.fn(async (body: Record<string, unknown>) => {
      calls.push(body);
      const phase = body.phase as 'orchestrator' | 'specialist' | 'reviewer';
      let message = 'Revue terminee.';
      if (phase === 'orchestrator') {
        message = JSON.stringify({
          summary: 'Analyser puis verifier',
          risks: [],
          tasks: [
            {
              id: 'analysis-task',
              agentRole: 'Developpeur',
              objective: 'Analyser le composant',
              files: ['src/App.tsx'],
              dependencies: [],
              acceptanceCriteria: ['Identifier le contrat'],
              budget: 2
            },
            {
              id: 'tests-task',
              agentRole: 'Tests',
              objective: 'Verifier le contrat',
              files: ['tests/App.test.tsx'],
              dependencies: ['analysis-task'],
              acceptanceCriteria: ['Proposer un test reproductible'],
              budget: 2
            }
          ]
        });
      } else if (phase === 'specialist' && body.agent_id === 'developer') {
        message = JSON.stringify({
          result: 'Le contrat attend une valeur booleenne.',
          intermediateResult: 'Contrat booleen identifie.',
          questions: [],
          blockers: [],
          testState: 'pending',
          coordination: [{
            toAgentId: 'tests',
            kind: 'verification_request',
            subject: 'Verifier le contrat',
            body: 'Confirme que le test couvre la valeur booleenne.',
            relatedTaskId: 'tests-task'
          }]
        });
      } else if (phase === 'specialist') {
        expect(String(body.objective)).toContain('Contrat booleen identifie.');
        expect(String(body.objective)).toContain('verification_request');
        message = JSON.stringify({
          result: 'Le test couvre le contrat.',
          questions: [],
          blockers: [],
          testState: 'passed',
          coordination: [{
            toAgentId: 'developer',
            kind: 'response',
            subject: 'Verification terminee',
            body: 'Le contrat est couvert.'
          }]
        });
      }
      return {
        message,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        model_display: 'Claude Sonnet 4.5',
        task_id: body.task_id as string,
        agent_id: body.agent_id as string,
        agent_name: body.agent_name as string,
        phase,
        files_used: [],
        budget: body.budget as number,
        duration_ms: 10,
        entitlement_plan: 'neura_plus',
        usage: { credits_consumed: 0.1 }
      };
    });
    const service = new MultiAgentService({ storePath, executePhase });
    const progressEvents: unknown[] = [];
    const result = await service.run({
      objective: 'Verifier une dependance entre analyse et tests.',
      projectId: '0123456789abcdef01234567',
      projectName: 'NeuraCo test',
      selectedAgentIds: ['developer', 'tests'],
      maxAgents: 2,
      budget: 8,
      files: [
        { path: 'src/App.tsx', content: 'export const ready = true;' },
        { path: 'tests/App.test.tsx', content: 'expect(ready).toBe(true);' }
      ]
    }, new AbortController().signal, (event) => progressEvents.push(event));

    expect(calls.map((call) => `${call.phase}:${call.agent_id}`)).toEqual([
      'orchestrator:architect',
      'specialist:developer',
      'specialist:tests',
      'reviewer:reviewer'
    ]);
    expect(result.tasks[1]).toMatchObject({
      dependencies: ['analysis-task'],
      testState: 'passed',
      status: 'completed'
    });
    expect(result.coordinationMessages.some((message) => (
      message.fromAgentId === 'developer'
      && message.toAgentId === 'tests'
      && message.kind === 'verification_request'
    ))).toBe(true);
    expect(result.coordinationMessages.some((message) => (
      message.fromAgentId === 'developer'
      && message.toAgentId === 'tests'
      && message.kind === 'result'
    ))).toBe(true);
    expect(result.fileReservations).toHaveLength(2);
    expect(result.fileReservations.every((reservation) => reservation.releasedAt)).toBe(true);
    expect(result.coordinationLimits.messagesUsed).toBeLessThanOrEqual(
      result.coordinationLimits.maxMessages
    );
    expect(progressEvents.length).toBeGreaterThan(3);
  });
});
