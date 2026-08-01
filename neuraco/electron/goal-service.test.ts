import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GoalService } from './goal-service';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

const createService = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-goals-'));
  directories.push(directory);
  return new GoalService(path.join(directory, 'goals.json'));
};

describe('GoalService', () => {
  it('persists a complete goal and computes progress from verified work', async () => {
    const service = await createService();
    let goal = await service.create({
      title: 'Livrer NeuraCo',
      expectedResult: 'Une application installable et testée.',
      description: 'Terminer les fonctions restantes sans régression.',
      steps: ['Implémenter', 'Tester'],
      successCriteria: ['Build réussi', 'Tests réussis'],
      priority: 'critical',
      budget: 40,
      projectIds: ['project-1'],
      agentIds: ['developer', 'tests'],
      targetDate: '2026-08-30'
    });

    expect(goal.progress).toBe(0);
    expect((await service.list('project-1'))[0]).toMatchObject({
      title: 'Livrer NeuraCo',
      priority: 'critical',
      budget: 40
    });

    goal = await service.updateStep(goal.id, goal.steps[0].id, 'completed');
    expect(goal.progress).toBe(25);
    goal = await service.update(goal.id, {
      criterionId: goal.successCriteria[0].id,
      criterionSatisfied: true
    });
    expect(goal.progress).toBe(50);
  });

  it('keeps agent-proposed steps pending until explicit approval', async () => {
    const service = await createService();
    let goal = await service.create({
      title: 'Stabiliser le produit',
      expectedResult: 'Aucune régression.',
      description: '',
      steps: ['Analyser'],
      successCriteria: ['Tests verts'],
      priority: 'high',
      budget: 20,
      projectIds: ['project-1'],
      agentIds: ['reviewer']
    });

    goal = await service.proposeFromTasks(goal.id, 'task-12345678', [{
      id: 'agent-task-1',
      agentId: 'reviewer',
      agentName: 'Réviseur',
      agentRole: 'Review',
      objective: 'Ajouter un test de non-régression',
      files: [],
      dependencies: [],
      acceptanceCriteria: [],
      budget: 2,
      status: 'completed'
    }]);
    expect(goal.steps).toHaveLength(1);
    expect(goal.proposals[0]).toMatchObject({
      title: 'Ajouter un test de non-régression',
      status: 'pending'
    });

    goal = await service.resolveProposal(goal.id, goal.proposals[0].id, 'approved');
    expect(goal.steps).toHaveLength(2);
    expect(goal.steps[1].title).toBe('Ajouter un test de non-régression');
    expect(goal.proposals[0].status).toBe('approved');
  });

  it('redacts secrets from goal content', async () => {
    const service = await createService();
    const goal = await service.create({
      title: 'Déployer',
      expectedResult: 'Utiliser sk-secret-value-that-must-not-leak',
      description: '',
      steps: [],
      successCriteria: [],
      priority: 'medium',
      budget: 1,
      projectIds: ['project-1'],
      agentIds: []
    });
    expect(goal.expectedResult).not.toContain('sk-secret-value');
  });
});
