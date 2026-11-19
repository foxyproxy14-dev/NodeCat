'use strict';
/* NodeCat AI: widget flotante; reutiliza la API autenticada de solo lectura. */
(() => {
  const root = document.getElementById('nodecatAiWidget');
  if (!root) return;
  let abierto = false, ocupado = false, equipoActual = '', historial = [], usuarioActual = null, solicitud = 0;
  // Reutilizar exactamente el SVG original de la mascota de NodeCat.
  if (typeof gatoSVG === 'function') {
    root.querySelector('.ncai-avatar').innerHTML = gatoSVG('asomando');
    root.querySelector('.ncai-toggle-gato').innerHTML = gatoSVG('asomando');
  }
  const boton = root.querySelector('#ncaiToggle');
  const panel = root.querySelector('#ncaiPanel');
  const cerrar = root.querySelector('#ncaiCerrar');
  const nuevo = root.querySelector('#ncaiNuevo');
  const selector = root.querySelector('#ncaiEquipo');
  const mensajes = root.querySelector('#ncaiMensajes');
  const formulario = root.querySelector('#ncaiForm');
  const pregunta = root.querySelector('#ncaiPregunta');
  const enviarBtn = root.querySelector('#ncaiEnviar');
  const estadoTxt = root.querySelector('#ncaiEstado');
  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const format = s => escapeHtml(s).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  const routers = () => typeof equipos === 'function'
    ? equipos().filter(e => e.tipo === 'mikrotik' || e.tipo === 'fortigate') : [];
  const conectado = () => typeof SESION !== 'undefined' && !!SESION;
  function reiniciar() {
    historial = []; mensajes.innerHTML = '';
    agregar('bot', '¡Hola! Soy NodeCat AI. Selecciona un dispositivo y dime qué necesitas analizar.');
    estadoTxt.textContent = 'Solo lectura · Las respuestas pueden contener errores.';
  }
  function agregar(rol, contenido) {
    const item = document.createElement('div');
    item.className = 'ncai-mensaje ncai-' + rol;
    item.innerHTML = format(contenido);
    mensajes.appendChild(item);
    mensajes.scrollTop = mensajes.scrollHeight;
  }
  function contextoRuta() {
    if (typeof rutaActual !== 'function') return '';
    const r = rutaActual();
    if (r.vista !== 'equipo') return '';
    const id = String(r.id);
    return routers().some(e => String(e.id) === id) ? id : '';
  }
  function refrescarEquipos(preferirRuta = false) {
    if (!conectado()) return;
    const lista = routers(), disponibles = new Set(lista.map(e => String(e.id)));
    const deRuta = contextoRuta();
    const seleccionado = preferirRuta && deRuta ? deRuta
      : disponibles.has(equipoActual) ? equipoActual : deRuta || (lista[0] ? String(lista[0].id) : '');
    selector.innerHTML = '<option value="">Selecciona un dispositivo</option>' + lista.map(e =>
      '<option value="' + escapeHtml(e.id) + '">' + escapeHtml((e.clienteNombre || '') + ' · ' +
        (typeof nombreEq === 'function' ? nombreEq(e) : e.nombre || e.alias || e.tipo)) + '</option>').join('');
    selector.value = seleccionado;
    if (equipoActual !== seleccionado) { equipoActual = seleccionado; reiniciar(); }
    enviarBtn.disabled = ocupado || !equipoActual;
  }
  function mostrar(valor) {
    abierto = valor;
    panel.hidden = !valor;
    boton.setAttribute('aria-expanded', String(valor));
    boton.setAttribute('aria-label', valor ? 'Cerrar NodeCat AI' : 'Abrir NodeCat AI');
    if (valor) { refrescarEquipos(true); pregunta.focus(); }
    else boton.focus();
  }
  boton.addEventListener('click', () => mostrar(!abierto));
  cerrar.addEventListener('click', () => mostrar(false));
  nuevo.addEventListener('click', () => { reiniciar(); pregunta.focus(); });
  selector.addEventListener('change', () => {
    equipoActual = selector.value;
    reiniciar();
    enviarBtn.disabled = ocupado || !equipoActual;
  });
  window.addEventListener('hashchange', () => {
    if (abierto && !ocupado) refrescarEquipos(true);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && abierto) mostrar(false);
  });
  // No guardar conversaciones ni respuestas en almacenamiento local.
  // El historial se adjunta resumido a la pregunta para permitir seguimientos sin cambiar el backend.
  formulario.addEventListener('submit', async e => {
    e.preventDefault();
    if (ocupado || !conectado() || !equipoActual) return;
    const texto = pregunta.value.trim();
    if (texto.length < 10 || texto.length > 2000) {
      estadoTxt.textContent = 'Escribe una pregunta de entre 10 y 2000 caracteres.'; return;
    }
    const usuario = SESION.usuario, id = equipoActual, turno = ++solicitud;
    const previo = historial.slice(-4).map(m => (m.rol === 'usuario' ? 'Usuario: ' : 'Asistente: ') +
      m.texto.slice(0, 260)).join('\n');
    let preguntaApi = texto;
    if (previo) {
      const prefijo = 'Contexto conversacional previo (no son métricas verificadas):\n';
      const espacio = 2000 - texto.length - prefijo.length - 24;
      if (espacio > 80) preguntaApi = prefijo + previo.slice(-Math.min(espacio, 1100)) +
        '\nPregunta actual:\n' + texto;
    }
    ocupado = true; enviarBtn.disabled = true; selector.disabled = true;
    pregunta.value = '';
    agregar('usuario', texto);
    estadoTxt.textContent = 'Consultando OpenRouter…';
    try {
      const respuesta = await enviar('/api/ia/analizar', 'POST', { equipoId: id, pregunta: preguntaApi });
      if (!conectado() || SESION.usuario !== usuario || equipoActual !== id || turno !== solicitud) return;
      const salida = String(respuesta.respuesta || 'Sin respuesta del proveedor.');
      agregar('bot', salida);
      historial.push({ rol: 'usuario', texto }, { rol: 'bot', texto: salida });
      historial = historial.slice(-6);
      estadoTxt.textContent = 'Modelo: ' + (respuesta.modelo || 'gratuito') +
        (respuesta.truncada ? ' · Respuesta truncada por límite de tokens.' : ' · Solo lectura.');
    } catch (err) {
      if (conectado() && SESION.usuario === usuario && turno === solicitud) {
        agregar('bot', 'No pude completar la consulta: ' + (err.message || 'Error de conexión.'));
        estadoTxt.textContent = 'La consulta no se completó.';
      }
    } finally {
      ocupado = false; selector.disabled = false;
      if (conectado() && SESION.usuario === usuario) enviarBtn.disabled = !equipoActual;
    }
  });
  // El panel permanece oculto cuando no existe sesión.
  // Al cambiar de cuenta, se borra el historial en memoria.
  document.addEventListener('click', () => {
    const usuario = conectado() ? SESION.usuario : null;
    if (usuario !== usuarioActual) {
      usuarioActual = usuario; equipoActual = ''; solicitud++;
      reiniciar();
      if (abierto) mostrar(false);
    }
  }, true);
  reiniciar();
})();
