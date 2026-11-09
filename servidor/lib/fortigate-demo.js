'use strict';
// Modo demo: FortiGate simulados que responden como la API REST real (mismas rutas y campos principales).
const PERFILES = {
  fg100f: { modelo: ['FortiGate', '100F'], version: 'v7.2.8', serie: 'FG100FTK2290', ha: true,
    interfaces: [['wan1', 'physical', 'Fibra Inter', 180e6, 40e6], ['wan2', 'physical', 'LTE respaldo', 1.2e6, 0.4e6], ['internal1', 'physical', 'LAN', 60e6, 150e6], ['dmz', 'physical', 'Servidores', 20e6, 30e6], ['ha1', 'physical', 'Latido HA', 0.1e6, 0.1e6], ['vlan10-voz', 'vlan', 'Telefonía', 0.8e6, 0.8e6], ['ssl.root', 'tunnel', 'SSL-VPN', 2e6, 6e6]],
    sdwan: ['wan1', 'wan2'], tuneles: [['A-Sede-Norte', '186.24.10.5', 'up'], ['A-Proveedor-RX', '200.71.4.9', 'up'], ['A-Backup-Nube', '52.10.33.1', 'down']] },
  fg40f: { modelo: ['FortiGate', '40F'], version: 'v7.4.4', serie: 'FGT40FTK2310', ha: false,
    interfaces: [['wan', 'physical', 'WAN Movistar', 35e6, 8e6], ['lan', 'hard-switch', 'LAN', 8e6, 32e6], ['a', 'physical', 'Impresoras', 0.3e6, 0.1e6], ['Barq-Valencia', 'tunnel', 'Túnel a la sede', 3e6, 2e6]],
    sdwan: [], tuneles: [['Barq-Valencia', '200.44.1.10', 'up']] }
};
const rnd = Math.random;
function jornada(t) { const d = new Date(t - 4 * 3600e3), h = d.getUTCHours() + d.getUTCMinutes() / 60; return 0.18 + (h >= 7.5 && h <= 19 ? 0.82 * Math.sin((h - 7.5) / 11.5 * Math.PI) : 0); }
const estados = new Map();
function estado(id, perfil) {
  let e = estados.get(id); if (e) return e;
  const p = PERFILES[perfil] || PERFILES.fg40f;
  e = { p, t: Date.now(), arranque: Date.now() - (20 + rnd() * 80) * 864e5, cnt: Object.fromEntries(p.interfaces.map(i => [i[0], { rx: rnd() * 1e12, tx: rnd() * 2e11 }])) };
  estados.set(id, e); return e;
}
function api(id) {
  const fila = require('./db').q('SELECT config FROM equipos WHERE id = ?').get(id);
  const perfil = fila && fila.config ? JSON.parse(fila.config).perfil : 'fg40f';
  const e = estado(id, perfil), p = e.p;
  return {
    cerrar() { },
    async get(ruta) {
      const ahora = Date.now(), j = jornada(ahora);
      switch (ruta) {
        case 'monitor/system/status': return { version: p.version, serial: p.serie, results: { hostname: perfil === 'fg100f' ? 'FW-Clinica-01' : 'FW-Barquisimeto', model_name: p.modelo[0], model_number: p.modelo[1] } };
        case 'monitor/system/resource/usage': return { results: { cpu: [{ current: Math.round(4 + j * 22 + rnd() * 6) }], mem: [{ current: Math.round(48 + j * 8 + rnd() * 3) }], disk: [{ current: 23 }], session: [{ current: Math.round(800 + 9000 * j * (0.8 + rnd() * 0.4)) }] } };
        case 'monitor/system/interface': {
          const dt = (ahora - e.t) / 1000; e.t = ahora; const o = {};
          for (const [n, tipo, alias, rx, tx] of p.interfaces) {
            const extra = n === 'wan2' ? 1 : j * (0.75 + rnd() * 0.5);
            e.cnt[n].rx += rx * extra * dt / 8; e.cnt[n].tx += tx * extra * dt / 8;
            o[n] = { name: n, alias, type: tipo, link: true, status: 'up', speed: tipo === 'physical' ? 1000 : 0, rx_bytes: Math.round(e.cnt[n].rx), tx_bytes: Math.round(e.cnt[n].tx) };
          }
          return { results: o };
        }
        case 'monitor/virtual-wan/members': return { results: p.sdwan.map((n, i) => ({ interface: n, zone: 'virtual-wan-link', link: 'up', session: Math.round((i ? 40 : 3000) * (0.5 + j)), tx_bandwidth: Math.round(rnd() * 3e7), rx_bandwidth: Math.round(rnd() * 9e7), gateway: i ? '10.64.64.64' : '200.44.1.1' })) };
        case 'monitor/virtual-wan/health-check': {
          if (!p.sdwan.length) return { results: {} };
          const m = (base, var1, perd) => ({ status: 'up', latency: base + rnd() * var1, jitter: rnd() * var1 / 3, packet_loss: rnd() < perd ? Math.round(rnd() * 8) : 0, sla_targets_met: [1] });
          return { results: { Google: { wan1: m(9, 4, 0.02), wan2: m(48, 30, 0.25) }, 'Oficina central': { wan1: m(14, 5, 0.02), wan2: m(62, 35, 0.3) } } };
        }
        case 'monitor/system/sensor-info': return { results: [{ name: 'CPU ON-DIE', type: 'temperature', value: 52 + Math.round(rnd() * 4) }, { name: 'MB', type: 'temperature', value: 41 }] };
        case 'monitor/vpn/ipsec': return { results: p.tuneles.map(([n, gw, est]) => ({ name: n, rgwy: gw, proxyid: [{ p2name: n, status: est, incoming_bytes: Math.round(rnd() * 9e9), outgoing_bytes: Math.round(rnd() * 5e9), proxy_src: [{ subnet: '192.168.10.0/24' }], proxy_dst: [{ subnet: '10.20.0.0/16' }], expire: 3200 }] })) };
        case 'monitor/system/dhcp': return { results: Array.from({ length: perfil === 'fg100f' ? 74 : 19 }, (_, i) => ({ ip: `192.168.10.${20 + i}`, mac: `00:09:0f:${(i + 16).toString(16)}:aa:${(i * 7 % 255).toString(16).padStart(2, '0')}`, hostname: ['PC-ADMISION', 'PC-RAYOSX', 'IMPRESORA-LAB', 'PC-FARMACIA', 'TEL-RECEPCION', 'NAS-HISTORIAS'][i % 6] + (i > 5 ? '-' + i : ''), interface: 'internal1', status: 'leased', expire_time: Math.round(ahora / 1000 + 3600 * 8) })) };
        case 'monitor/web-ui/state': return { results: { utc_last_reboot: e.arranque } };
        case 'monitor/system/ha-peer': return { results: p.ha ? [{ hostname: 'FW-Clinica-01', serial_no: p.serie, priority: 200, primary: true, manage_master: 'primario' }, { hostname: 'FW-Clinica-02', serial_no: p.serie.replace('90', '91'), priority: 100, manage_master: 'secundario' }] : [] };
        case 'monitor/system/ha-statistics': return { results: p.ha ? [{ serial_no: p.serie, cpu_usage: 12, mem_usage: 51, sessions: 6200 }, { serial_no: p.serie.replace('90', '91'), cpu_usage: 2, mem_usage: 38, sessions: 6190 }] : [] };
        case 'monitor/vpn/ssl': return { results: perfil === 'fg100f' ? [{ user_name: 'dra.paredes', remote_host: '190.204.33.12', last_login_time: '2026-11-09 08:02:11', duration: 15200, subsessions: [{ aip: '10.212.134.200' }] }, { user_name: 'contador', remote_host: '186.92.4.7', last_login_time: '2026-11-09 11:40:03', duration: 3500, subsessions: [{ aip: '10.212.134.201' }] }] : [] };
        case 'cmdb/firewall/policy': { const W = p.sdwan.length ? 'virtual-wan-link' : 'wan', L = p.sdwan.length ? 'internal1' : 'lan'; return { results: [
          [1, 'LAN a Internet', L, W, 'all', 'all', 'ALL', 'accept', 'enable'], [2, 'Servidores a Internet', 'dmz', W, 'servidores', 'all', 'HTTPS DNS', 'accept', 'enable'],
          [3, 'SSL-VPN a LAN', 'ssl.root', L, 'SSLVPN_TUNNEL_ADDR1', 'red-lan', 'RDP SMB', 'accept', 'enable'], [4, 'Bloquear redes sociales', L, W, 'pc-caja', 'redes-sociales', 'ALL', 'deny', 'enable'],
          [5, 'Pruebas antiguas', L, 'dmz', 'all', 'all', 'ALL', 'accept', 'disable']].map(([id, n, si, di, sa, da, sv, ac, st]) => ({ policyid: id, name: n, srcintf: [{ name: si }], dstintf: [{ name: di }], srcaddr: [{ name: sa }], dstaddr: [{ name: da }], service: sv.split(' ').map(x => ({ name: x })), action: ac, status: st, nat: id === 1 || id === 2 ? 'enable' : 'disable', comments: '' })) }; }
        case 'monitor/firewall/policy': return { results: [1, 2, 3, 4, 5].map(id => ({ policyid: id, hit_count: id === 5 ? 0 : Math.round(rnd() * 9e6 / id), bytes: id === 5 ? 0 : Math.round(rnd() * 9e11 / id), last_used: id === 5 ? 0 : Math.round(ahora / 1000 - rnd() * 600) })) };
        case 'monitor/router/ipv4': return { results: !p.sdwan.length ? [{ ip_mask: '0.0.0.0/0', gateway: '200.44.1.1', interface: 'wan', type: 'static', distance: 10, metric: 0 }, { ip_mask: '192.168.20.0/24', gateway: '0.0.0.0', interface: 'lan', type: 'connect', distance: 0, metric: 0 }, { ip_mask: '10.10.0.0/16', gateway: '0.0.0.0', interface: 'Barq-Valencia', type: 'static', distance: 10, metric: 0 }] : [{ ip_mask: '0.0.0.0/0', gateway: '200.44.1.1', interface: 'wan1', type: 'static', distance: 1, metric: 0 }, { ip_mask: '0.0.0.0/0', gateway: '10.64.64.64', interface: 'wan2', type: 'static', distance: 10, metric: 0 }, { ip_mask: '192.168.10.0/24', gateway: '0.0.0.0', interface: 'internal1', type: 'connect', distance: 0, metric: 0 }, { ip_mask: '10.20.0.0/16', gateway: '0.0.0.0', interface: 'A-Sede-Norte', type: 'static', distance: 10, metric: 0 }] };
        case 'monitor/license/status': return { results: { forticare: { status: 'licensed', expires: Math.round(ahora / 1000 + 210 * 86400) }, antivirus: { status: 'licensed', expires: Math.round(ahora / 1000 + 210 * 86400), version: '92.07721' }, ips: { status: 'licensed', expires: Math.round(ahora / 1000 + 210 * 86400), version: '28.00870' }, web_filtering: { status: 'licensed', expires: Math.round(ahora / 1000 + 24 * 86400) }, antispam: { status: 'expired', expires: Math.round(ahora / 1000 - 30 * 86400) } } };
        case 'monitor/user/firewall': return { results: [{ username: 'jcastillo', ipaddr: '192.168.10.45', method: 'FSSO', usergroup: [{ name: 'Administracion' }], duration: 18000, traffic_vol_bytes: 1.2e9 }] };
        case 'log/memory/event/system': return { results: Array.from({ length: 30 }, (_, i) => { const t = new Date(ahora - 4 * 3600e3 - i * 7 * 60000); return { date: t.toISOString().slice(0, 10), time: t.toISOString().slice(11, 19), level: i % 9 === 0 ? 'warning' : 'information', msg: ['Admin admin logged in successfully from https(192.168.10.5)', 'Link monitor status changed: wan2 SLA dropped', 'DHCP server sends a DHCPACK', 'FortiGuard database updated', 'IPsec tunnel A-Backup-Nube is down'][i % 5], user: i % 5 === 0 ? 'admin' : '' }; }) };
        default: { const e2 = new Error(`Esta versión de FortiOS no tiene ${ruta}.`); e2.tipo = 'falta'; throw e2; }
      }
    }
  };
}
module.exports = { api, PERFILES };
