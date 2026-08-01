// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NeuraCoDesktopApi,
  NeuraCoRoutinesState
} from '../electron/ipc-contract';
import RoutinesPanel from './RoutinesPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state: NeuraCoRoutinesState = {
  schedulerActive: true,
  localOnlyNotice:
    'Les routines locales sont exécutées uniquement lorsque NeuraCo et le PC sont actifs.',
  routines: [{
    id: 'routine-1',
    name: 'Rapport du matin',
    instruction: 'Analyse les erreurs et prépare un rapport.',
    projectIds: ['project-1'],
    agentIds: ['reviewer'],
    model: 'gemini-2.5-flash',
    schedule: { trigger: 'time', time: '09:00' },
    tools: ['files'],
    budgetCredits: 20,
    autonomy: 'balanced',
    notificationConditions: ['on_success', 'on_failure'],
    executionMode: 'local',
    cloudConsent: false,
    enabled: true,
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
    nextRunAt: '2026-07-30T07:00:00.000Z'
  }],
  recentRuns: [{
    id: 'run-1',
    routineId: 'routine-1',
    routineName: 'Rapport du matin',
    trigger: 'manual',
    executionMode: 'local',
    status: 'completed',
    summary: 'Rapport créé.',
    provider: 'Google',
    model: 'gemini-2.5-flash',
    creditsConsumed: 3,
    startedAt: '2026-07-29T12:00:00.000Z',
    completedAt: '2026-07-29T12:00:05.000Z'
  }]
};

afterEach(() => {
  document.body.innerHTML = '';
  delete window.neuraco;
});

describe('RoutinesPanel', () => {
  it('shows real schedules and toggles a configured routine', async () => {
    const setRoutineEnabled = vi.fn().mockResolvedValue({
      ...state,
      routines: [{ ...state.routines[0], enabled: false }]
    });
    window.neuraco = {
      getRoutinesState: vi.fn().mockResolvedValue(state),
      listAgents: vi.fn().mockResolvedValue([{
        id: 'reviewer',
        name: 'Réviseur',
        role: 'Qualité',
        instructions: 'Vérifie le travail.',
        model: 'auto',
        tools: [],
        allowedApplications: [],
        allowedFolders: [],
        budget: 10,
        autonomy: 'ask',
        memory: 'project',
        color: '#111111',
        icon: 'shield',
        builtIn: true
      }]),
      setRoutineEnabled
    } as unknown as NeuraCoDesktopApi;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <RoutinesPanel
          project={{ id: 'project-1', name: 'Projet', rootPath: 'C:\\Projet' }}
          emergencyStopped={false}
          onStatus={vi.fn()}
        />
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Rapport du matin');
    expect(container.textContent).toContain('planificateur actif');
    expect(container.textContent).toContain('PC sont actifs');
    expect(container.textContent).toContain('Gemini');
    expect(container.textContent).toContain('3 crédits');

    const entry = container.querySelector<HTMLElement>('.routine-entry');
    const toggle = Array.from(entry!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.toLowerCase().includes('sactiver'));
    expect(toggle).toBeDefined();
    await act(async () => {
      toggle!.click();
      await Promise.resolve();
    });
    expect(setRoutineEnabled).toHaveBeenCalledWith('routine-1', false);

    await act(async () => root.unmount());
  });
});
