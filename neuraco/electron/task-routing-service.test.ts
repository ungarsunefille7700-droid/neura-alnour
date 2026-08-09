import { describe, expect, it } from 'vitest';
import type { NeuraCoTaskRoutingRequest } from './ipc-contract';
import { routeTask } from './task-routing-service';

const request = (
  content: string,
  overrides: Partial<NeuraCoTaskRoutingRequest> = {}
): NeuraCoTaskRoutingRequest => ({
  projectId: '0123456789abcdef01234567',
  content,
  requestedMode: 'automatic',
  filePaths: [],
  imageCount: 0,
  ...overrides
});

describe('task routing', () => {
  it('routes a Web interface task to real frontend, browser and test agents', () => {
    const preview = routeTask(request(
      'Ajoute une page React responsive et vérifie-la dans le navigateur.',
      { filePaths: ['src/pages/Dashboard.tsx'] }
    ));

    expect(preview.mode).toBe('frontend');
    expect(preview.execution).toBe('multi_agent');
    expect(preview.agents.map((agent) => agent.id)).toEqual([
      'frontend',
      'browser',
      'tests'
    ]);
    expect(preview.tools).toEqual(expect.arrayContaining([
      'code',
      'browser',
      'tests'
    ]));
    expect(preview.primaryModel).toBe('gpt-4o');
    expect(preview.requiresConfirmation).toBe(true);
  });

  it('routes a document task to Cowork without pretending it is code', () => {
    const preview = routeTask(request(
      'Produis un rapport PDF et une présentation PowerPoint à partir du document.',
      { filePaths: ['donnees/rapport.docx'] }
    ));

    expect(preview.mode).toBe('cowork');
    expect(preview.agents.map((agent) => agent.id)).toEqual([
      'cowork',
      'documentation'
    ]);
    expect(preview.tools).toContain('office-preview');
    expect(preview.categories[0].id).toBe('cowork');
  });

  it('combines categories and deduplicates agents for a cross-domain task', () => {
    const preview = routeTask(request(
      'Corrige le script FiveM QBCore, teste-le puis génère une documentation PDF.',
      { filePaths: ['resources/garage/client.lua', 'docs/garage.md'] }
    ));

    expect(preview.mode).toBe('mixed');
    expect(preview.categories.map((category) => category.id)).toEqual(
      expect.arrayContaining(['fivem', 'cowork'])
    );
    expect(preview.agents.map((agent) => agent.id)).toEqual(
      expect.arrayContaining(['fivem', 'developer', 'tests', 'cowork', 'documentation'])
    );
    expect(new Set(preview.agents.map((agent) => agent.id)).size).toBe(
      preview.agents.length
    );
  });

  it('keeps an informational question in chat mode', () => {
    const preview = routeTask(request(
      'Pourquoi utilise-t-on des worktrees Git dans ce projet ?'
    ));

    expect(preview.mode).toBe('question');
    expect(preview.execution).toBe('chat');
    expect(preview.agents).toEqual([]);
    expect(preview.estimatedMinimumCredits).toBeGreaterThan(0);
    expect(preview.estimatedMaximumCredits).toBeGreaterThan(
      preview.estimatedMinimumCredits
    );
  });

  it('honors a manual mode override while keeping confirmation mandatory', () => {
    const preview = routeTask(request('Analyse cette demande.', {
      requestedMode: 'audit'
    }));

    expect(preview.mode).toBe('audit');
    expect(preview.agents.map((agent) => agent.id)).toEqual([
      'reviewer',
      'security',
      'tests'
    ]);
    expect(preview.modeLabel).toContain('Sécurité');
    expect(preview.requiresConfirmation).toBe(true);
  });

  it('changes real routing resources and cost when the effort level changes', () => {
    const rapid = routeTask(request(
      'Ajoute une API FastAPI complète et vérifie les tests.',
      { effort: 'rapid' }
    ));
    const maximum = routeTask(request(
      'Ajoute une API FastAPI complète et vérifie les tests.',
      { effort: 'maximum' }
    ));

    expect(rapid.effort).toBe('rapid');
    expect(rapid.primaryModel).toBe('gemini-2.5-flash');
    expect(rapid.verificationPasses).toBe(1);
    expect(maximum.effort).toBe('maximum');
    expect(maximum.verificationPasses).toBe(4);
    expect(maximum.agents.length).toBeGreaterThan(rapid.agents.length);
    expect(maximum.suggestedBudget).toBeGreaterThan(rapid.suggestedBudget);
    expect(maximum.estimatedMaximumCredits).toBeGreaterThan(
      rapid.estimatedMaximumCredits
    );
  });

  it('changes communication style without changing quality, tools or permissions', () => {
    const normal = routeTask(request(
      'Corrige cette API et lance les tests.',
      { communicationStyle: 'normal' }
    ));
    const pedagogical = routeTask(request(
      'Corrige cette API et lance les tests.',
      { communicationStyle: 'pedagogical' }
    ));

    expect(pedagogical.communicationStyleLabel).toBe('Pédagogique');
    expect(pedagogical.primaryModel).toBe(normal.primaryModel);
    expect(pedagogical.verificationPasses).toBe(normal.verificationPasses);
    expect(pedagogical.agents).toEqual(normal.agents);
    expect(pedagogical.tools).toEqual(normal.tools);
    expect(pedagogical.estimatedMaximumCredits).toBe(
      normal.estimatedMaximumCredits
    );
  });

  it('honors the selected real model and fast response cap', () => {
    const preview = routeTask(request(
      'Crée une API FastAPI et vérifie ses tests.',
      {
        preferredModel: 'gpt-4o',
        responseSpeed: 'fast',
        effort: 'maximum'
      }
    ));

    expect(preview.primaryModel).toBe('gpt-4o');
    expect(preview.responseSpeed).toBe('fast');
    expect(preview.maxOutputTokens).toBe(4_096);
    expect(preview.effortEffects).toEqual(expect.arrayContaining([
      'Vitesse de réponse : rapide',
      'Modèle demandé : gpt-4o'
    ]));
  });
});
