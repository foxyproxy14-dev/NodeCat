'use strict';
// Modo demo: clientes y servidores inventados que informan como agentes de verdad, con 30 días de historial.
const { q, transaccion } = require('./db');
const flota = require('./flota');
const auth = require('./auth');
const { log } = require('./util');

const ROUTERS = {
  'Clínica San Rafael': [['Router principal', 'rb5009']],
  'Transportes Andes': [['Core sede Valencia', 'ccr2004'], ['Almacén Puerto Cabello', 'hapax2']],
  'Estudio Contable Mérida': [['Router oficina', 'hex']],
  'Ferretería El Tornillo': [['Router tienda', 'hapac2']]
};
const CLIENTES = [
  { nombre: 'Clínica San Rafael', notas: 'Soporte 24/7. Contacto: Dra. Paredes.', equipos: [
    { nombre: 'SRV-DC01', perfil: 'dc' }, { nombre: 'SRV-RDS01', perfil: 'rds', alto: 'cpu' }, { nombre: 'SRV-RDS02', perfil: 'rds' }, { nombre: 'SRV-SQL01', perfil: 'sql' }] },
  { nombre: 'Transportes Andes', grupo: 'Grupo Andes', notas: 'Sede Valencia y almacén de Puerto Cabello.', equipos: [
    { nombre: 'TA-DC01', perfil: 'dc' }, { nombre: 'TA-TS01', perfil: 'rds' }, { nombre: 'TA-TS02', perfil: 'rds', caido: true }, { nombre: 'TA-ERP', perfil: 'sql', alto: 'disco' }] },
  { nombre: 'Andes Logística Barquisimeto', grupo: 'Grupo Andes', notas: 'Sede nueva.', equipos: [{ nombre: 'ALB-SRV01', perfil: 'rds' }] },
  { nombre: 'Estudio Contable Mérida', notas: '', equipos: [{ nombre: 'ECM-SRV01', perfil: 'rds' }, { nombre: 'ECM-BACKUP', perfil: 'archivo' }] },
  { nombre: 'Ferretería El Tornillo', notas: 'Horario: lunes a sábado.', equipos: [{ nombre: 'FT-SERVIDOR', perfil: 'rds' }] }
];
const PERSONAS = ['mgarcia', 'jrodriguez', 'aperez', 'lfernandez', 'cgonzalez', 'rmartinez', 'psanchez', 'dramirez', 'vtorres', 'eflores',
  'hmorales', 'njimenez', 'scastro', 'ovargas', 'iromero', 'bherrera', 'gmedina', 'kaguilar', 'tsilva', 'fmendoza', 'ureyes', 'yortiz'];
const PERFILES = {
  dc: { cpu: 8, ram: 46, ramTotal: 8, sesiones: [0, 2], discos: [['C:', 'Sistema', 80, 41]] },
  rds: { cpu: 34, ram: 62, ramTotal: 32, sesiones: [6, 16], discos: [['C:', 'Sistema', 120, 63], ['D:', 'Perfiles', 500, 48]] },
  sql: { cpu: 22, ram: 66, ramTotal: 64, sesiones: [0, 2], discos: [['C:', 'Sistema', 100, 52], ['E:', 'Datos', 1000, 71], ['F:', 'Registros', 200, 38]] },
  archivo: { cpu: 5, ram: 30, ramTotal: 8, sesiones: [0, 1], discos: [['C:', 'Sistema', 80, 37], ['D:', 'Copias', 4000, 66]] }
};
const SO = { dc: 'Windows Server 2019 Standard', rds: 'Windows Server 2022 Standard', sql: 'Windows Server 2022 Datacenter', archivo: 'Windows Server 2016 Standard' };

let semilla = 7;
const azar = () => { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; };
const entre = (a, b) => a + azar() * (b - a);
const rnd = Math.random;

// Carga diaria: baja de noche, sube en horario de oficina (hora local de Venezuela)
function jornada(t) {
  const d = new Date(t - 4 * 3600e3), h = d.getUTCHours() + d.getUTCMinutes() / 60, finde = d.getUTCDay() === 0;
  const oficina = h >= 7.5 && h <= 18.5 ? Math.sin((h - 7.5) / 11 * Math.PI) : 0;
  return (finde ? 0.25 : 1) * oficina;
}

const equiposDemo = [];   // { id, clave, cfg, perfil, sesiones, arranque, discos }

function preparar() {
  if (!q('SELECT COUNT(*) n FROM clientes').get().n) { sembrar(); transaccion(sembrarRouters); }
  if (!auth.hayCuentas()) {
    auth.guardarCuenta({ usuario: 'demo', clave: 'nodecat-demo', rol: 'admin', clientes: null }, true);
    const g = q("SELECT grupo_id FROM clientes WHERE nombre = 'Transportes Andes'").get().grupo_id;
    auth.guardarCuenta({ usuario: 'andes', clave: 'nodecat-demo', rol: 'lector', clientes: null, grupos: [g] }, true);
  }
  for (const c of CLIENTES) {
    const cli = q('SELECT id, clave FROM clientes WHERE nombre = ?').get(c.nombre); if (!cli) continue;
    for (const e of c.equipos) {
      const fila = q("SELECT id FROM equipos WHERE cliente_id = ? AND nombre = ? AND tipo = 'windows'").get(cli.id, e.nombre); if (!fila) continue;
      const p = PERFILES[e.perfil];
      equiposDemo.push({
        id: fila.id, cliente: cli.id, cfg: e, p, arranque: Date.now() - entre(3, 40) * 864e5,
        discos: p.discos.map(([u, et, tot, pct]) => ({ u, et, tot, pct: e.alto === 'disco' && u === 'E:' ? 93.4 : pct })),
        sesiones: []
      });
    }
  }
  log('Modo demo: entra con el usuario "demo" y la contraseña "nodecat-demo" (o "andes" para ver un solo cliente).');
}

function sembrar() {
  log('Modo demo: creando clientes y 30 días de historial…');
  const ahora = Date.now();
  transaccion(() => {
    for (const c of CLIENTES) {
      const cid = flota.crearCliente(c.nombre, c.notas, c.grupo || null);
      for (const e of c.equipos) {
        const p = PERFILES[e.perfil];
        const creado = ahora - 32 * 864e5;
        const r = q("INSERT INTO equipos (cliente_id, tipo, nombre, creado, ultimo_contacto, version_agente, ip, intervalo) VALUES (?, 'windows', ?, ?, ?, '1.1.0', ?, 30)")
          .run(cid, e.nombre, creado, e.caido ? ahora - 47 * 60000 : ahora - 20000, `10.${cid}.0.${10 + Number(q('SELECT COUNT(*) n FROM equipos').get().n)}`);
        const id = Number(r.lastInsertRowid);
        if (e.caido) q('UPDATE equipos SET datos = ? WHERE id = ?').run(JSON.stringify(informe({ cfg: e, p, arranque: ahora - 9 * 864e5, discos: p.discos.map(([u, et, tot, pct]) => ({ u, et, tot, pct })), sesiones: [] }, ahora - 47 * 60000)), id);
        // Métricas: 5 min hasta hace 7 días, 1 min después
        const ins = q('INSERT INTO metricas (equipo_id, t, cpu, ram, disco, resumen) VALUES (?, ?, ?, ?, ?, ?)');
        const maxDisco = Math.max(...p.discos.map(d => d[3])) + (e.alto === 'disco' ? 22 : 0);
        for (let t = creado; t < ahora - (e.caido ? 47 * 60000 : 60000); ) {
          const reciente = t > ahora - 7 * 864e5;
          const j = jornada(t);
          const cpu = Math.round(Math.min(100, Math.max(1, p.cpu * (0.3 + j * 1.4) + entre(-6, 9) + (e.alto === 'cpu' && t > ahora - 50 * 60000 ? 55 : 0))));
          const ram = Math.round(Math.min(99, Math.max(5, p.ram + j * 14 + entre(-4, 4) + (e.alto === 'ram' ? 30 : 0))));
          const disco = Math.round(Math.min(99, maxDisco - (ahora - t) / 864e5 * 0.18));
          ins.run(id, t, cpu, ram, disco, reciente ? 0 : 1);
          t += reciente ? 60000 : 300000;
        }
        // Caídas y reinicios de ejemplo
        const ev = q('INSERT INTO eventos (equipo_id, t, tipo, detalle) VALUES (?, ?, ?, ?)');
        ev.run(id, creado, 'nuevo', 'El agente empezó a informar.');
        const nCaidas = e.caido ? 3 : Math.floor(entre(0, 2.6));
        for (let i = 0; i < nCaidas; i++) {
          const t = Math.round(ahora - entre(1, 29) * 864e5), dur = Math.round(entre(4, 70) * 60000);
          ev.run(id, t, 'caida', 'Dejó de responder.');
          ev.run(id, t + dur, 'vuelta', `Volvió a responder tras ${Math.round(dur / 60000)} min.`);
        }
        if (e.caido) ev.run(id, ahora - 47 * 60000 + 90000, 'caida', 'Dejó de responder.');
        // Sesiones de los últimos 30 días (solo servidores)
        if (p.sesiones[1] > 2) {
          const ses = q('INSERT INTO sesiones (equipo_id, sid, usuario, dominio, origen, estado, inicio, fin, visto, desconexiones) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
          for (let d = 30; d >= 1; d--) {
            const dia = ahora - d * 864e5; if (jornada(dia - (dia % 864e5) + 16 * 3600e3) < 0.5) continue;
            const n = Math.round(entre(p.sesiones[0], p.sesiones[1]));
            for (let i = 0; i < n; i++) {
              const u = PERSONAS[Math.floor(entre(0, PERSONAS.length))];
              const base = dia - (dia % 864e5) + 4 * 3600e3;    // medianoche en Venezuela
              const inicio = base + entre(7.4, 10.5) * 3600e3, fin = inicio + entre(1.5, 9.5) * 3600e3;
              ses.run(id, 2 + i, u, 'CORP', 'PC-' + u.slice(1, 5).toUpperCase() + String(Math.floor(entre(1, 40))).padStart(2, '0'), 'activa', Math.round(inicio), Math.round(fin), Math.round(fin), Math.floor(entre(0, 2.4)));
            }
          }
        }
      }
    }
  });
}

// Routers simulados con su historial de CPU, memoria y tráfico
function sembrarRouters() {
  const ahora = Date.now();
  const { PERFILES } = require('./mikrotik-demo');
  for (const [cliNombre, lista] of Object.entries(ROUTERS)) {
    const cli = q('SELECT id FROM clientes WHERE nombre = ?').get(cliNombre); if (!cli) continue;
    for (const [nombre, perfil] of lista) {
      const id = flota.crearRouter(cli.id, nombre, { demo: true, perfil });
      const p = PERFILES[perfil], creado = ahora - 32 * 864e5;
      q('UPDATE equipos SET creado = ? WHERE id = ?').run(creado, id);
      const insM = q('INSERT INTO metricas (equipo_id, t, cpu, ram, disco, resumen) VALUES (?, ?, ?, ?, NULL, ?)');
      const insT = q('INSERT INTO trafico (equipo_id, t, interfaz, rx, tx, rx_max, tx_max, resumen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const conHist = p.interfaces.filter(i => i[3] > 0).slice(0, 4);
      for (let t = creado; t < ahora - 60000;) {
        const reciente = t > ahora - 864e5, j = jornada(t) * 0.82 + 0.18;
        insM.run(id, t, Math.round(p.cpu * (0.5 + j) + entre(0, 8)), Math.round(52 + entre(-4, 6)), reciente ? 0 : 1);
        for (const [n, , , rx, tx] of conHist) {
          const r = rx * j * entre(0.7, 1.3), x = tx * j * entre(0.7, 1.3);
          insT.run(id, t, n, Math.round(r), Math.round(x), Math.round(r * entre(1.2, 2.2)), Math.round(x * entre(1.2, 2)), reciente ? 0 : 1);
        }
        t += reciente ? 60000 : 300000;
      }
      const ev = q('INSERT INTO eventos (equipo_id, t, tipo, detalle) VALUES (?, ?, ?, ?)');
      if (perfil === 'hapax2') {
        const t = Math.round(ahora - entre(2, 6) * 864e5);
        ev.run(id, t, 'wan-caida', 'El enlace WAN (ether1) se cayó.'); ev.run(id, t + 23 * 60000, 'wan-vuelta', 'El enlace WAN (ether1) volvió.');
      }
      if (perfil === 'hex') { const t = Math.round(ahora - entre(8, 20) * 864e5); ev.run(id, t, 'caida', 'Dejó de responder.'); ev.run(id, t + 14 * 60000, 'vuelta', 'Volvió a responder tras 14 min.'); }
    }
  }
}

function informe(x, ahora) {
  const j = jornada(ahora), p = x.p, e = x.cfg;
  const cpu = Math.round(Math.min(100, Math.max(1, p.cpu * (0.3 + j * 1.4) + (rnd() * 15 - 6) + (e.alto === 'cpu' ? 55 : 0))));
  const ramPct = Math.round(Math.min(99, Math.max(5, p.ram + j * 14 + (rnd() * 8 - 4) + (e.alto === 'ram' ? 30 : 0))));
  return {
    nombre: e.nombre, version: '1.1.0', intervalo: 30, hora: ahora,
    cpu, ramPct, ramTotal: p.ramTotal, ramUsada: Math.round(p.ramTotal * ramPct) / 100, so: SO[e.perfil], arranque: x.arranque,
    discos: x.discos.map(d => ({ unidad: d.u, etiqueta: d.et, total: d.tot, libre: Math.round(d.tot * (100 - d.pct) * 10) / 1000, pct: Math.round(d.pct) })),
    sesiones: x.sesiones.map(s => ({ ...s, inactivo: s.estado === 'desconectada' ? Math.round((ahora - s.desde) / 60000) : Math.floor(rnd() * 12) }))
  };
}

// Las sesiones van cambiando: entra gente, alguien se desconecta, otros cierran
function moverSesiones(x, ahora) {
  const p = x.p; if (p.sesiones[1] < 1) return;
  const objetivo = Math.round(p.sesiones[0] + (p.sesiones[1] - p.sesiones[0]) * jornada(ahora));
  const usados = new Set(x.sesiones.map(s => s.usuario));
  if (x.sesiones.length < objetivo && rnd() < 0.12) {
    const libres = PERSONAS.filter(u => !usados.has(u)); if (!libres.length) return;
    const u = libres[Math.floor(rnd() * libres.length)];
    x.sesiones.push({ usuario: u, dominio: 'CORP', id: 2 + Math.floor(rnd() * 60), estado: 'activa', estadoTexto: 'Activa', equipo: 'PC-' + u.slice(1, 5).toUpperCase() + String(Math.floor(rnd() * 40)).padStart(2, '0'), inicio: ahora - Math.floor(rnd() * 3 * 3600e3), desde: ahora });
  } else if (x.sesiones.length > objetivo && rnd() < 0.1) {
    x.sesiones.splice(Math.floor(rnd() * x.sesiones.length), 1);
  } else if (rnd() < 0.02 && x.sesiones.length) {
    const s = x.sesiones[Math.floor(rnd() * x.sesiones.length)];
    s.estado = s.estado === 'activa' ? 'desconectada' : 'activa'; s.estadoTexto = s.estado === 'activa' ? 'Activa' : 'Desconectada'; s.desde = ahora;
  }
}

function latir() {
  const ahora = Date.now();
  for (const x of equiposDemo) {
    if (x.cfg.caido) continue;
    moverSesiones(x, ahora);
    for (const d of x.discos) d.pct = Math.min(99, d.pct + rnd() * 0.002);
    const clave = q('SELECT clave FROM clientes WHERE id = ?').get(x.cliente);
    if (!clave) continue;
    try { flota.recibir(clave.clave, informe(x, ahora), '10.0.0.' + (x.id % 250)); } catch (e) { log('Demo: ' + e.message); }
  }
}

function arrancar() {
  // Sesiones iniciales acordes a la hora
  for (const x of equiposDemo) for (let i = 0; i < 200; i++) moverSesiones(x, Date.now());
  latir();
  setInterval(latir, 10000).unref();
}

module.exports = { preparar, arrancar };
