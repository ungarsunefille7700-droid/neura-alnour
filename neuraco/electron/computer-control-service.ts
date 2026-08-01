import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  NeuraCoComputerActionPlan,
  NeuraCoComputerActionRequest,
  NeuraCoComputerActionResult,
  NeuraCoComputerCapture,
  NeuraCoComputerElement,
  NeuraCoComputerWindow
} from './ipc-contract';
import { createSandboxedEnvironment } from './sandbox-environment';

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const POWERSHELL_TIMEOUT_MS = 15_000;
const PLAN_LIFETIME_MS = 2 * 60 * 1000;
const CONTROLLED_PROCESSES: Readonly<Record<string, string>> = {
  explorer: 'explorer',
  notepad: 'notepad',
  code: 'vscode',
  msedge: 'edge-isolated',
  chrome: 'chrome-isolated',
  fivem: 'fivem',
  blender: 'blender',
  '3dsmax': '3dsmax'
};

export type ComputerPowerShellRunner = (script: string) => Promise<string>;

const defaultRunner: ComputerPowerShellRunner = (script) => new Promise((resolve, reject) => {
  if (process.platform !== 'win32') {
    reject(new Error('Le contrôle PC expérimental nécessite Windows.'));
    return;
  }
  const executable = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const child = spawn(executable, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], {
    env: createSandboxedEnvironment(),
    windowsHide: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let outputBytes = 0;
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('Windows UI Automation a dépassé 15 secondes.'));
  }, POWERSHELL_TIMEOUT_MS);
  const append = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
    outputBytes += chunk.length;
    if (outputBytes > MAX_OUTPUT_BYTES) {
      child.kill();
      clearTimeout(timer);
      reject(new Error('La sortie UI Automation dépasse 4 Mo.'));
      return;
    }
    if (stream === 'stdout') stdout += chunk.toString('utf8');
    else stderr += chunk.toString('utf8');
  };
  child.stdout.on('data', (chunk: Buffer) => append(chunk, 'stdout'));
  child.stderr.on('data', (chunk: Buffer) => append(chunk, 'stderr'));
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(stderr.trim() || `UI Automation a quitté avec le code ${code}.`));
  });
});

const parseArray = <T>(raw: string): T[] => {
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw) as T | T[];
  return Array.isArray(parsed) ? parsed : [parsed];
};

const finite = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const safeText = (value: unknown, limit: number): string => (
  String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit)
);

const windowListScript = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NeuraCoWindowBounds {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
'@
$result = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
  ForEach-Object {
    $rect = New-Object NeuraCoWindowBounds+RECT
    [void][NeuraCoWindowBounds]::GetWindowRect($_.MainWindowHandle, [ref]$rect)
    [PSCustomObject]@{
      processId = $_.Id
      processName = $_.ProcessName
      title = $_.MainWindowTitle
      handle = $_.MainWindowHandle.ToInt64().ToString()
      x = $rect.Left
      y = $rect.Top
      width = [Math]::Max(0, $rect.Right - $rect.Left)
      height = [Math]::Max(0, $rect.Bottom - $rect.Top)
    }
  }
$result | ConvertTo-Json -Compress -Depth 4
`;

const elementTreeScript = (handle: string) => `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${handle}))
if ($null -eq $root) { throw "Fenêtre UI Automation introuvable." }
$elements = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition
)
$result = for ($index = 0; $index -lt [Math]::Min($elements.Count, 300); $index++) {
  $element = $elements.Item($index)
  try {
    $rect = $element.Current.BoundingRectangle
    if (
      [double]::IsNaN($rect.X) -or [double]::IsInfinity($rect.X) -or
      [double]::IsNaN($rect.Y) -or [double]::IsInfinity($rect.Y) -or
      [double]::IsNaN($rect.Width) -or [double]::IsInfinity($rect.Width) -or
      [double]::IsNaN($rect.Height) -or [double]::IsInfinity($rect.Height)
    ) { continue }
    [PSCustomObject]@{
      runtimeId = (($element.GetRuntimeId() | ForEach-Object { $_.ToString() }) -join ".")
      name = $element.Current.Name
      automationId = $element.Current.AutomationId
      controlType = $element.Current.ControlType.ProgrammaticName
      enabled = $element.Current.IsEnabled
      offscreen = $element.Current.IsOffscreen
      password = $element.Current.IsPassword
      x = [Math]::Round($rect.X)
      y = [Math]::Round($rect.Y)
      width = [Math]::Round($rect.Width)
      height = [Math]::Round($rect.Height)
    }
  } catch {}
}
$result | ConvertTo-Json -Compress -Depth 4
`;

const captureWindowScript = (window: NeuraCoComputerWindow) => `
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NeuraCoWindowCapture {
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
'@
$bitmap = New-Object System.Drawing.Bitmap(${Math.round(window.bounds.width)}, ${Math.round(window.bounds.height)})
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $hdc = $graphics.GetHdc()
  try {
    $printed = [NeuraCoWindowCapture]::PrintWindow(
      [IntPtr]::new(${window.handle}),
      $hdc,
      2
    )
  } finally {
    $graphics.ReleaseHdc($hdc)
  }
  if (-not $printed) {
    $graphics.CopyFromScreen(
      ${Math.round(window.bounds.x)},
      ${Math.round(window.bounds.y)},
      0,
      0,
      $bitmap.Size,
      [System.Drawing.CopyPixelOperation]::SourceCopy
    )
  }
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    [Convert]::ToBase64String($stream.ToArray())
  } finally {
    $stream.Dispose()
  }
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
`;

const SENSITIVE_COMPUTER_ACTION = new RegExp([
  'password', 'mot de passe', 'passcode', 'otp', 'captcha', 'cvv',
  'carte bancaire', 'credit card', 'checkout', 'payment', 'paiement',
  'payer', 'acheter', 'purchase', 'transfer', 'virement', 'publish',
  'publier', 'send all', 'envoi massif', 'delete permanently',
  'suppression définitive', 'account settings', 'paramètres du compte',
  'administrator', 'administrateur', 'registry', 'registre', 'firewall',
  'pare-feu'
].join('|'), 'i');

const actionScript = (
  plan: NeuraCoComputerActionPlan,
  text: string
): string => {
  if (!/^-?\d+(?:\.-?\d+)*$/.test(plan.element.runtimeId)) {
    throw new Error('Identifiant UI Automation invalide.');
  }
  const encodedText = Buffer.from(text, 'utf8').toString('base64');
  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NeuraCoComputerInput {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new(${plan.window.handle}))
if ($null -eq $root) { throw "Fenêtre UI Automation introuvable." }
$runtimeId = "${plan.element.runtimeId}"
$elements = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.Condition]::TrueCondition
)
$target = $null
for ($index = 0; $index -lt $elements.Count; $index++) {
  $candidate = $elements.Item($index)
  try {
    if ((($candidate.GetRuntimeId() | ForEach-Object { $_.ToString() }) -join ".") -eq $runtimeId) {
      $target = $candidate
      break
    }
  } catch {}
}
if ($null -eq $target) { throw "L'élément UI Automation a changé ou disparu." }
if (-not $target.Current.IsEnabled -or $target.Current.IsOffscreen -or $target.Current.IsPassword) {
  throw "L'élément UI Automation n'est plus actionnable."
}
[void][NeuraCoComputerInput]::SetForegroundWindow([IntPtr]::new(${plan.window.handle}))
Start-Sleep -Milliseconds 120
switch ("${plan.action}") {
  "focus" {
    $target.SetFocus()
  }
  "click" {
    $invoke = $null
    if ($target.TryGetCurrentPattern(
      [System.Windows.Automation.InvokePattern]::Pattern,
      [ref]$invoke
    )) {
      $invoke.Invoke()
    } else {
      [void][NeuraCoComputerInput]::SetCursorPos(${plan.pointer.x}, ${plan.pointer.y})
      [NeuraCoComputerInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      [NeuraCoComputerInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
  }
  "type" {
    $value = $null
    if (-not $target.TryGetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern,
      [ref]$value
    )) {
      throw "Ce champ ne supporte pas la saisie UI Automation sécurisée."
    }
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${encodedText}"))
    $target.SetFocus()
    $value.SetValue($text)
  }
}
[PSCustomObject]@{ ok = $true; action = "${plan.action}" } | ConvertTo-Json -Compress
`;
};

export class ComputerControlService {
  private readonly runner: ComputerPowerShellRunner;
  private readonly platform: NodeJS.Platform;
  private readonly plans = new Map<string, NeuraCoComputerActionPlan>();
  private readonly planTexts = new Map<string, string>();

  constructor(options: {
    runner?: ComputerPowerShellRunner;
    platform?: NodeJS.Platform;
  } = {}) {
    this.runner = options.runner || defaultRunner;
    this.platform = options.platform || process.platform;
  }

  private ensureWindows(): void {
    if (this.platform !== 'win32') {
      throw new Error('Le contrôle PC expérimental nécessite Windows.');
    }
  }

  async listWindows(): Promise<NeuraCoComputerWindow[]> {
    this.ensureWindows();
    const rows = parseArray<Record<string, unknown>>(await this.runner(windowListScript));
    return rows.flatMap((row) => {
      const processName = safeText(row.processName, 80).toLowerCase();
      const applicationId = CONTROLLED_PROCESSES[processName];
      const processId = Math.round(finite(row.processId));
      const handle = safeText(row.handle, 32);
      const title = safeText(row.title, 500);
      if (!applicationId || processId < 1 || !/^\d+$/.test(handle) || !title) return [];
      return [{
        id: `${handle}:${processId}`,
        applicationId,
        processId,
        processName,
        title,
        handle,
        bounds: {
          x: finite(row.x),
          y: finite(row.y),
          width: Math.max(0, finite(row.width)),
          height: Math.max(0, finite(row.height))
        }
      }];
    });
  }

  async inspectWindow(windowId: string): Promise<{
    window: NeuraCoComputerWindow;
    elements: NeuraCoComputerElement[];
    inspectedAt: string;
  }> {
    this.ensureWindows();
    const windows = await this.listWindows();
    const window = windows.find((candidate) => candidate.id === windowId);
    if (!window) throw new Error('Cette fenêtre n’est pas dans la liste blanche NeuraCo.');
    const rows = parseArray<Record<string, unknown>>(
      await this.runner(elementTreeScript(window.handle))
    );
    const elements = rows.flatMap((row) => {
      const width = Math.max(0, finite(row.width));
      const height = Math.max(0, finite(row.height));
      const runtimeId = safeText(row.runtimeId, 200);
      if (!runtimeId) return [];
      const controlType = safeText(row.controlType, 120).replace(
        /^ControlType\./,
        ''
      );
      return [{
        id: randomUUID(),
        runtimeId,
        name: safeText(row.name, 500),
        automationId: safeText(row.automationId, 300),
        controlType,
        enabled: Boolean(row.enabled),
        offscreen: Boolean(row.offscreen),
        password: Boolean(row.password),
        actionable: Boolean(
          row.enabled
          && !row.offscreen
          && width > 0
          && height > 0
          && /Button|Edit|ComboBox|CheckBox|RadioButton|Hyperlink|ListItem|MenuItem|TabItem/i
            .test(controlType)
        ),
        bounds: {
          x: finite(row.x),
          y: finite(row.y),
          width,
          height
        }
      }];
    });
    return {
      window,
      elements,
      inspectedAt: new Date().toISOString()
    };
  }

  async captureWindow(windowId: string): Promise<NeuraCoComputerCapture> {
    this.ensureWindows();
    const window = (await this.listWindows()).find(
      (candidate) => candidate.id === windowId
    );
    if (!window) throw new Error('Cette fenêtre n’est pas dans la liste blanche NeuraCo.');
    const { width, height } = window.bounds;
    if (
      width < 1
      || height < 1
      || width > 10_000
      || height > 10_000
      || width * height > 40_000_000
    ) {
      throw new Error('Les dimensions de cette fenêtre ne permettent pas une capture sûre.');
    }
    const encoded = (await this.runner(captureWindowScript(window))).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error('La capture Windows retournée est invalide.');
    }
    const png = Buffer.from(encoded, 'base64');
    if (
      png.length < 8
      || png[0] !== 0x89
      || png.subarray(1, 4).toString('ascii') !== 'PNG'
    ) {
      throw new Error('La capture Windows n’est pas un fichier PNG valide.');
    }
    return {
      id: randomUUID(),
      windowId: window.id,
      dataUrl: `data:image/png;base64,${encoded}`,
      width,
      height,
      capturedAt: new Date().toISOString()
    };
  }

  async planAction(
    request: NeuraCoComputerActionRequest
  ): Promise<NeuraCoComputerActionPlan> {
    this.ensureWindows();
    if (!['focus', 'click', 'type'].includes(request.action)) {
      throw new Error('Action de contrôle PC invalide.');
    }
    const inspection = await this.inspectWindow(String(request.windowId || ''));
    const element = inspection.elements.find(
      (candidate) => candidate.runtimeId === String(request.elementRuntimeId || '')
    );
    if (!element || !element.actionable) {
      throw new Error('L’élément UI Automation ciblé n’est pas actionnable.');
    }
    const text = request.action === 'type' ? String(request.text || '') : '';
    if (request.action === 'type' && (!text || text.length > 4_000)) {
      throw new Error('Le texte à saisir doit contenir entre 1 et 4 000 caractères.');
    }
    if (request.action === 'type' && !/Edit|ComboBox/i.test(element.controlType)) {
      throw new Error('La saisie est limitée aux champs de texte identifiés par UI Automation.');
    }
    const sensitiveContext = [
      inspection.window.title,
      element.name,
      element.automationId,
      element.controlType
    ].join(' ');
    if (element.password || SENSITIVE_COMPUTER_ACTION.test(sensitiveContext)) {
      throw new Error(
        'Action sensible interdite: mot de passe, paiement, publication, compte ou administration.'
      );
    }
    const pointer = {
      x: Math.round(element.bounds.x + element.bounds.width / 2),
      y: Math.round(element.bounds.y + element.bounds.height / 2)
    };
    const windowRight = inspection.window.bounds.x + inspection.window.bounds.width;
    const windowBottom = inspection.window.bounds.y + inspection.window.bounds.height;
    if (
      pointer.x < inspection.window.bounds.x
      || pointer.y < inspection.window.bounds.y
      || pointer.x > windowRight
      || pointer.y > windowBottom
    ) {
      throw new Error('Les coordonnées calculées sont hors de la fenêtre autorisée.');
    }
    const createdAt = new Date();
    const plan: NeuraCoComputerActionPlan = {
      id: randomUUID(),
      status: 'pending',
      window: inspection.window,
      element,
      action: request.action,
      pointer,
      textPreview: text ? text.slice(0, 160) : undefined,
      confirmationRequired: true,
      risk: 'moderate',
      explanation: request.action === 'type'
        ? `Saisir ${text.length} caractère(s) dans « ${element.name || element.controlType} ».`
        : `${request.action === 'click' ? 'Cliquer sur' : 'Donner le focus à'} « ${element.name || element.controlType} ».`,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PLAN_LIFETIME_MS).toISOString()
    };
    this.plans.set(plan.id, plan);
    this.planTexts.set(plan.id, text);
    return plan;
  }

  getPlan(planId: string): NeuraCoComputerActionPlan | undefined {
    const plan = this.plans.get(planId);
    return plan ? { ...plan } : undefined;
  }

  cancelPlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== 'pending') return false;
    plan.status = 'cancelled';
    this.planTexts.delete(planId);
    return true;
  }

  async executePlan(planId: string): Promise<NeuraCoComputerActionResult> {
    this.ensureWindows();
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== 'pending') {
      throw new Error('Ce plan de contrôle PC n’est plus exécutable.');
    }
    if (Date.now() > Date.parse(plan.expiresAt)) {
      plan.status = 'expired';
      this.planTexts.delete(planId);
      throw new Error('Ce plan de contrôle PC a expiré. Préparez une nouvelle action.');
    }
    const inspection = await this.inspectWindow(plan.window.id);
    const freshElement = inspection.elements.find(
      (candidate) => candidate.runtimeId === plan.element.runtimeId
    );
    if (
      inspection.window.processId !== plan.window.processId
      || !freshElement
      || !freshElement.actionable
      || freshElement.password
      || SENSITIVE_COMPUTER_ACTION.test([
        inspection.window.title,
        freshElement.name,
        freshElement.automationId,
        freshElement.controlType
      ].join(' '))
    ) {
      throw new Error('La fenêtre ou l’élément a changé; l’action est refusée.');
    }
    const output = JSON.parse(
      await this.runner(actionScript(plan, this.planTexts.get(planId) || ''))
    ) as { ok?: boolean };
    if (!output?.ok) throw new Error('Windows UI Automation n’a pas confirmé l’action.');
    plan.status = 'completed';
    this.planTexts.delete(planId);
    return {
      planId: plan.id,
      status: 'completed',
      action: plan.action,
      windowId: plan.window.id,
      completedAt: new Date().toISOString()
    };
  }
}
