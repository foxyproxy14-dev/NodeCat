'use strict';
const PROVEEDORES = Object.freeze({
  openrouter: { url:'https://openrouter.ai/api/v1/chat/completions', variableClave:'OPENROUTER_API_KEY', variableModelo:'OPENROUTER_MODEL', modelo:'openrouter/free' },
  openai: { url:'https://api.openai.com/v1/chat/completions', variableClave:'OPENAI_API_KEY', variableModelo:'OPENAI_MODEL' }
});
function configuracion(env=process.env) {
  const proveedor=env.IA_PROVIDER || 'openrouter';
  if (!Object.hasOwn(PROVEEDORES,proveedor)) throw Object.assign(new Error('IA_PROVIDER debe ser openrouter u openai.'),{status:503});
  const p=PROVEEDORES[proveedor];
  const modelo=env[p.variableModelo] || p.modelo;
  if (!modelo || modelo.length>200 || !/^[a-zA-Z0-9._:/-]+$/.test(modelo))
    throw Object.assign(new Error('Configura un modelo válido en '+p.variableModelo+'.'),{status:503});
  function entero(nombre,def,min,max) {
    const n=env[nombre]===undefined?def:Number(env[nombre]);
    if (!Number.isInteger(n)||n<min||n>max) throw Object.assign(new Error('Valor inválido para '+nombre+'.'),{status:503});
    return n;
  }
  return {...p,proveedor,modelo,clave:env[p.variableClave],esperaMs:entero('IA_TIMEOUT_MS',90000,1000,120000),maxTokens:entero('IA_MAX_TOKENS',2400,256,8000)};
}
module.exports={configuracion};
