const http = require('node:http');

const port = Number(process.env.NEURACO_BROWSER_SMOKE_PORT || 4317);
const html = `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8"><title>NeuraCo Browser Smoke</title></head>
  <body>
    <main style="width:100%;min-height:100vh">
      <label for="neuraco-smoke-input">Smoke</label>
      <input id="neuraco-smoke-input" autocomplete="off">
    </main>
  </body>
</html>`;

const server = http.createServer((_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(html);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`NeuraCo browser smoke server ready on ${port}\n`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
