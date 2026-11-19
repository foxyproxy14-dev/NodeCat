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
module.exports = { resumirTelemetria };
