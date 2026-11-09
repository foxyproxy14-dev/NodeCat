'use strict';
// Sonda: un agente Windows del cliente lee por NodeCat los MikroTik y FortiGate de su red.
// NodeCat no necesita llegar al equipo: el agente mantiene una petición abierta (long-poll) hacia NodeCat,
// recibe las órdenes (comandos de la API de RouterOS o lecturas HTTPS de FortiOS), las ejecuta en la red local
// y devuelve el resultado. El resto de NodeCat usa estos clientes igual que los directos.
const { q } = require('./db');
const { Conexion, ErrorRouter } = require('./routeros');
const { camino, interpretar, ErrorForti } = require('./fortios');

const ESPERA = 25000;                 // cuánto se mantiene abierta la petición del agente si no hay órdenes
const VERSION_MINIMA = [1, 2, 0];
const agentes = new Map();            // equipoId (Windows) → estado de la sonda
const usos = new Map();               // equipoId (Windows) → Set de equipos de red que lee
let secuencia = 1;

function estado(id) {
  let a = agentes.get(id);
  if (!a) agentes.set(id, a = { cola: [], espera: null, visto: 0, ultimo: 0, pendientes: new Map(), quiere: 0, esperandoConexion: [] });
  return a;
}
const conectado = a => !!a.espera || Date.now() - a.visto < 40000;

function fila(id) { return q("SELECT id, cliente_id, nombre, ultimo_contacto, version_agente FROM equipos WHERE id = ? AND tipo = 'windows'").get(id); }
function versionVale(v) {
  const p = String(v || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((p[i] || 0) !== VERSION_MINIMA[i]) return (p[i] || 0) > VERSION_MINIMA[i]; }
  return true;
}

/** Comprueba que un servidor puede hacer de sonda para un cliente. Devuelve su id. */
function validar(sondaId, clienteId) {
  if (sondaId == null || sondaId === '' || sondaId === 0) return null;
  const f = fila(Number(sondaId));
  if (!f) throw new Error('Elige un servidor del cliente para hacer de sonda.');
  if (clienteId != null && f.cliente_id !== Number(clienteId)) throw new Error('El servidor elegido como sonda es de otro cliente.');
  return f.id;
}
function nombre(id) { const f = fila(id); return f ? f.nombre : `el servidor ${id}`; }

// Los colectores registran qué equipos se leen por cada sonda (para decirle al agente que se conecte)
function registrar(sondaId, equipoId) { if (!sondaId) return; if (!usos.has(sondaId)) usos.set(sondaId, new Set()); usos.get(sondaId).add(equipoId); }
function soltar(equipoId) { for (const [s, l] of usos) { l.delete(equipoId); if (!l.size) usos.delete(s); } }
/** El informe del agente responde sonda: true si tiene equipos asignados o alguien está probando una conexión por él. */
function enUso(id) { const a = agentes.get(id); return usos.has(id) || !!(a && Date.now() - a.quiere < 90000); }

// ---------------------------------------------------------------- cola de órdenes
function despachar(a) {
  if (!a.espera || !a.cola.length) return;
  const { responder } = a.espera; a.espera = null;
  responder(a.cola.splice(0, 40));
}

async function esperarConexion(id, a) {
  const f = fila(id);
  if (!f) throw new ErrorRouter('El servidor que hacía de sonda ya no existe. Elige otro en la configuración del equipo.', 'red');
  if (!versionVale(f.version_agente)) throw new ErrorRouter(`El agente de ${f.nombre} es la versión ${f.version_agente || 'antigua'}. Para usarlo como sonda, instala el agente nuevo (1.2 o superior) desde Clientes y agentes.`, 'red');
  if (!f.ultimo_contacto || Date.now() - f.ultimo_contacto > 120000) throw new ErrorRouter(`${f.nombre}, que hace de sonda, no está informando a NodeCat. Revisa que esté encendido y con el agente en marcha.`, 'red');
  // Si ya estuvo conectada y se fue, no se espera: es una caída (de la sonda o de la red del cliente)
  if (a.ultimo) { a.quiere = Date.now(); throw new ErrorRouter(`La sonda ${f.nombre} no está conectada con NodeCat. Revisa que el servidor esté encendido y con Internet.`, 'red'); }
  // El agente se conecta como sonda en su próximo informe (cada 30 s como mucho)
  a.quiere = Date.now();
  await new Promise((ok, mal) => {
    const t = setTimeout(() => { a.esperandoConexion = a.esperandoConexion.filter(x => x !== ok); mal(new ErrorRouter(`${f.nombre} no se conectó como sonda. Comprueba que tiene el agente 1.2 o superior.`, 'red')); }, 45000);
    a.esperandoConexion.push(() => { clearTimeout(t); ok(); });
  });
}

/** Envía una orden al agente y espera su resultado. */
async function pedir(id, orden, tiempo) {
  const a = estado(id);
  if (!conectado(a)) await esperarConexion(id, a);
  return new Promise((ok, mal) => {
    const o = { id: secuencia++, ...orden, tiempo };
    const t = setTimeout(() => {
      a.pendientes.delete(o.id); a.cola = a.cola.filter(x => x !== o);
      mal(new ErrorRouter(`La sonda ${nombre(id)} no respondió a tiempo.`, 'red'));
    }, tiempo + 10000);
    a.pendientes.set(o.id, { ok, mal, t });
    a.cola.push(o);
    despachar(a);
  });
}

/** Petición del agente: entrega resultados y espera órdenes. */
function atender(id, resultados, res) {
  const a = estado(id);
  a.visto = a.ultimo = Date.now();
  for (const ok of a.esperandoConexion.splice(0)) ok();
  if (a.espera) { const { responder } = a.espera; a.espera = null; responder([]); }   // una sola petición abierta por agente
  let hubo = false;
  for (const r of Array.isArray(resultados) ? resultados.slice(0, 200) : []) {
    const p = r && a.pendientes.get(r.id); if (!p) continue;
    a.pendientes.delete(r.id); clearTimeout(p.t); hubo = true;
    p.ok(r);
  }
  return new Promise(ok => {
    let hecho = false;
    const responder = ordenes => { if (hecho) return; hecho = true; clearTimeout(a._t); a.visto = a.ultimo = Date.now(); ok({ ordenes, espera: ESPERA }); };
    const abrir = () => {
      if (a.cola.length) return responder(a.cola.splice(0, 40));
      a.espera = { responder };
      a._t = setTimeout(() => { if (a.espera && a.espera.responder === responder) a.espera = null; responder([]); }, ESPERA);
      // Si la conexión del agente se corta mientras espera, se da por desconectado enseguida (salvo que vuelva en 5 s)
      res.on('close', () => { if (!res.writableEnded && a.espera && a.espera.responder === responder) { a.espera = null; a.visto = Date.now() - 35000; hecho = true; clearTimeout(a._t); } });
    };
    // Tras entregar resultados, los colectores suelen pedir el siguiente comando en milisegundos: se espera un poco para juntarlo
    if (hubo) setTimeout(abrir, 15); else abrir();
  });
}

function olvidar(id) {
  const a = agentes.get(id); if (!a) return;
  for (const [, p] of a.pendientes) { clearTimeout(p.t); p.mal(new ErrorRouter('El servidor que hacía de sonda se quitó de NodeCat.', 'red')); }
  if (a.espera) a.espera.responder([]);
  agentes.delete(id); usos.delete(id);
}

// ---------------------------------------------------------------- mensajes de error de la red local
function mensajeRed(r, host, puerto, que, sondaNombre) {
  const desde = ` (desde ${sondaNombre})`;
  switch (r.codigo) {
    case 'rechazo': return `${que} ${host} rechaza la conexión en el puerto ${puerto}${desde}.`;
    case 'tiempo': return `${que} ${host}:${puerto} no responde${desde}. Revisa la IP, el puerto y que el servicio esté activo.`;
    case 'ruta': return `No hay ruta hasta ${host}${desde}.`;
    case 'nombre': return `No se encuentra el nombre ${host}${desde}.`;
    case 'cert': return `El certificado de ${host} no es válido${desde}. Desmarca "Verificar el certificado" o instala uno válido.`;
    case 'cerrada': return `${que} ${host} cerró la conexión${desde}.`;
    default: return `Error de conexión con ${host}${desde}: ${r.error || 'desconocido'}`;
  }
}

// ---------------------------------------------------------------- RouterOS a través de la sonda
class ConexionSonda extends Conexion {
  constructor(o) { super(o); this.sonda = o.sonda; this.sondaNombre = nombre(o.sonda); }
  async conectar() {
    // Se comprueba la conexión (y el usuario) con una lectura sencilla
    await this.ejecutar(['/system/identity/print']);
    this.lista = true;
  }
  async ejecutar(palabras, tiempo = this.o.tiempo || 10000) {
    const { host, puerto, ssl, usuario, clave } = this.o;
    const r = await pedir(this.sonda, { tipo: 'ros', con: { host, puerto, ssl: !!ssl, usuario, clave }, palabras }, tiempo);
    if (r.error) {
      if (r.tipo === 'trap') throw new ErrorRouter(r.error, 'trap');
      if (r.tipo === 'login') throw new ErrorRouter('El router rechazó el usuario o la contraseña.', 'login');
      this.lista = false;
      throw new ErrorRouter(mensajeRed(r, host, puerto, 'El router', this.sondaNombre), 'red');
    }
    return { filas: Array.isArray(r.filas) ? r.filas : [], done: r.done || {} };
  }
  cerrar() { this.lista = false; }
}

// ---------------------------------------------------------------- FortiOS a través de la sonda
class FortiOSSonda {
  constructor({ host, puerto, token, verificar, vdom, tiempo = 10000, sonda }) {
    this.o = { host, puerto: puerto || 443, token, verificar: !!verificar, vdom: vdom || '', tiempo };
    this.sonda = sonda; this.sondaNombre = nombre(sonda);
  }
  async get(ruta, params = {}, tiempo = this.o.tiempo) {
    const { host, puerto, token, verificar } = this.o;
    const r = await pedir(this.sonda, { tipo: 'https', con: { host, puerto, token, verificar }, camino: camino(ruta, params, this.o.vdom) }, tiempo);
    if (r.error) throw new ErrorForti(mensajeRed(r, host, puerto, 'El FortiGate', this.sondaNombre), 'red');
    return interpretar(r.estado, r.cuerpo || '', ruta);
  }
  cerrar() { }
}

function resumen() {
  return [...agentes].map(([id, a]) => ({ id, conectado: conectado(a), pendientes: a.pendientes.size, equipos: usos.has(id) ? [...usos.get(id)] : [] }));
}

module.exports = { validar, registrar, soltar, enUso, atender, pedir, olvidar, ConexionSonda, FortiOSSonda, nombre, resumen, versionVale };
