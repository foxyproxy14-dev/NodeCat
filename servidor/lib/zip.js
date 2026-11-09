'use strict';
// ZIP mínimo (compresión deflate de zlib) para el paquete del agente.
const zlib = require('node:zlib');

const TABLA = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = TABLA[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function fechaDos(d) {
  return { hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** archivos: [{ nombre, datos: Buffer|string }] */
function crear(archivos) {
  const partes = [], central = [];
  let pos = 0;
  const { hora, dia } = fechaDos(new Date());
  for (const a of archivos) {
    const datos = Buffer.isBuffer(a.datos) ? a.datos : Buffer.from(a.datos, 'utf8');
    const nombre = Buffer.from(a.nombre, 'utf8');
    const comp = zlib.deflateRawSync(datos, { level: 9 });
    const crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(hora, 10); local.writeUInt16LE(dia, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(nombre.length, 26);
    partes.push(local, nombre, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(hora, 12); c.writeUInt16LE(dia, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(datos.length, 24); c.writeUInt16LE(nombre.length, 28); c.writeUInt32LE(pos, 42);
    central.push(c, nombre);
    pos += 30 + nombre.length + comp.length;
  }
  const tamCentral = central.reduce((n, b) => n + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(tamCentral, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...partes, ...central, fin]);
}

module.exports = { crear };
