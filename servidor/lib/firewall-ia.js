'use strict';
// Contexto de firewall bajo demanda para IA: solo lectura, allowlist y minimización de datos.
// No se envían IP, nombres de interfaz, comentarios ni identificadores internos.
const CATEGORIAS = Object.freeze({
  filter: ['cadena', 'accion', 'deshabilitada', 'detalle'],
  nat: ['chain', 'action', 'protocol', 'dst-port', 'to-ports', 'disabled'],
  mangle: ['chain', 'action', 'protocol', 'dst-port', 'passthrough', 'disabled'],
  listas: ['list', 'dynamic', 'disabled']
});
const MAX_POR_CATEGORIA = 35;
const MAX_TOTAL = 100;
const estado = v => v === true || v === 'true' || v === 'yes' ? true
  : v === false || v === 'false' || v === 'no' ? false : null;
const limpiar = (v, max = 60) => String(v == null ? '' : v)
  .replace(/(?:\b\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?/g, '[IP]')
  .replace(/\b[0-9a-f]{0,4}:[0-9a-f:]{2,}\b/gi, '[IPv6]')
  .replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, '[MAC]')
  .replace(/[\r\n\t]/g, ' ').slice(0, max);
function detectar(pregunta) {
  const p = String(pregunta || '').toLowerCase();
  if (!/firewall|cortafuegos|reglas?\b|bloque|permit|nat\b|masquerade|mangle|address.?list|puertos?\b|redirecci[oó]n|vlan/i.test(p)) return [];
  if (/\bnat\b|masquerade|dst.?nat|src.?nat|redirecci[oó]n de puerto/.test(p)) return ['nat'];
  if (/mangle|mark.?routing|mark.?connection|policy routing/.test(p)) return ['mangle'];
  if (/address.?list|lista de direcciones/.test(p)) return ['listas'];
  if (/\bfilter\b|input\b|forward\b|output\b/.test(p)) return ['filter'];
  return ['filter', 'nat', 'mangle', 'listas'];
}
function resumirCategoria(tipo, filas, limite = MAX_POR_CATEGORIA) {
  if (!Array.isArray(filas)) return { disponible: false, motivo: 'No se pudo consultar la sección' };
  const max = Math.min(MAX_POR_CATEGORIA, Math.max(0, limite));
  const reglas = filas.slice(0, max).map((f, i) => {
    const r = { orden: i + 1 };
    if (tipo === 'filter') {
      r.cadena = limpiar(f.cadena, 24);
      r.accion = limpiar(f.accion, 30);
      r.deshabilitada = estado(f.deshabilitada);
      // "detalle" contiene direcciones e identificadores de interfaces; no enviarlo.
      r.condiciones = 'Condiciones detalladas omitidas por privacidad';
    } else {
      for (const campo of CATEGORIAS[tipo] || []) {
        if (campo === 'disabled') r.deshabilitada = estado(f[campo]);
        else if (campo === 'dynamic') r.dinamica = estado(f[campo]);
        else if (campo === 'list') r.lista = 'Lista presente (nombre omitido)';
        else if (f[campo] != null) r[campo] = limpiar(f[campo], 40);
      }
    }
    return r;
  });
  return { disponible: true, totalRecibido: filas.length, incluidas: reglas.length,
    truncado: filas.length > reglas.length, reglas };
}
async function obtener(mikrotik, id, pregunta) {
  const categorias = detectar(pregunta);
  if (!categorias.length) return null;
  const resultado = { soloLectura: true, alcance: 'Metadatos de reglas; IP, interfaces y comentarios omitidos', categorias: {} };
  const secciones = { filter: 'firewall', nat: 'nat', mangle: 'mangle', listas: 'listas' };
  let restantes = MAX_TOTAL;
  for (const categoria of categorias) {
    try {
      const datos = await mikrotik.seccion(id, secciones[categoria]);
      const filas = Array.isArray(datos) ? datos : datos?.[categoria];
      const resumen = resumirCategoria(categoria, filas, restantes);
      resultado.categorias[categoria] = resumen;
      restantes -= resumen.incluidas || 0;
    } catch {
      resultado.categorias[categoria] = { disponible: false, motivo: 'Consulta no disponible o fallida' };
    }
    if (restantes <= 0) break;
  }
  return resultado;
}
module.exports = { detectar, resumirCategoria, obtener };
