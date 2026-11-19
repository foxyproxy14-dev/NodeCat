'use strict';
// Solo campos numéricos/booleanos y estados operativos, sin IP, MAC, credenciales ni configuración.
const numero = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
const textoEstado = x => x === true ? 'activa' : x === false ? 'inactiva' : 'desconocida';
function resumirTelemetria(registro, ahora = Date.now()) {
  if (!registro || !registro.datos || !registro.ultimo_contacto) return { disponible: false, motivo: 'Sin muestras de telemetría' };
  const d = registro.datos, red = d.red || {};
  const antiguedadSeg = Math.max(0, Math.round((ahora - registro.ultimo_contacto) / 1000));
  const interfaces = Array.isArray(red.interfaces) ? red.interfaces.slice(0, 16).map(i => ({
    // Se omite nombre/comentario para evitar identificadores internos del cliente.
    tipo: String(i.tipo || '').slice(0, 30),
    estado: textoEstado(i.activa && !i.deshabilitada),
    rxBps: numero(i.rx),
    txBps: numero(i.tx)
  })) : [];
  const wan = red.wan ? { estado: textoEstado(red.wan.activa), rxBps: numero(red.wan.rx), txBps: numero(red.wan.tx) } : null;
  const wans = Array.isArray(red.wans) ? red.wans.slice(0, 4).map(w => ({
    estado: textoEstado(w.activa), rxBps: numero(w.rx), txBps: numero(w.tx)
  })) : wan ? [wan] : [];
  const latencia = Array.isArray(red.latencia) ? red.latencia.slice(0, 6).map(x => ({
    ms: numero(x.ms), perdidaPct: numero(x.perdida)
  })) : [];
  return {
    disponible: true,
    antiguedadSeg,
    obsoleta: antiguedadSeg > 120 || !!registro.sinRespuesta,
    cpuPct: numero(d.cpu),
    ramPct: numero(d.ramPct),
    temperaturaC: numero(red.temperatura),
    conexiones: numero(red.conexiones),
    interfaces,
    wans,
    latencia,
    // El modelo no debe inferir disponibilidad o capacidad del enlace solo por throughput.
    nota: 'Tráfico instantáneo en bits/s; no indica capacidad contratada. Valores nulos significan no disponible.'
  };
}

function resumirRutasMikroTik(datos) {
  const filas = Array.isArray(datos?.rutas) ? datos.rutas : null;
  if (!filas) return { disponible: false, motivo: 'No se pudieron leer las rutas' };
  const defecto = filas.filter(r => r['dst-address'] === '0.0.0.0/0').slice(0, 24);
  const tablas = new Map();
  for (const r of defecto) {
    // Los nombres reales de tablas y gateways no se envían al proveedor.
    const clave = String(r['routing-table'] || r['routing-mark'] || 'main');
    if (!tablas.has(clave)) tablas.set(clave, 'tabla-' + (tablas.size + 1));
  }
  const rutas = defecto.map((r, i) => {
    const valor = x => x === true || x === 'true' || x === 'yes';
    const inactiva = valor(r.disabled) || r.active === false || r.active === 'false' || r.active === 'no';
    const n = Number(r.distance);
    return {
      ruta: i + 1,
      tabla: tablas.get(String(r['routing-table'] || r['routing-mark'] || 'main')),
      distancia: Number.isFinite(n) && n >= 0 && n <= 255 ? n : null,
      activa: !inactiva && (r.active === true || r.active === 'true' || r.active === 'yes'),
      deshabilitada: valor(r.disabled),
      dinamica: valor(r.dynamic),
      // Gateway real, comentarios, IPs y nombre de interfaz nunca salen de NodeCat.
      gatewayDefinido: !!r.gateway
    };
  });
  const alertas = [];
  for (const tabla of new Set(rutas.map(r => r.tabla))) {
    const rs = rutas.filter(r => r.tabla === tabla);
    const activas = rs.filter(r => r.activa);
    if (!activas.length) alertas.push(tabla + ': sin rutas por defecto activas');
    if (activas.length === 1) alertas.push(tabla + ': solo una ruta por defecto activa');
    if (activas.length > 1 && activas.some((r, i) => activas.slice(i + 1).some(s => s.distancia === r.distancia)))
      alertas.push(tabla + ': posibles rutas ECMP por distancia igual');
  }
  return { disponible: true, totalRutasDefault: defecto.length, truncado: filas.filter(r => r['dst-address'] === '0.0.0.0/0').length > 24,
    rutas, alertas, limitaciones: [
      'Una ruta activa no demuestra conectividad a Internet.',
      'No se consultaron reglas de policy routing, mangle ni resolución recursiva.',
      'No se ejecutaron pruebas de caída de ISP ni sondas adicionales.',
      'No se incluyen direcciones de gateways, interfaces ni comentarios.'
    ] };
}

module.exports = { resumirTelemetria, resumirRutasMikroTik };
