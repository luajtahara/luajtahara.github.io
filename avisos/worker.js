// Avisos de Tahará — servidor de notificaciones.
// Guarda, por teléfono, sólo la hora de cada aviso y el texto que eligió ella. Cada minuto manda los que tocan.
import { generateVapid, sendPush } from './webpush.js';

const ORIGINS = ['https://luajtahara.github.io'];
const SUBJECT = 'https://luajtahara.github.io';
const MAX_ITEMS = 80, MAX_TEXT = 80;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) || o.startsWith('http://localhost') ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (req, data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });

const rnd = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');

// Claves VAPID: se generan solas la primera vez y quedan guardadas en la base.
async function vapid(env) {
  const row = await env.DB.prepare('SELECT v FROM config WHERE k = ?').bind('vapid').first();
  if (row) return JSON.parse(row.v);
  const v = await generateVapid();
  await env.DB.prepare('INSERT OR IGNORE INTO config (k, v) VALUES (?, ?)').bind('vapid', JSON.stringify(v)).run();
  const again = await env.DB.prepare('SELECT v FROM config WHERE k = ?').bind('vapid').first();
  return JSON.parse(again.v);
}

async function device(env, id, token) {
  if (typeof id !== 'string' || typeof token !== 'string') return null;
  const d = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first();
  return d && d.token === token ? d : null;
}

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  const now = Date.now();
  return items
    .map(x => ({ at: Math.round(Number(x && x.at)), text: String((x && x.text) || 'Recordatorio').slice(0, MAX_TEXT) }))
    .filter(x => Number.isFinite(x.at) && x.at > now - 60000 && x.at < now + 120 * 864e5)
    .slice(0, MAX_ITEMS);
}

async function handle(req, env) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });

  if (req.method === 'GET' && url.pathname === '/vapid') return json(req, { publicKey: (await vapid(env)).publicKey });
  if (req.method === 'GET' && url.pathname === '/') return json(req, { ok: true });

  let body = {};
  if (req.method !== 'GET') { try { body = await req.json(); } catch (e) { return json(req, { error: 'json' }, 400); } }

  // Alta o renovación del teléfono
  if (req.method === 'POST' && url.pathname === '/sub') {
    const s = body.subscription || {};
    const endpoint = s.endpoint, p256dh = s.keys && s.keys.p256dh, auth = s.keys && s.keys.auth;
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string')
      return json(req, { error: 'subscription' }, 400);
    const now = Date.now();
    const known = await device(env, body.id, body.token);
    if (known) {
      await env.DB.prepare('UPDATE devices SET endpoint = ?, p256dh = ?, auth = ?, updated = ? WHERE id = ?')
        .bind(endpoint, p256dh, auth, now, known.id).run();
      return json(req, { id: known.id, token: known.token });
    }
    const id = rnd(16), token = rnd(24);
    await env.DB.prepare('INSERT INTO devices (id, token, endpoint, p256dh, auth, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, token, endpoint, p256dh, auth, now, now).run();
    return json(req, { id, token });
  }

  const d = await device(env, body.id, body.token);
  if (!d) return json(req, { error: 'device' }, 404);

  // Reemplaza todos los avisos pendientes de este teléfono
  if (req.method === 'PUT' && url.pathname === '/plan') {
    const items = cleanItems(body.items);
    const stmts = [env.DB.prepare('DELETE FROM items WHERE device = ?').bind(d.id)];
    for (const it of items) stmts.push(env.DB.prepare('INSERT INTO items (device, at, text) VALUES (?, ?, ?)').bind(d.id, it.at, it.text));
    stmts.push(env.DB.prepare('UPDATE devices SET updated = ? WHERE id = ?').bind(Date.now(), d.id));
    await env.DB.batch(stmts);
    return json(req, { ok: true, count: items.length });
  }

  // Aviso de prueba inmediato
  if (req.method === 'POST' && url.pathname === '/test') {
    const status = await sendPush(d, { title: String(body.text || 'Prueba').slice(0, MAX_TEXT) }, await vapid(env), SUBJECT);
    return json(req, { ok: status >= 200 && status < 300, status });
  }

  // Desactivar: borra el teléfono y sus avisos
  if (req.method === 'DELETE' && url.pathname === '/sub') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM items WHERE device = ?').bind(d.id),
      env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(d.id),
    ]);
    return json(req, { ok: true });
  }

  return json(req, { error: 'not found' }, 404);
}

// Cada minuto: manda los avisos que ya tocan
async function tick(env) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    'SELECT items.id AS iid, items.text, devices.* FROM items JOIN devices ON devices.id = items.device WHERE items.at <= ? ORDER BY items.at LIMIT 300'
  ).bind(now + 20000).all();
  if (!results.length) {
    // limpiar avisos huérfanos o muy viejos de vez en cuando
    if (new Date(now).getUTCMinutes() === 0) await env.DB.prepare('DELETE FROM items WHERE at < ?').bind(now - 2 * 864e5).run();
    return;
  }
  const v = await vapid(env), gone = new Set(), done = [];
  await Promise.all(results.map(async r => {
    try {
      const status = await sendPush(r, { title: r.text }, v, SUBJECT);
      if (status === 404 || status === 410) gone.add(r.id);
      if ((status >= 200 && status < 300) || status === 404 || status === 410 || status === 400 || status === 413) done.push(r.iid);
      // otros errores (429, 5xx): se reintenta en el próximo minuto
    } catch (e) { /* red: se reintenta */ }
  }));
  const stmts = done.map(iid => env.DB.prepare('DELETE FROM items WHERE id = ?').bind(iid));
  for (const id of gone) {
    stmts.push(env.DB.prepare('DELETE FROM items WHERE device = ?').bind(id));
    stmts.push(env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id));
  }
  // si un aviso lleva más de 6 horas sin poder salir, se descarta
  stmts.push(env.DB.prepare('DELETE FROM items WHERE at < ?').bind(now - 6 * 3600e3));
  if (stmts.length) await env.DB.batch(stmts);
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) { return json(req, { error: 'server' }, 500); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env)); },
};
