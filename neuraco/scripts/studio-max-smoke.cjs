const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { StudioService } = require('../dist-electron/studio-service.js');

const escapeMax = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const runProcess = (executable, args, cwd, timeoutMs = 180000) => new Promise(
  (resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('3ds Max smoke preparation timed out.'));
    }, timeoutMs);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`3ds Max exited with ${code}.\n${output.slice(-4000)}`));
    });
  }
);

const main = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-max-smoke-'));
  try {
    const service = new StudioService({
      storageDirectory: path.join(directory, '.neuraco-studio')
    });
    const max3d = (await service.tools()).find((tool) => tool.id === '3dsmax');
    if (!max3d?.installed) throw new Error('3ds Max is not installed.');
    const scene = path.join(directory, 'smoke.max');
    const initializer = path.join(directory, 'create-scene.ms');
    await writeFile(initializer, `
resetMaxFile #noPrompt
box name:"NeuraCoSmokeBox" length:10 width:10 height:10
saveMaxFile "${escapeMax(scene)}" quiet:true
quitMAX #noPrompt
`, 'utf8');
    await runProcess(
      max3d.executable,
      ['-q', '-silent', '-U', 'MAXScript', initializer],
      directory
    );
    const sceneSize = (await stat(scene)).size;
    const project = {
      id: 'studio-max-smoke',
      name: '3ds Max smoke',
      rootPath: directory
    };
    const inspect = await service.run(
      project,
      {
        taskId: 'max-inspect-smoke',
        operation: 'max_inspect',
        targetPath: 'smoke.max'
      },
      () => undefined
    );
    const reportText = await readFile(inspect.reportPath, 'utf8');
    const report = {
      ok: inspect.ok && sceneSize > 0 && /objects=\d+/i.test(reportText),
      max3d: {
        version: max3d.version,
        executable: max3d.executable
      },
      sceneBytes: sceneSize,
      inspect: reportText.trim(),
      durationMs: inspect.durationMs
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
