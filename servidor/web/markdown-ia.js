'use strict';
// Deliberately small Markdown subset. All source is escaped; no raw HTML,
// images, links, attributes or provider-supplied classes enter the DOM.
(function(root) {
  const escapar = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function inline(s) {
    return String(s).split(/(`[^`\n]*`)/g).map((p,i)=>i%2
      ? '<code>'+escapar(p.slice(1,-1))+'</code>'
      : escapar(p).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')).join('');
  }
  function celdas(s) {
    s=s.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'');
    const a=[]; let celda='',codigo=false;
    for(let i=0;i<s.length;i++) {
      if(s[i]==='\\'&&s[i+1]==='|') {celda+='|';i++;continue;}
      if(s[i]==='`') codigo=!codigo;
      if(s[i]==='|'&&!codigo) {a.push(celda.trim());celda='';} else celda+=s[i];
    }
    a.push(celda.trim());return a;
  }
  function renderizar(texto) {
    const lineas=String(texto??'').slice(0,12000).replace(/\r\n?/g,'\n').split('\n');
    const html=[];
    for(let i=0;i<lineas.length;i++) {
      const l=lineas[i];
      if(/^\s*```/.test(l)) {
        const bloque=[];
        while(++i<lineas.length&&!/^\s*```/.test(lineas[i])) bloque.push(lineas[i]);
        html.push('<pre><code>'+escapar(bloque.join('\n'))+'</code></pre>');continue;
      }
      const cab=celdas(l), sep=i+1<lineas.length?celdas(lineas[i+1]):[];
      if(l.includes('|')&&cab.length<=16&&sep.length===cab.length&&sep.every(c=>/^:?-{3,}:?$/.test(c))) {
        html.push('<div class="ncai-tabla"><table><thead><tr>'+cab.map(c=>'<th scope="col">'+inline(c)+'</th>').join('')+'</tr></thead><tbody>');
        i++;
        while(i+1<lineas.length&&lineas[i+1].includes('|')&&lineas[i+1].trim()) {
          const fila=celdas(lineas[++i]);
          // A malformed row stays visible as text, rather than silently losing cells.
          if(fila.length!==cab.length) {i--;break;}
          html.push('<tr>'+fila.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>');
        }
        html.push('</tbody></table></div>');continue;
      }
      const titulo=l.match(/^#{1,3}\s+(.+)$/);
      if(titulo) html.push('<h4>'+inline(titulo[1])+'</h4>');
      else if(/^\s*[-*]\s+/.test(l)) {
        const lista=[l.replace(/^\s*[-*]\s+/,'')];
        while(i+1<lineas.length&&/^\s*[-*]\s+/.test(lineas[i+1])) lista.push(lineas[++i].replace(/^\s*[-*]\s+/,''));
        html.push('<ul>'+lista.map(x=>'<li>'+inline(x)+'</li>').join('')+'</ul>');
      } else if(l.trim()) html.push('<p>'+inline(l)+'</p>');
    }
    return html.join('');
  }
  if(typeof module==='object'&&module.exports) module.exports={renderizar,celdas};
  else root.NodeCatMarkdown={renderizar};
})(typeof globalThis!=='undefined'?globalThis:this);
