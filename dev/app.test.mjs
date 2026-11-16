import test from 'node:test';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import assert from 'node:assert/strict';
import { mockRedis } from './mock-redis.mjs';
import handler, { sortear, conferirSorteio, pinHash } from '../api/app.js';

const PINS_DO_TESTE = new Set(['0000', '1111', '2222', '7777', '1357', '2468', '3579', '2580', '4826', '4827']);
function pinAleatorio(...evitar) {
  for (;;) {
    const pin = String(randomInt(10000)).padStart(4, '0');
    if (!/^(\d)\1{3}$/.test(pin) && !PINS_DO_TESTE.has(pin) && !evitar.includes(pin)) return pin;
  }
}
const segredoAleatorio = () => randomBytes(32).toString('base64url');
const FAMILY_PIN = pinAleatorio();
const ADMIN_PIN = pinAleatorio(FAMILY_PIN);

Object.assign(process.env, {
  FAMILY_PIN,
  ADMIN_PIN,
  SEGREDO: segredoAleatorio(),
  UPSTASH_REDIS_REST_URL: 'http://mock',
  UPSTASH_REDIS_REST_TOKEN: 'mock',
});
const db = mockRedis();

let token = '';
async function call(a, body = {}, ip = '1.1.1.1') {
  const out = { status: 200, headers: {} };
  const res = {
    setHeader: (k, v) => { out.headers[k] = v; },
    status(c) { out.status = c; return this; },
    json(o) { out.body = o; return this; },
  };
  await handler({ query: { a }, body, headers: { 'x-familia': token, 'x-forwarded-for': ip } }, res);
  if (out.body?.token) token = out.body.token;
  return out;
}

const nomes = (n) => Array.from({ length: n }, (_, i) => 'p' + i);
const PINS = { Ana: '1357', Bia: '2468', Caio: '3579', Zeca: '2580', Zuca: '2580' };
let ana;
let lista;

test('sorteio: ninguém tira a si mesmo e ninguém é tirado duas vezes (2 a 60 pessoas, 200x cada)', () => {
  for (let n = 2; n <= 60; n++) {
    for (let r = 0; r < 200; r++) {
      const ids = nomes(n);
      const m = sortear(ids);
      assert.equal(Object.keys(m).length, n);
      assert.equal(new Set(Object.values(m)).size, n, 'ninguém tirado por duas pessoas');
      for (const id of ids) assert.notEqual(m[id], id, 'ninguém tira a si mesmo');
    }
  }
});

test('sorteio: as 9 combinações válidas de 4 pessoas saem com a mesma chance (~2000 em 18000)', () => {
  const contagem = new Map();
  for (let r = 0; r < 18000; r++) {
    const m = sortear(nomes(4));
    const chave = nomes(4).map((id) => m[id]).join(',');
    contagem.set(chave, (contagem.get(chave) || 0) + 1);
  }
  assert.equal(contagem.size, 9, 'todas as 9 combinações aparecem');
  for (const [chave, vezes] of contagem) assert.ok(vezes > 1800 && vezes < 2200, `${chave} saiu ${vezes}x`);
});

test('sorteio: não segue a ordem da lista (com 6 pessoas, p0 tira cada uma das outras ~20%)', () => {
  const vezes = {};
  for (let r = 0; r < 10000; r++) {
    const tirou = sortear(nomes(6)).p0;
    vezes[tirou] = (vezes[tirou] || 0) + 1;
  }
  assert.deepEqual(Object.keys(vezes).sort(), ['p1', 'p2', 'p3', 'p4', 'p5']);
  for (const v of Object.values(vezes)) assert.ok(v > 1750 && v < 2250, `p0 tirou alguém ${v}x`);
});

test('conferência barra sorteio quebrado', () => {
  const ids = ['a', 'b', 'c'];
  assert.throws(() => conferirSorteio({ a: 'a', b: 'c', c: 'b' }, ids), /regra quebrada/, 'tirou a si mesmo');
  assert.throws(() => conferirSorteio({ a: 'b', b: 'a', c: 'a' }, ids), /regra quebrada/, 'tirado duas vezes');
  assert.throws(() => conferirSorteio({ a: 'b', b: 'c' }, ids), /regra quebrada/, 'faltou alguém');
  assert.throws(() => sortear(['a']), /2\+ pessoas/, 'uma pessoa só');
  assert.throws(() => sortear(['a', 'a', 'b']), /sem repetição/, 'id repetido');
});

test('senha da família', async () => {
  assert.equal((await call('lista')).status, 403);
  assert.equal((await call('login', { pin: '0000' })).status, 401);
  assert.equal((await call('login', { pin: FAMILY_PIN })).status, 200);
});

test('cadastro: regras de nome e PIN', async () => {
  ana = (await call('salvar', { nome: 'Ana', pin: PINS.Ana, camisa: 'M' })).body.pessoa;
  assert.equal(ana.pin, undefined);
  assert.equal((await call('salvar', { nome: 'ana', pin: '2222' })).status, 400, 'nome repetido');
  assert.equal((await call('salvar', { nome: 'Bia', pin: '12a4' })).status, 400, 'PIN inválido');
  assert.equal((await call('salvar', { nome: 'Bia', pin: FAMILY_PIN })).status, 400, 'igual à senha da família');
  assert.equal((await call('salvar', { nome: 'Bia', pin: '7777' })).status, 400, '4 números iguais');
  assert.equal((await call('salvar', { nome: '  ÁNA ', pin: '2580', sapato: '40' })).status, 400, 'mesmo nome com acento e espaço');
  assert.equal((await call('salvar', { nome: 'Zeca', pin: '1111', sapato: '40' })).status, 400, '4 números iguais com dica');
});

test('cadastro: pelo menos uma dica (tamanho ou "Quero ganhar" com 3+ letras)', async () => {
  const semDica = (extra) => call('salvar', { nome: 'Sem Dica', pin: '2580', ...extra });
  assert.equal((await semDica({})).status, 400);
  assert.equal((await semDica({ sugestoes: '  a ' })).status, 400);
  assert.equal((await semDica({ naoGosto: 'meia' })).status, 400, '"Não quero ganhar" sozinho não conta');
  assert.match((await semDica({})).body.erro, /pelo menos um tamanho/);
});

test('cadastro: PIN repetido é permitido', async () => {
  assert.equal((await call('salvar', { nome: 'Zeca', pin: PINS.Zeca, sugestoes: 'Livro' })).status, 200);
  assert.equal((await call('salvar', { nome: 'Zuca', pin: PINS.Zuca, calcaLetra: 'G' })).status, 200);
  assert.equal((await call('salvar', { nome: 'Bia', pin: PINS.Bia, sapato: '36' })).status, 200);
  assert.equal((await call('salvar', { nome: 'Caio', pin: PINS.Caio, calcaNum: '42' })).status, 200);
});

test('edição: exige o PIN e mantém a regra da dica', async () => {
  assert.equal((await call('salvar', { id: ana.id, pin: '0000', nome: 'Hacker' })).status, 401);
  assert.equal((await call('salvar', { id: ana.id, pin: PINS.Ana, nome: 'Ana', camisa: 'G' })).body.pessoa.camisa, 'G');
  assert.equal((await call('salvar', { id: ana.id, pin: PINS.Ana, nome: 'Ana' })).status, 400, 'não pode apagar todas as dicas');
});

test('lista não expõe PIN', async () => {
  lista = (await call('lista')).body;
  assert.equal(lista.pessoas.length, 5);
  assert.ok(lista.pessoas.every((p) => !('pin' in p)));
  assert.equal(lista.sorteioFeito, false);
});

test('entrar e sortear', async () => {
  assert.equal((await call('entrar', { id: ana.id, pin: '0000' })).status, 401);
  assert.equal((await call('entrar', { id: ana.id, pin: PINS.Ana })).body.amigo, null);
  assert.equal((await call('admin', { adminPin: '1111', op: 'sortear' })).status, 401);
  assert.equal((await call('admin', { adminPin: ADMIN_PIN, op: 'sortear' })).body.sorteados, 5);
  assert.ok(['Bia', 'Caio', 'Zeca', 'Zuca'].includes((await call('entrar', { id: ana.id, pin: PINS.Ana })).body.amigo));
  assert.equal((await call('lista')).body.sorteioFeito, true);
});

test('sorteio pelo servidor e banco: cada um vê alguém diferente e nunca a si mesmo (50x)', async () => {
  for (let r = 0; r < 50; r++) {
    await call('admin', { adminPin: ADMIN_PIN, op: 'sortear' });
    const tirados = [];
    for (const p of lista.pessoas) {
      const amigo = (await call('entrar', { id: p.id, pin: PINS[p.nome] })).body.amigo;
      assert.ok(amigo && amigo !== p.nome, `${p.nome} tirou ${amigo}`);
      tirados.push(amigo);
    }
    assert.equal(new Set(tirados).size, 5);
  }
});

test('quem vê o banco não descobre PIN nem quem tirou quem', async () => {
  const pessoas = [...db.get('pessoas').values()].map((j) => JSON.parse(j));
  const ids = pessoas.map((p) => p.id);
  const nomesDb = pessoas.map((p) => p.nome);
  for (const p of pessoas) {
    assert.equal(p.pin, undefined, 'sem PIN em texto');
    assert.ok(p.pinHash, 'só o HMAC');
  }
  const bancoPessoas = [...db.get('pessoas').values()].join('|');
  for (const pin of ['1357', '2468', '3579', '2580']) assert.ok(!bancoPessoas.includes(`"${pin}"`), `PIN ${pin} não aparece`);
  for (const [quem, valor] of db.get('sorteio')) {
    assert.ok(ids.includes(quem));
    for (const x of [...ids, ...nomesDb]) assert.ok(!valor.includes(x), 'resultado do sorteio não aparece em texto');
  }
  const certo = process.env.SEGREDO;
  const anaDb = pessoas.find((p) => p.nome === 'Ana');
  const tokenCerto = token;
  process.env.SEGREDO = segredoAleatorio();
  await call('login', { pin: FAMILY_PIN });
  const status = (await call('entrar', { id: anaDb.id, pin: PINS.Ana })).status;
  process.env.SEGREDO = certo;
  token = tokenCerto;
  assert.equal(status, 401, 'com outro SEGREDO nem o PIN confere');
  assert.ok((await call('entrar', { id: anaDb.id, pin: PINS.Ana })).body.amigo);
});

test('cadastro antigo com PIN em texto continua entrando e é convertido', async () => {
  const id = 'antigo-1';
  db.get('pessoas').set(id, JSON.stringify({ id, nome: 'Velho', pin: '4826', sapato: '40' }));
  assert.equal((await call('entrar', { id, pin: '4826' })).status, 200);
  const salvo = JSON.parse(db.get('pessoas').get(id));
  assert.equal(salvo.pin, undefined);
  assert.equal(salvo.pinHash, pinHash(id, '4826'));
  assert.equal((await call('entrar', { id, pin: '4826' })).status, 200);
  assert.equal((await call('entrar', { id, pin: '4827' })).status, 401);
});

test('bloqueia depois de muitas tentativas erradas', async () => {
  for (let i = 0; i < 20; i++) await call('login', { pin: '0000' }, '6.6.6.6');
  assert.equal((await call('login', { pin: FAMILY_PIN }, '6.6.6.6')).status, 429);
});

test('bloqueio vale para pedidos em paralelo', async () => {
  const r = await Promise.all(Array.from({ length: 50 }, (_, i) => call('admin', { adminPin: String(1000 + i), op: 'ver' }, '7.7.7.7')));
  assert.ok(r.filter((x) => x.status === 401).length <= 20);
});

test('token da família não sai só da senha', async () => {
  const salvo = token;
  token = createHash('sha256').update('amigo-secreto:' + FAMILY_PIN).digest('hex');
  assert.equal((await call('lista')).status, 403);
  token = salvo;
});

test('remover alguém desfaz o sorteio', async () => {
  await call('admin', { adminPin: ADMIN_PIN, op: 'sortear' });
  const r = await call('admin', { adminPin: ADMIN_PIN, op: 'apagar', id: 'antigo-1' });
  assert.equal(r.body.sorteados, 0);
  assert.equal((await call('lista')).body.sorteioFeito, false);
});
