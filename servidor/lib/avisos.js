'use strict';
// Avisos por Telegram: ajustes, reglas con histéresis, cola de envío y resumen diario.
const { q, ajustes } = require('./db');
const flota = require('./flota');
const config = require('./config');
const { log, duracion, html: H, nf } = require('./util');

const { cifrar, descifrar } = require('./secreto');

// ---------------------------------------------------------------- ajustes
const DEFECTO = {
  activo: false, token: '', chats: [], porCliente: {},
  caidas: true, caidaMin: 0,
  cpu: true, cpuUmbral: 90, cpuMin: 5,
  ram: true, ramUmbral: 95, ramMin: 10,
  disco: true, discoUmbral: 90,
  wan: true,
  resumen: false, resumenHora: '08:00', recordarHoras: 0, ultimoResumen: ''
};
const CLAVE = config.DEMO ? 'notificaciones-demo' : 'notificaciones';
let A = { ...DEFECTO, ...ajustes.leer(CLAVE, {}) };
const token = () => descifrar(A.token);
const guardar = () => ajustes.guardar(CLAVE, A);

function info() {
  const tk = token();
  const { token: _, ultimoResumen, ...resto } = A;
  return {
    ...resto, tokenGuardado: tk.length > 0, tokenFin: tk.length > 6 ? tk.slice(-4) : '',
    recientes, activas: [...estados.values()].filter(e => e.activa).map(e => e.texto.replace(/<[^>]+>/g, '').split('\n')[0])
  };
}

const CHAT = /^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/;
function listaChats(t) {
  const l = [...new Set(String(t || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];
  for (const c of l) if (!CHAT.test(c)) throw new Error(`El chat "${c}" no es válido. Usa el número de chat o @canal.`);
  return l;
}
function rango(o, k, min, max) {
  const v = o[k] == null || o[k] === '' ? DEFECTO[k] : Number(o[k]);
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`Valor fuera de rango (de ${min} a ${max}).`);
  return v;
}
function guardarDesdeWeb(o, quien) {
  const n = {
    activo: !!o.activo, chats: listaChats(o.chats), porCliente: {},
    caidas: !!o.caidas, caidaMin: rango(o, 'caidaMin', 0, 120),
    cpu: !!o.cpu, cpuUmbral: rango(o, 'cpuUmbral', 50, 100), cpuMin: rango(o, 'cpuMin', 0, 240),
    ram: !!o.ram, ramUmbral: rango(o, 'ramUmbral', 50, 100), ramMin: rango(o, 'ramMin', 0, 240),
    disco: !!o.disco, discoUmbral: rango(o, 'discoUmbral', 50, 100), wan: o.wan !== false,
    resumen: !!o.resumen, resumenHora: /^([01]\d|2[0-3]):[0-5]\d$/.test(o.resumenHora || '') ? o.resumenHora : '08:00',
    recordarHoras: rango(o, 'recordarHoras', 0, 48), ultimoResumen: A.ultimoResumen
  };
  for (const [id, t] of Object.entries(o.porCliente || {})) { const l = listaChats(t); if (l.length) n.porCliente[id] = l; }
  const nuevoToken = String(o.token || '').trim();
  n.token = nuevoToken ? cifrar(nuevoToken) : A.token;
  if (n.activo && !descifrar(n.token)) throw new Error('Escribe el token del bot de Telegram.');
  if (n.activo && !n.chats.length && !Object.keys(n.porCliente).length) throw new Error('Elige al menos un chat donde enviar los avisos.');
  const activando = n.activo && !A.activo;
  A = n; guardar();
  if (activando || !A.activo) { estados.clear(); guardarEstado(); }
  if (activando) silenciar = 'anunciar';   // al activar: un solo mensaje con lo que ya está pendiente
  log(`${quien} cambió las notificaciones de Telegram (${A.activo ? 'activadas' : 'desactivadas'}).`);
  if (A.activo) evaluar(true);
}

// ---------------------------------------------------------------- Telegram
async function llamar(tk, metodo, datos) {
  let r;
  try {
    r = await fetch(`${config.TELEGRAM_API}/bot${tk}/${metodo}`, {
      method: datos ? 'POST' : 'GET', headers: datos ? { 'Content-Type': 'application/json' } : {},
      body: datos ? JSON.stringify(datos) : undefined, signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    const err = new Error(`No se pudo conectar con Telegram (${e.cause ? e.cause.code || e.cause.message : e.message}). Comprueba que el servidor de Atalaya tiene salida a Internet hacia api.telegram.org.`);
    err.sinRed = true; throw err;
  }
  let o = null; try { o = await r.json(); } catch { }
  if (!r.ok || !o || !o.ok) {
    const err = new Error(explicar(r.status, (o && o.description) || ''));
    err.codigo = r.status; err.esperar = o && o.parameters ? o.parameters.retry_after : 0;
    throw err;
  }
  return o.result;
}
function explicar(codigo, desc) {
  if (codigo === 401 || codigo === 404) return 'El token del bot no es válido. Cópialo de nuevo desde @BotFather.';
  if (desc.includes('chat not found')) return 'Telegram no encuentra ese chat. Escribe primero un mensaje al bot (o añádelo al grupo) y vuelve a buscar el chat.';
  if (desc.includes('bot was blocked')) return 'Bloqueaste al bot en ese chat. Desbloquéalo en Telegram.';
  if (desc.includes('kicked')) return 'El bot ya no está en ese grupo. Vuelve a añadirlo.';
  if (desc.includes('webhook')) return 'Este bot tiene un webhook configurado, así que no se pueden buscar los chats. Escribe el número de chat a mano o usa otro bot.';
  if (codigo === 429) return 'Telegram pide esperar antes de enviar más mensajes.';
  return `Telegram respondió ${codigo}${desc ? ': ' + desc : ''}`;
}
const tokenO = t => String(t || '').trim() || token();

async function buscarChats(t) {
  const tk = tokenO(t);
  if (!tk) throw new Error('Escribe primero el token del bot.');
  const yo = await llamar(tk, 'getMe');
  const ups = await llamar(tk, 'getUpdates?limit=100&timeout=0');
  const chats = new Map();
  for (const u of ups || []) for (const k of ['message', 'edited_message', 'channel_post', 'my_chat_member']) {
    const ch = u[k] && u[k].chat; if (!ch) continue;
    const nombre = ch.title || `${ch.first_name || ''} ${ch.last_name || ''}`.trim() || ch.username || '';
    chats.set(String(ch.id), { id: String(ch.id), nombre, tipo: ch.type === 'private' ? 'Chat personal' : ch.type === 'channel' ? 'Canal' : 'Grupo' });
  }
  return { bot: '@' + yo.username, chats: [...chats.values()] };
}
async function probar(t, chatsTexto) {
  const tk = tokenO(t);
  if (!tk) throw new Error('Escribe primero el token del bot.');
  let chats = listaChats(chatsTexto);
  if (!chats.length) chats = A.chats;
  if (!chats.length) throw new Error('Elige primero un chat.');
  const yo = await llamar(tk, 'getMe');
  for (const c of chats) await llamar(tk, 'sendMessage', {
    chat_id: c, parse_mode: 'HTML', disable_web_page_preview: true,
    text: '✅ <b>Atalaya</b>\nLas notificaciones funcionan. A partir de ahora los avisos llegarán a este chat.' + (config.DEMO ? '\n<i>(modo demo)</i>' : '')
  });
  return '@' + yo.username;
}

// ---------------------------------------------------------------- cola de envío
const cola = [], recientes = [];
let enviando = false;
function encolar(texto, clienteId) {
  if (config.DEMO) texto = '<i>[demo]</i> ' + texto;
  cola.push({ texto, clienteId });
  if (cola.length > 300) cola.shift();
  enviar();
}
function anotar(texto, error) {
  recientes.unshift({ hora: Date.now(), texto: texto.replace(/<[^>]+>/g, ''), error: error || null });
  if (recientes.length > 30) recientes.pop();
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
async function enviar() {
  if (enviando) return;
  enviando = true;
  try {
    while (cola.length) {
      const m = cola[0], tk = token();
      const chats = [...new Set([...A.chats, ...((m.clienteId && A.porCliente[m.clienteId]) || [])])];
      let error = null, reintentar = false;
      for (const c of chats) {
        try { await llamar(tk, 'sendMessage', { chat_id: c, text: m.texto, parse_mode: 'HTML', disable_web_page_preview: true }); }
        catch (e) {
          if (e.codigo === 429) { await dormir(Math.max(1, e.esperar || 1) * 1000); reintentar = true; break; }
          if (e.sinRed) { log('Telegram: ' + e.message); await dormir(60000); reintentar = true; break; }
          error = e.message;
        }
      }
      if (reintentar) continue;
      cola.shift();
      anotar(m.texto, error);
      if (error) log('No se pudo enviar un aviso por Telegram: ' + error);
      await dormir(400);
    }
  } finally { enviando = false; }
}

// ---------------------------------------------------------------- reglas
// Cada problema tiene una clave (equipo|regla). Se avisa al empezar (tras los minutos de espera) y al resolverse.
const estados = new Map();
let silenciar = false, ultima = 0;
const ESTADO = config.DEMO ? 'alertas-demo' : 'alertas';

function cargarEstado() {
  for (const r of q('SELECT clave, desde, aviso, texto FROM alertas').all())
    if (r.clave.startsWith(ESTADO + ':')) estados.set(r.clave.slice(ESTADO.length + 1), { desde: r.desde, aviso: r.aviso, texto: r.texto, activa: true });
}
function guardarEstado() {
  q('DELETE FROM alertas WHERE clave LIKE ?').run(ESTADO + ':%');
  for (const [k, e] of estados) if (e.activa) q('INSERT INTO alertas (clave, desde, aviso, texto) VALUES (?, ?, ?, ?)').run(`${ESTADO}:${k}`, e.desde, e.aviso, e.texto);
}

function regla(clave, habilitada, enCondicion, despejada, minutos, alerta, fin, ahora, primera, clienteId) {
  let st = estados.get(clave);
  if (!habilitada) { estados.delete(clave); return; }
  if (enCondicion == null) return;          // sin datos: no se cambia nada
  if (enCondicion) {
    if (!st) estados.set(clave, st = { desde: ahora, activa: false });
    if (!st.activa && ahora - st.desde >= minutos * 60000) {
      st.activa = true; st.aviso = ahora; st.texto = alerta();
      if (!primera) encolar(st.texto, clienteId);
    } else if (st.activa && A.recordarHoras > 0 && ahora - st.aviso >= A.recordarHoras * 3600e3) {
      st.aviso = ahora;
      encolar(`⏰ <b>Sigue sin resolverse</b> desde hace ${duracion(ahora - st.desde)}\n${alerta()}`, clienteId);
    }
  } else if (despejada && st) {
    if (st.activa) encolar(fin(ahora - st.desde), clienteId);
    estados.delete(clave);
  }
}

const gb = v => v == null ? '' : nf.format(v);
function evaluar(forzar) {
  const ahora = Date.now();
  if (!forzar && ahora - ultima < 5000) return;
  ultima = ahora;
  if (!A.activo) return;
  const primera = silenciar; silenciar = false;
  const antes = [...estados.values()].filter(e => e.activa).length;
  const nombres = new Map(flota.clientes().map(c => [c.id, c.nombre]));
  const vigentes = new Set();
  for (const v of flota.vivo.values()) {
    const e = flota.vistaEquipo(v, ahora);
    const cli = nombres.get(e.cliente) || '';
    const s = `${e.id}`, hs = `${H(e.alias || e.nombre)}`, hc = cli ? `\n<i>${H(cli)}</i>` : '';
    vigentes.add(s);
    const caido = e.estado === 'caido', vivo = e.estado === 'ok' || e.estado === 'sinMetricas';
    regla(s + '|caida', A.caidas, e.estado === 'pendiente' ? null : caido, vivo, A.caidaMin,
      () => `🔴 <b>${hs} no responde</b>${hc}\n${e.tipo === 'mikrotik' ? `Atalaya no puede conectar con el router${e.errorConexion ? ': ' + H(e.errorConexion) : '.'}` : `Sin noticias del agente desde ${new Date(e.ultimo).toLocaleTimeString('es', { timeZone: config.ZONA_HORARIA, hour: '2-digit', minute: '2-digit' })}.`}`,
      t => `🟢 <b>${hs} vuelve a responder</b>${hc}\nEstuvo sin responder ${duracion(t)}.`, ahora, primera, e.cliente);
    const cpu = vivo ? e.cpu : null, ram = vivo ? e.ramPct : null;
    regla(s + '|cpu', A.cpu, cpu == null ? null : cpu >= A.cpuUmbral, cpu != null && cpu < A.cpuUmbral - 5, A.cpuMin,
      () => `🟠 <b>${hs}: CPU al ${cpu} %</b>${hc}\nLleva ${A.cpuMin > 0 ? `más de ${A.cpuMin} min ` : ''}por encima del ${A.cpuUmbral} %.`,
      t => `✅ <b>${hs}: CPU normal</b> (${cpu} %)${hc}\nEstuvo alta ${duracion(t)}.`, ahora, primera, e.cliente);
    regla(s + '|ram', A.ram, ram == null ? null : ram >= A.ramUmbral, ram != null && ram < A.ramUmbral - 3, A.ramMin,
      () => `🟠 <b>${hs}: memoria al ${ram} %</b>${hc}\n${e.ramTotal ? `${gb(e.ramUsada)} de ${gb(e.ramTotal)} GB en uso.` : ''}`,
      t => `✅ <b>${hs}: memoria normal</b> (${ram} %)${hc}\nEstuvo alta ${duracion(t)}.`, ahora, primera, e.cliente);
    const wan = vivo && e.red && e.red.wan;
    regla(s + '|wan', A.wan, wan ? !wan.activa : null, wan ? wan.activa : false, 0,
      () => `🔴 <b>${hs}: se cayó el enlace WAN</b>${hc}\nLa interfaz ${H(wan.interfaz)} está sin enlace. El router sigue respondiendo (quizá por un respaldo).`,
      t => `🟢 <b>${hs}: el enlace WAN volvió</b>${hc}\nEstuvo caído ${duracion(t)}.`, ahora, primera, e.cliente);
    if (vivo && e.tipo !== 'mikrotik') for (const d of e.discos) {
      if (d.pct == null) continue;
      regla(`${s}|disco|${d.unidad}`, A.disco, d.pct >= A.discoUmbral, d.pct < A.discoUmbral - 2, 0,
        () => `🟠 <b>${hs}: disco ${H(d.unidad)} al ${d.pct} %</b>${hc}\nQuedan ${gb(d.libre)} GB libres de ${gb(d.total)} GB.`,
        () => `✅ <b>${hs}: disco ${H(d.unidad)} con espacio</b> (${d.pct} %)${hc}`, ahora, primera, e.cliente);
    }
  }
  for (const k of [...estados.keys()]) if (!vigentes.has(k.split('|')[0])) estados.delete(k);
  let cambio = [...estados.values()].filter(e => e.activa).length !== antes;
  if (primera === 'anunciar') {
    const act = [...estados.values()].filter(e => e.activa).map(e => '• ' + e.texto.split('\n')[0].replace(/<[^>]+>/g, '').replace(/^[🔴🟠] /u, ''));
    encolar('🔔 <b>Avisos de Atalaya activados</b>\n' + (act.length === 0 ? 'Ahora mismo todo está en orden. Te avisaré cuando algo cambie.'
      : `Ahora mismo hay ${act.length} ${act.length === 1 ? 'problema' : 'problemas'}:\n${H(act.join('\n'))}\n\nTe avisaré de lo nuevo y de lo que se resuelva.`));
    cambio = true;
  }
  if (primera) cambio = true;
  if (cambio) guardarEstado();
  resumenDiario();
}

// ---------------------------------------------------------------- resumen diario
function partesHoy() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: config.ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => f.find(p => p.type === t).value;
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
}
function resumenDiario() {
  if (!A.resumen) return;
  const { dia, hora } = partesHoy();
  if (A.ultimoResumen === dia || hora < A.resumenHora) return;
  A.ultimoResumen = dia; guardar();
  encolar(textoResumen());
}
function textoResumen() {
  const ahora = Date.now(), desde = ahora - 864e5;
  const fecha = new Date().toLocaleDateString('es', { timeZone: config.ZONA_HORARIA, weekday: 'long', day: 'numeric', month: 'long' });
  const todos = flota.estado({ clientes: null });
  let total = 0, enLinea = 0, act = 0, dsc = 0;
  const lineas = [], revisar = [];
  for (const c of todos.clientes) {
    if (!c.equipos.length) continue;
    const caidos = c.equipos.filter(e => e.estado === 'caido');
    total += c.equipos.length; enLinea += c.equipos.length - caidos.length;
    for (const e of c.equipos) {
      act += e.sesiones.filter(s => s.estado === 'activa').length; dsc += e.sesiones.filter(s => s.estado === 'desconectada').length;
      if (e.estado !== 'caido') {
        if (e.ramPct != null && e.ramPct >= A.ramUmbral) revisar.push(`${H(e.nombre)} (${H(c.nombre)}): memoria al ${e.ramPct} %`);
        for (const d of e.discos) if (d.pct >= A.discoUmbral) revisar.push(`${H(e.nombre)} (${H(c.nombre)}): disco ${H(d.unidad)} al ${d.pct} %`);
      }
    }
    const caidas = q(`SELECT COUNT(*) n FROM eventos ev JOIN equipos e ON e.id = ev.equipo_id WHERE e.cliente_id = ? AND ev.tipo = 'caida' AND ev.t >= ?`).get(c.id, desde).n;
    lineas.push(`${caidos.length ? '🔴' : '🟢'} <b>${H(c.nombre)}</b>: ${c.equipos.length - caidos.length} de ${c.equipos.length} en línea` +
      (caidos.length ? ` (sin respuesta: ${caidos.map(e => H(e.nombre)).join(', ')})` : '') + (caidas ? `, ${caidas} ${caidas === 1 ? 'caída' : 'caídas'} en 24 h` : ''));
  }
  return `📋 <b>Resumen de Atalaya</b>, ${fecha}\n\n<b>Equipos:</b> ${enLinea} de ${total} en línea.\n<b>Ahora:</b> ${act} ${act === 1 ? 'sesión activa' : 'sesiones activas'} y ${dsc} ${dsc === 1 ? 'desconectada' : 'desconectadas'}.\n\n` +
    (lineas.join('\n') || 'Todavía no hay equipos.') + (revisar.length ? `\n\n<b>Para revisar:</b>\n• ${revisar.join('\n• ')}` : '\n\nNada pendiente de revisar.');
}
const enviarResumen = () => encolar(textoResumen());

function arrancar() {
  cargarEstado();
    // Tras reiniciar no se repiten avisos de problemas que ya existían
  if (A.activo) silenciar = 'callar';
  setInterval(() => evaluar(), 15000).unref();
  setInterval(() => enviar(), 30000).unref();
}

module.exports = { info, guardarDesdeWeb, buscarChats, probar, evaluar, enviarResumen, arrancar };
