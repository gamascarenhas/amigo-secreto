export function mockRedis() {
  const db = new Map();
  const hash = (k) => {
    if (!db.has(k)) db.set(k, new Map());
    return db.get(k);
  };

  const comandos = {
    GET: (k) => db.get(k) ?? null,
    SET: (k, v) => {
      db.set(k, v);
      return 'OK';
    },
    DEL: (k) => (db.delete(k) ? 1 : 0),
    INCR: (k) => {
      db.set(k, String(Number(db.get(k) || 0) + 1));
      return Number(db.get(k));
    },
    DECR: (k) => {
      db.set(k, String(Number(db.get(k) || 0) - 1));
      return Number(db.get(k));
    },
    EXPIRE: () => 1,
    HGET: (k, campo) => db.get(k)?.get(campo) ?? null,
    HSET: (k, ...pares) => {
      for (let i = 0; i < pares.length; i += 2) hash(k).set(pares[i], pares[i + 1]);
      return pares.length / 2;
    },
    HDEL: (k, campo) => (db.get(k)?.delete(campo) ? 1 : 0),
    HGETALL: (k) => [...(db.get(k) || new Map())].flat(),
    HLEN: (k) => db.get(k)?.size || 0,
    RENAME: (k, novo) => {
      if (!db.has(k)) throw new Error('ERR no such key');
      db.set(novo, db.get(k));
      db.delete(k);
      return 'OK';
    },
  };

  globalThis.fetch = async (_url, opt) => {
    const [cmd, ...args] = JSON.parse(opt.body);
    const comando = comandos[cmd.toUpperCase()];
    if (!comando) throw new Error('mock sem suporte a ' + cmd);
    const result = comando(...args);
    return { json: async () => ({ result }) };
  };

  return db;
}
