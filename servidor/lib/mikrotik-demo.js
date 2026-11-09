'use strict';
// Modo demo: routers MikroTik simulados que responden como la API real (mismas rutas y campos).
const PERFILES = {
  rb5009: {
    modelo: 'RB5009UG+S+', arq: 'arm64', version: '7.16.1 (stable)', ram: 1024, cpu: 6, temp: 41, volt: 24.2, ap: false,
    interfaces: [['ether1', 'ether', 'WAN Inter', 95e6, 18e6], ['ether2', 'ether', 'Servidores', 30e6, 60e6], ['ether3', 'ether', 'Recepción', 4e6, 1e6], ['ether8', 'ether', '', 0, 0, false],
      ['sfp-sfpplus1', 'ether', 'Enlace edificio B', 40e6, 22e6], ['bridge-lan', 'bridge', '', 70e6, 110e6], ['vlan20-voip', 'vlan', 'Telefonía', 0.6e6, 0.5e6], ['wg-sedes', 'wg', 'VPN sedes', 2e6, 3e6]],
    leases: 64, wifi: 0, wg: ['Sede Naguanagua', 'Sede Guacara', 'Soporte (NodeCat)'], ppp: ['vpn-dra.paredes']
  },
  ccr2004: {
    modelo: 'CCR2004-1G-12S+2XS', arq: 'arm64', version: '7.15.3 (stable)', ram: 4096, cpu: 9, temp: 48, volt: 12.1, ap: false,
    interfaces: [['ether1', 'ether', 'WAN Fibra', 160e6, 35e6], ['sfp-sfpplus1', 'ether', 'Core LAN', 120e6, 150e6], ['sfp-sfpplus2', 'ether', 'Almacén', 25e6, 8e6],
      ['sfp-sfpplus3', 'ether', '', 0, 0, false], ['bridge', 'bridge', '', 140e6, 180e6], ['wg-almacen', 'wg', 'Túnel almacén', 6e6, 4e6]],
    leases: 118, wifi: 0, wg: ['Almacén Puerto Cabello', 'Gerencia (móvil)'], ppp: []
  },
  hapax2: {
    modelo: 'hAP ax²', arq: 'arm64', version: '7.16 (stable)', ram: 1024, cpu: 14, temp: 52, volt: 12, ap: true,
    interfaces: [['ether1', 'ether', 'WAN Movistar', 22e6, 5e6], ['lte1', 'lte', 'Respaldo 4G', 0, 0, false], ['ether2', 'ether', 'Oficina', 6e6, 2e6],
      ['wifi1', 'wifi', 'Almacén 5 GHz', 9e6, 3e6], ['wifi2', 'wifi', 'Almacén 2.4 GHz', 2e6, 1e6], ['bridge', 'bridge', '', 14e6, 6e6], ['wg-andes', 'wg', 'Túnel sede', 4e6, 6e6]],
    leases: 23, wifi: 11, wg: ['Sede Valencia'], ppp: []
  },
  hex: {
    modelo: 'hEX RB750Gr3', arq: 'mmips', version: '6.49.17 (long-term)', ram: 256, cpu: 11, temp: null, volt: 24, ap: false,
    interfaces: [['ether1', 'ether', 'WAN', 28e6, 6e6], ['ether2', 'ether', 'LAN', 6e6, 26e6], ['ether3', 'ether', 'Impresoras', 0.2e6, 0.1e6], ['ether4', 'ether', '', 0, 0, false], ['bridge1', 'bridge', '', 6e6, 26e6]],
    leases: 17, wifi: 0, wg: [], ppp: ['contador-casa', 'socia-casa']
  },
  hapac2: {
    modelo: 'hAP ac²', arq: 'arm', version: '7.12.1 (stable)', ram: 128, cpu: 18, temp: 46, volt: 24, ap: true,
    interfaces: [['ether1', 'ether', 'WAN', 12e6, 3e6], ['ether2', 'ether', 'Caja', 1e6, 0.5e6], ['wlan1', 'wlan', 'Tienda 2.4 GHz', 4e6, 1e6], ['wlan2', 'wlan', 'Tienda 5 GHz', 6e6, 2e6], ['bridge', 'bridge', '', 11e6, 3e6]],
    leases: 14, wifi: 7, wg: [], ppp: []
  }
};
const NOMBRES = ['PC-RECEPCION', 'PC-CAJA1', 'PC-GERENCIA', 'iPhone-de-Ana', 'Galaxy-S23', 'HP-LaserJet', 'NVR-Hikvision', 'ATA-Grandstream', 'PC-CONTAB', 'MacBook-Pro', 'Redmi-Note', 'TV-Sala', 'PC-ALMACEN', 'Lector-codigos', 'PC-DRA-PAREDES', 'Tablet-ventas', 'PC-FACTURACION', 'Yealink-T31', 'ESP32-sensor', 'PC-SOPORTE'];
const TEMAS = [['system,info', 'user admin logged in from 10.20.0.5 via winbox'], ['dhcp,info', 'defconf assigned 192.168.88.143 for 3C:22:FB:10:2A:7E PC-CAJA1'], ['interface,info', 'ether3 link up (speed 1G, full duplex)'],
  ['wireguard,info', 'wg-sedes: peer Sede Guacara handshake'], ['system,error,critical', 'login failure for user admin from 45.95.147.12 via ssh'], ['firewall,info', 'drop input: in:ether1 out:(unknown 0), proto TCP (SYN), 185.220.101.4:51234->200.44.1.10:8291'],
  ['dhcp,info', 'defconf deassigned 192.168.88.120 for 9C:B6:D0:44:11:02'], ['system,info', 'config changed by admin'], ['interface,info', 'ether8 link down']];

const rnd = Math.random;
function jornada(t) {
  const d = new Date(t - 4 * 3600e3), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return 0.18 + (h >= 7.5 && h <= 19 ? 0.82 * Math.sin((h - 7.5) / 11.5 * Math.PI) : 0);
}
const hex2 = () => Math.floor(rnd() * 256).toString(16).padStart(2, '0').toUpperCase();
const mac = () => Array.from({ length: 6 }, hex2).join(':');
const dur = s => { s = Math.max(0, Math.round(s)); const w = Math.floor(s / 604800); s %= 604800; const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); s %= 60; return `${w ? w + 'w' : ''}${d ? d + 'd' : ''}${h ? h + 'h' : ''}${m ? m + 'm' : ''}${s}s`; };

const estados = new Map();
function estado(id, perfil) {
  let e = estados.get(id);
  if (e) return e;
  const p = PERFILES[perfil] || PERFILES.hex;
  e = { p, arranque: Date.now() - (5 + rnd() * 60) * 864e5, t: Date.now(), rafaga: 0,
    contadores: Object.fromEntries(p.interfaces.map(i => [i[0], { rx: rnd() * 1e12, tx: rnd() * 3e11 }])),
    leases: Array.from({ length: p.leases }, (_, i) => ({ ip: `192.168.${perfil === 'hex' ? 1 : 88}.${20 + i}`, mac: mac(), nombre: i < NOMBRES.length ? NOMBRES[i] : (rnd() < 0.5 ? '' : 'android-' + hex2().toLowerCase() + hex2().toLowerCase()), activo: rnd() < 0.82, visto: Math.floor(rnd() * 3000) })),
    wifi: [],
    registro: Array.from({ length: 60 }, (_, i) => { const [tm, msg] = TEMAS[Math.floor(rnd() * TEMAS.length)]; return { t: Date.now() - (60 - i) * 97000, tm, msg }; })
  };
  // Los equipos Wi-Fi son algunos de los del DHCP (así tienen nombre e IP)
  e.wifi = e.leases.filter(l => l.activo).slice(0, p.wifi).map(l => ({ mac: l.mac, señal: -45 - Math.floor(rnd() * 35), desde: Date.now() - rnd() * 6 * 3600e3, banda: rnd() < 0.6 }));
  estados.set(id, e);
  return e;
}

function tasas(e, t) {
  const j = jornada(t);
  if (e.rafaga <= 0 && rnd() < 0.03) e.rafaga = 4 + Math.floor(rnd() * 8);
  const extra = e.rafaga-- > 0 ? 1.8 + rnd() : 1;
  return e.p.interfaces.map(([n, tipo, com, rx, tx, arriba = true]) => ({ n, rx: arriba ? rx * j * extra * (0.75 + rnd() * 0.5) : 0, tx: arriba ? tx * j * (0.75 + rnd() * 0.5) : 0 }));
}

function conexion(id) {
  const fila = require('./db').q('SELECT config FROM equipos WHERE id = ?').get(id);
  const perfil = fila && fila.config ? JSON.parse(fila.config).perfil : 'hex';
  const e = estado(id, perfil), p = e.p;
  return {
    lista: true,
    cerrar() { },
    async ejecutar(palabras) {
      if (palabras[0] === '/ping') {
        const ip = palabras.find(w => w.startsWith('=address=')).slice(9);
        const base = { '1.1.1.1': 9, '8.8.8.8': 14, '200.44.1.1': 2 }[ip] || 31;
        const carga = jornada(Date.now()) * (perfil === 'hapax2' ? 25 : 6);
        const t = [0, 1, 2].map(() => rnd() < (perfil === 'hapax2' ? 0.06 : 0.01) ? null : base + carga * rnd() + rnd() * 4);
        const ok = t.filter(v => v != null);
        const f = t.map((v, i) => v == null ? { seq: String(i), host: ip, status: 'timeout', sent: String(i + 1), received: String(t.slice(0, i + 1).filter(x => x != null).length) } : { seq: String(i), host: ip, time: `${Math.floor(v)}ms${Math.round(v % 1 * 1000)}us`, sent: String(i + 1), received: String(t.slice(0, i + 1).filter(x => x != null).length) });
        if (ok.length) f[f.length - 1]['avg-rtt'] = `${Math.floor(ok.reduce((a, b) => a + b, 0) / ok.length)}ms`;
        return { filas: f, done: {} };
      }
      if (palabras[0] === '/tool/traceroute') {
        const ip = palabras.find(w => w.startsWith('=address=')).slice(9);
        const saltos = ['192.168.88.1', '200.44.1.1', '200.44.32.1', '10.255.0.9', '172.16.20.1', '108.170.250.1', ip];
        return { filas: saltos.map((a, i) => ({ hop: String(i + 1), address: a, loss: i === 3 ? '33.3%' : '0%', last: `${2 + i * 6}.${Math.floor(rnd() * 9)}ms`, avg: `${2 + i * 6}ms`, best: `${1 + i * 6}ms`, worst: `${4 + i * 7}ms`, status: '' })), done: {} };
      }
      if (palabras[0] === '/ip/firewall/connection/print' && palabras.includes('=count-only=')) return { filas: [], done: { ret: String(Math.round(300 + 2400 * jornada(Date.now()) * (0.8 + rnd() * 0.4))) } };
      return { filas: await this.imprimir(palabras[0]), done: {} };
    },
    async imprimir(ruta) {
      const ahora = Date.now();
      switch (ruta) {
        case '/system/resource/print': {
          const libre = p.ram * (0.45 + rnd() * 0.08) * 1048576;
          return [{ 'cpu-load': String(Math.round(p.cpu * (0.5 + jornada(ahora)) + rnd() * 8 + (e.rafaga > 0 ? 15 : 0))), 'free-memory': String(Math.round(libre)), 'total-memory': String(p.ram * 1048576),
            uptime: dur((ahora - e.arranque) / 1000), version: p.version, 'board-name': p.modelo, 'architecture-name': p.arq, 'total-hdd-space': String(128 * 1048576), 'free-hdd-space': String(Math.round(81 * 1048576)) }];
        }
        case '/system/identity/print': return [{ name: perfil === 'hapax2' ? 'Almacen-hAP' : 'MikroTik-' + p.modelo.split(/[ -]/)[0] }];
        case '/system/health/print':
          if (p.version.startsWith('6')) return [{ voltage: String(p.volt) }];
          return [p.temp != null ? { name: 'cpu-temperature', value: String(p.temp + Math.round(rnd() * 3)), type: 'C' } : null, { name: 'voltage', value: String(p.volt), type: 'V' }].filter(Boolean);
        case '/interface/print': {
          const dt = (ahora - e.t) / 1000; e.t = ahora;
          const ts = tasas(e, ahora);
          return p.interfaces.map(([n, tipo, com, , , arriba = true]) => {
            const c = e.contadores[n], r = ts.find(x => x.n === n);
            c.rx += r.rx * dt / 8; c.tx += r.tx * dt / 8;
            return { name: n, type: tipo, running: String(arriba), disabled: 'false', 'rx-byte': String(Math.round(c.rx)), 'tx-byte': String(Math.round(c.tx)), comment: com, 'mac-address': '' };
          });
        }
        case '/ip/route/print': return [{ 'dst-address': '0.0.0.0/0', gateway: '200.44.1.1', 'immediate-gw': `200.44.1.1%${p.interfaces[0][0]}`, 'gateway-status': `200.44.1.1 reachable via  ${p.interfaces[0][0]}`, active: 'true', distance: '1' }];
        case '/ip/dhcp-server/lease/print':
          return e.leases.map(l => ({ address: l.ip, 'active-address': l.activo ? l.ip : '', 'mac-address': l.mac, 'active-mac-address': l.activo ? l.mac : '', 'host-name': l.nombre, status: l.activo ? 'bound' : 'waiting', server: 'dhcp-lan', comment: l.nombre === 'HP-LaserJet' ? 'Impresora fija' : '', 'last-seen': dur(l.visto + rnd() * 30), dynamic: String(l.nombre !== 'HP-LaserJet'), disabled: 'false' }));
        case '/interface/wifi/registration-table/print':
          if (!p.ap || p.version.startsWith('6') || p.modelo === 'hAP ac²') throw Object.assign(new Error('no such command prefix'), { tipo: 'trap' });
          return e.wifi.map(w => ({ interface: w.banda ? 'wifi1' : 'wifi2', 'mac-address': w.mac, signal: String(w.señal + Math.round(rnd() * 4 - 2)), uptime: dur((ahora - w.desde) / 1000), 'tx-rate': w.banda ? '866700000' : '144400000', 'rx-rate': w.banda ? '780000000' : '130000000', ssid: w.banda ? 'Almacen' : 'Almacen-Invitados' }));
        case '/interface/wireless/registration-table/print':
          if (!p.ap) throw Object.assign(new Error('no such command prefix'), { tipo: 'trap' });
          return e.wifi.map(w => ({ interface: w.banda ? 'wlan2' : 'wlan1', 'mac-address': w.mac, 'signal-strength': `${w.señal}dBm@6Mbps`, uptime: dur((ahora - w.desde) / 1000), 'tx-rate': '130Mbps-20MHz/2S', 'rx-rate': '117Mbps' }));
        case '/interface/wireguard/peers/print':
          if (p.version.startsWith('6')) throw Object.assign(new Error('no such command prefix'), { tipo: 'trap' });
          return p.wg.map((n, i) => ({ name: n, comment: n, interface: p.interfaces.find(x => x[1] === 'wg')[0], 'current-endpoint-address': `186.${90 + i}.${14 * i + 3}.${40 + i}`, 'current-endpoint-port': '13231', 'last-handshake': i === p.wg.length - 1 && p.wg.length > 1 ? '9m12s' : dur(20 + rnd() * 90), rx: String(Math.round(rnd() * 9e9)), tx: String(Math.round(rnd() * 4e9)), 'allowed-address': `10.10.${i + 1}.0/24`, disabled: 'false' }));
        case '/ppp/active/print': return p.ppp.map((n, i) => ({ name: n, service: p.version.startsWith('6') ? 'l2tp' : 'ovpn', 'caller-id': `190.${200 + i}.33.${12 + i}`, address: `10.99.0.${10 + i}`, uptime: dur(3600 * (1 + i) + rnd() * 900) }));
        case '/ip/ipsec/active-peers/print': return [];
        case '/ip/address/print': return [{ address: '200.44.1.10/29', network: '200.44.1.8', interface: p.interfaces[0][0], dynamic: 'false', disabled: 'false', comment: 'IP pública' }, { address: '192.168.88.1/24', network: '192.168.88.0', interface: p.interfaces.find(i => i[1] === 'bridge')[0], dynamic: 'false', disabled: 'false', comment: 'LAN' }, { address: '10.10.0.1/24', network: '10.10.0.0', interface: (p.interfaces.find(i => i[1] === 'wg') || p.interfaces[0])[0], dynamic: 'false', disabled: 'false', comment: 'VPN' }];
        case '/ip/arp/print': return e.leases.filter(l => l.activo).slice(0, 25).map(l => ({ address: l.ip, 'mac-address': l.mac, interface: p.interfaces.find(i => i[1] === 'bridge')[0], dynamic: 'true', complete: 'true', status: 'reachable' }));
        case '/ip/dns/print': return [{ servers: '1.1.1.1,8.8.8.8', 'dynamic-servers': '200.44.32.12', 'allow-remote-requests': 'true', 'cache-size': '2048KiB', 'cache-used': `${300 + Math.floor(rnd() * 200)}KiB`, 'cache-max-ttl': '1w' }];
        case '/ip/dns/static/print': return [{ name: 'router.lan', address: '192.168.88.1', type: 'A', ttl: '1d', disabled: 'false' }, { name: 'nas.lan', address: '192.168.88.10', type: 'A', ttl: '1d', disabled: 'false' }];
        case '/ip/neighbor/print': return [{ identity: 'SW-Oficina', address: '192.168.88.2', 'mac-address': mac(), interface: 'ether2', platform: 'MikroTik', board: 'CRS326-24G-2S+', version: '7.15.2', uptime: '12d3h' }, { identity: 'AP-Pasillo', address: '192.168.88.3', 'mac-address': mac(), interface: 'ether3', platform: 'MikroTik', board: 'cAP ax', version: '7.16', uptime: '5d20h' }];
        case '/interface/bridge/print': return [{ name: p.interfaces.find(i => i[1] === 'bridge')[0], 'protocol-mode': 'rstp', 'vlan-filtering': 'false', running: 'true', disabled: 'false' }];
        case '/interface/bridge/port/print': return p.interfaces.filter(i => ['ether', 'wifi', 'wlan'].includes(i[1]) && i !== p.interfaces[0]).map(i => ({ interface: i[0], bridge: p.interfaces.find(x => x[1] === 'bridge')[0], pvid: '1', status: i[5] === false ? 'inactive' : 'in-bridge', inactive: String(i[5] === false), disabled: 'false', hw: 'true' }));
        case '/interface/vlan/print': return p.interfaces.filter(i => i[1] === 'vlan').map(i => ({ name: i[0], 'vlan-id': i[0].match(/\d+/)[0], interface: p.interfaces.find(x => x[1] === 'bridge')[0], running: 'true', disabled: 'false', comment: i[2] }));
        case '/ip/dhcp-server/print': return [{ name: 'dhcp-lan', interface: p.interfaces.find(i => i[1] === 'bridge')[0], 'address-pool': 'pool-lan', 'lease-time': '1d', disabled: 'false' }];
        case '/ip/dhcp-server/network/print': return [{ address: '192.168.88.0/24', gateway: '192.168.88.1', 'dns-server': '192.168.88.1' }];
        case '/ip/dhcp-client/print': return [];
        case '/ip/pool/print': return [{ name: 'pool-lan', ranges: '192.168.88.20-192.168.88.250' }];
        case '/ip/pool/used/print': return e.leases.filter(l => l.activo).slice(0, 10).map(l => ({ pool: 'pool-lan', address: l.ip, owner: 'dhcp-lan', info: l.mac }));
        case '/interface/wireguard/print': return p.interfaces.filter(i => i[1] === 'wg').map(i => ({ name: i[0], 'listen-port': '13231', mtu: '1420', running: 'true', disabled: 'false', comment: i[2] }));
        case '/queue/simple/print': return [['Caja', '192.168.88.30/32', '10M/10M'], ['Invitados', '192.168.89.0/24', '20M/5M'], ['Gerencia', '192.168.88.22/32', '50M/20M']].map(([n, t, m]) => ({ name: n, target: t, 'max-limit': m.replace(/M/g, '000000'), rate: `${Math.round(rnd() * 3e6)}/${Math.round(rnd() * 8e6)}`, bytes: `${Math.round(rnd() * 3e9)}/${Math.round(rnd() * 9e9)}`, packets: '1000/2000', disabled: 'false', dynamic: 'false' }));
        case '/queue/tree/print': return [];
        case '/ip/firewall/nat/print': return [{ chain: 'srcnat', action: 'masquerade', 'out-interface-list': 'WAN', comment: 'defconf: masquerade', bytes: String(Math.round(rnd() * 9e11)), packets: String(Math.round(rnd() * 9e8)), disabled: 'false' }, { chain: 'dstnat', action: 'dst-nat', protocol: 'tcp', 'dst-port': '8443', 'in-interface-list': 'WAN', 'to-addresses': '192.168.88.10', 'to-ports': '443', comment: 'NAS (web)', bytes: String(Math.round(rnd() * 9e8)), packets: String(Math.round(rnd() * 9e5)), disabled: 'false' }];
        case '/ip/firewall/mangle/print': return [];
        case '/ip/firewall/address-list/print': return [{ list: 'redes-sociales', address: '157.240.0.0/16', dynamic: 'false', disabled: 'false', comment: 'Meta' }, { list: 'redes-sociales', address: '142.250.0.0/15', dynamic: 'false', disabled: 'false', comment: 'YouTube' }, { list: 'bloqueados', address: '45.95.147.12', timeout: '23h12m', dynamic: 'true', disabled: 'false', 'creation-time': '2026-11-09 08:12:33' }];
        case '/system/package/print': return ['routeros', 'wifi-qcom', 'container'].slice(0, p.ap ? 3 : 1).map(n => ({ name: n, version: p.version.split(' ')[0], 'build-time': '2026-10-02 11:20:14', disabled: 'false' }));
        case '/system/routerboard/print': return [{ model: p.modelo, 'serial-number': 'HFX0' + hex2() + hex2() + hex2(), 'firmware-type': p.arq, 'current-firmware': p.version.split(' ')[0], 'upgrade-firmware': p.version.split(' ')[0] }];
        case '/system/package/update/print': return [{ channel: 'stable', 'installed-version': p.version.split(' ')[0], 'latest-version': '7.16.2', status: 'New version is available' }];
        case '/ip/service/print': return [['telnet', '23', '', 'true'], ['ftp', '21', '', 'true'], ['www', '80', '192.168.88.0/24', 'false'], ['ssh', '22', '192.168.88.0/24', 'false'], ['www-ssl', '443', '', 'true'], ['api', '8728', '10.10.0.0/24', 'false'], ['winbox', '8291', '192.168.88.0/24,10.10.0.0/24', 'false'], ['api-ssl', '8729', '200.44.9.18/32', 'false']].map(([n, pt, a, d]) => ({ name: n, port: pt, address: a, disabled: d }));
        case '/system/script/print': return [{ name: 'respaldo-diario', owner: 'admin', 'last-started': '2026-11-09 03:00:00', 'run-count': '62', source: '/system backup save name=diario' }];
        case '/system/scheduler/print': return [{ name: 'respaldo', 'start-date': '2026-09-01', 'start-time': '03:00:00', interval: '1d', 'on-event': 'respaldo-diario', 'next-run': '2026-11-10 03:00:00', 'run-count': '62', owner: 'admin', disabled: 'false' }];
        case '/system/clock/print': return [{ time: new Date(ahora - 4 * 3600e3).toISOString().slice(11, 19), date: new Date(ahora - 4 * 3600e3).toISOString().slice(0, 10), 'time-zone-name': 'America/Caracas', 'gmt-offset': '-04:00' }];
        case '/system/ntp/client/print': return [{ enabled: 'true', mode: 'unicast', servers: 'time.cloudflare.com,pool.ntp.org', status: 'synchronized', 'synced-server': 'time.cloudflare.com' }];
        case '/system/ntp/client/servers/print': return [{ address: 'time.cloudflare.com', reachable: 'true', stratum: '3', offset: '-1.2ms', disabled: 'false' }];
        case '/system/logging/print': return [{ topics: 'info', action: 'memory', prefix: '', disabled: 'false' }, { topics: 'error', action: 'memory', disabled: 'false' }, { topics: 'warning', action: 'memory', disabled: 'false' }, { topics: 'critical', action: 'echo', disabled: 'false' }];
        case '/system/logging/action/print': return [{ name: 'memory', target: 'memory' }, { name: 'disk', target: 'disk', 'disk-file-name': 'log' }, { name: 'echo', target: 'echo' }];
        case '/snmp/print': return [{ enabled: 'false', contact: '', location: '' }];
        case '/snmp/community/print': return [{ name: 'public', addresses: '::/0', security: 'none', 'read-access': 'true', 'write-access': 'false', disabled: 'false' }];
        case '/file/print': return [{ name: 'diario.backup', type: 'backup', size: '412345', 'creation-time': '2026-11-09 03:00:02' }, { name: 'flash', type: 'disk', size: '' }];
        case '/container/print': return [];
        case '/user/print': return [{ name: 'admin', group: 'full', address: '192.168.88.0/24', 'last-logged-in': '2026-11-09 08:12:30', disabled: 'false' }, { name: 'nodecat', group: 'nodecat', address: '', 'last-logged-in': '2026-11-09 12:00:00', disabled: 'false' }];
        case '/user/active/print': return [{ name: 'nodecat', address: '10.10.0.5', via: 'api', when: '2026-11-09 12:00:00', group: 'nodecat' }];
        case '/ip/firewall/connection/print': {
          const destinos = [['142.250.78.110', 30], ['157.240.12.35', 22], ['104.18.32.7', 18], ['20.190.151.70', 12], ['8.8.8.8', 9], ['52.96.164.18', 8], ['13.107.42.14', 6]];
          const l = [];
          for (const [d, n] of destinos) for (let i = 0; i < n * 8; i++) { const lz = e.leases[Math.floor(rnd() * Math.min(12, e.leases.length))]; l.push({ 'src-address': lz.ip + ':' + (40000 + i), 'dst-address': d + ':443', protocol: rnd() < 0.85 ? 'tcp' : 'udp', 'orig-bytes': String(Math.round(rnd() * 2e6)), 'repl-bytes': String(Math.round(rnd() * 9e6)), 'tcp-state': 'established' }); }
          return l;
        }
        case '/interface/wireless/print': return [{ name: 'wlan1', ssid: 'Tienda' }, { name: 'wlan2', ssid: 'Tienda-5G' }];
        case '/interface/wifi/print': return [{ name: 'wifi1', 'configuration.ssid': 'Almacen' }, { name: 'wifi2', 'configuration.ssid': 'Almacen-Invitados' }];
        case '/caps-man/registration-table/print': throw Object.assign(new Error('no such command prefix'), { tipo: 'trap' });
        case '/ip/firewall/filter/print': {
          const k = jornada(ahora) * (ahora - e.arranque) / 1000;
          return [
            ['input', 'accept', 'defconf: accept established,related,untracked', { 'connection-state': 'established,related,untracked' }, 2400],
            ['input', 'drop', 'defconf: drop invalid', { 'connection-state': 'invalid' }, 3],
            ['input', 'accept', 'defconf: accept ICMP', { protocol: 'icmp' }, 6],
            ['input', 'accept', 'NodeCat: API-SSL solo desde la oficina', { protocol: 'tcp', 'dst-port': '8729', 'src-address': '200.44.9.18' }, 1.2],
            ['input', 'accept', 'WireGuard', { protocol: 'udp', 'dst-port': '13231' }, 40],
            ['input', 'drop', 'defconf: drop all not coming from LAN', { 'in-interface-list': '!LAN' }, 18],
            ['forward', 'fasttrack-connection', 'defconf: fasttrack', { 'connection-state': 'established,related' }, 90000],
            ['forward', 'accept', 'defconf: accept established,related, untracked', { 'connection-state': 'established,related,untracked' }, 9000],
            ['forward', 'drop', 'defconf: drop invalid', { 'connection-state': 'invalid' }, 2],
            ['forward', 'drop', 'Bloquear redes sociales en caja', { 'src-address': '192.168.88.30-192.168.88.40', 'dst-address': 'redes-sociales' }, 0.4],
            ['forward', 'drop', 'defconf: drop all from WAN not DSTNATed', { 'in-interface-list': 'WAN' }, 4]
          ].map(([chain, action, comment, extra, peso]) => ({ chain, action, comment, bytes: String(Math.round(k * peso * 900)), packets: String(Math.round(k * peso)), disabled: 'false', ...extra }));
        }
        case '/log/print': {
          if (rnd() < 0.3) { const [tm, msg] = TEMAS[Math.floor(rnd() * TEMAS.length)]; e.registro.push({ t: ahora, tm, msg }); if (e.registro.length > 200) e.registro.shift(); }
          return e.registro.map(x => ({ time: new Date(x.t - 4 * 3600e3).toISOString().slice(11, 19), topics: x.tm, message: x.msg }));
        }
        default: return [];
      }
    }
  };
}

module.exports = { conexion, PERFILES };
