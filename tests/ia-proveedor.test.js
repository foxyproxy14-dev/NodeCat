'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const https=require('node:https');
const {EventEmitter}=require('node:events');
const {consultar}=require('../servidor/lib/cliente-ia');
let secuencia=0;
function entorno(t,proveedor='openrouter') {
 const variables={IA_PROVIDER:proveedor,OPENROUTER_API_KEY:'or-test-secret',OPENAI_API_KEY:'oa-test-secret',OPENAI_MODEL:'modelo-prueba'};
 for(const [k,v] of Object.entries(variables)) {
  const anterior=process.env[k];process.env[k]=v;
  t.after(()=>{if(anterior===undefined) delete process.env[k]; else process.env[k]=anterior;});
 }
}
function simular(t,{status=200,cuerpo,modo}={}) {
 const llamadas=[];
 t.mock.method(https,'request',(url,opciones,callback)=>{
  const req=new EventEmitter();
  req.destroy=err=>{req.emit('error',err);req.emit('close');};
  req.end=datos=>{
   llamadas.push({url,opciones,cuerpo:JSON.parse(datos)});
   process.nextTick(()=>{
    if(modo==='timeout') {req.emit('timeout');return;}
    if(modo==='network') {req.destroy(Object.assign(Error('SECRET error'),{code:'ECONNRESET'}));return;}
    const res=new EventEmitter();res.statusCode=status;res.setEncoding=()=>{};
    callback(res);
    if(modo==='aborted') res.emit('aborted');
    else {
     res.emit('data',cuerpo??JSON.stringify({model:'modelo-servido',choices:[{message:{content:'| Regla | Acción |\n| --- | --- |\n| 1 | drop |'},finish_reason:'stop'}]}));
     res.emit('end');
    }
    req.emit('close');
   });
  };
  return req;
 });
 return llamadas;
}
const consulta=extra=>({usuario:'prueba-'+(++secuencia),equipo:{tipo:'mikrotik',nombre:'NO-ENVIAR'},pregunta:'Revisa 192.0.2.1 token=NOENVIAR y el firewall',contexto:{cpu:3,password:'NOENVIAR'},...extra});
for(const proveedor of ['openrouter','openai']) test('contrato HTTP '+proveedor+' y anonimización antes del envío',async t=>{
 entorno(t,proveedor);const llamadas=simular(t);
 const r=await consultar(consulta());
 assert.equal(r.proveedor,proveedor);assert.equal(r.modo,'solo-lectura');
 const c=llamadas[0];assert.equal(llamadas.length,1);
 assert.equal(new URL(c.url).host,proveedor==='openai'?'api.openai.com':'openrouter.ai');
 assert.equal(c.opciones.method,'POST');assert.ok(c.opciones.headers.Authorization.startsWith('Bearer '));
 assert.ok(c.cuerpo[proveedor==='openai'?'max_completion_tokens':'max_tokens']);
 assert.equal(c.cuerpo.tools,undefined);assert.equal(c.cuerpo.messages.length,2);
 assert.match(c.cuerpo.messages[0].content,/INPUT.*FORWARD/);
 assert.doesNotMatch(c.cuerpo.messages[1].content,/192\.0|NOENVIAR|NO-ENVIAR|password/);
 assert.equal(Number(c.opciones.headers['Content-Length']),Buffer.byteLength(JSON.stringify(c.cuerpo)));
});
for(const status of [401,402,403,429,500]) test('HTTP '+status+' no reintenta ni cambia de proveedor',async t=>{
 entorno(t);const llamadas=simular(t,{status,cuerpo:'SECRETO proveedor'});
 await assert.rejects(consultar(consulta()),err=>err.status===(status===429?429:502)&&!err.message.includes('SECRETO'));
 assert.equal(llamadas.length,1);
});
for(const modo of ['timeout','network','aborted']) test('transporte '+modo+' termina con error controlado',async t=>{
 entorno(t);simular(t,{modo});const logs=[];t.mock.method(console,'error',(...a)=>logs.push(a));
 await assert.rejects(consultar(consulta()),e=>e.status===(modo==='timeout'?504:502));
 assert.doesNotMatch(JSON.stringify(logs),/SECRET|secret|192\.0|NOENVIAR/);
});
for(const cuerpo of ['no-json','{}',JSON.stringify({choices:[{message:{content:''}}]})]) test('respuesta inválida se rechaza '+cuerpo,async t=>{
 entorno(t);simular(t,{cuerpo});await assert.rejects(consultar(consulta()),e=>e.status===502);
});
test('truncamiento y límite local de respuesta',async t=>{
 entorno(t);simular(t,{cuerpo:JSON.stringify({choices:[{message:{content:'a'.repeat(13000)},finish_reason:'length'}]})});
 const r=await consultar(consulta());assert.equal(r.truncada,true);assert.equal(r.respuesta.length,12000);
});
test('validación y límite por usuario antes de emitir otra petición',async t=>{
 entorno(t);const llamadas=simular(t);const q=consulta();
 await consultar(q);assert.throws(()=>consultar(q),e=>e.status===429);
 assert.throws(()=>consultar(consulta({pregunta:'corta'})),e=>e.status===400);
 assert.equal(llamadas.length,1);
});
