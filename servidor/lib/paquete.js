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
const nombreArchivo = c => c.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

module.exports = { crear, instalador, nombreArchivo, disponible };
