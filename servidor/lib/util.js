'use strict';
const crypto = require('node:crypto');
const config = require('./config');

const aleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

function log(texto) {
  const t = new Date().toLocaleString('es', { timeZone: config.ZONA_HORARIA, hour12: false });
  console.log(`${t}  ${texto}`);
}

function iguales(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function duracion(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'menos de un minuto';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

const html = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });

// Series en vivo de un equipo de red (tráfico por interfaz y latencia): enteras, o solo los puntos posteriores a "desde".
// "claves" lista las series que siguen existiendo, para que la página quite las que ya no están.
function seriesDesde(r, desde) {
  const d = Number(desde) || 0;
  const corta = s => d ? s.filter(p => p[0] > d) : s;
  const serie = {}, latencia = {};
  for (const [k, s] of r.serie) serie[k] = corta(s);
  for (const [k, x] of r.lat) latencia[k] = corta(x.serie);
  return d ? { serie, latencia, desde: d, claves: { serie: Object.keys(serie), latencia: Object.keys(latencia) } } : { serie, latencia };
}

module.exports = { aleatorio, log, iguales, duracion, html, nf, seriesDesde };
