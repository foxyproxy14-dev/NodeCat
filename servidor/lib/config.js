'use strict';
// Configuración por variables de entorno (docker-compose.yml)
const env = process.env;
module.exports = {
  VERSION: '0.13.0',
  PUERTO: parseInt(env.PUERTO || '8080', 10),
  DATA_DIR: env.DATA_DIR || require('node:path').join(__dirname, '..', 'datos'),
  DEMO: env.NODECAT_DEMO === '1',
  // Detrás de Cloudflare Tunnel o de un proxy inverso: usar la IP real del visitante y saber si llegó por HTTPS
  CONFIAR_PROXY: env.CONFIAR_PROXY === '1',
  TELEGRAM_API: (env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, ''),
  ZONA_HORARIA: env.TZ || 'America/Caracas'
};
