const {
  ComputerControlService
} = require('../dist-electron/computer-control-service.js');

const run = async () => {
  const service = new ComputerControlService();
  let target;
  for (let attempt = 0; attempt < 20 && !target; attempt += 1) {
    const windows = await service.listWindows();
    target = windows.find((window) => window.applicationId === 'notepad');
    if (!target) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!target) throw new Error('La fenêtre Bloc-notes de smoke test n’a pas été détectée.');
  const inspection = await service.inspectWindow(target.id);
  const capture = await service.captureWindow(target.id);
  const report = {
    ok: capture.dataUrl.startsWith('data:image/png;base64,')
      && capture.width > 0
      && capture.height > 0,
    window: {
      applicationId: target.applicationId,
      processId: target.processId,
      title: target.title,
      bounds: target.bounds
    },
    uiAutomation: {
      elements: inspection.elements.length,
      actionable: inspection.elements.filter((element) => element.actionable).length,
      passwordElementsExposed: inspection.elements.filter((element) => element.password).length
    },
    capture: {
      width: capture.width,
      height: capture.height,
      pngData: capture.dataUrl.startsWith('data:image/png;base64,')
    }
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
