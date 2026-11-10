#!/usr/bin/env python3
# Agente de NodeCat para Linux y Proxmox VE.
# Solo lee: CPU, memoria, discos, red, temperatura, sesiones SSH y, en Proxmox, las VM, los
# contenedores LXC y los almacenamientos (con pvesh, la API local, y los archivos de /etc/pve; no hace falta token).
# Envía un informe por HTTPS cada 30 segundos. Sin dependencias: solo Python 3 de la distribución.
import hashlib, json, os, re, socket, subprocess, sys, threading, time, urllib.parse, urllib.request, urllib.error, uuid, shutil

VERSION = '1.2.1'
CONFIG = '/etc/nodecat-agente.json'
CARPETA = '/opt/nodecat-agente'
SERVICIO = 'nodecat-agente'
FS_REALES = {'ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'vfat', 'ntfs', 'f2fs', 'reiserfs', 'jfs', 'nfs', 'nfs4', 'cifs'}


def log(t):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), t, flush=True)


def cargar():
    with open(CONFIG, encoding='utf-8') as f:
        c = json.load(f)
    c['servidor'] = c['servidor'].rstrip('/')
    return c


def guardar(c):
    tmp = CONFIG + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(c, f, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONFIG)


def leer(ruta, defecto=''):
    try:
        with open(ruta, encoding='utf-8', errors='replace') as f:
            return f.read()
    except OSError:
        return defecto


def cmd(args, tiempo=20):
    r = subprocess.run(args, capture_output=True, text=True, timeout=tiempo)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or 'error').strip()[:300])
    return r.stdout


# ------------------------------------------------------------------ lecturas del sistema
_cpu_prev = None
def cpu():
    global _cpu_prev
    p = [int(x) for x in leer('/proc/stat').splitlines()[0].split()[1:9]]
    if _cpu_prev is None:
        _cpu_prev = p
        time.sleep(0.5)
        p = [int(x) for x in leer('/proc/stat').splitlines()[0].split()[1:9]]
    d = [a - b for a, b in zip(p, _cpu_prev)]
    _cpu_prev = p
    total = sum(d) or 1
    inactivo = d[3] + d[4]
    return {'cpu': round(100 * (total - inactivo) / total, 1), 'cpuUsuario': round(100 * (d[0] + d[1]) / total, 1),
            'cpuSistema': round(100 * (d[2] + d[5] + d[6]) / total, 1)}


def memoria():
    m = {}
    for l in leer('/proc/meminfo').splitlines():
        k, _, v = l.partition(':')
        m[k] = int(v.split()[0]) * 1024 if v.strip() else 0
    total, disp = m.get('MemTotal', 0), m.get('MemAvailable', 0)
    cache = m.get('Cached', 0) + m.get('Buffers', 0) + m.get('SReclaimable', 0)
    usada = max(0, total - disp)
    gb = lambda b: round(b / 1024 ** 3, 1)
    return {'ramTotal': gb(total), 'ramUsada': gb(usada), 'ramCache': gb(cache), 'ramPct': round(100 * usada / total) if total else None}


def discos():
    vistos, l = set(), []
    for linea in leer('/proc/mounts').splitlines():
        dev, punto, fs = linea.split()[:3]
        if fs not in FS_REALES or punto.startswith(('/snap', '/boot/efi', '/var/lib/docker', '/run')) or dev in vistos:
            continue
        if fs == 'zfs' and punto not in ('/',) and punto.count('/') > 1:
            continue   # en ZFS solo los conjuntos de primer nivel
        try:
            s = os.statvfs(punto)
        except OSError:
            continue
        total, libre = s.f_blocks * s.f_frsize, s.f_bavail * s.f_frsize
        if total < 512 * 1024 ** 2:
            continue
        vistos.add(dev)
        l.append({'unidad': punto, 'etiqueta': fs, 'total': round(total / 1024 ** 3, 1), 'libre': round(libre / 1024 ** 3, 1),
                  'pct': round(100 * (total - libre) / total)})
    return l[:20]


_red_prev = {}
def red():
    global _red_prev
    ahora, l, nuevos = time.time(), [], {}
    for linea in leer('/proc/net/dev').splitlines()[2:]:
        nombre, _, datos = linea.partition(':')
        nombre = nombre.strip()
        if nombre == 'lo' or nombre.startswith(('veth', 'fwbr', 'fwpr', 'fwln', 'tap', 'docker', 'br-')):
            continue
        c = datos.split()
        rx, tx = int(c[0]), int(c[8])
        nuevos[nombre] = (ahora, rx, tx)
        p = _red_prev.get(nombre)
        if p and ahora > p[0]:
            l.append({'nombre': nombre, 'rx': max(0, round((rx - p[1]) * 8 / (ahora - p[0]))), 'tx': max(0, round((tx - p[2]) * 8 / (ahora - p[0]))),
                      'activa': leer(f'/sys/class/net/{nombre}/operstate').strip() in ('up', 'unknown')})
    _red_prev = nuevos
    return l[:20]


def temperatura():
    mejor = None
    for base in ('/sys/class/hwmon',):
        if not os.path.isdir(base):
            continue
        for h in os.listdir(base):
            nombre = leer(f'{base}/{h}/name').strip()
            if nombre not in ('coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'acpitz'):
                continue
            for f in os.listdir(f'{base}/{h}'):
                if f.startswith('temp') and f.endswith('_input'):
                    try:
                        v = int(leer(f'{base}/{h}/{f}').strip()) / 1000
                        if 0 < v < 130:
                            mejor = max(mejor or 0, v)
                    except ValueError:
                        pass
    return round(mejor) if mejor else None


def sesiones():
    l = []
    try:
        for i, linea in enumerate(cmd(['who'], 5).splitlines()):
            p = linea.split()
            if len(p) < 2:
                continue
            origen = linea[linea.find('(') + 1:linea.find(')')] if '(' in linea else 'consola'
            l.append({'usuario': p[0], 'id': i + 1, 'estado': 'activa', 'estadoTexto': p[1], 'equipo': origen})
    except Exception:
        pass
    return l


def so():
    d = {}
    for l in leer('/etc/os-release').splitlines():
        k, _, v = l.partition('=')
        d[k] = v.strip('"')
    return d.get('PRETTY_NAME', 'Linux')


# ------------------------------------------------------------------ Proxmox
def es_proxmox():
    return shutil.which('pvesh') is not None


def pvesh(ruta, *extra, tiempo=25):
    return json.loads(cmd(['pvesh', 'get', ruta, '--output-format', 'json', *extra], tiempo) or 'null')


# Apps conocidas: nombre del CT/VM (o etiqueta) → nombre visible, puerto, esquema, ruta, categoría
APPS = [
    ('adguard', 'AdGuard Home', 80, 'http', '', 'DNS y bloqueo de anuncios'), ('pihole', 'Pi-hole', 80, 'http', '/admin', 'DNS y bloqueo de anuncios'),
    ('technitium', 'Technitium DNS', 5380, 'http', '', 'DNS'), ('nginxproxymanager', 'Nginx Proxy Manager', 81, 'http', '', 'Proxy inverso'),
    ('npm', 'Nginx Proxy Manager', 81, 'http', '', 'Proxy inverso'), ('traefik', 'Traefik', 8080, 'http', '', 'Proxy inverso'),
    ('portainer', 'Portainer', 9443, 'https', '', 'Contenedores'), ('dockge', 'Dockge', 5001, 'http', '', 'Contenedores'),
    ('homeassistant', 'Home Assistant', 8123, 'http', '', 'Domótica'), ('haos', 'Home Assistant', 8123, 'http', '', 'Domótica'),
    ('jellyfin', 'Jellyfin', 8096, 'http', '', 'Multimedia'), ('plex', 'Plex', 32400, 'http', '/web', 'Multimedia'), ('emby', 'Emby', 8096, 'http', '', 'Multimedia'),
    ('nextcloud', 'Nextcloud', 443, 'https', '', 'Archivos'), ('immich', 'Immich', 2283, 'http', '', 'Fotos'), ('paperless', 'Paperless-ngx', 8000, 'http', '', 'Documentos'),
    ('syncthing', 'Syncthing', 8384, 'http', '', 'Archivos'), ('grafana', 'Grafana', 3000, 'http', '', 'Monitoreo'), ('prometheus', 'Prometheus', 9090, 'http', '', 'Monitoreo'),
    ('uptimekuma', 'Uptime Kuma', 3001, 'http', '', 'Monitoreo'), ('uptime-kuma', 'Uptime Kuma', 3001, 'http', '', 'Monitoreo'), ('zabbix', 'Zabbix', 80, 'http', '', 'Monitoreo'),
    ('mikrodash', 'MikroDash', 3081, 'http', '', 'Monitoreo'), ('nodecat', 'NodeCat', 8080, 'http', '', 'Monitoreo'), ('netdata', 'Netdata', 19999, 'http', '', 'Monitoreo'),
    ('vaultwarden', 'Vaultwarden', 443, 'https', '', 'Contraseñas'), ('unifi', 'UniFi Network', 8443, 'https', '', 'Red'), ('omada', 'Omada Controller', 8043, 'https', '', 'Red'),
    ('wireguard', 'WireGuard (wg-easy)', 51821, 'http', '', 'VPN'), ('wg-easy', 'WireGuard (wg-easy)', 51821, 'http', '', 'VPN'), ('tailscale', 'Tailscale', None, '', '', 'VPN'),
    ('frigate', 'Frigate', 5000, 'http', '', 'Cámaras'), ('n8n', 'n8n', 5678, 'http', '', 'Automatización'), ('nodered', 'Node-RED', 1880, 'http', '', 'Automatización'),
    ('gitea', 'Gitea', 3000, 'http', '', 'Desarrollo'), ('forgejo', 'Forgejo', 3000, 'http', '', 'Desarrollo'), ('minio', 'MinIO', 9001, 'http', '', 'Almacenamiento'),
    ('pbs', 'Proxmox Backup Server', 8007, 'https', '', 'Copias de seguridad'), ('proxmox-backup', 'Proxmox Backup Server', 8007, 'https', '', 'Copias de seguridad'),
    ('truenas', 'TrueNAS', 443, 'https', '', 'Almacenamiento'), ('openmediavault', 'OpenMediaVault', 80, 'http', '', 'Almacenamiento'), ('omv', 'OpenMediaVault', 80, 'http', '', 'Almacenamiento'),
    ('cockpit', 'Cockpit', 9090, 'https', '', 'Administración'), ('webmin', 'Webmin', 10000, 'https', '', 'Administración'), ('homepage', 'Homepage', 3000, 'http', '', 'Panel'),
    ('heimdall', 'Heimdall', 80, 'http', '', 'Panel'), ('dashy', 'Dashy', 4000, 'http', '', 'Panel'), ('qbittorrent', 'qBittorrent', 8090, 'http', '', 'Descargas'),
    ('transmission', 'Transmission', 9091, 'http', '', 'Descargas'), ('sonarr', 'Sonarr', 8989, 'http', '', 'Multimedia'), ('radarr', 'Radarr', 7878, 'http', '', 'Multimedia'),
    ('prowlarr', 'Prowlarr', 9696, 'http', '', 'Multimedia'), ('mosquitto', 'Mosquitto (MQTT)', None, '', '', 'Domótica'), ('zigbee2mqtt', 'Zigbee2MQTT', 8080, 'http', '', 'Domótica'),
    ('windows', 'Windows', None, '', '', 'Sistema'), ('mikrotik', 'MikroTik CHR', 80, 'http', '', 'Red'), ('chr', 'MikroTik CHR', 80, 'http', '', 'Red'), ('pfsense', 'pfSense', 443, 'https', '', 'Red'), ('opnsense', 'OPNsense', 443, 'https', '', 'Red'),
]
URL_RE = re.compile(r'https?://[^\s<>"\')\]]+', re.I)


def ip_de_config(cfg):
    for k, v in cfg.items():
        if k.startswith(('net', 'ipconfig')) and isinstance(v, str):
            m = re.search(r'ip=(\d+\.\d+\.\d+\.\d+)', v)
            if m:
                return m.group(1)
    return None


def ips_lxc(nodo, vmid):
    # lxc-info (programa en C, inmediato) en lugar de pvesh (Perl, ~0,3 s de CPU por llamada); si no está, pvesh
    if shutil.which('lxc-info'):
        try:
            l = [x.strip() for x in cmd(['lxc-info', '-n', str(vmid), '-i', '-H'], 5).splitlines()]
            return [x for x in l if re.match(r'^\d+\.\d+\.\d+\.\d+$', x) and not x.startswith('127.')]
        except Exception:
            pass
    ips = []
    for i in pvesh(f'/nodes/{nodo}/lxc/{vmid}/interfaces', tiempo=10) or []:
        inet = i.get('inet') or ''
        if inet and not inet.startswith('127.'):
            ips.append(inet.split('/')[0])
    return ips


_ips_qemu = {}   # vmid → (hora, ips): el agente invitado se consulta cada 10 min por VM (es una llamada lenta)
def ips_qemu(nodo, vmid):
    ya = _ips_qemu.get(vmid)
    if ya and time.time() - ya[0] < 600:
        return ya[1]
    ips = []
    r = pvesh(f'/nodes/{nodo}/qemu/{vmid}/agent/network-get-interfaces', tiempo=10) or {}
    for i in r.get('result', []):
        if i.get('name') == 'lo':
            continue
        for a in i.get('ip-addresses', []):
            if a.get('ip-address-type') == 'ipv4' and not a['ip-address'].startswith(('127.', '169.254.')):
                ips.append(a['ip-address'])
    _ips_qemu[vmid] = (time.time(), ips)
    return ips


def ips_invitado(nodo, tipo, vmid, cfg):
    ips = []
    try:
        if tipo == 'lxc':
            ips = ips_lxc(nodo, vmid)
        elif str(cfg.get('agent', '')).startswith(('1', 'enabled=1')):
            ips = ips_qemu(nodo, vmid)
    except Exception:
        pass
    fija = ip_de_config(cfg)
    if not ips and fija:
        ips.append(fija)
    return ips[:4]


def app_de(nombre, cfg, ips):
    notas = cfg.get('description') or ''
    etiquetas = [t for t in re.split(r'[;,\s]+', cfg.get('tags') or '') if t]
    clave = re.sub(r'[^a-z0-9-]', '', nombre.lower())
    conocida = next((a for a in APPS if a[0] in clave or a[0] in [t.lower() for t in etiquetas]), None)
    url = None
    for m in URL_RE.finditer(notas):
        u = m.group(0).rstrip('.,;')
        host = re.sub(r'^https?://', '', u).split('/')[0].split(':')[0].lower()
        # Las notas de los scripts de la comunidad traen enlaces a su web, GitHub o donaciones: no son la dirección de la app
        if any(d in host for d in ('community-scripts', 'github', 'helper-scripts', 'tteck', 'ko-fi', 'buymeacoffee', 'patreon', 'discord', 'proxmox.com', 'youtube')):
            continue
        url = u   # una dirección propia (IP o dominio del cliente)
        break
    if not url and conocida and conocida[2] and ips:
        url = f'{conocida[3]}://{ips[0]}' + ('' if conocida[2] in (80, 443) and ((conocida[3] == 'http') == (conocida[2] == 80)) else f':{conocida[2]}') + conocida[4]
    return {'app': conocida[1] if conocida else None, 'categoria': conocida[5] if conocida else None, 'url': url, 'etiquetas': etiquetas[:8],
            'notas': re.sub(r'<[^>]+>', '', notas)[:300] if notas else ''}


class Lento:
    """Lecturas lentas de Proxmox (apps, copias, discos, nodo): en segundo plano y con caché."""
    def __init__(self):
        self.datos, self.cuando, self.bloqueo = {}, {}, threading.Lock()

    def obtener(self, clave, cada, fn):
        with self.bloqueo:
            if time.time() - self.cuando.get(clave, 0) >= cada and not self.cuando.get(clave + '!'):
                self.cuando[clave + '!'] = True
                threading.Thread(target=self._leer, args=(clave, fn), daemon=True).start()
            return self.datos.get(clave)

    def _leer(self, clave, fn):
        try:
            v = fn()
        except Exception as e:
            v = {'error': str(e)[:300]}
        with self.bloqueo:
            self.datos[clave], self.cuando[clave] = v, time.time()
            self.cuando[clave + '!'] = False


lento = Lento()


def leer_conf(nodo, tipo, vmid):
    """Configuración de una VM/CT leída del archivo de /etc/pve (solo lectura, sin lanzar pvesh). Mismo formato que pvesh config."""
    carpeta = 'qemu-server' if tipo == 'qemu' else 'lxc'
    with open(f'/etc/pve/nodes/{nodo}/{carpeta}/{vmid}.conf', encoding='utf-8', errors='replace') as f:
        texto = f.read()
    cfg, notas = {}, []
    for linea in texto.splitlines():
        if linea.startswith('['):
            break   # instantáneas y cambios pendientes: no son la configuración actual
        if linea.startswith('#'):
            notas.append(urllib.parse.unquote(linea[1:]))   # las notas van como comentarios, con %XX para lo especial
            continue
        k, sep, v = linea.partition(':')
        if sep and k.strip():
            cfg[k.strip()] = v.strip()
    if notas:
        cfg['description'] = '\n'.join(notas)
    return cfg


def config_vm(nodo, tipo, vmid):
    try:
        return leer_conf(nodo, tipo, vmid)
    except Exception:
        try:
            return pvesh(f'/nodes/{nodo}/{tipo}/{vmid}/config', tiempo=10) or {}
        except Exception:
            return {}


def leer_apps(nodo, vms):
    l = []
    vivos = {v['id'] for v in vms if v.get('estado') == 'running'}
    for k in list(_ips_qemu):   # una VM que se apagó o reinició vuelve a preguntar sus IP
        if k not in vivos:
            _ips_qemu.pop(k, None)
    for v in vms:
        cfg = config_vm(nodo, v['tipo'], v['id'])
        ips = ips_invitado(nodo, v['tipo'], v['id'], cfg) if v.get('estado') == 'running' else ([ip_de_config(cfg)] if ip_de_config(cfg) else [])
        a = app_de(v['nombre'], cfg, ips)
        l.append({'id': v['id'], 'nombre': v['nombre'], 'tipo': v['tipo'], 'estado': v['estado'], 'ips': ips, 'so': cfg.get('ostype'),
                  'arranqueAuto': str(cfg.get('onboot', '0')) == '1', **a})
    return l


def leer_copias(nodo):
    archivos, almacenes = [], []
    for st in pvesh(f'/nodes/{nodo}/storage') or []:
        if 'backup' not in (st.get('content') or '') or not st.get('active', 1):
            continue
        almacenes.append(st['storage'])
        try:
            for x in pvesh(f"/nodes/{nodo}/storage/{st['storage']}/content", '--content', 'backup', tiempo=40) or []:
                archivos.append({'vmid': str(x.get('vmid', '')), 'fecha': (x.get('ctime') or 0) * 1000, 'tamano': x.get('size'), 'almacen': st['storage'],
                                 'formato': x.get('format') or x.get('subtype') or '', 'notas': (x.get('notes') or '')[:120], 'protegida': bool(x.get('protected')),
                                 'verificada': (x.get('verification') or {}).get('state')})
        except Exception:
            pass
    archivos.sort(key=lambda a: a['fecha'], reverse=True)
    try:
        trabajos = [{'id': j.get('id'), 'horario': j.get('schedule') or j.get('starttime'), 'almacen': j.get('storage'), 'activo': str(j.get('enabled', 1)) != '0',
                     'que': 'Todas' if j.get('all') else (j.get('vmid') or j.get('pool') or ''), 'modo': j.get('mode'), 'comentario': (j.get('comment') or '')[:120],
                     'proxima': (j.get('next-run') or 0) * 1000 or None} for j in pvesh('/cluster/backup') or []]
    except Exception:
        trabajos = []
    try:
        tareas = [{'vmid': str(t.get('id') or ''), 'inicio': (t.get('starttime') or 0) * 1000, 'fin': (t.get('endtime') or 0) * 1000 or None,
                   'estado': t.get('status') or 'en curso', 'usuario': t.get('user')} for t in pvesh(f'/nodes/{nodo}/tasks', '--typefilter', 'vzdump', '--limit', '30') or []]
    except Exception:
        tareas = []
    return {'archivos': archivos[:400], 'trabajos': trabajos[:40], 'tareas': tareas, 'almacenes': almacenes}


_smart = {}   # disco → últimos datos SMART (se reutilizan mientras el disco duerme)
def leer_smart(disco):
    """Datos SMART de solo lectura (temperatura, ciclos, horas encendido, errores CRC). Requiere smartctl.
    Con -n standby no despierta un disco dormido: en ese caso se devuelven los últimos datos leídos."""
    if not disco or not re.match(r'^/dev/[\w/-]+$', disco) or not shutil.which('smartctl'):
        return {}
    try:
        r = subprocess.run(['smartctl', '-n', 'standby', '-A', '-H', '-j', disco], capture_output=True, text=True, timeout=20)
        j = json.loads(r.stdout or '{}')
    except Exception:
        return _smart.get(disco, {})
    if (j.get('power_mode') or {}).get('is_standby') or (r.returncode & 2 and not j.get('smart_status')):
        return _smart.get(disco, {})
    o = {}
    t = (j.get('temperature') or {}).get('current')
    if t is not None:
        o['temperatura'] = t
    if (j.get('power_cycle_count')) is not None:
        o['ciclos'] = j.get('power_cycle_count')
    h = (j.get('power_on_time') or {}).get('hours')
    if h is not None:
        o['horas'] = h
    nv = j.get('nvme_smart_health_information_log') or {}
    if nv:
        o.setdefault('temperatura', nv.get('temperature'))
        o.setdefault('ciclos', nv.get('power_cycles'))
        o.setdefault('horas', nv.get('power_on_hours'))
        o['crc'] = nv.get('media_errors')
    for a in (j.get('ata_smart_attributes') or {}).get('table') or []:
        if a.get('id') == 199:
            o['crc'] = (a.get('raw') or {}).get('value')
    st = j.get('smart_status')
    if st is not None:
        o['smartOk'] = bool(st.get('passed'))
    if o:
        _smart[disco] = o
    return o


def leer_nodo(nodo):
    st = pvesh(f'/nodes/{nodo}/status') or {}
    ci = st.get('cpuinfo') or {}
    n = {'cpuModelo': ci.get('model'), 'sockets': ci.get('sockets'), 'hilos': ci.get('cpus'), 'kernel': st.get('kversion'), 'pve': st.get('pveversion'),
         'carga': st.get('loadavg'), 'swapTotal': (st.get('swap') or {}).get('total'), 'swapUsado': (st.get('swap') or {}).get('used'),
         'ksm': (st.get('ksm') or {}).get('shared'), 'arranque': (st.get('boot-info') or {}).get('mode')}
    try:
        n['actualizaciones'] = len(pvesh(f'/nodes/{nodo}/apt/update', tiempo=30) or [])
    except Exception:
        n['actualizaciones'] = None
    try:
        cl = pvesh('/cluster/status') or []
        c = next((x for x in cl if x.get('type') == 'cluster'), None)
        n['cluster'] = {'nombre': c.get('name'), 'quorum': bool(c.get('quorate')), 'nodos': [{'nombre': x.get('name'), 'online': bool(x.get('online'))} for x in cl if x.get('type') == 'node']} if c else None
    except Exception:
        n['cluster'] = None
    try:
        n['discos'] = [{'disco': d.get('devpath'), 'modelo': d.get('model'), 'tamano': d.get('size'), 'tipo': d.get('type'), 'salud': d.get('health'),
                        'desgaste': d.get('wearout'), 'uso': d.get('used'), 'serie': d.get('serial')} for d in pvesh(f'/nodes/{nodo}/disks/list', tiempo=30) or []]
        for d in n['discos']:
            d.update(leer_smart(d['disco']))
    except Exception:
        n['discos'] = []
    try:
        n['almacenes'] = [{'nombre': x.get('storage'), 'tipo': x.get('type'), 'contenido': x.get('content'), 'activo': bool(x.get('active')), 'compartido': bool(x.get('shared')),
                           'usado': x.get('used'), 'total': x.get('total'), 'disponible': x.get('avail')} for x in pvesh(f'/nodes/{nodo}/storage') or []]
    except Exception:
        n['almacenes'] = []
    return n


def leer_red_host():
    base = '/sys/class/net'
    ips = {}
    try:
        for i in json.loads(cmd(['ip', '-j', 'addr'], 5)):
            ips[i['ifname']] = [a['local'] + '/' + str(a.get('prefixlen', '')) for a in i.get('addr_info', []) if a.get('family') == 'inet']
    except Exception:
        pass
    l = []
    for n in sorted(os.listdir(base)):
        if n == 'lo':
            continue
        r = f'{base}/{n}'
        tipo = 'puente' if os.path.isdir(f'{r}/bridge') else 'fisica' if os.path.exists(f'{r}/device') else \
            'invitado' if re.match(r'^(veth|tap)\d+i\d+$', n) else 'firewall' if n.startswith(('fwbr', 'fwpr', 'fwln')) else 'virtual'
        if tipo == 'firewall':
            continue
        try:
            vel = int(leer(f'{r}/speed').strip() or -1)
        except ValueError:
            vel = -1
        m = re.match(r'^(veth|tap)(\d+)i\d+$', n)
        maestro = os.path.basename(os.path.realpath(f'{r}/master')) if os.path.exists(f'{r}/master') else None
        if maestro and maestro.startswith('fwbr'):   # firewall de Proxmox en medio: se busca el puente real
            fw = f'{base}/{maestro.replace("fwbr", "fwpr", 1)}'
            for p in (os.listdir(f'{base}/{maestro}/brif') if os.path.isdir(f'{base}/{maestro}/brif') else []):
                if p.startswith('fwpr') and os.path.exists(f'{base}/{p}/master'):
                    maestro = os.path.basename(os.path.realpath(f'{base}/{p}/master'))
        est = lambda k: int(leer(f'{r}/statistics/{k}').strip() or 0)
        l.append({'nombre': n, 'tipo': tipo, 'estado': leer(f'{r}/operstate').strip(), 'velocidad': vel if vel > 0 else None,
                  'duplex': leer(f'{r}/duplex').strip() or None, 'mtu': int(leer(f'{r}/mtu').strip() or 0) or None, 'mac': leer(f'{r}/address').strip(),
                  'ips': ips.get(n, []), 'puente': maestro, 'puertos': sorted(os.listdir(f'{r}/brif')) if tipo == 'puente' and os.path.isdir(f'{r}/brif') else [],
                  'vmid': m.group(2) if m else None, 'rxTotal': est('rx_bytes'), 'txTotal': est('tx_bytes'),
                  'descartados': est('rx_dropped') + est('tx_dropped'), 'errores': est('rx_errors') + est('tx_errors')})
    gw, dns, dominio, lat = None, [], None, None
    try:
        rt = json.loads(cmd(['ip', '-j', 'route', 'show', 'default'], 5))
        gw = rt[0].get('gateway') if rt else None
    except Exception:
        pass
    for linea in leer('/etc/resolv.conf').splitlines():
        p = linea.split()
        if len(p) >= 2 and p[0] == 'nameserver':
            dns.append(p[1])
        elif len(p) >= 2 and p[0] in ('search', 'domain'):
            dominio = p[1]
    if gw:
        try:
            r = subprocess.run(['ping', '-c', '4', '-i', '0.3', '-W', '1', gw], capture_output=True, text=True, timeout=10)
            perd = re.search(r'([\d.]+)% packet loss', r.stdout)
            rtt = re.search(r'= [\d.]+/([\d.]+)/([\d.]+)', r.stdout)
            lat = {'destino': gw, 'ms': float(rtt.group(1)) if rtt else None, 'max': float(rtt.group(2)) if rtt else None, 'perdida': float(perd.group(1)) if perd else None}
        except Exception:
            pass
    return {'interfaces': l[:80], 'puertaEnlace': gw, 'dns': dns[:3], 'dominio': dominio, 'latencia': lat, 'host': socket.gethostname()}


_pveversion = [0, None]
_enviado = {}   # parte de "pve" → (huella, hora): solo se manda lo que cambió (y todo cada 15 min)
def solo_cambios(pve):
    ahora, o = time.time(), {'parcial': True}
    for k, v in pve.items():
        h = hashlib.sha1(json.dumps(v, sort_keys=True, default=str).encode()).hexdigest()
        ya = _enviado.get(k)
        if not ya or ya[0] != h or ahora - ya[1] > 900:
            o[k] = v
            _enviado[k] = (h, ahora)
    return o


def proxmox(nodo):
    datos = {'hipervisor': 'proxmox'}
    # pveversion (Perl, lento) cambia solo al actualizar Proxmox: se pregunta cada hora
    if time.time() - _pveversion[0] > 3600 or not _pveversion[1]:
        try:
            _pveversion[1] = 'Proxmox VE ' + cmd(['pveversion'], 10).split('/')[1].strip()
        except Exception:
            pass
        _pveversion[0] = time.time()
    if _pveversion[1]:
        datos['so'] = _pveversion[1]
    try:
        rec = pvesh('/cluster/resources')
        vms, almacen = [], []
        for r in rec:
            if r.get('node') != nodo:
                continue
            if r.get('type') in ('qemu', 'lxc'):
                vms.append({'id': str(r.get('vmid', '')), 'nombre': r.get('name') or f"{r.get('type')}-{r.get('vmid')}", 'tipo': r.get('type'),
                            'estado': r.get('status'), 'nodo': nodo, 'cpu': round((r.get('cpu') or 0) * 100, 1), 'cpus': r.get('maxcpu') or 0,
                            'ram': r.get('mem'), 'ramMax': r.get('maxmem'), 'disco': r.get('disk') or None, 'discoMax': r.get('maxdisk'),
                            'uptime': r.get('uptime'), 'netin': r.get('netin'), 'netout': r.get('netout'),
                            'diskread': r.get('diskread'), 'diskwrite': r.get('diskwrite'), 'etiquetas': [t for t in re.split(r'[;,\s]+', r.get('tags') or '') if t][:8]})
            elif r.get('type') == 'storage' and r.get('maxdisk'):
                total, usado = r['maxdisk'], r.get('disk') or 0
                almacen.append({'unidad': r.get('storage'), 'etiqueta': r.get('plugintype') or 'storage', 'total': round(total / 1024 ** 3, 1),
                                'libre': round((total - usado) / 1024 ** 3, 1), 'pct': round(100 * usado / total)})
        datos['vms'] = vms
        if almacen:
            datos['discos'] = almacen
        # Lo lento, en segundo plano: apps cada 2 min, nodo cada 5, copias cada 5
        pve = {'apps': lento.obtener('apps', 120, lambda: leer_apps(nodo, vms)),
               'copias': lento.obtener('copias', 300, lambda: leer_copias(nodo)),
               'nodo': lento.obtener('nodo', 300, lambda: leer_nodo(nodo)),
               'red': lento.obtener('red', 60, leer_red_host)}
        datos['pve'] = solo_cambios({k: v for k, v in pve.items() if v is not None})
    except Exception as e:
        datos['errorVms'] = str(e)
    return datos


# ------------------------------------------------------------------ informe
def ips_locales():
    """IPv4 de la red local del equipo (sin la de loopback ni las de Docker y similares)."""
    try:
        r = subprocess.run(['ip', '-4', '-o', 'addr', 'show', 'scope', 'global'], capture_output=True, text=True, timeout=5)
    except Exception:
        return []
    l = []
    for linea in r.stdout.splitlines():
        p = linea.split()
        if len(p) < 4 or re.match(r'^(docker|br-|veth|virbr|tailscale|wg|zt|fwpr|fwln|tap)', p[1]):
            continue
        ip = p[3].split('/')[0]
        if not ip.startswith('169.254.') and ip not in l:
            l.append(ip)
    return l[:6]


def recolectar(c, evento='periodico'):
    nodo = socket.gethostname().split('.')[0]
    o = {'nombre': nodo, 'version': VERSION + '-linux', 'evento': evento, 'hora': int(time.time() * 1000), 'instalacion': c.get('instalacion', ''),
         'plataforma': 'linux', 'intervalo': c.get('intervalo', 30)}
    try:
        o.update(cpu()); o.update(memoria())
        o['so'] = so()
        o['arranque'] = int((time.time() - float(leer('/proc/uptime').split()[0])) * 1000)
        o['discos'] = discos()
        o['nucleos'] = os.cpu_count()
        o['carga'] = round(os.getloadavg()[0], 2)
        o['temperatura'] = temperatura()
        o['red'] = red()
        o['ipsLocales'] = ips_locales()
    except Exception as e:
        o['errorMetricas'] = str(e)
    o['sesiones'] = sesiones()
    if es_proxmox():
        o['plataforma'] = 'proxmox'
        o.update(proxmox(nodo))
    return o


def enviar(c, informe):
    req = urllib.request.Request(c['servidor'] + '/api/agente/informe', data=json.dumps(informe).encode(), method='POST',
                                 headers={'Content-Type': 'application/json; charset=utf-8', 'X-NodeCat-Agente': c['clave'], 'User-Agent': 'NodeCat-Agente-Linux/' + VERSION})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}


actualizando = [False]
def actualizar(c, version):
    """NodeCat tiene una versión nueva del agente: se descarga, se comprueba y el servicio se reinicia con ella."""
    try:
        req = urllib.request.Request(c['servidor'] + '/agente/nodecat-agente.py', headers={'User-Agent': 'NodeCat-Agente-Linux/' + VERSION})
        with urllib.request.urlopen(req, timeout=30) as r:
            nuevo = r.read()
        if b'NodeCat' not in nuevo[:400] or len(nuevo) < 2000:
            raise RuntimeError('el archivo descargado no parece el agente')
        compile(nuevo, 'nodecat-agente.py', 'exec')
        destino = os.path.realpath(__file__)
        tmp = destino + '.nuevo'
        with open(tmp, 'wb') as f:
            f.write(nuevo)
        os.chmod(tmp, 0o755)
        os.replace(tmp, destino)
        log(f'Agente actualizado a la versión {version}. Reiniciando.')
        os._exit(0)   # systemd lo vuelve a arrancar con la versión nueva
    except Exception as e:
        log(f'No se pudo actualizar el agente: {e}')
        actualizando[0] = False


def bucle():
    c = cargar()
    log(f'Agente {VERSION} iniciado. Envía a {c["servidor"]}.')
    pendientes, conectado = [], True
    while True:
        try:
            pendientes.append(recolectar(c))
            pendientes = pendientes[-120:]
            while pendientes:
                try:
                    estado, r = enviar(c, pendientes[0])
                except Exception as e:
                    if conectado:
                        log(f'No se pudo conectar con NodeCat ({e}). Se reintentará; los datos se guardan mientras tanto.')
                    conectado = False
                    break
                if estado == 410:
                    log('Este servidor se quitó de NodeCat. El agente se desinstala solo.')
                    desinstalar(silencioso=True)
                    return
                if estado == 403:
                    log('NodeCat rechazó la clave del agente. Vuelve a instalarlo con el comando de NodeCat.')
                    pendientes.pop(0)
                    break
                pendientes.pop(0)
                if not conectado:
                    log('Conectado de nuevo con NodeCat.')
                conectado = True
                if r.get('agenteLinux') and r['agenteLinux'] != VERSION and not actualizando[0]:
                    actualizando[0] = True
                    threading.Thread(target=actualizar, args=(c, r['agenteLinux']), daemon=True).start()
                if 5 <= int(r.get('intervalo', 30)) <= 600:
                    c['intervalo'] = int(r['intervalo'])
                nueva = r.get('clave')
                if nueva and len(nueva) >= 16 and nueva != c['clave']:
                    c['clave'] = nueva
                    guardar(c)
                    log(f'Este servidor ahora pertenece a {r.get("cliente", "otro cliente")} en NodeCat.')
        except Exception as e:
            log(f'Error al recoger los datos: {e}')
        time.sleep(c.get('intervalo', 30))


def desinstalar(silencioso=False):
    try:
        c = cargar()
        enviar(c, {'nombre': socket.gethostname().split('.')[0], 'version': VERSION + '-linux', 'evento': 'desinstalado',
                   'instalacion': c.get('instalacion', ''), 'plataforma': 'proxmox' if es_proxmox() else 'linux', 'hora': int(time.time() * 1000)})
    except Exception:
        pass
    for f in (CONFIG, f'/etc/systemd/system/{SERVICIO}.service', '/usr/local/bin/nodecat-agente'):
        try:
            os.remove(f)
        except OSError:
            pass
    shutil.rmtree(CARPETA, ignore_errors=True)
    subprocess.run(['systemctl', 'daemon-reload'], capture_output=True)
    if not silencioso:
        print('Agente de NodeCat desinstalado: no queda ningún servicio ni archivo.')
    # Al final: detener el servicio (si este proceso es el servicio, termina aquí)
    subprocess.Popen(['systemctl', 'disable', '--now', SERVICIO], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == '__main__':
    orden = sys.argv[1] if len(sys.argv) > 1 else 'ayuda'
    if orden == 'servicio':
        bucle()
    elif orden == 'probar':
        c = cargar()
        i = recolectar(c, 'prueba')
        print(json.dumps(i, indent=2, ensure_ascii=False))
        estado, r = enviar(c, i)
        print(f'\nNodeCat respondió {estado}: {r.get("error") or "correcto"}')
    elif orden == 'desinstalar':
        if os.geteuid() != 0:
            sys.exit('Ejecútalo con sudo.')
        desinstalar()
    else:
        print(f'Agente de NodeCat {VERSION} para Linux y Proxmox\n\n  nodecat-agente probar        Muestra lo que lee y lo envía una vez\n  sudo nodecat-agente desinstalar   Lo quita por completo\n')
