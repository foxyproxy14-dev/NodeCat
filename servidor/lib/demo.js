'use strict';
// Modo demo: clientes y servidores inventados que informan como agentes de verdad, con 30 días de historial.
const { q, transaccion } = require('./db');
const flota = require('./flota');
const auth = require('./auth');
const { log } = require('./util');

const ROUTERS = {
  'Clínica San Rafael': [['Router principal', 'rb5009'], ['Firewall perimetral', 'fg100f', 'fortigate']],
  'Andes Logística Barquisimeto': [['FortiGate sede', 'fg40f', 'fortigate']],
  'Transportes Andes': [['Core sede Valencia', 'ccr2004'], ['Almacén Puerto Cabello', 'hapax2']],
  'Estudio Contable Mérida': [['Router oficina', 'hex', 'mikrotik', true]],   // leído a través de su servidor (sonda)
  'Ferretería El Tornillo': [['Router tienda', 'hapac2']]
};
const CLIENTES = [
  { nombre: 'Clínica San Rafael', notas: 'Soporte 24/7. Contacto: Dra. Paredes.', equipos: [
    { nombre: 'SRV-DC01', perfil: 'dc' }, { nombre: 'SRV-RDS01', perfil: 'rds', alto: 'cpu' }, { nombre: 'SRV-RDS02', perfil: 'rds' }, { nombre: 'SRV-SQL01', perfil: 'sql' }] },
  { nombre: 'Transportes Andes', grupo: 'Grupo Andes', notas: 'Sede Valencia y almacén de Puerto Cabello.', equipos: [
    { nombre: 'TA-DC01', perfil: 'dc' }, { nombre: 'TA-TS01', perfil: 'rds' }, { nombre: 'TA-TS02', perfil: 'rds', caido: true }, { nombre: 'TA-ERP', perfil: 'sql', alto: 'disco' }] },
  { nombre: 'Andes Logística Barquisimeto', grupo: 'Grupo Andes', notas: 'Sede nueva.', equipos: [{ nombre: 'ALB-SRV01', perfil: 'rds' }] },
  { nombre: 'Estudio Contable Mérida', notas: '', equipos: [{ nombre: 'ECM-SRV01', perfil: 'rds' }, { nombre: 'ECM-BACKUP', perfil: 'archivo' }, { nombre: 'PVE01', perfil: 'proxmox' }] },
  { nombre: 'Ferretería El Tornillo', notas: 'Horario: lunes a sábado.', equipos: [{ nombre: 'FT-SERVIDOR', perfil: 'rds' }, { nombre: 'FT-HYPERV', perfil: 'hyperv' }] }
];
const PERSONAS = ['mgarcia', 'jrodriguez', 'aperez', 'lfernandez', 'cgonzalez', 'rmartinez', 'psanchez', 'dramirez', 'vtorres', 'eflores',
  'hmorales', 'njimenez', 'scastro', 'ovargas', 'iromero', 'bherrera', 'gmedina', 'kaguilar', 'tsilva', 'fmendoza', 'ureyes', 'yortiz'];
const PERFILES = {
  dc: { cpu: 8, ram: 46, ramTotal: 8, sesiones: [0, 2], discos: [['C:', 'Sistema', 80, 41]] },
  rds: { cpu: 34, ram: 62, ramTotal: 32, sesiones: [6, 16], discos: [['C:', 'Sistema', 120, 63], ['D:', 'Perfiles', 500, 48]] },
  sql: { cpu: 22, ram: 66, ramTotal: 64, sesiones: [0, 2], discos: [['C:', 'Sistema', 100, 52], ['E:', 'Datos', 1000, 71], ['F:', 'Registros', 200, 38]] },
  archivo: { cpu: 5, ram: 30, ramTotal: 8, sesiones: [0, 1], discos: [['C:', 'Sistema', 80, 37], ['D:', 'Copias', 4000, 66]] },
  proxmox: { cpu: 9, ram: 27, ramTotal: 15.4, sesiones: [0, 0], discos: [['local', 'dir', 94, 31], ['local-lvm', 'lvmthin', 832, 46], ['backups', 'nfs', 3600, 58]] },
  hyperv: { cpu: 18, ram: 71, ramTotal: 128, sesiones: [0, 1], discos: [['C:', 'Sistema', 240, 44], ['D:', 'Máquinas virtuales', 3800, 62]] }
};
// Hipervisores de la demo: sus VM y contenedores
const VMS_PVE = [
  ['100', 'adguard', 'lxc', 'running', 1, 0.5, 2, 'AdGuard Home', 'DNS y bloqueo de anuncios', 'http://10.20.20.10'],
  ['101', 'nginxproxymanager', 'lxc', 'running', 2, 1, 4, 'Nginx Proxy Manager', 'Proxy inverso', 'http://10.20.40.10:81'],
  ['102', 'mikrodash', 'lxc', 'running', 1, 1, 8, 'MikroDash', 'Monitoreo', 'http://10.20.20.30:3081'],
  ['103', 'uptime-kuma', 'lxc', 'running', 1, 0.5, 4, 'Uptime Kuma', 'Monitoreo', 'http://10.20.20.31:3001'],
  ['110', 'homeassistant', 'qemu', 'running', 2, 4, 32, 'Home Assistant', 'Domótica', 'http://10.20.20.40:8123'],
  ['120', 'srv-contabilidad', 'qemu', 'running', 4, 8, 120, null, null, null],
  ['130', 'win11-pruebas', 'qemu', 'stopped', 4, 8, 64, null, null, null]
];
const VMS_HV = [['SRV-APPS', 'running', 4, 16, 200], ['SRV-DC02', 'running', 2, 4, 80], ['SRV-CAMARAS', 'running', 4, 8, 2000], ['PLANTILLA-W2022', 'stopped', 2, 4, 60]];
const GB = 1024 ** 3;
function hipervisor(e, ahora, j) {
  if (e.perfil === 'proxmox') {
    const vms = VMS_PVE.map(([id, n, t, est, cpus, ram, disco]) => ({ id, nombre: n, tipo: t, estado: est, nodo: 'pve01', cpus, cpu: est === 'running' ? Math.round((2 + rnd() * 6 + j * 8) * 10) / 10 : 0,
      ram: est === 'running' ? Math.round(ram * GB * (0.35 + rnd() * 0.3)) : 0, ramMax: ram * GB, disco: t === 'lxc' ? Math.round(disco * GB * 0.41) : null, discoMax: disco * GB, uptime: est === 'running' ? Math.round(6 * 86400 + Number(id) * 3713) : 0,
      netin: est === 'running' ? Math.round(disco * 0.9 * GB * (1 + j)) : 0, netout: est === 'running' ? Math.round(disco * 0.3 * GB * (1 + j)) : 0,
      diskread: est === 'running' ? Math.round(disco * 1.4 * GB) : 0, diskwrite: est === 'running' ? Math.round(disco * 0.7 * GB) : 0,
      etiquetas: t === 'lxc' ? ['community-script', id === '102' || id === '103' ? 'monitoreo' : 'red'] : id === '120' ? ['produccion'] : [] }));
    const IP_VM = id => '10.20.20.' + (50 + Number(id) % 50);
    const invitados = VMS_PVE.filter(v => v[3] === 'running').map(([id, n, t]) => ({ nombre: (t === 'lxc' ? 'veth' : 'tap') + id + (t === 'lxc' ? 'i0' : 'i0'), tipo: 'invitado', estado: 'up', velocidad: 10000, duplex: 'full', mtu: 1500, mac: 'bc:24:11:' + id.padStart(2, '0').slice(-2) + ':4e:' + id.slice(-2), ips: [], puente: 'vmbr0', puertos: [], vmid: id, rxTotal: Math.round(Number(id) * 0.31 * GB), txTotal: Math.round(Number(id) * 0.12 * GB), descartados: 0, errores: 0 }));
    const redHost = { host: 'pve01', dominio: 'mk-zero.local', puertaEnlace: '10.20.20.1', dns: ['10.20.20.10', '1.1.1.1'],
      latencia: { destino: '10.20.20.1', ms: Math.round((0.4 + rnd() * 0.5) * 100) / 100, max: 1.8, perdida: 0 },
      interfaces: [
        { nombre: 'enp3s0', tipo: 'fisica', estado: 'up', velocidad: 1000, duplex: 'full', mtu: 1500, mac: '1c:69:7a:0b:42:e1', ips: [], puente: 'vmbr0', puertos: [], rxTotal: 412 * GB, txTotal: 168 * GB, descartados: 12, errores: 0 },
        { nombre: 'enp4s0', tipo: 'fisica', estado: 'down', velocidad: null, duplex: null, mtu: 1500, mac: '1c:69:7a:0b:42:e2', ips: [], puente: null, puertos: [], rxTotal: 0, txTotal: 0, descartados: 0, errores: 0 },
        { nombre: 'vmbr0', tipo: 'puente', estado: 'up', velocidad: 1000, duplex: null, mtu: 1500, mac: '1c:69:7a:0b:42:e1', ips: ['10.20.20.5/24'], puente: null, puertos: ['enp3s0', ...invitados.map(i => i.nombre)], rxTotal: 398 * GB, txTotal: 161 * GB, descartados: 0, errores: 0 },
        ...invitados
      ] };
    const apps = VMS_PVE.map(([id, n, t, est, , , , app, cat, url]) => ({ id, nombre: n, tipo: t, estado: est, ips: url ? [url.replace(/^https?:\/\//, '').split(':')[0]] : est === 'running' ? ['10.20.20.' + (50 + Number(id) % 50)] : [], so: t === 'lxc' ? 'debian' : id === '130' ? 'win11' : 'l26', arranqueAuto: est === 'running', app, categoria: cat, url, etiquetas: t === 'lxc' ? ['community-script'] : [], notas: '' }));
    const dia = 864e5, archivos = [];
    for (const [id, , , , , , disco] of VMS_PVE) { if (id === '130') continue; for (let k = 0; k < (id === '120' ? 7 : 3); k++) archivos.push({ vmid: id, fecha: ahora - (k + (id === '110' ? 9 : 0)) * dia - 3 * 3600e3, tamano: Math.round(disco * GB * 0.18), almacen: 'backups', formato: 'tar.zst', notas: '', protegida: k === 0 && id === '120', verificada: 'ok' }); }
    archivos.sort((a, b) => b.fecha - a.fecha);
    return { plataforma: 'proxmox', hipervisor: 'proxmox', so: 'Proxmox VE 8.2.7', nucleos: 12, carga: Math.round((0.4 + j * 1.6 + rnd() * 0.3) * 100) / 100, temperatura: Math.round(42 + j * 6 + rnd() * 2),
      cpuUsuario: Math.round((5 + j * 8) * 10) / 10, cpuSistema: Math.round((1 + j * 2) * 10) / 10, ramCache: 1.6,
      red: [{ nombre: 'vmbr0', rx: Math.round(2e6 + rnd() * 8e6), tx: Math.round(1e6 + rnd() * 4e6) }, { nombre: 'enp3s0', rx: Math.round(2e6 + rnd() * 8e6), tx: Math.round(1e6 + rnd() * 4e6) }],
      vms, pve: { apps, red: redHost,
        copias: { archivos, almacenes: ['backups'], trabajos: [{ id: 'backup-diario', horario: '02:00', almacen: 'backups', activo: true, que: '100,101,102,103,110,120', modo: 'snapshot', comentario: 'Diario a las 2 a. m.', proxima: ahora + 7 * 3600e3 }],
          tareas: [['120', 'OK'], ['103', 'OK'], ['102', 'OK'], ['101', 'OK'], ['100', 'OK'], ['110', 'ERROR: unable to create temporary directory']].map(([v, est], i) => ({ vmid: v, inicio: ahora - 16 * 3600e3 + i * 240000, fin: ahora - 16 * 3600e3 + i * 240000 + 180000, estado: est, usuario: 'root@pam' })) },
        nodo: { cpuModelo: 'Intel(R) Core(TM) i5-10500T CPU @ 2.30GHz', sockets: 1, hilos: 12, kernel: 'Linux 6.8.12-4-pve', pve: 'pve-manager/8.2.7', carga: [0.62, 0.71, 0.66], swapTotal: 8 * GB, swapUsado: 0.2 * GB, ksm: 0, arranque: 'efi', actualizaciones: 14, cluster: null,
          discos: [{ disco: '/dev/nvme0n1', modelo: 'Samsung SSD 980 1TB', tamano: 1000 * 1e9, tipo: 'nvme', salud: 'PASSED', desgaste: 96, uso: 'LVM', serie: 'S64DNX0R', temperatura: 38, ciclos: 111, horas: 1630, crc: 0, smartOk: true }, { disco: '/dev/sda', modelo: 'WDC WD40EFRX', tamano: 4000 * 1e9, tipo: 'hdd', salud: 'PASSED', desgaste: null, uso: 'ext4', serie: 'WD-WCC7K', temperatura: 34, ciclos: 58, horas: 21450, crc: 0, smartOk: true }],
          almacenes: [{ nombre: 'local', tipo: 'dir', contenido: 'iso,vztmpl,backup', activo: true, compartido: false, usado: 29 * GB, total: 94 * GB, disponible: 65 * GB }, { nombre: 'local-lvm', tipo: 'lvmthin', contenido: 'images,rootdir', activo: true, compartido: false, usado: 383 * GB, total: 832 * GB, disponible: 449 * GB }, { nombre: 'backups', tipo: 'nfs', contenido: 'backup', activo: true, compartido: true, usado: 2088 * GB, total: 3600 * GB, disponible: 1512 * GB }] } } };
  }
  if (e.perfil === 'hyperv') {
    return { hipervisor: 'hyperv', vms: VMS_HV.map(([n, est, cpus, ram, disco], i) => ({ id: 'a1b2c3d4-000' + i, nombre: n, tipo: 'hyperv', estado: est, cpus, cpu: est === 'running' ? Math.round(3 + rnd() * 10 + j * 15) : 0,
      ram: est === 'running' ? (i % 2 ? ram * GB : Math.round(ram * GB * (0.6 + rnd() * 0.2))) : 0, ramMax: ram * GB, ramFija: !!(i % 2), disco: Math.round(disco * GB * 0.55), discoMax: disco * GB, uptime: est === 'running' ? 11 * 86400 + i * 3600 : 0,
      ips: est === 'running' ? ['192.168.10.' + (60 + i)] : [] })),
      hvRed: { host: 'FT-HYPERV', dominio: 'ferreteria.local', puertaEnlace: '192.168.10.1', dns: ['192.168.10.5', '8.8.8.8'], latencia: { destino: '192.168.10.1', ms: 0.6, max: 1.2, perdida: 0 },
        interfaces: [
          { nombre: 'Ethernet', tipo: 'fisica', descripcion: 'Intel(R) Ethernet Controller X550', estado: 'up', velocidad: 10000, duplex: 'full', mtu: 1500, mac: '3c:ec:ef:11:22:01', ips: [], puente: 'Externo LAN', rxTotal: 912 * GB, txTotal: 377 * GB, errores: 0, descartados: 4 },
          { nombre: 'Ethernet 2', tipo: 'fisica', descripcion: 'Intel(R) Ethernet Controller X550 #2', estado: 'up', velocidad: 1000, duplex: 'full', mtu: 1500, mac: '3c:ec:ef:11:22:02', ips: ['10.10.10.2/24'], puente: null, rxTotal: 12 * GB, txTotal: 9 * GB, errores: 0, descartados: 0 },
          { nombre: 'Externo LAN', tipo: 'puente', clase: 'External', estado: 'up', mac: '3c:ec:ef:11:22:01', ips: ['192.168.10.4/24'], puertos: ['Ethernet', ...VMS_HV.map(v => v[0])], rxTotal: 410 * GB, txTotal: 120 * GB, errores: 0, descartados: 0 },
          { nombre: 'Interno Pruebas', tipo: 'puente', clase: 'Internal', estado: 'up', mac: '00:15:5d:0a:01:01', ips: ['172.16.0.1/24'], puertos: [], rxTotal: 0, txTotal: 0, errores: 0, descartados: 0 },
          ...VMS_HV.map(([n, est], i) => ({ nombre: n + ' · Adaptador de red', tipo: 'invitado', estado: est === 'running' ? 'up' : 'down', mac: '00:15:5d:0a:02:0' + i, ips: est === 'running' ? ['192.168.10.' + (60 + i)] : [], puente: 'Externo LAN', vmid: 'a1b2c3d4-000' + i, puertos: [], rxTotal: 0, txTotal: 0, errores: 0, descartados: 0 }))
        ] } };
  }
  return {};
}
const SO = { dc: 'Windows Server 2019 Standard', rds: 'Windows Server 2022 Standard', sql: 'Windows Server 2022 Datacenter', archivo: 'Windows Server 2016 Standard', proxmox: 'Proxmox VE 8.2.7', hyperv: 'Windows Server 2022 Datacenter' };

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
  if (!q('SELECT COUNT(*) n FROM clientes').get().n) {
    sembrar(); transaccion(sembrarRouters);
    // Transportes Andes: un cliente con dos sedes (sin crear subclientes)
    const ta = q("SELECT id FROM clientes WHERE nombre = 'Transportes Andes'").get();
    if (ta) {
      q("UPDATE equipos SET sede = 'Valencia' WHERE cliente_id = ? AND nombre IN ('TA-DC01', 'TA-ERP', 'TA-TS01', 'Core sede Valencia')").run(ta.id);
      q("UPDATE equipos SET sede = 'Puerto Cabello' WHERE cliente_id = ? AND nombre IN ('TA-TS02', 'Almacén Puerto Cabello')").run(ta.id);
    }
  }
  if (!auth.hayCuentas()) {
    auth.guardarCuenta({ usuario: 'demo', clave: 'nodecat-demo', rol: 'admin', clientes: null }, true);
    const g = q("SELECT grupo_id FROM clientes WHERE nombre = 'Transportes Andes'").get().grupo_id;
    auth.guardarCuenta({ usuario: 'andes', clave: 'nodecat-demo', rol: 'lector', clientes: null, grupos: [g] }, true);
  }
  for (const c of CLIENTES) {
    const cli = q('SELECT id, clave FROM clientes WHERE nombre = ?').get(c.nombre); if (!cli) continue;
    for (const e of c.equipos) {
      const fila = q("SELECT id FROM equipos WHERE cliente_id = ? AND nombre = ? AND tipo IN ('windows', 'linux', 'proxmox')").get(cli.id, e.nombre); if (!fila) continue;
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
        const r = q("INSERT INTO equipos (cliente_id, tipo, nombre, creado, ultimo_contacto, version_agente, ip, intervalo) VALUES (?, 'windows', ?, ?, ?, '1.2.0', ?, 30)")
          .run(cid, e.nombre, creado, e.caido ? ahora - 47 * 60000 : ahora - 20000, `10.${cid}.0.${10 + Number(q('SELECT COUNT(*) n FROM equipos').get().n)}`);
        const id = Number(r.lastInsertRowid);
        if (e.caido) q('UPDATE equipos SET datos = ? WHERE id = ?').run(JSON.stringify(informe({ cfg: e, p, arranque: ahora - 9 * 864e5, discos: p.discos.map(([u, et, tot, pct]) => ({ u, et, tot, pct })), sesiones: [] }, ahora - 47 * 60000)), id);
        // Métricas: 5 min hasta hace 7 días, 1 min después
        const ins = q('INSERT OR IGNORE INTO metricas (equipo_id, t, cpu, ram, disco, resumen) VALUES (?, ?, ?, ?, ?, ?)');
        const maxDisco = Math.max(...p.discos.map(d => d[3])) + (e.alto === 'disco' ? 22 : 0);
        // Tráfico de red de los Proxmox (24 h, por minuto) para la pestaña Red
        if (e.perfil === 'proxmox') {
          const insT = q('INSERT OR IGNORE INTO trafico (equipo_id, t, interfaz, rx, tx, rx_max, tx_max, resumen) VALUES (?, ?, ?, ?, ?, ?, ?, 0)');
          for (let t = ahora - 864e5; t < ahora - 60000; t += 60000) {
            const j = jornada(t) * 0.8 + 0.2;
            for (const n of ['vmbr0', 'enp3s0']) { const r = Math.round(6e6 * j * entre(0.5, 1.5)), x = Math.round(2.5e6 * j * entre(0.5, 1.5)); insT.run(id, t, n, r, x, r, x); }
          }
        }
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
  const PERFILES = { ...require('./mikrotik-demo').PERFILES, ...require('./fortigate-demo').PERFILES };
  for (const [cliNombre, lista] of Object.entries(ROUTERS)) {
    const cli = q('SELECT id FROM clientes WHERE nombre = ?').get(cliNombre); if (!cli) continue;
    for (const [nombre, perfil, tipo = 'mikrotik', porSonda] of lista) {
      const srv = porSonda && q("SELECT id FROM equipos WHERE cliente_id = ? AND tipo = 'windows' ORDER BY id LIMIT 1").get(cli.id);
      const id = flota.crearRouter(cli.id, nombre, { demo: true, perfil, sonda: srv ? srv.id : null, ...(tipo === 'fortigate' ? { logs: { activo: true, dias: 30, cats: ['sistema', 'vpn', 'usuarios', 'red', 'seguridad'] } } : {}) }, tipo);
      const p = PERFILES[perfil], creado = ahora - 32 * 864e5;
      if (!p.cpu) p.cpu = 8;
      q('UPDATE equipos SET creado = ? WHERE id = ?').run(creado, id);
      const insM = q('INSERT OR IGNORE INTO metricas (equipo_id, t, cpu, ram, disco, resumen) VALUES (?, ?, ?, ?, NULL, ?)');
      const insT = q('INSERT OR IGNORE INTO trafico (equipo_id, t, interfaz, rx, tx, rx_max, tx_max, resumen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
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
      if (perfil === 'fg100f') { const t = Math.round(ahora - entre(1, 4) * 864e5); ev.run(id, t, 'wan-caida', 'El enlace WAN (wan1) se cayó.'); ev.run(id, t + 41 * 60000, 'wan-vuelta', 'El enlace WAN (wan1) volvió.'); }
      if (perfil === 'hex') { const t = Math.round(ahora - entre(8, 20) * 864e5); ev.run(id, t, 'caida', 'Dejó de responder.'); ev.run(id, t + 14 * 60000, 'vuelta', 'Volvió a responder tras 14 min.'); }
    }
  }
}

function informe(x, ahora) {
  const j = jornada(ahora), p = x.p, e = x.cfg;
  const cpu = Math.round(Math.min(100, Math.max(1, p.cpu * (0.3 + j * 1.4) + (rnd() * 15 - 6) + (e.alto === 'cpu' ? 55 : 0))));
  const ramPct = Math.round(Math.min(99, Math.max(5, p.ram + j * 14 + (rnd() * 8 - 4) + (e.alto === 'ram' ? 30 : 0))));
  return {
    nombre: e.nombre, version: '1.2.0', intervalo: 30, hora: ahora,
    cpu, ramPct, ramTotal: p.ramTotal, ramUsada: Math.round(p.ramTotal * ramPct) / 100, so: SO[e.perfil], arranque: x.arranque, ipsLocales: ['192.168.10.' + (10 + x.id % 200)],
    discos: x.discos.map(d => ({ unidad: d.u, etiqueta: d.et, total: d.tot, libre: Math.round(d.tot * (100 - d.pct) * 10) / 1000, pct: Math.round(d.pct) })),
    sesiones: x.sesiones.map(s => ({ ...s, inactivo: s.estado === 'desconectada' ? Math.round((ahora - s.desde) / 60000) : Math.floor(rnd() * 12), ...usoSesion(s) })),
    ...hipervisor(e, ahora, j)
  };
}

// Consumo por sesión (como lo informa el agente 1.5): CPU, memoria y los programas que más usan
const PROGRAMAS = [['chrome', 9, 900e6], ['EXCEL', 1, 320e6], ['OUTLOOK', 1, 280e6], ['msedge', 6, 600e6], ['Teams', 3, 450e6], ['sapgui', 1, 210e6], ['WINWORD', 1, 180e6], ['AcroRd32', 2, 150e6]];
function usoSesion(s) {
  if (!s.perfilUso) { const k = Math.floor(rnd() * PROGRAMAS.length); s.perfilUso = [PROGRAMAS[k], PROGRAMAS[(k + 1 + Math.floor(rnd() * 3)) % PROGRAMAS.length], PROGRAMAS[(k + 4) % PROGRAMAS.length]]; s.peso = 0.4 + rnd() * 1.6; }
  const activa = s.estado === 'activa';
  const top = s.perfilUso.map(([n, k, r], i) => ({ nombre: n, cantidad: k, cpu: activa ? Math.round((i === 0 ? 3 + rnd() * 9 : rnd() * 2.5) * s.peso * 10) / 10 : 0, ram: Math.round(r * s.peso * (0.8 + rnd() * 0.4)) }));
  const ram = top.reduce((n, x) => n + x.ram, 0) + 260e6;
  return { cpu: Math.round((top.reduce((n, x) => n + x.cpu, 0) + (activa ? rnd() : 0)) * 10) / 10, ram, procesos: 30 + top.reduce((n, x) => n + x.cantidad, 0) + Math.floor(s.peso * 10), top };
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
