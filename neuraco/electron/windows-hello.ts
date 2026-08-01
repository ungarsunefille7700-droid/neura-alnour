import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NeuraCoWindowsHelloAvailability } from './ipc-contract';

const execFileAsync = promisify(execFile);

const awaitHelper = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await-WinRt($Operation, $ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}
[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
`;

const runPowerShell = async (script: string): Promise<string> => {
  if (process.platform !== 'win32') return 'PlatformNotSupported';
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    {
      windowsHide: true,
      timeout: 90_000,
      maxBuffer: 64 * 1024
    }
  );
  return String(stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || 'Unknown';
};

export const parseWindowsHelloAvailability = (
  result: string
): NeuraCoWindowsHelloAvailability => {
  const normalized = result.trim().toLowerCase();
  if (normalized === 'available') return 'available';
  if (normalized === 'notconfiguredforuser') return 'not_configured';
  if (normalized === 'disabledbypolicy') return 'disabled_by_policy';
  if (normalized === 'devicenotpresent' || normalized === 'platformnotsupported') {
    return 'not_supported';
  }
  if (normalized === 'devicebusy') return 'busy';
  return 'unknown';
};

export const checkWindowsHelloAvailability = async (
): Promise<NeuraCoWindowsHelloAvailability> => {
  try {
    const result = await runPowerShell(`
${awaitHelper}
$result = Await-WinRt (
  [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()
) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
Write-Output $result.ToString()
`);
    return parseWindowsHelloAvailability(result);
  } catch {
    return 'unknown';
  }
};

export const requestWindowsHelloVerification = async (
  message: string
): Promise<boolean> => {
  if (process.platform !== 'win32') return false;
  const safeMessage = message.replace(/'/g, "''").slice(0, 160);
  try {
    const result = await runPowerShell(`
${awaitHelper}
$result = Await-WinRt (
  [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${safeMessage}')
) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
Write-Output $result.ToString()
`);
    return result.trim().toLowerCase() === 'verified';
  } catch {
    return false;
  }
};
