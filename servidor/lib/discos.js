'use strict';
// Salud de los discos de los servidores Windows (como CrystalDiskInfo) y licencia de Escritorio remoto.
// El agente manda lo que lee Windows (Get-PhysicalDisk, contadores de fiabilidad y atributos SMART en bruto);
// aquí se limpia y se calcula el estado (bueno, precaución, malo), así las reglas se pueden mejorar sin tocar el agente.

const BYTES = 1e16;
const num = (v, min = 0, max = 1e15) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
const txt = (v, n = 80) => (v == null ? '' : String(v)).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

// Nombres de los atributos SMART más comunes (en español; los demás se muestran como "Específico del fabricante")
const ATRIBUTOS = {
  1: 'Tasa de errores de lectura', 2: 'Rendimiento', 3: 'Tiempo de arranque del motor', 4: 'Arranques y paradas', 5: 'Sectores reasignados',
  7: 'Errores de búsqueda', 8: 'Rendimiento de búsqueda', 9: 'Horas encendido', 10: 'Reintentos de arranque', 11: 'Reintentos de calibración', 12: 'Ciclos de encendido',
  13: 'Errores de lectura suaves', 22: 'Helio', 160: 'Sectores incorregibles', 161: 'Bloques de reserva válidos', 163: 'Bloques defectuosos de fábrica',
  164: 'Borrados totales', 165: 'Borrados máximos', 166: 'Borrados mínimos', 167: 'Borrados promedio', 168: 'Ciclos de borrado máximos', 169: 'Vida restante',
  170: 'Bloques de reserva disponibles', 171: 'Fallos de programación', 172: 'Fallos de borrado', 173: 'Nivelación de desgaste', 174: 'Apagados inesperados',
  175: 'Fallos de programación (chip)', 176: 'Fallos de borrado (chip)', 177: 'Nivelación de desgaste', 178: 'Bloques de reserva usados (chip)', 179: 'Bloques de reserva usados',
  180: 'Bloques de reserva sin usar', 181: 'Fallos de programación', 182: 'Fallos de borrado', 183: 'Errores SATA (degradación)', 184: 'Errores de extremo a extremo',
  187: 'Errores incorregibles informados', 188: 'Tiempos de espera de comandos', 189: 'Escrituras altas', 190: 'Temperatura del flujo de aire', 191: 'Golpes (sensor)',
  192: 'Retracciones por apagado', 193: 'Ciclos de carga y descarga', 194: 'Temperatura', 195: 'ECC recuperados', 196: 'Eventos de reasignación',
  197: 'Sectores pendientes', 198: 'Sectores incorregibles', 199: 'Errores CRC (cable)', 200: 'Errores de escritura', 201: 'Errores de lectura suaves',
  202: 'Vida restante', 206: 'Altura de vuelo', 210: 'Errores de vibración', 220: 'Desplazamiento del disco', 222: 'Horas cargado', 223: 'Reintentos de carga',
  224: 'Fricción de carga', 225: 'Ciclos de carga', 226: 'Tiempo de carga', 230: 'Amplitud del cabezal', 231: 'Vida restante del SSD', 232: 'Reserva disponible',
  233: 'Indicador de desgaste', 234: 'Total borrado', 235: 'Bloques buenos', 240: 'Horas de vuelo del cabezal', 241: 'Total escrito', 242: 'Total leído',
  243: 'Total escrito (alto)', 244: 'Total leído (alto)', 249: 'Escrituras NAND', 250: 'Reintentos de lectura', 254: 'Golpes'
};
const nombreAtributo = id => ATRIBUTOS[id] || 'Específico del fabricante';

const ES_RAID = /PERC|LOGICAL VOLUME|MegaRAID|Smart Array|\bRAID\b|LSI|AVAGO|Adaptec|ServeRAID|MR9\d{3}|Virtual Disk|HP LOGICAL|DELL VIRTUAL/i;
const ES_VIRTUAL = /Virtual|VMware|QEMU|VBOX|Xen|Msft Virtual|Red Hat VirtIO|KVM/i;

function limpiarSalud(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.error) return { error: txt(s.error, 300) };
  const discos = (Array.isArray(s.discos) ? s.discos : []).slice(0, 32).map(limpiarDisco).filter(d => d.modelo || d.tamano);
  return { virtual: !!s.virtual, discos };
}

function limpiarDisco(d) {
  const atributos = (Array.isArray(d.atributos) ? d.atributos : []).slice(0, 40)
    .filter(a => Array.isArray(a) && num(a[0], 1, 255))
    .map(a => [num(a[0], 1, 255), num(a[1], 0, 255), num(a[2], 0, 255), a[3] == null ? null : num(a[3], 0, 255), num(a[4], 0, 2 ** 48)]);
  const o = {
    numero: txt(d.numero, 10), modelo: txt(d.modelo, 80), serie: txt(d.serie, 60), firmware: txt(d.firmware, 30),
    bus: txt(d.bus, 20), medio: txt(d.medio, 20), tamano: num(d.tamano, 0, BYTES), salud: txt(d.salud, 20), operativo: txt(d.operativo, 80),
    temperatura: num(d.temperatura, 0, 150) || null, temperaturaMax: num(d.temperaturaMax, 0, 150) || null,
    horas: d.horas == null ? null : num(d.horas, 0, 1e7), ciclos: d.ciclos == null ? null : num(d.ciclos, 0, 1e9),
    desgaste: d.desgaste == null ? null : num(d.desgaste, 0, 100),
    erroresLectura: d.erroresLectura == null ? null : num(d.erroresLectura, 0, 1e12), erroresEscritura: d.erroresEscritura == null ? null : num(d.erroresEscritura, 0, 1e12),
    prediccion: d.prediccion == null ? null : !!d.prediccion,
    volumenes: (Array.isArray(d.volumenes) ? d.volumenes : []).slice(0, 26).map(v => txt(v, 4)).filter(Boolean),
    atributos
  };
  return evaluar(o);
}

const crudo = (o, id) => { const a = o.atributos.find(x => x[0] === id); return a ? a[4] : null; };
const actual = (o, id) => { const a = o.atributos.find(x => x[0] === id); return a ? a[1] : null; };

/** Calcula el estado del disco como CrystalDiskInfo: bueno, precaución, malo o sin datos. */
function evaluar(o) {
  const nvme = /nvme/i.test(o.bus);
  o.ssd = nvme || /ssd/i.test(o.medio) || /ssd|nvme|solid/i.test(o.modelo) || o.atributos.some(a => [169, 173, 177, 202, 231, 233].includes(a[0]));
  o.tipo = nvme ? 'NVMe' : o.ssd ? 'SSD' : /hdd/i.test(o.medio) || o.atributos.length ? 'HDD' : '';
  // Temperatura, horas y ciclos: lo de Windows y, si falta, los atributos SMART
  if (o.temperatura == null) { let t = crudo(o, 194) ?? crudo(o, 190); if (t != null) { t = t % 65536; if (t > 150) t = t % 256; if (t > 0 && t < 150) o.temperatura = t; } }
  if (o.horas == null) { const h = crudo(o, 9); if (h != null) o.horas = h % 2 ** 32; }
  if (o.ciclos == null) { const c = crudo(o, 12); if (c != null) o.ciclos = c % 2 ** 32; }
  o.reasignados = crudo(o, 5); o.pendientes = crudo(o, 197); o.incorregibles = crudo(o, 198); o.crc = crudo(o, 199);
  if (o.reasignados != null) o.reasignados %= 2 ** 32;
  if (o.pendientes != null) o.pendientes %= 2 ** 32;
  if (o.incorregibles != null) o.incorregibles %= 2 ** 32;
  if (o.crc != null) o.crc %= 2 ** 32;
  // Vida restante del SSD: el desgaste que da Windows o el atributo del fabricante
  o.vida = o.desgaste != null && (o.ssd || o.desgaste > 0) ? 100 - o.desgaste : null;
  if (o.vida == null && o.ssd) for (const id of [231, 169, 202, 233, 177]) { const v = actual(o, id); if (v != null && v <= 100) { o.vida = v; break; } }

  const motivos = [], cuidado = [];
  o.raid = /raid/i.test(o.bus) || (ES_RAID.test(o.modelo) && !o.atributos.length && o.temperatura == null);
  o.virtual = ES_VIRTUAL.test(o.modelo) && !o.atributos.length;
  if (o.prediccion) motivos.push('el propio disco predice una falla');
  if (/unhealthy/i.test(o.salud)) motivos.push('Windows lo marca como no saludable');
  for (const a of o.atributos) if (a[3] && a[3] < 254 && a[1] <= a[3]) motivos.push(`${nombreAtributo(a[0])} por debajo del umbral`);
  if (o.vida != null && o.vida <= 0) motivos.push('el SSD llegó al final de su vida útil');
  if (o.reasignados) cuidado.push(`${o.reasignados} ${o.reasignados === 1 ? 'sector reasignado' : 'sectores reasignados'}`);
  if (o.pendientes) cuidado.push(`${o.pendientes} ${o.pendientes === 1 ? 'sector pendiente' : 'sectores pendientes'}`);
  if (o.incorregibles) cuidado.push(`${o.incorregibles} ${o.incorregibles === 1 ? 'sector incorregible' : 'sectores incorregibles'}`);
  if (/warning/i.test(o.salud)) cuidado.push('Windows lo marca con advertencia');
  if (o.vida != null && o.vida > 0 && o.vida < 10) cuidado.push(`le queda ${o.vida} % de vida`);
  if (o.erroresLectura) cuidado.push(`${o.erroresLectura} errores de lectura sin corregir`);
  const conDatos = o.atributos.length || o.temperatura != null || o.horas != null || /healthy|warning/i.test(o.salud);
  o.estado = motivos.length ? 'malo' : cuidado.length ? 'precaucion' : o.raid || o.virtual ? (o.raid ? 'raid' : 'virtual') : conDatos ? 'bueno' : 'desconocido';
  o.motivos = motivos.length ? motivos : cuidado;
  // Temperatura: los SSD y NVMe aguantan más que los discos mecánicos
  const [av, al] = nvme ? [65, 75] : o.ssd ? [60, 70] : [50, 60];
  o.temp = o.temperatura == null ? null : o.temperatura >= al ? 'alerta' : o.temperatura >= av ? 'aviso' : 'ok';
  o.atributos = o.atributos.map(a => [...a, nombreAtributo(a[0])]);
  return o;
}

/** Resumen corto para /api/estado (el detalle va aparte). */
function resumen(s) {
  if (!s || s.error || !s.discos) return null;
  const ds = s.discos.filter(d => !d.virtual);
  if (!ds.length) return s.virtual ? { virtual: true } : null;
  const orden = ['malo', 'precaucion', 'bueno', 'raid', 'desconocido'];
  const peor = ds.map(d => d.estado).sort((a, b) => orden.indexOf(a) - orden.indexOf(b))[0];
  return { peor, n: ds.length, malos: ds.filter(d => d.estado === 'malo').length, precaucion: ds.filter(d => d.estado === 'precaucion').length, tempAlta: ds.some(d => d.temp === 'alerta') };
}

// ---------------- Escritorio remoto (RDS) ----------------
const LICENCIAS = { 0: 'Personal', 1: 'Administración remota', 2: 'Por dispositivo', 4: 'Por usuario', 5: 'Sin configurar', 7: 'Conector externo' };
function limpiarRds(r) {
  if (!r || typeof r !== 'object') return null;
  const modo = num(r.modo, 0, 10), licencia = num(r.licencia, 0, 20);
  if (modo !== 1) return null;   // sin el rol de Host de sesión no hay periodo de gracia
  const servidores = (Array.isArray(r.servidores) ? r.servidores : []).slice(0, 8).map(x => txt(x, 100)).filter(Boolean);
  const dias = r.dias == null ? null : num(r.dias, 0, 365);
  const configurado = servidores.length > 0 && (licencia === 2 || licencia === 4 || licencia === 7);
  // Con servidor de licencias y modo configurados, la cuenta de días ya no importa
  const estado = configurado ? 'licenciado' : dias == null ? 'desconocido' : dias <= 0 ? 'vencido' : dias <= 7 ? 'critico' : dias <= 30 ? 'pronto' : 'gracia';
  return { estado, dias, licencia, licenciaTexto: LICENCIAS[licencia] || `Tipo ${licencia}`, servidores, configurado };
}

module.exports = { limpiarSalud, limpiarRds, resumen, evaluar, nombreAtributo, LICENCIAS };
