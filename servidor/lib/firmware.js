'use strict';
// Versiones nuevas de RouterOS y FortiOS (solo se avisa: NodeCat no actualiza nada).
// RouterOS: NodeCat pregunta al mismo servidor que usan los routers (upgrade.mikrotik.com), por rama y canal.
// FortiOS: lo que el propio FortiGate sabe por FortiGuard (monitor/system/firmware), leído por el módulo de FortiGate.
const config = require('./config');
const { log } = require('./util');

const CADA = 6 * 3600e3;
const cache = new Map();   // 'a7.stable' → { t, version, pidiendo }
// En la demo no hay Internet: versiones fijas
const DEMO = { 'a7.stable': '7.20.4', 'a7.long-term': '7.16.2', 'a7.testing': '7.21beta3', '6.stable': '6.49.18', '6.long-term': '6.49.18' };

// Compara versiones tipo 7.16.2, 7.21beta3, 7.19rc1 (las beta y rc van antes de la final)
function partes(v) {
  const m = String(v || '').replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:\s*(beta|rc)(\d+))?/i);
  if (!m) return null;
  const pre = m[4] ? (m[4].toLowerCase() === 'beta' ? 1 : 2) : 3;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0), pre, Number(m[5] || 0)];
}
function comparar(a, b) {
  const x = partes(a), y = partes(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 5; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

function pedir(clave) {
  const c = cache.get(clave) || {};
  if (c.pidiendo || (c.t && Date.now() - c.t < (c.version ? CADA : 30 * 60000))) return;
  cache.set(clave, { ...c, pidiendo: true });
  const ctl = new AbortController(); const reloj = setTimeout(() => ctl.abort(), 15000);
  fetch(`https://upgrade.mikrotik.com/routeros/NEWEST${clave}`, { signal: ctl.signal, headers: { 'User-Agent': 'NodeCat' } })
    .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(t => { const v = String(t).trim().split(/\s+/)[0]; cache.set(clave, { t: Date.now(), version: partes(v) ? v : c.version || null }); })
    .catch(e => { cache.set(clave, { t: Date.now(), version: c.version || null }); if (!c.error) log(`No se pudo consultar la última versión de RouterOS (${clave}): ${e.message}`); cache.get(clave).error = true; })
    .finally(() => clearTimeout(reloj));
}

// Última versión de RouterOS para la rama (6 o 7) y canal del router. Devuelve null si todavía no se sabe.
function ultimaRouterOS(version, canal) {
  const p = partes(version); if (!p) return null;
  const rama = p[0] >= 7 ? 'a7' : '6';
  const c = String(canal || '').toLowerCase().replace(/[^a-z-]/g, '') || 'stable';
  const clave = `${rama}.${['stable', 'long-term', 'testing', 'development'].includes(c) ? c : 'stable'}`;
  if (config.DEMO) return DEMO[clave] || null;
  pedir(clave);
  return (cache.get(clave) || {}).version || null;
}

// Para un MikroTik: { actual, nueva, canal } si hay algo más nuevo; si no, null.
// "delRouter" es la última versión que el propio router ya conoce (si alguna vez buscó actualizaciones).
function routeros(version, canal, delRouter) {
  const v = String(version || '').replace(/\s*\(.*\)$/, '');
  let nueva = ultimaRouterOS(v, canal);
  if (delRouter && (!nueva || comparar(delRouter, nueva) > 0)) nueva = delRouter;
  if (!nueva || comparar(nueva, v) <= 0) return null;
  return { actual: v, nueva, canal: canal || 'stable', producto: 'RouterOS', notas: 'https://mikrotik.com/download/changelogs' };
}

// Para un FortiGate, con la respuesta de monitor/system/firmware.
// Se ofrece la última de la misma rama (7.2.x → 7.2.y) y, aparte, la más nueva de todas.
function fortios(actual, firmware) {
  const v = String(actual || '').replace(/^v/i, '');
  const r = firmware && firmware.results; if (!r || !partes(v)) return null;
  const disp = (Array.isArray(r.available) ? r.available : []).map(x => String(x.version || `${x.major}.${x.minor}.${x.patch}`).replace(/^v/i, '')).filter(x => partes(x) && comparar(x, v) > 0);
  if (!disp.length) return null;
  disp.sort((a, b) => comparar(b, a));
  const [ma, mi] = partes(v);
  const rama = disp.find(x => { const p = partes(x); return p[0] === ma && p[1] === mi; }) || null;
  const nueva = rama || disp[0];
  return { actual: v, nueva, rama: `${ma}.${mi}`, masNueva: disp[0] !== nueva ? disp[0] : null, producto: 'FortiOS', notas: `https://docs.fortinet.com/product/fortigate/${partes(nueva)[0]}.${partes(nueva)[1]}` };
}

module.exports = { comparar, routeros, fortios, ultimaRouterOS };
