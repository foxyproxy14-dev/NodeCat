'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const firewall=require('../servidor/lib/firewall-ia');
const {crearAnonimizador}=require('../servidor/lib/privacidad-ia');
const {configuracion}=require('../servidor/lib/proveedor-ia');
const {renderizar,celdas}=require('../servidor/web/markdown-ia');

test('filter conserva orden, negación, estados y condiciones conjuntas',()=>{
 const anon=crearAnonimizador();
 const x=firewall.resumirCategoria('filter',[
  {chain:'input',action:'accept',disabled:'true',protocol:'tcp','src-address':'!10.0.0.0/24','in-interface-list':'!WAN','src-port':'100-200','dst-port':'22,443','connection-state':'new','connection-nat-state':'!dstnat'},
  {chain:'forward',action:'drop',disabled:false,'out-interface':'ether-secret','tcp-flags':'syn,!ack'},
  {chain:'forward',action:'jump','jump-target':'CUSTOM-PRIVATE'},
  {chain:'CUSTOM-PRIVATE',action:'return'}
 ],35,anon);
 assert.deepEqual(x.reglas.map(r=>r.orden),[1,2,3,4]);
 assert.equal(x.reglas[0].deshabilitada,true);
 assert.equal(x.reglas[2].deshabilitada,null);
 assert.match(x.reglas[0].condiciones['src-address'],/^!direccion-\d+\/24$/);
 assert.match(x.reglas[0].condiciones['in-interface-list'],/^!grupoInterfaz-/);
 assert.equal(x.reglas[0].condiciones['connection-nat-state'],'!dstnat');
 assert.equal(x.reglas[0].condiciones['src-port'],'100-200');
 assert.equal(x.reglas[2].condiciones['jump-target'],x.reglas[3].cadena);
 assert.match(x.reglas[0].alcance,/propio router/);
 assert.match(x.reglas[1].alcance,/atraviesa/);
 assert.doesNotMatch(JSON.stringify(x),/10\.0|WAN|ether-secret|CUSTOM-PRIVATE/);
});
test('NAT, mangle y listas comparten alias y conservan parámetros',()=>{
 const a=crearAnonimizador();
 const n=firewall.resumirCategoria('nat',[{chain:'dstnat',action:'dst-nat','to-addresses':'10.1.2.3','to-ports':'8443','src-address-list':'clientes','dst-port':'443'}],35,a);
 const m=firewall.resumirCategoria('mangle',[{chain:'prerouting',action:'mark-routing','src-address-list':'clientes','connection-mark':'conexion','new-routing-mark':'ISP-private',passthrough:'no','per-connection-classifier':'both-addresses:2/0'}],35,a);
 const l=firewall.resumirCategoria('listas',[{list:'clientes',address:'10.1.2.3'}],35,a);
 assert.equal(n.reglas[0].condiciones['src-address-list'],m.reglas[0].condiciones['src-address-list']);
 assert.equal(l.reglas[0].condiciones.list,n.reglas[0].condiciones['src-address-list']);
 assert.equal(l.reglas[0].condiciones.address,n.reglas[0].condiciones['to-addresses']);
 assert.equal(m.reglas[0].condiciones.passthrough,'no');
 assert.equal(n.reglas[0].condiciones['to-ports'],'8443');
 assert.doesNotMatch(JSON.stringify([n,m,l]),/clientes|10\.1|ISP-private|conexion/);
});
test('consulta todas las categorías solicitadas, con fallo y truncamiento explícitos',async()=>{
 const llamadas=[];
 const x=await firewall.obtener({seccion:async(id,s)=>{
  llamadas.push(s);if(s==='ia-mangle')throw Error('no disponible');
  return Array.from({length:60},()=>({chain:'input',action:'drop'}));
 }},1,'Analiza el firewall completo');
 assert.deepEqual(llamadas,['ia-filter','ia-nat','ia-mangle','ia-listas']);
 assert.equal(x.categorias.filter.totalRecibido,60);
 assert.equal(x.categorias.filter.truncado,true);
 assert.equal(x.categorias.mangle.disponible,false);
 assert.ok(x.categorias.listas);
 assert.deepEqual(firewall.detectar('Compara filter NAT y mangle'),['filter','nat','mangle']);
});
test('nunca reconstruye reglas desde detalles incompletos ni oculta campos desconocidos',()=>{
 const x=firewall.resumirCategoria('filter',[{cadena:'input',detalle:'tcp'}, {chain:'forward',action:'accept','future-sensitive-key':'SECRET'}]);
 assert.equal(x.reglas[0].completa,false);
 assert.equal(x.reglas[1].completa,false);
 assert.equal(x.reglas[1].camposNoInterpretados.length,1);
 assert.doesNotMatch(JSON.stringify(x),/SECRET|future-sensitive/);
});
test('privacidad de pregunta y contexto, IPv4 IPv6 MAC correo URL y credenciales',()=>{
 const a=crearAnonimizador();a.alias('interfaz','ether-cliente');
 const s=a.texto('Revisa ether-cliente 192.0.2.1 2001:db8::1 ::ffff:192.0.2.8 00:11:22:33:44:55 usuario@example.com https://secret.example/x token=SECRETO sk-abc123');
 assert.doesNotMatch(s,/ether-cliente|192\.0|2001:|00:11|usuario@|secret.example|SECRETO|sk-abc/);
 assert.deepEqual(a.objeto({password:'x',comment:'x',cpu:4}),{cpu:4});
 assert.equal(a.alias('interfaz','ether-cliente'),'interfaz-1');
 assert.equal(crearAnonimizador().alias('interfaz','otra'),'interfaz-1');
});
test('proveedores configurables, sin fallback ni endpoints arbitrarios',()=>{
 assert.equal(configuracion({}).proveedor,'openrouter');
 const c=configuracion({IA_PROVIDER:'openai',OPENAI_MODEL:'modelo-prueba',OPENAI_API_KEY:'key',IA_MAX_TOKENS:'3000'});
 assert.equal(c.url,'https://api.openai.com/v1/chat/completions');assert.equal(c.clave,'key');assert.equal(c.maxTokens,3000);
 assert.throws(()=>configuracion({IA_PROVIDER:'otro'}));
 assert.throws(()=>configuracion({IA_PROVIDER:'openai'}),/OPENAI_MODEL/);
 assert.throws(()=>configuracion({IA_TIMEOUT_MS:'NaN'}));
});
test('conserva rangos de dirección y semántica de no-mark',()=>{
 const a=crearAnonimizador();
 assert.equal(a.referencia('marcaConexion','!no-mark'),'!no-mark');
 assert.match(a.referencia('direccion','!10.0.0.1-10.0.0.9'),/^!direccion-1\.\.direccion-2$/);
 assert.equal(a.referencia('direccion','10.0.0.1/32'),'direccion-1/32');
});
test('Markdown: tablas, escapes, bloques de código y ausencia de HTML activo',()=>{
 const h=renderizar('| Regla | Acción |\n| --- | --- |\n| **INPUT** | `<img src=x onerror=alert(1)>` |\n\n```html\n<script>alert(1)</script>\n```\n[javascript](javascript:alert(1))');
 assert.match(h,/<table>/);assert.match(h,/<strong>INPUT<\/strong>/);
 assert.match(h,/&lt;img/);assert.match(h,/&lt;script/);
 assert.doesNotMatch(h,/<script|<img|<a\b|href=|onerror="/);
 assert.deepEqual(celdas('| a\\|b | `c|d` |'),['a|b','`c|d`']);
 assert.doesNotMatch(renderizar('```\n**bold** <svg/onload=alert(1)>'),/<strong>|<svg/);
});
test('solo lecturas fijas de RouterOS y carga segura del renderer',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../servidor/lib/mikrotik.js'),'utf8');
 for(const tipo of ['filter','nat','mangle','listas'])
  assert.match(s,new RegExp("'ia-"+tipo+"': con => con.imprimir\\('/ip/firewall/[^']+/print'\\)"));
 const html=fs.readFileSync(path.join(__dirname,'../servidor/web/index.html'),'utf8');
 assert.ok(html.indexOf('markdown-ia.js')<html.indexOf('chat-ia.js'));
});
