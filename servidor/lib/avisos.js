'use strict';
// Avisos por Telegram: ajustes, reglas con histéresis, cola de envío y resumen diario.
const { q, ajustes } = require('./db');
const flota = require('./flota');
const config = require('./config');
const { log, duracion, html: H, nf } = require('./util');

const { cifrar, descifrar } = require('./secreto');

// ---------------------------------------------------------------- ajustes
const DEFECTO = {
  activo: false, token: '', chats: [], porCliente: {}, bots: [],
  caidas: true, caidaMin: 0,
  cpu: true, cpuUmbral: 90, cpuMin: 5,
  ram: true, ramUmbral: 95, ramMin: 10,
  disco: true, discoUmbral: 90,
  wan: true,
  resumen: false, resumenHora: '08:00', recordarHoras: 0, ultimoResumen: ''
};
const CLAVE = config.DEMO ? 'notificaciones-demo' : 'notificaciones';
let A = { ...DEFECTO, ...ajustes.leer(CLAVE, {}) };
if (!Array.isArray(A.bots)) A.bots = [];
const token = () => descifrar(A.token);
const guardar = () => ajustes.guardar(CLAVE, A);

function info() {
  const tk = token();
  const { token: _, ultimoResumen, bots, ...resto } = A;
  return {
    ...resto, bots: bots.map(infoBot), tokenGuardado: tk.length > 0, tokenFin: tk.length > 6 ? tk.slice(-4) : '',
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
    recordarHoras: rango(o, 'recordarHoras', 0, 48), ultimoResumen: A.ultimoResumen, bots: A.bots
  };
  for (const [id, t] of Object.entries(o.porCliente || {})) { const l = listaChats(t); if (l.length) n.porCliente[id] = l; }
  const nuevoToken = String(o.token || '').trim();
  n.token = nuevoToken ? cifrar(nuevoToken) : A.token;
  const conBots = n.bots.some(b => b.chats.length);
  if (n.activo && !descifrar(n.token) && !conBots) throw new Error('Escribe el token del bot general o agrega un bot por cliente.');
  if (n.activo && descifrar(n.token) && !n.chats.length && !Object.keys(n.porCliente).length && !conBots) throw new Error('Elige al menos un chat donde enviar los avisos.');
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
    const err = new Error(`No se pudo conectar con Telegram (${e.cause ? e.cause.code || e.cause.message : e.message}). Comprueba que el servidor de NodeCat tiene salida a Internet hacia api.telegram.org.`);
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
    text: '✅ <b>NodeCat</b>\nLas notificaciones funcionan. A partir de ahora los avisos llegarán a este chat.' + (config.DEMO ? '\n<i>(modo demo)</i>' : '')
  });
  return '@' + yo.username;
}

// ---------------------------------------------------------------- bots por cliente o grupo
// Cada bot se asigna a clientes y/o grupos. NodeCat detecta solo los chats donde está el bot (al añadirlo a un grupo
// de Telegram o al escribirle) y le manda las alertas de sus clientes. Así cada cliente recibe solo lo suyo, por su bot.
const tokenBot = b => descifrar(b.token);
const ids = l => [...new Set((Array.isArray(l) ? l : []).map(Number).filter(Number.isInteger))];
function clientesDeBot(b) {
  const g = new Set(b.grupos || []);
  return new Set([...(b.clientes || []), ...flota.clientes().filter(c => c.grupo_id && g.has(c.grupo_id)).map(c => c.id)]);
}
function infoBot(b) {
  const cs = flota.clientes(), gs = flota.grupos();
  return {
    id: b.id, usuario: b.usuario, nombre: b.nombre, chats: b.chats, error: b.error || null,
    clientes: b.clientes || [], grupos: b.grupos || [],
    alcance: [...(b.grupos || []).map(id => { const g = gs.find(x => x.id === id); return g ? g.nombre + ' (grupo)' : null; }),
      ...(b.clientes || []).map(id => { const c = cs.find(x => x.id === id); return c ? c.nombre : null; })].filter(Boolean)
  };
}
const tipoChat = ch => ch.type === 'private' ? 'Chat personal' : ch.type === 'channel' ? 'Canal' : 'Grupo';
const nombreChat = ch => ch.title || `${ch.first_name || ''} ${ch.last_name || ''}`.trim() || ch.username || String(ch.id);

/** Lee lo nuevo del bot: grupos donde lo añadieron o lo quitaron, y chats que le escribieron. */
async function leerBot(b, aviso) {
  const ups = await llamar(tokenBot(b), `getUpdates?timeout=0&limit=100${b.offset ? '&offset=' + b.offset : ''}&allowed_updates=${encodeURIComponent('["message","channel_post","my_chat_member"]')}`);
  const nuevos = [];
  for (const u of ups || []) {
    b.offset = u.update_id + 1;
    const mc = u.my_chat_member;
    if (mc && mc.chat) {
      const dentro = ['member', 'administrator', 'creator'].includes(mc.new_chat_member && mc.new_chat_member.status);
      const i = b.chats.findIndex(c => c.id === String(mc.chat.id));
      if (!dentro && i >= 0) { const c = b.chats.splice(i, 1)[0]; log(`Telegram: sacaron al bot ${b.usuario} de "${c.nombre}".`); }
      if (dentro && i < 0) { const c = { id: String(mc.chat.id), nombre: nombreChat(mc.chat), tipo: tipoChat(mc.chat) }; b.chats.push(c); nuevos.push(c); }
      continue;
    }
    const ch = (u.message || u.channel_post || {}).chat;
    if (ch && !b.chats.some(c => c.id === String(ch.id))) { const c = { id: String(ch.id), nombre: nombreChat(ch), tipo: tipoChat(ch) }; b.chats.push(c); nuevos.push(c); }
    // Si migran el grupo a supergrupo, Telegram cambia su número
    const m = u.message;
    if (m && m.migrate_to_chat_id) { const c = b.chats.find(x => x.id === String(m.chat.id)); if (c) c.id = String(m.migrate_to_chat_id); }
  }
  b.error = null;
  for (const c of nuevos) {
    log(`Telegram: el bot ${b.usuario} ahora envía los avisos a "${c.nombre}".`);
    if (aviso) {
      const quien = infoBot(b).alcance;
      try { await llamar(tokenBot(b), 'sendMessage', { chat_id: c.id, parse_mode: 'HTML', text: `🐱 <b>NodeCat</b>\nDesde ahora en este chat llegarán los avisos de: <b>${H(quien.join(', ') || 'ningún cliente todavía')}</b>.` + (config.DEMO ? '\n<i>(modo demo)</i>' : '') }); } catch { }
    }
  }
  return nuevos;
}

async function agregarBot(o, quien) {
  const tk = String(o.token || '').trim();
  if (!/^\d{5,15}:[A-Za-z0-9_-]{20,80}$/.test(tk)) throw new Error('Pega el token completo que te dio @BotFather (números, dos puntos y letras).');
  const yo = await llamar(tk, 'getMe');
  if (A.bots.some(b => b.botId === yo.id)) throw new Error(`El bot @${yo.username} ya está agregado. Edita sus clientes en la lista.`);
  if (descifrar(A.token) === tk) throw new Error(`@${yo.username} ya es el bot general. Usa otro bot para cada cliente.`);
  const b = { id: 'b' + yo.id, botId: yo.id, usuario: '@' + yo.username, nombre: yo.first_name || yo.username, token: cifrar(tk), chats: [], clientes: ids(o.clientes), grupos: ids(o.grupos), offset: 0 };
  try { await llamar(tk, 'deleteWebhook'); } catch { }
  await leerBot(b, true);
  A.bots.push(b); guardar();
  log(`${quien} agregó el bot de Telegram ${b.usuario}.`);
  return infoBot(b);
}
function editarBot(id, o, quien) {
  const b = A.bots.find(x => x.id === id); if (!b) throw new Error('Ese bot ya no está.');
  if (o.clientes) b.clientes = ids(o.clientes);
  if (o.grupos) b.grupos = ids(o.grupos);
  if (Array.isArray(o.chats)) { const quedan = new Set(o.chats.map(String)); b.chats = b.chats.filter(c => quedan.has(c.id)); }
  guardar(); log(`${quien} cambió el bot de Telegram ${b.usuario}.`);
  return infoBot(b);
}
function quitarBot(id, quien) {
  const b = A.bots.find(x => x.id === id); if (!b) return;
  A.bots = A.bots.filter(x => x !== b); guardar();
  log(`${quien} quitó el bot de Telegram ${b.usuario}.`);
}
async function probarBot(id) {
  const b = A.bots.find(x => x.id === id); if (!b) throw new Error('Ese bot ya no está.');
  await leerBot(b, false); guardar();
  if (!b.chats.length) throw new Error(`${b.usuario} todavía no está en ningún chat. Añádelo al grupo de Telegram del cliente (o escríbele) y vuelve a probar.`);
  const quien = infoBot(b).alcance.join(', ') || 'ningún cliente todavía';
  for (const c of b.chats) await llamar(tokenBot(b), 'sendMessage', { chat_id: c.id, parse_mode: 'HTML', text: `✅ <b>NodeCat</b>\nLas notificaciones funcionan. Aquí llegarán los avisos de: <b>${H(quien)}</b>.` + (config.DEMO ? '\n<i>(modo demo)</i>' : '') });
  return infoBot(b);
}
// Cada minuto: ¿añadieron algún bot a un grupo nuevo?
let leyendoBots = false;
async function vigilarBots() {
  if (leyendoBots || !A.bots.length) return;
  leyendoBots = true;
  let cambio = false;
  try {
    for (const b of A.bots) {
      const antes = JSON.stringify(b.chats) + b.offset;
      try { await leerBot(b, true); } catch (e) { if (!e.sinRed) b.error = e.message; }
      if (antes !== JSON.stringify(b.chats) + b.offset) cambio = true;
    }
  } finally { leyendoBots = false; if (cambio) guardar(); }
}

// ---------------------------------------------------------------- cola de envío
const cola = [], recientes = [];
let enviando = false;
function encolar(texto, clienteId, soloBot) {
  if (config.DEMO) texto = '<i>[demo]</i> ' + texto;
  cola.push({ texto, clienteId, soloBot });
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
      const m = cola[0];
      const destinos = m.enviados ? m.pendientes : destinosDe(m);
      m.enviados = true; m.pendientes = destinos;
      let error = null, reintentar = false;
      while (m.pendientes.length) {
        const [tk, c] = m.pendientes[0];
        try { await llamar(tk, 'sendMessage', { chat_id: c, text: m.texto, parse_mode: 'HTML', disable_web_page_preview: true }); m.pendientes.shift(); }
        catch (e) {
          if (e.codigo === 429) { await dormir(Math.max(1, e.esperar || 1) * 1000); reintentar = true; break; }
          if (e.sinRed) { log('Telegram: ' + e.message); await dormir(60000); reintentar = true; break; }
          error = e.message; m.pendientes.shift();
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

/** A quién va cada aviso: el bot general (sus chats y los chats extra del cliente) y los bots asignados a ese cliente. */
function destinosDe(m) {
  const l = [], visto = new Set();
  const poner = (tk, c) => { const k = tk + '|' + c; if (tk && !visto.has(k)) { visto.add(k); l.push([tk, c]); } };
  if (m.soloBot) { const b = A.bots.find(x => x.id === m.soloBot); if (b) for (const c of b.chats) poner(tokenBot(b), c.id); return l; }
  const tk = token();
  for (const c of [...A.chats, ...((m.clienteId && A.porCliente[m.clienteId]) || [])]) poner(tk, c);
  if (m.clienteId) for (const b of A.bots) if (clientesDeBot(b).has(Number(m.clienteId))) for (const c of b.chats) poner(tokenBot(b), c.id);
  return l;
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
      () => `🔴 <b>${hs} no responde</b>${hc}\n${e.tipo !== 'windows' ? `NodeCat no puede conectar con el equipo${e.errorConexion ? ': ' + H(e.errorConexion) : '.'}` : `Sin noticias del agente desde ${new Date(e.ultimo).toLocaleTimeString('es', { timeZone: config.ZONA_HORARIA, hour: '2-digit', minute: '2-digit' })}.`}`,
      t => `🟢 <b>${hs} vuelve a responder</b>${hc}\nEstuvo sin responder ${duracion(t)}.`, ahora, primera, e.cliente);
    const cpu = vivo ? e.cpu : null, ram = vivo ? e.ramPct : null;
    regla(s + '|cpu', A.cpu, cpu == null ? null : cpu >= A.cpuUmbral, cpu != null && cpu < A.cpuUmbral - 5, A.cpuMin,
      () => `🟠 <b>${hs}: CPU al ${cpu} %</b>${hc}\nLleva ${A.cpuMin > 0 ? `más de ${A.cpuMin} min ` : ''}por encima del ${A.cpuUmbral} %.`,
      t => `✅ <b>${hs}: CPU normal</b> (${cpu} %)${hc}\nEstuvo alta ${duracion(t)}.`, ahora, primera, e.cliente);
    regla(s + '|ram', A.ram, ram == null ? null : ram >= A.ramUmbral, ram != null && ram < A.ramUmbral - 3, A.ramMin,
      () => `🟠 <b>${hs}: memoria al ${ram} %</b>${hc}\n${e.ramTotal ? `${gb(e.ramUsada)} de ${gb(e.ramTotal)} GB en uso.` : ''}`,
      t => `✅ <b>${hs}: memoria normal</b> (${ram} %)${hc}\nEstuvo alta ${duracion(t)}.`, ahora, primera, e.cliente);
    for (const wan of vivo ? flota.wansDe({ red: e.red }) : []) {
      regla(`${s}|wan|${wan.interfaz}`, A.wan, !wan.activa, wan.activa, 0,
        () => `🔴 <b>${hs}: se cayó el enlace WAN ${H(wan.interfaz)}</b>${hc}\nEl equipo sigue respondiendo (quizá por otro enlace).`,
        t => `🟢 <b>${hs}: volvió el enlace WAN ${H(wan.interfaz)}</b>${hc}\nEstuvo caído ${duracion(t)}.`, ahora, primera, e.cliente);
    }
    if (vivo && e.tipo === 'windows') for (const d of e.discos) {
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
    encolar('🔔 <b>Avisos de NodeCat activados</b>\n' + (act.length === 0 ? 'Ahora mismo todo está en orden. Te avisaré cuando algo cambie.'
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
  enviarResumen();
}
function textoResumen(soloClientes) {
  const ahora = Date.now(), desde = ahora - 864e5;
  const fecha = new Date().toLocaleDateString('es', { timeZone: config.ZONA_HORARIA, weekday: 'long', day: 'numeric', month: 'long' });
  const todos = flota.estado({ clientes: soloClientes ? [...soloClientes] : null });
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
  return `📋 <b>Resumen de NodeCat</b>, ${fecha}\n\n<b>Equipos:</b> ${enLinea} de ${total} en línea.\n<b>Ahora:</b> ${act} ${act === 1 ? 'sesión activa' : 'sesiones activas'} y ${dsc} ${dsc === 1 ? 'desconectada' : 'desconectadas'}.\n\n` +
    (lineas.join('\n') || 'Todavía no hay equipos.') + (revisar.length ? `\n\n<b>Para revisar:</b>\n• ${revisar.join('\n• ')}` : '\n\nNada pendiente de revisar.');
}
function enviarResumen() {
  if (token() && A.chats.length) encolar(textoResumen());
  for (const b of A.bots) if (b.chats.length) { const cs = clientesDeBot(b); if (cs.size) encolar(textoResumen(cs), null, b.id); }
}

function arrancar() {
  cargarEstado();
    // Tras reiniciar no se repiten avisos de problemas que ya existían
  if (A.activo) silenciar = 'callar';
  setInterval(() => evaluar(), 15000).unref();
  setInterval(() => enviar(), 30000).unref();
  setInterval(() => vigilarBots(), 60000).unref();
  setTimeout(() => vigilarBots(), 5000).unref();
}

module.exports = { info, guardarDesdeWeb, buscarChats, probar, evaluar, enviarResumen, arrancar, agregarBot, editarBot, quitarBot, probarBot, vigilarBots, destinosDe };
