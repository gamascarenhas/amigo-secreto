import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mockRedis } from './mock-redis.mjs';
import handler from '../api/app.js';

const PORTA = process.env.PORT || 3004;

if (!process.env.FAMILY_PIN || !process.env.ADMIN_PIN || !process.env.SEGREDO) {
  console.error('Faltou o .env: copie .env.example para .env e preencha FAMILY_PIN, ADMIN_PIN (4 números) e SEGREDO.');
  console.error('Gere o SEGREDO com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"');
  process.exit(1);
}

process.env.UPSTASH_REDIS_REST_URL = 'http://mock';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock';
mockRedis();

async function lerCorpo(req) {
  let raw = '';
  for await (const parte of req) raw += parte;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function comoVercel(res) {
  res.status = (codigo) => {
    res.statusCode = codigo;
    return res;
  };
  res.json = (dado) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(dado));
  };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/app') {
    req.query = Object.fromEntries(url.searchParams);
    req.body = await lerCorpo(req);
    return handler(req, comoVercel(res));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(await readFile(new URL('../index.html', import.meta.url)));
}).listen(PORTA, () => {
  console.log(`http://localhost:${PORTA}  (senha da família ${process.env.FAMILY_PIN}, organizador ${process.env.ADMIN_PIN})`);
});
