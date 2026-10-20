// Receives the golden-image PNGs that the example app uploads in CI (example/golden/GoldenRunner.tsx)
// and writes them to <outDir>/<name>.png. Exits once the app reports it is done: 0 on success,
// 1 if the app reported an error or nothing arrived before the timeout.
//
//   node scripts/golden-server.mjs <outDir> [port=8099] [timeoutSeconds=900]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [outDir, port = '8099', timeout = '900'] = process.argv.slice(2);
if (!outDir) {
  console.error('usage: node scripts/golden-server.mjs <outDir> [port] [timeoutSeconds]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    res.end('ok');
    if (url.pathname === '/upload') {
      const name = (url.searchParams.get('name') ?? 'unnamed').replace(/[^\w.-]/g, '_');
      const body = Buffer.concat(chunks);
      writeFileSync(join(outDir, `${name}.png`), body);
      console.log(`${url.searchParams.get('platform')}: ${name} (${body.length} bytes)`);
    } else if (url.pathname === '/done') {
      const error = url.searchParams.get('error');
      console.log(error ? `app failed: ${error}` : 'app finished');
      server.close();
      process.exit(error ? 1 : 0);
    }
  });
});
server.listen(Number(port), () => console.log(`waiting for uploads on port ${port}`));
setTimeout(() => {
  console.error(`no "done" from the app after ${timeout}s`);
  process.exit(1);
}, Number(timeout) * 1000);
