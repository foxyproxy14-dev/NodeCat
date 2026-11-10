'use strict';
// Paquete del agente para un cliente: ZIP con el ejecutable y su configuración ya puesta.
const fs = require('node:fs');
const path = require('node:path');
const zip = require('./zip');

const EXE = path.join(__dirname, '..', 'agente', 'NodeCatAgente.exe');
const disponible = () => fs.existsSync(EXE);
const crlf = s => s.replace(/\r?\n/g, '\r\n');
const bom = s => Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(crlf(s), 'utf8')]);

function crear(cliente, url) {
  if (!disponible()) throw new Error('Esta instalación de NodeCat no incluye el agente (falta agente/NodeCatAgente.exe).');
  const carpeta = 'NodeCat-Agente-' + cliente.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '/';
  const leeme = `AGENTE DE NODECAT — ${cliente.nombre}

Se instala en cada servidor Windows de este cliente. Lee allí mismo las sesiones de
Escritorio remoto, la CPU, la memoria y los discos, y se los envía a NodeCat por HTTPS.
No hace falta VPN, abrir puertos en el cliente ni usar contraseñas: el servidor solo
necesita salida a Internet hacia la dirección de NodeCat.

INSTALAR
  1. Copia esta carpeta al servidor.
  2. Haz doble clic en "Instalar agente.bat" y acepta los permisos de administrador.
  3. En unos segundos el servidor aparecerá en NodeCat, dentro de ${cliente.nombre}.

INSTALAR EN MUCHOS SERVIDORES A LA VEZ (GPO o script)
  NodeCatAgente.exe instalar /silencioso
  (o el instalador de un solo archivo de NodeCat:  "NodeCat-Agente-....exe" /silencioso)
  (agente.json debe estar junto a NodeCatAgente.exe)

CONFIGURACIÓN (agente.json)
  servidor: dirección de NodeCat. Ahora: ${url}
  clave:    clave de los agentes de ${cliente.nombre}. Si se genera una nueva en NodeCat,
            hay que actualizarla aquí (o descargar el paquete otra vez).

SONDA (LEER MIKROTIK Y FORTIGATE DE ESTA RED)
  Si en NodeCat eliges este servidor como sonda de un router o un FortiGate, el agente
  lee ese equipo desde aquí (solo lectura) y se lo pasa a NodeCat. Así no hace falta VPN.
  Permite en el router (API, puerto 8728) o en el FortiGate (HTTPS) la IP interna de este
  servidor. Para ver la sonda en primer plano: para el servicio y ejecuta
  NodeCatAgente.exe sonda

REQUISITOS
  Windows Server 2012 R2 o superior (o Windows 10/11) con .NET Framework 4.5 o superior.
  Funciona con la cuenta del sistema.

COMPROBAR
  "C:\\Program Files\\NodeCat Agente\\NodeCatAgente.exe" probar

DESINSTALAR
  Panel de control > Programas y características > NodeCat Agente > Desinstalar.
  También: "Desinstalar agente.bat". Quita el servicio, el proceso y los archivos.
  Si quitas el servidor en NodeCat, el agente se desinstala solo.
`;
  return zip.crear([
    { nombre: carpeta + 'NodeCatAgente.exe', datos: fs.readFileSync(EXE) },
    { nombre: carpeta + 'agente.json', datos: JSON.stringify({ servidor: url, clave: cliente.clave }, null, 2) },
    { nombre: carpeta + 'Instalar agente.bat', datos: crlf('@echo off\nrem Instala el agente de NodeCat en este servidor (pide permisos de administrador).\n"%~dp0NodeCatAgente.exe" instalar\n') },
    { nombre: carpeta + 'Desinstalar agente.bat', datos: crlf('@echo off\n"%~dp0NodeCatAgente.exe" desinstalar\n') },
    { nombre: carpeta + 'LEEME.txt', datos: bom(leeme) }
  ]);
}

/** Instalador de un solo archivo: el .exe del agente con su configuración pegada al final. Doble clic = instalar. */
function instalador(cliente, url) {
  if (!disponible()) throw new Error('Esta instalación de NodeCat no incluye el agente (falta agente/NodeCatAgente.exe).');
  const cfg = Buffer.from(JSON.stringify({ servidor: url, clave: cliente.clave }), 'utf8');
  const cola = Buffer.alloc(12); cola.writeInt32LE(cfg.length, 0); cola.write('NODECAT1', 4, 'ascii');
  return Buffer.concat([fs.readFileSync(EXE), cfg, cola]);
}
// Versión del agente de Windows que ofrece este NodeCat (la escribe agente/build.sh al compilar)
let versionWin = { t: 0, v: null };
function versionWindows() {
  try { const f = path.join(__dirname, '..', 'agente', 'NodeCatAgente.version'), m = fs.statSync(f).mtimeMs; if (m !== versionWin.t) versionWin = { t: m, v: fs.readFileSync(f, 'utf8').trim() || null }; }
  catch { versionWin = { t: 0, v: null }; }
  return versionWin.v;
}
const nombreArchivo = c => c.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------- Windows por PowerShell (irm … | iex), con pasos y barra de progreso
const PS1 = path.join(__dirname, '..', 'agente', 'instalar.ps1');
function scriptWindows(cliente, url) {
  const q = s => String(s).replace(/'/g, "''").replace(/[\r\n]/g, ' ');
  return fs.readFileSync(PS1, 'utf8')
    .replace(/__URL_SCRIPT__/g, q(`${url}/instalar/${cliente.clave}.ps1`))
    .replace(/__URL_EXE__/g, q(`${url}/instalar/${cliente.clave}.exe`))
    .replace(/__SERVIDOR__/g, q(url))
    .replace(/__CLIENTE__/g, q(cliente.nombre).slice(0, 80));
}

// ---------------------------------------------------------------- Linux y Proxmox
const PY = path.join(__dirname, '..', 'agente', 'nodecat-agente.py');
const agentePython = () => fs.readFileSync(PY);
/** Script de instalación de una línea: curl -fsSL <url> | sudo bash */
function scriptLinux(cliente, url) {
  const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
  return `#!/bin/bash
# Instalador del agente de NodeCat para Linux y Proxmox VE (${cliente.nombre.replace(/[^\w .áéíóúñÁÉÍÓÚÑ-]/g, '')})
set -e
SERVIDOR=${q(url)}
CLAVE=${q(cliente.clave)}
if [ "$(id -u)" != "0" ]; then echo "Ejecútalo como root (o con sudo)."; exit 1; fi
if ! command -v systemctl >/dev/null; then echo "Hace falta systemd."; exit 1; fi
if ! command -v python3 >/dev/null; then
  echo "> Instalando python3"
  if command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq python3 >/dev/null
  elif command -v dnf >/dev/null; then dnf install -y -q python3
  elif command -v yum >/dev/null; then yum install -y -q python3
  else echo "Instala python3 y vuelve a ejecutar el comando."; exit 1; fi
fi
echo "> Descargando el agente de NodeCat"
systemctl stop nodecat-agente 2>/dev/null || true
mkdir -p /opt/nodecat-agente
if command -v curl >/dev/null; then curl -fsSL "$SERVIDOR/agente/nodecat-agente.py" -o /opt/nodecat-agente/nodecat-agente.py
else wget -qO /opt/nodecat-agente/nodecat-agente.py "$SERVIDOR/agente/nodecat-agente.py"; fi
chmod 755 /opt/nodecat-agente/nodecat-agente.py
ln -sf /opt/nodecat-agente/nodecat-agente.py /usr/local/bin/nodecat-agente
INSTALACION=$(cat /proc/sys/kernel/random/uuid | tr -d '-')
umask 077
cat > /etc/nodecat-agente.json <<CFG
{ "servidor": "$SERVIDOR", "clave": "$CLAVE", "instalacion": "$INSTALACION" }
CFG
cat > /etc/systemd/system/nodecat-agente.service <<'UNIT'
[Unit]
Description=Agente de NodeCat (solo lectura)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/env python3 /opt/nodecat-agente/nodecat-agente.py servicio
Restart=always
RestartSec=30
Nice=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now nodecat-agente >/dev/null 2>&1
sleep 3
if systemctl is-active --quiet nodecat-agente; then
  if command -v pvesh >/dev/null; then QUE="Proxmox VE (con sus VM, contenedores y almacenamientos)"; else QUE="este servidor Linux"; fi
  echo ""
  echo "  Agente de NodeCat instalado y en marcha en $(hostname)."
  echo "  En unos segundos aparecerá $QUE en NodeCat."
  echo "  Para quitarlo: sudo nodecat-agente desinstalar"
else
  echo "El servicio no arrancó. Revisa: journalctl -u nodecat-agente -n 30"; exit 1
fi
`;
}

module.exports = { versionWindows, scriptWindows, crear, instalador, nombreArchivo, disponible, agentePython, scriptLinux };
