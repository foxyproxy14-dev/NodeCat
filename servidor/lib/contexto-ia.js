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
  const todas = filas.filter(r => r && r['dst-address'] === '0.0.0.0/0');
  const defecto = todas.slice(0, 24);
  const tablas = new Map();
  for (const r of defecto) {
    const clave = String(r['routing-table'] || r['routing-mark'] || 'main');
    if (!tablas.has(clave)) tablas.set(clave, 'tabla-' + (tablas.size + 1));
  }
  const flag = x => x === true || x === 'true' || x === 'yes';
  const flagConocido = x => x === true || x === false || ['true', 'false', 'yes', 'no'].includes(x);
  const rutas = defecto.map((r, i) => {
    const n = r.distance === undefined || r.distance === null || r.distance === '' ? NaN : Number(r.distance);
    const habilitada = flagConocido(r.disabled) ? !flag(r.disabled) : null;
    const activa = flagConocido(r.active) ? flag(r.active) : null;
    const check = String(r['check-gateway'] || '').toLowerCase();
    return {
      ruta: i + 1,
      tabla: tablas.get(String(r['routing-table'] || r['routing-mark'] || 'main')),
      distancia: Number.isFinite(n) && n >= 0 && n <= 255 ? n : null,
      activa,
      habilitada,
      dinamica: flagConocido(r.dynamic) ? flag(r.dynamic) : null,
      checkGateway: ['ping', 'arp', 'bfd', 'none'].includes(check) ? check : 'desconocido',
      gatewayDefinido: !!r.gateway
    };
  });
  const tablasResumen = [...new Set(rutas.map(r => r.tabla))].map(tabla => {
    const rs = rutas.filter(r => r.tabla === tabla);
    const distancias = rs.filter(r => r.habilitada !== false && r.distancia !== null).map(r => r.distancia);
    const minima = distancias.length ? Math.min(...distancias) : null;
    const candidatos = rs.filter(r => r.habilitada !== false && r.distancia !== null && r.distancia > minima);
    const ecmp = minima !== null && rs.filter(r => r.habilitada !== false && r.distancia === minima).length > 1;
    return {
      tabla,
      rutas: rs.length,
      rutaPreferidaDistancia: minima,
      posiblesRespaldosPorDistancia: candidatos.length,
      ecmpPotencial: ecmp,
      evaluacion: candidatos.length
        ? 'Hay rutas de mayor distancia candidatas a respaldo; que no estén activas puede ser normal. No se ha verificado la conmutación.'
        : 'No se identificaron rutas de mayor distancia habilitadas; no se puede confirmar respaldo.'
    };
  });
  return {
    disponible: true, totalRutasDefault: todas.length, truncado: todas.length > 24,
    rutas, tablasResumen,
    limitaciones: [
      'Activa=false NO equivale a deshabilitada ni prueba que el respaldo esté averiado.',
      'Habilitada indica el estado administrativo; activa indica selección/instalación observada.',
      'Distancias distintas sugieren preferencia, NO demuestran failover funcional.',
      'check-gateway=ping comprueba el gateway configurado, que puede seguir accesible sin Internet.',
      'El failover recursivo requiere inspeccionar rutas de resolución y pruebas externas.',
      'No se verificaron routing rules, mangle, NAT, resolución recursiva ni pruebas de caída.',
      'No se incluyen direcciones de gateways, interfaces, nombres de tablas ni comentarios.'
    ]
  };
}

module.exports = { resumirTelemetria, resumirRutasMikroTik };
