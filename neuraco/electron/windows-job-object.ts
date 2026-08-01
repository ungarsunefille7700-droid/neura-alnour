import path from 'node:path';

const WINDOWS_JOB_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class NeuraCoJobBoundary
{
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private const uint JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
    private const uint JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private static IntPtr jobHandle = IntPtr.Zero;

    public static void Apply()
    {
        if (jobHandle != IntPtr.Zero) return;
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");

        var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_ACTIVE_PROCESS |
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION |
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        limits.BasicLimitInformation.ActiveProcessLimit = 64;
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr pointer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(limits, pointer, false);
            if (!SetInformationJobObject(job, 9, pointer, (uint)length))
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "SetInformationJobObject failed"
                );
            IntPtr current = System.Diagnostics.Process.GetCurrentProcess().Handle;
            if (!AssignProcessToJobObject(job, current))
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "AssignProcessToJobObject failed"
                );
            jobHandle = job;
        }
        catch
        {
            CloseHandle(job);
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }
}
'@

[NeuraCoJobBoundary]::Apply()
$executable = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($env:NEURACO_JOB_EXECUTABLE_BASE64)
)
$argumentsJson = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($env:NEURACO_JOB_ARGUMENTS_BASE64)
)
$arguments = @($argumentsJson | ConvertFrom-Json)
Remove-Item Env:NEURACO_JOB_EXECUTABLE_BASE64 -ErrorAction SilentlyContinue
Remove-Item Env:NEURACO_JOB_ARGUMENTS_BASE64 -ErrorAction SilentlyContinue
& $executable @arguments
if ($null -eq $LASTEXITCODE) { exit 0 }
exit $LASTEXITCODE
`;

const encodedScript = Buffer.from(WINDOWS_JOB_SCRIPT, 'utf16le').toString('base64');

export interface WindowsJobCommand {
  executable: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
}

export const wrapWithWindowsJobObject = (
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env
): WindowsJobCommand => {
  if (process.platform !== 'win32') {
    return { executable, args, environment };
  }
  const windowsRoot = environment.SystemRoot || environment.WINDIR || 'C:\\Windows';
  return {
    executable: path.join(
      windowsRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    ),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedScript
    ],
    environment: {
      ...environment,
      NEURACO_JOB_EXECUTABLE_BASE64: Buffer.from(executable, 'utf8').toString('base64'),
      NEURACO_JOB_ARGUMENTS_BASE64: Buffer.from(JSON.stringify(args), 'utf8').toString('base64')
    }
  };
};
