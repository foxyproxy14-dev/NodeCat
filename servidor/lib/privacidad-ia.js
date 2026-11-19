'use strict';
const { isIP } = require('node:net');
// Un mapa por consulta: nunca se persiste ni se devuelve al proveedor.
function crearAnonimizador() {
  const mapas = new Map();
  const conocidos = new Map();
  function alias(tipo, valor) {
    const v = String(valor);
    if (!mapas.has(tipo)) mapas.set(tipo, new Map());
    const m = mapas.get(tipo);
    if (!m.has(v)) m.set(v, tipo + '-' + (m.size + 1));
    conocidos.set(v, m.get(v));
    return m.get(v);
  }
  function referencia(tipo, valor) {
    return String(valor).split(',').map(v => {
      const negada = v.startsWith('!');
      const dato = negada ? v.slice(1) : v;
      if (['marcaConexion', 'marcaPaquete'].includes(tipo) && dato === 'no-mark')
        return (negada ? '!' : '') + 'no-mark';
      if (tipo === 'direccion' && dato.includes('-')) {
        const rango = dato.split('-');
        if (rango.length === 2 && rango.every(isIP))
          return (negada ? '!' : '') + rango.map(x => alias(tipo, x)).join('..');
      }
      const prefijo = tipo === 'direccion' ? dato.match(/^(.*)(\/\d{1,3})$/) : null;
      return (negada ? '!' : '') + (prefijo ? alias(tipo, prefijo[1]) + prefijo[2] : alias(tipo, dato));
    }).join(',');
  }
  function texto(valor) {
    let s = String(valor);
    for (const [v, a] of [...conocidos].sort((a, b) => b[0].length - a[0].length)) {
      if (v.length > 2) s = s.split(v).join(a);
    }
    s = s.replace(/\b(?:password|passwd|contrase(?:ña|na)|token|secret|api[_-]?key|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '[CREDENCIAL]')
      .replace(/\b(?:sk-[\w-]+|Bearer\s+\S+)\b/gi, '[CREDENCIAL]')
      .replace(/https?:\/\/[^\s<>]+/gi, v => alias('URL', v))
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, v => alias('EMAIL', v))
      .replace(/\b(?:[a-f\d]{2}[:-]){5}[a-f\d]{2}\b/gi, v => alias('MAC', v.toLowerCase()))
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g, v => alias('IP', v))
      .replace(/(?<![\w:])[a-f\d:]*:[a-f\d:.]+(?:%[\w.-]+)?(?:\/\d{1,3})?/gi, v => {
        const base = v.split('/')[0].split('%')[0];
        return isIP(base) === 6 ? alias('IPv6', v) : v;
      })
      .replace(/\b(?:[a-z\d-]+\.)+[a-z]{2,63}\b/gi, v => alias('HOST', v));
    return s;
  }
  function objeto(v) {
    if (typeof v === 'string') return texto(v);
    if (Array.isArray(v)) return v.map(objeto);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.entries(v).filter(([k]) => !/password|passwd|clave|token|secret|comment|comentario|usuario|hostname|identity/i.test(k))
      .map(([k, x]) => [k, objeto(x)]));
  }
  return { alias, referencia, texto, objeto };
}
module.exports = { crearAnonimizador };
