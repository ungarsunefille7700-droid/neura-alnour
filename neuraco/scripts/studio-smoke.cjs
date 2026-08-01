const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, readFile, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { StudioService } = require('../dist-electron/studio-service.js');

const runProcess = (executable, args, cwd, timeoutMs = 120000) => new Promise(
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
      reject(new Error('Blender smoke preparation timed out.'));
    }, timeoutMs);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`Blender exited with ${code}.\n${output.slice(-4000)}`));
    });
  }
);

const main = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'neuraco-blender-smoke-'));
  try {
    const service = new StudioService({
      storageDirectory: path.join(directory, '.neuraco-studio')
    });
    const blender = (await service.tools()).find((tool) => tool.id === 'blender');
    if (!blender?.installed) throw new Error('Blender is not installed.');
    const scene = path.join(directory, 'smoke.blend');
    const python = [
      'import bpy',
      'bpy.ops.mesh.primitive_cube_add(location=(0,0,0))',
      `bpy.ops.wm.save_as_mainfile(filepath=r"${scene.replace(/\\/g, '\\\\')}")`
    ].join(';');
    await runProcess(
      blender.executable,
      ['--background', '--factory-startup', '--python-expr', python],
      directory
    );
    const project = {
      id: 'studio-smoke',
      name: 'Studio smoke',
      rootPath: directory
    };
    const analysis = await service.analyze(project);
    const inspect = await service.run(
      project,
      {
        taskId: 'blender-inspect-smoke',
        operation: 'blender_inspect',
        targetPath: 'smoke.blend'
      },
      () => undefined
    );
    const exported = await service.run(
      project,
      {
        taskId: 'blender-export-smoke',
        operation: 'blender_export_gltf',
        targetPath: 'smoke.blend',
        outputPath: 'exports/smoke.glb'
      },
      () => undefined
    );
    const glb = path.join(directory, 'exports', 'smoke.glb');
    const report = {
      ok: (
        analysis.blender.detected
        && inspect.ok
        && exported.ok
        && (await stat(glb)).size > 0
      ),
      blender: {
        version: blender.version,
        executable: blender.executable
      },
      analysis: {
        files: analysis.blender.files,
        scannedFiles: analysis.scannedFiles
      },
      inspect: JSON.parse(await readFile(inspect.reportPath, 'utf8')),
      export: {
        outputPath: exported.outputPath,
        bytes: (await stat(glb)).size,
        report: JSON.parse(await readFile(exported.reportPath, 'utf8'))
      }
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    await mkdir(directory, { recursive: true });
    await rm(directory, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
