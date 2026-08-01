import WebSocket from 'ws';

const port = Number(process.argv[2] || 9341);
const prompt = process.argv[3] || 'Réponds uniquement : TEST CHAT GENERAL OK';
const timeoutMs = Number(process.argv[4] || 45_000);

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  return response.json();
});
const target = targets.find((item) => item.type === 'page');
if (!target?.webSocketDebuggerUrl) throw new Error('Fenêtre NeuraCo introuvable.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();

const evaluate = (expression) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true }
  }));
});

socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  if (message.error || message.result?.exceptionDetails) {
    task.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
    return;
  }
  task.resolve(message.result?.result?.value);
});

await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});

const initial = await evaluate(`JSON.stringify({
  textarea: Boolean(document.querySelector('.composer textarea:not([disabled])')),
  projectOpen: !document.body.innerText.includes('Aucun projet ouvert'),
  assistantCount: document.querySelectorAll('.home-chat-message.is-assistant').length,
  currentText: document.body.innerText
})`);
const initialState = JSON.parse(initial);
if (!initialState.textarea) throw new Error('Zone de saisie générale indisponible.');
if (initialState.projectOpen) throw new Error('Le test exige qu’aucun projet local ne soit ouvert.');

await evaluate(`(() => {
  const textarea = document.querySelector('.composer textarea:not([disabled])');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set;
  setter.call(textarea, ${JSON.stringify(prompt)});
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

await new Promise((resolve) => setTimeout(resolve, 150));
const submitted = await evaluate(`(() => {
  const button = document.querySelector('.composer .send-button:not([disabled])');
  if (!button) return false;
  button.click();
  return true;
})()`);
if (!submitted) throw new Error('Le bouton Envoyer est resté désactivé.');

const deadline = Date.now() + timeoutMs;
let result;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  result = JSON.parse(await evaluate(`JSON.stringify({
    busy: Boolean(document.querySelector('.home-chat-thinking')),
    messages: [...document.querySelectorAll('.home-chat-message')].map((item) => ({
      role: item.className,
      text: item.innerText
    }))
  })`));
  const assistantMessages = result.messages.filter(
    (message) => message.role.includes('is-assistant')
  );
  const assistant = assistantMessages.at(-1);
  const system = result.messages.find((message) => message.role.includes('is-system'));
  if (system) throw new Error(`Erreur visible dans l’interface : ${system.text}`);
  if (assistantMessages.length > initialState.assistantCount && assistant && !result.busy) {
    console.log(JSON.stringify({
      ok: true,
      projectOpen: false,
      userMessage: result.messages.find((message) => message.role.includes('is-user'))?.text,
      assistantMessage: assistant.text
    }, null, 2));
    socket.close();
    process.exit(0);
  }
}

socket.close();
throw new Error(`Aucune réponse IA reçue après ${timeoutMs} ms.`);
