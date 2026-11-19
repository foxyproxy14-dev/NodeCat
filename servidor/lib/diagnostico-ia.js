'use strict';

// Diagnóstico determinista de rutas MikroTik RouterOS 7.
// Solo analiza snapshots; no abre conexiones ni ejecuta comandos.
// Las rutas inactivas se excluyen de la selección de salida.

const activo = r => r && r.disabled !== true && r.disabled !== 'true' &&
  r.active !== false && r.active !== 'false' && r.inactive !== true &&
  r.inactive !== 'true';

const distancia = r => {
  const n = Number(r.distance);
  return Number.isFinite(n) ? n : Infinity;
};

function diagnosticarFailover(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.routes)) {
    throw new TypeError('Se requiere un snapshot con routes[]');
  }
  const tablas = [...new Set(snapshot.routes.map(r => r['routing-table'] || r.routingTable || 'main'))];
  const resultados = tablas.map(tabla => {
    const rutas = snapshot.routes.filter(r =>
      (r['routing-table'] || r.routingTable || 'main') === tabla &&
      (r['dst-address'] || r.dstAddress) === '0.0.0.0/0');
    const disponibles = rutas.filter(activo).sort((a, b) => distancia(a) - distancia(b));
    const primaria = disponibles[0] || null;
    const respaldo = disponibles.find(r => distancia(r) > distancia(primaria)) || null;
    const alertas = [];
    if (!rutas.length) alertas.push('No hay ruta predeterminada en esta tabla.');
    else if (!primaria) alertas.push('No hay ruta predeterminada activa.');
    if (primaria && !respaldo) alertas.push('No se observa una ruta de respaldo activa con mayor distancia.');
    if (rutas.some(r => r['check-gateway'] === 'ping' &&
      !snapshot.recursiveProbesVerified)) {
      alertas.push('check-gateway=ping no demuestra por sí solo conectividad a Internet; verificar sondas recursivas.');
    }
    if (disponibles.length > 1 && distancia(disponibles[0]) === distancia(disponibles[1])) {
      alertas.push('Hay rutas predeterminadas activas con igual distancia; puede existir ECMP.');
    }
    return {
      tabla,
      totalRutasDefault: rutas.length,
      principal: primaria ? {
        gateway: primaria.gateway || null,
        distance: distancia(primaria),
        comment: primaria.comment || ''
      } : null,
      respaldo: respaldo ? {
        gateway: respaldo.gateway || null,
        distance: distancia(respaldo),
        comment: respaldo.comment || ''
      } : null,
      alertas
    };
  });
  return {
    modo: 'solo-lectura',
    diagnostico: 'orientativo',
    tablas: resultados,
    advertencias: [
      'La ausencia de rutas activas puede ser transitoria; contrastar con estado WAN y DHCP.',
      'La selección efectiva también depende de routing rules, mangle, scope/target-scope y resolución recursiva.',
      'No se ejecutó ningún ping ni prueba real de failover.'
    ]
  };
}

module.exports = { diagnosticarFailover };
