import { describe, expect, it, vi } from 'vitest';
import { ComputerControlService } from './computer-control-service';

describe('experimental Windows computer control discovery', () => {
  it('returns only top-level windows from the application allowlist', async () => {
    const runner = vi.fn().mockResolvedValue(JSON.stringify([
      {
        processId: 42,
        processName: 'notepad',
        title: 'notes.txt - Bloc-notes',
        handle: '1001',
        x: 20,
        y: 30,
        width: 800,
        height: 600
      },
      {
        processId: 99,
        processName: 'unknown-app',
        title: 'Unknown',
        handle: '1002',
        x: 0,
        y: 0,
        width: 400,
        height: 300
      }
    ]));
    const service = new ComputerControlService({ runner, platform: 'win32' });

    await expect(service.listWindows()).resolves.toEqual([expect.objectContaining({
      applicationId: 'notepad',
      processId: 42,
      title: 'notes.txt - Bloc-notes',
      bounds: { x: 20, y: 30, width: 800, height: 600 }
    })]);
  });

  it('reads a bounded real UI Automation tree for an allowed window', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        processId: 42,
        processName: 'code',
        title: 'Project - Visual Studio Code',
        handle: '1001',
        x: 0,
        y: 0,
        width: 1200,
        height: 800
      }))
      .mockResolvedValueOnce(JSON.stringify([{
        runtimeId: '42.7.1',
        name: 'Open file',
        automationId: 'open-file',
        controlType: 'ControlType.Button',
        enabled: true,
        offscreen: false,
        password: false,
        x: 50,
        y: 60,
        width: 120,
        height: 32
      }]));
    const service = new ComputerControlService({ runner, platform: 'win32' });

    const inspected = await service.inspectWindow('1001:42');
    expect(inspected.elements).toHaveLength(1);
    expect(inspected.elements[0]).toEqual(expect.objectContaining({
      name: 'Open file',
      controlType: 'Button',
      actionable: true
    }));
  });

  it('refuses unsupported platforms and non-allowlisted windows', async () => {
    const unsupported = new ComputerControlService({
      runner: vi.fn(),
      platform: 'linux'
    });
    await expect(unsupported.listWindows()).rejects.toThrow(/Windows/i);

    const service = new ComputerControlService({
      runner: vi.fn().mockResolvedValue('[]'),
      platform: 'win32'
    });
    await expect(service.inspectWindow('999:1')).rejects.toThrow(/liste blanche/i);
  });

  it('creates a visible expiring plan only for a safe UI Automation target', async () => {
    const window = {
      processId: 42,
      processName: 'notepad',
      title: 'notes.txt - Bloc-notes',
      handle: '1001',
      x: 0,
      y: 0,
      width: 800,
      height: 600
    };
    const runner = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(window))
      .mockResolvedValueOnce(JSON.stringify({
        runtimeId: '42.7.1',
        name: 'Document',
        automationId: '15',
        controlType: 'ControlType.Edit',
        enabled: true,
        offscreen: false,
        password: false,
        x: 10,
        y: 20,
        width: 500,
        height: 400
      }));
    const service = new ComputerControlService({ runner, platform: 'win32' });

    const plan = await service.planAction({
      windowId: '1001:42',
      elementRuntimeId: '42.7.1',
      action: 'type',
      text: 'Texte vérifié'
    });
    expect(plan).toEqual(expect.objectContaining({
      status: 'pending',
      confirmationRequired: true,
      action: 'type',
      pointer: { x: 260, y: 220 }
    }));
    expect(Date.parse(plan.expiresAt)).toBeGreaterThan(Date.parse(plan.createdAt));
  });

  it('blocks password and payment-like targets before creating a plan', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        processId: 42,
        processName: 'chrome',
        title: 'Paiement',
        handle: '1001',
        x: 0,
        y: 0,
        width: 800,
        height: 600
      }))
      .mockResolvedValueOnce(JSON.stringify({
        runtimeId: '42.7.1',
        name: 'Mot de passe',
        automationId: 'password',
        controlType: 'ControlType.Edit',
        enabled: true,
        offscreen: false,
        password: true,
        x: 10,
        y: 20,
        width: 300,
        height: 30
      }));
    const service = new ComputerControlService({ runner, platform: 'win32' });

    await expect(service.planAction({
      windowId: '1001:42',
      elementRuntimeId: '42.7.1',
      action: 'type',
      text: 'secret'
    })).rejects.toThrow(/sensible interdite/i);
  });

  it('captures the approved window as a validated PNG', async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        processId: 42,
        processName: 'notepad',
        title: 'notes.txt - Bloc-notes',
        handle: '1001',
        x: 0,
        y: 0,
        width: 800,
        height: 600
      }))
      .mockResolvedValueOnce(Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
      ]).toString('base64'));
    const service = new ComputerControlService({ runner, platform: 'win32' });

    const capture = await service.captureWindow('1001:42');
    expect(capture).toEqual(expect.objectContaining({
      windowId: '1001:42',
      width: 800,
      height: 600
    }));
    expect(capture.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('revalidates the target immediately before executing a confirmed plan', async () => {
    const window = {
      processId: 42,
      processName: 'notepad',
      title: 'notes.txt - Bloc-notes',
      handle: '1001',
      x: 0,
      y: 0,
      width: 800,
      height: 600
    };
    const element = {
      runtimeId: '42.7.1',
      name: 'Document',
      automationId: '15',
      controlType: 'ControlType.Edit',
      enabled: true,
      offscreen: false,
      password: false,
      x: 10,
      y: 20,
      width: 500,
      height: 400
    };
    const runner = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(window))
      .mockResolvedValueOnce(JSON.stringify(element))
      .mockResolvedValueOnce(JSON.stringify(window))
      .mockResolvedValueOnce(JSON.stringify(element))
      .mockResolvedValueOnce('{"ok":true}');
    const service = new ComputerControlService({ runner, platform: 'win32' });
    const plan = await service.planAction({
      windowId: '1001:42',
      elementRuntimeId: '42.7.1',
      action: 'type',
      text: 'Texte confirmé'
    });

    await expect(service.executePlan(plan.id)).resolves.toEqual(expect.objectContaining({
      planId: plan.id,
      status: 'completed',
      action: 'type'
    }));
    expect(service.getPlan(plan.id)?.status).toBe('completed');
  });
});
