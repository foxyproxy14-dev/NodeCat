'use strict';
// Cifrado de secretos en reposo (token de Telegram, contraseñas de los routers) con AES-256-GCM.
// La llave vive en DATA_DIR/secreto.key: sin ella no se pueden leer.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const archivoSecreto = path.join(config.DATA_DIR, 'secreto.key');
let secreto;
function llave() {
  if (secreto) return secreto;
  try { secreto = Buffer.from(fs.readFileSync(archivoSecreto, 'utf8').trim(), 'hex'); } catch { }
  if (!secreto || secreto.length !== 32) {
    secreto = crypto.randomBytes(32);
    fs.writeFileSync(archivoSecreto, secreto.toString('hex'), { mode: 0o600 });
  }
  return secreto;
}
function cifrar(t) {
  if (!t) return '';
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const d = Buffer.concat([c.update(t, 'utf8'), c.final()]);
  return 'gcm:' + Buffer.concat([iv, c.getAuthTag(), d]).toString('base64');
}
function descifrar(t) {
  if (!t || !t.startsWith('gcm:')) return '';
  try {
    const b = Buffer.from(t.slice(4), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', llave(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}

module.exports = { cifrar, descifrar };
