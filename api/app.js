import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_FALHAS = 20;
const BLOQUEIO_SEGUNDOS = 900;
const TAMANHO_MINIMO_SEGREDO = 32;
const TAMANHO_MINIMO_DICA = 3;

class HttpErr extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

async function redis(...cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new HttpErr(500, 'Banco não configurado (conecte o Upstash Redis na Vercel).');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(cmd.map(String)),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function pessoas() {
  const flat = (await redis('HGETALL', 'pessoas')) || [];
  const lista = [];
  for (let i = 0; i < flat.length; i += 2) lista.push(JSON.parse(flat[i + 1]));
  return lista;
}

const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const semPin = ({ pin, pinHash, ...p }) => p;
const chaveNome = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const temDica = (d) => !!(d.camisa || d.calcaNum || d.calcaLetra || d.sapato || String(d.sugestoes || '').trim().length >= TAMANHO_MINIMO_DICA);

function segredo() {
  const s = process.env.SEGREDO || '';
  if (s.length < TAMANHO_MINIMO_SEGREDO) throw new HttpErr(500, 'Configure SEGREDO (32+ caracteres aleatórios) na Vercel.');
  return s;
}

const hmac = (rotulo, texto) => createHmac('sha256', segredo()).update(`${rotulo}:${texto}`).digest();

const tokenFamilia = (pin) => hmac('familia', pin).toString('hex');

export const pinHash =(id, pin) => hmac('pin', `${id}:${pin}`).toString('base64');

function pinConfere(p, pin) {
  if (!p) return false;
  if (!p.pinHash) return p.pin === String(pin);
  const salvo = Buffer.from(p.pinHash, 'base64');
  const digitado = Buffer.from(pinHash(p.id, pin), 'base64');
  return salvo.length === digitado.length && timingSafeEqual(salvo, digitado);
}

function comPinSeguro(p, pin) {
  const { pin: _antigo, ...resto } = p;
  return { ...resto, pinHash: pinHash(p.id, pin) };
}

const chaveSorteio = () => hmac('sorteio', 'chave');

function cifrar(quem, tirou) {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chaveSorteio(), iv);
  cifra.setAAD(Buffer.from(quem));
  const dado = Buffer.concat([cifra.update(tirou, 'utf8'), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), dado]).toString('base64');
}

function decifrar(quem, texto) {
  const b = Buffer.from(texto, 'base64');
  const decifra = createDecipheriv('aes-256-gcm', chaveSorteio(), b.subarray(0, 12));
  decifra.setAAD(Buffer.from(quem));
  decifra.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([decifra.update(b.subarray(28)), decifra.final()]).toString('utf8');
}

export function sortear(ids) {
  if (ids.length < 2 || new Set(ids).size !== ids.length) throw new Error('Sorteio precisa de 2+ pessoas sem repetição.');
  for (;;) {
    const alvo = [...ids];
    for (let i = alvo.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [alvo[i], alvo[j]] = [alvo[j], alvo[i]];
    }
    if (alvo.every((a, i) => a !== ids[i])) return conferirSorteio(Object.fromEntries(ids.map((id, i) => [id, alvo[i]])), ids);
  }
}

export function conferirSorteio(pares, ids) {
  const tirados = Object.values(pares);
  const ok = Object.keys(pares).length === ids.length
    && ids.every((id) => Object.hasOwn(pares, id) && pares[id] !== id)
    && new Set(tirados).size === ids.length
    && tirados.every((t) => ids.includes(t));
  if (!ok) throw new Error('Sorteio inválido: regra quebrada.');
  return pares;
}

function conferidorDePin(ip) {
  const chave = 'falhas:' + ip;
  return async (ok) => {
    const tentativas = await redis('INCR', chave);
    await redis('EXPIRE', chave, BLOQUEIO_SEGUNDOS);
    if (tentativas > MAX_FALHAS) throw new HttpErr(429, 'Muitas tentativas. Tente em 15 minutos ⏳');
    if (!ok) throw new HttpErr(401, 'Ops, PIN errado!');
    await redis('DECR', chave);
  };
}

function lerDados(b) {
  return {
    nome: txt(b.nome, 40).replace(/\s+/g, ' '),
    camisa: txt(b.camisa, 5),
    calcaNum: txt(b.calcaNum, 3),
    calcaLetra: txt(b.calcaLetra, 5),
    sapato: txt(b.sapato, 3),
    sugestoes: txt(b.sugestoes, 1500),
    naoGosto: txt(b.naoGosto, 500),
    sapatoDuplo: b.sapatoDuplo === true || b.sapatoDuplo === 'on',
  };
}

function validarPinNovo(pin, familyPin) {
  if (!/^\d{4}$/.test(pin)) throw new HttpErr(400, 'O PIN precisa ter 4 números.');
  if (pin === familyPin) throw new HttpErr(400, 'Essa é a senha da família. Escolha outro PIN.');
  if (/^(\d)\1{3}$/.test(pin)) throw new HttpErr(400, 'PIN com 4 números iguais não vale. Escolha outro.');
}

async function amigoDe(p, lista) {
  const cifrado = await redis('HGET', 'sorteio', p.id);
  if (!cifrado) return null;
  let amigoId = null;
  try {
    amigoId = decifrar(p.id, cifrado);
  } catch (e) {
    console.error('sorteio ilegível (SEGREDO mudou?)', e.message);
  }
  const amigo = amigoId && lista.find((x) => x.id === amigoId);
  return amigo ? amigo.nome : null;
}

async function pessoasParaSorteio() {
  const lista = await pessoas();
  if (lista.length < 3) throw new HttpErr(400, 'O sorteio precisa de pelo menos 3 pessoas.');
  return lista;
}

async function gravarSorteio(ids) {
  const tmp = `sorteio:${randomUUID()}`;
  const pares = Object.entries(sortear(ids)).map(([quem, tirou]) => [quem, cifrar(quem, tirou)]);
  await redis('HSET', tmp, ...pares.flat());
  await redis('RENAME', tmp, 'sorteio');
}

const acoes = {
  async lista() {
    const [lista, evento, nSorteio] = await Promise.all([pessoas(), redis('GET', 'evento'), redis('HLEN', 'sorteio')]);
    return {
      pessoas: lista.map(semPin).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR')),
      evento: evento ? JSON.parse(evento) : null,
      sorteioFeito: nSorteio > 0,
    };
  },

  async entrar({ b, conferePin }) {
    const lista = await pessoas();
    const p = lista.find((x) => x.id === b.id);
    await conferePin(pinConfere(p, b.pin));
    if (!p.pinHash) await redis('HSET', 'pessoas', p.id, JSON.stringify(comPinSeguro(p, b.pin)));
    return { pessoa: semPin(p), amigo: await amigoDe(p, lista) };
  },

  async salvar({ b, conferePin, familyPin }) {
    const lista = await pessoas();
    const dados = lerDados(b);
    let p;
    if (b.id) {
      p = lista.find((x) => x.id === b.id);
      await conferePin(pinConfere(p, b.pin));
      p = comPinSeguro(p, b.pin);
    } else {
      validarPinNovo(String(b.pin), familyPin);
      const id = randomUUID();
      p = { id, pinHash: pinHash(id, String(b.pin)) };
    }
    if (!dados.nome) throw new HttpErr(400, 'Faltou seu nome!');
    if (!temDica(dados)) throw new HttpErr(400, 'Conte o que quer ganhar ou pelo menos um tamanho.');
    if (lista.some((x) => x.id !== p.id && chaveNome(x.nome) === chaveNome(dados.nome))) {
      throw new HttpErr(400, 'Esse nome já existe. É você? Use "Meu perfil".');
    }
    const novo = { ...p, ...dados, atualizado: Date.now() };
    await redis('HSET', 'pessoas', novo.id, JSON.stringify(novo));
    return { pessoa: semPin(novo) };
  },

  async admin({ b, conferePin, adminPin }) {
    await conferePin(String(b.adminPin) === adminPin);
    if (b.op === 'evento') {
      await redis('SET', 'evento', JSON.stringify({
        dia: /^\d{4}-\d{2}-\d{2}$/.test(b.dia) ? b.dia : '',
        hora: /^\d{2}:\d{2}$/.test(b.hora) ? b.hora : '',
        local: txt(b.local, 80),
        valor: String(b.valor ?? '').replace(/\D/g, '').slice(0, 7),
      }));
    } else if (b.op === 'sortear') {
      await gravarSorteio((await pessoasParaSorteio()).map((x) => x.id));
    } else if (b.op === 'teste') {
      const lista = await pessoasParaSorteio();
      const nome = Object.fromEntries(lista.map((x) => [x.id, x.nome]));
      const teste = Object.entries(sortear(lista.map((x) => x.id)))
        .map(([de, para]) => ({ de: nome[de], para: nome[para] }))
        .sort((x, y) => x.de.localeCompare(y.de, 'pt-BR'));
      return { ok: true, teste, sorteados: await redis('HLEN', 'sorteio') };
    } else if (b.op === 'desfazer') {
      await redis('DEL', 'sorteio');
    } else if (b.op === 'apagar') {
      await redis('HDEL', 'pessoas', String(b.id));
      await redis('DEL', 'sorteio');
    } else if (b.op !== 'ver') {
      throw new HttpErr(400, 'Operação inválida.');
    }
    return { ok: true, sorteados: await redis('HLEN', 'sorteio') };
  },
};

export default async function handler(req, res) {
  try {
    const { FAMILY_PIN, ADMIN_PIN } = process.env;
    if (!/^\d{4}$/.test(FAMILY_PIN || '') || !/^\d{4}$/.test(ADMIN_PIN || '')) {
      throw new HttpErr(500, 'Configure FAMILY_PIN e ADMIN_PIN (4 números) na Vercel.');
    }
    segredo();
    const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const a = req.query.a;
    const alvo = a === 'entrar' || a === 'salvar' ? 'pessoa:' + String(b.id).slice(0, 64) : a;
    const ctx = { b, conferePin: conferidorDePin(`${ip}:${alvo}`), familyPin: FAMILY_PIN, adminPin: ADMIN_PIN };

    if (a === 'login') {
      await ctx.conferePin(String(b.pin).trim() === FAMILY_PIN);
      return res.status(200).json({ token: tokenFamilia(FAMILY_PIN) });
    }
    if (req.headers['x-familia'] !== tokenFamilia(FAMILY_PIN)) throw new HttpErr(403, 'Qual a senha da família?');
    if (!Object.hasOwn(acoes, a)) throw new HttpErr(404, 'Ação desconhecida.');
    return res.status(200).json(await acoes[a](ctx));
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ erro: e.status ? e.message : 'Algo deu errado. Tente de novo.' });
  }
}
