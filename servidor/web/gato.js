'use strict';
/* ======================================================================
   El gato de Atalaya: la mascota. Dibujos SVG propios, animados con CSS.
   Poses: reparando (logo), corriendo (cargando), programando (vacío),
          molesto (tarda mucho), avergonzado (error).
   ====================================================================== */
const GATO_C = { pelo: '#EE8A2E', sombra: '#D2731D', oreja: '#F7B27A', tinta: '#121518', nariz: '#C2552A', rubor: '#F49AA0' };

// Cabeza redonda con orejas; las orejas cambian según el ánimo
function gatoCabeza(cx, cy, orejas = 'arriba') {
  const O = {
    arriba: [[-17, -6, -15, -24, -4, -13], [17, -6, 15, -24, 4, -13]],
    atras: [[-14, -9, -27, -17, -5, -13], [14, -9, 27, -17, 5, -13]],
    caidas: [[-13, -10, -29, 1, -4, -14], [13, -10, 29, 1, 4, -14]]
  }[orejas];
  const tri = t => `M${cx + t[0]} ${cy + t[1]} L${cx + t[2]} ${cy + t[3]} L${cx + t[4]} ${cy + t[5]} Z`;
  const dentro = t => `M${cx + t[0] * .82 + t[2] * .18} ${cy + t[1] * .82 + t[3] * .18} L${cx + t[2] * .78 + t[0] * .11 + t[4] * .11} ${cy + t[3] * .78 + t[1] * .11 + t[5] * .11} L${cx + t[4] * .82 + t[2] * .18} ${cy + t[5] * .82 + t[3] * .18} Z`;
  return `<path d="${tri(O[0])} ${tri(O[1])}" fill="${GATO_C.pelo}" stroke="${GATO_C.pelo}" stroke-width="3" stroke-linejoin="round"/>
    <path d="${dentro(O[0])} ${dentro(O[1])}" fill="${GATO_C.oreja}"/>
    <ellipse cx="${cx}" cy="${cy}" rx="19" ry="15.5" fill="${GATO_C.pelo}"/>
    <path d="M${cx - 1.6} ${cy + 3.6} H${cx + 1.6} L${cx} ${cy + 5.4} Z" fill="${GATO_C.nariz}"/>
    <path d="M${cx - 13} ${cy + 4} h-7 M${cx - 13} ${cy + 7} l-6 2 M${cx + 13} ${cy + 4} h7 M${cx + 13} ${cy + 7} l6 2" stroke="${GATO_C.sombra}" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>`;
}

const GATO_POSES = {
  reparando: () => `
    <g class="g-cola"><path d="M38 86 Q16 88 18 66 Q19 55 29 53" fill="none" stroke="${GATO_C.pelo}" stroke-width="7" stroke-linecap="round"/></g>
    <g class="g-cabeza">${gatoCabeza(63, 39)}
      <g class="g-ojos"><ellipse cx="56.5" cy="37" rx="2.6" ry="3.3" fill="${GATO_C.tinta}"/><ellipse cx="69.5" cy="37" rx="2.6" ry="3.3" fill="${GATO_C.tinta}"/>
        <circle cx="57.4" cy="35.9" r=".9" fill="#fff"/><circle cx="70.4" cy="35.9" r=".9" fill="#fff"/></g>
    </g>
    <rect class="g-caja" x="34" y="47" width="64" height="47" rx="7"/>
    <path class="g-rejilla" d="M44 61 H76 M44 70 H76"/>
    <circle class="g-led" cx="88" cy="85" r="3.6"/>
    <rect class="g-pata1" x="46" y="43" width="12" height="8" rx="4" fill="${GATO_C.pelo}"/>
    <rect class="g-pata2" x="68" y="43" width="12" height="8" rx="4" fill="${GATO_C.pelo}"/>
    <path class="g-chispa" d="M93 50 l1.6 -4.4 l1.6 4.4 l4.4 1.6 l-4.4 1.6 l-1.6 4.4 l-1.6 -4.4 l-4.4 -1.6 z" fill="#FAB219"/>`,

  // Con la tapa de la torre abierta, sentado de perfil y destornillador en mano
  arreglando: () => `
    <rect class="g-caja" x="60" y="12" width="48" height="82" rx="5"/>
    <rect x="65" y="17" width="38" height="72" rx="3" fill="#0d1113"/>
    <rect x="69" y="21" width="30" height="38" rx="2" fill="#24493a"/>
    <rect x="73" y="25" width="10" height="9" rx="1.5" fill="#3b6b56"/><rect x="86" y="25" width="9" height="3.5" rx="1" fill="#c9a34a"/><rect x="86" y="31" width="9" height="3.5" rx="1" fill="#c9a34a"/>
    <path d="M73 41 H95 M73 46 H90 M73 51 H93" stroke="#3b6b56" stroke-width="2" stroke-linecap="round"/>
    <g class="g-ventilador"><circle cx="84" cy="74" r="10" fill="#1d2327"/>
      <path d="M84 74 L84 65 Q89 66 87 72 Z M84 74 L93 74 Q92 79 86 77 Z M84 74 L84 83 Q79 82 81 76 Z M84 74 L75 74 Q76 69 82 71 Z" fill="#4b565e"/>
      <circle cx="84" cy="74" r="2.2" fill="#6b7780"/></g>
    <g class="g-cola"><path d="M30 90 Q8 92 10 72 Q11 63 19 61" fill="none" stroke="${GATO_C.pelo}" stroke-width="7" stroke-linecap="round"/></g>
    <ellipse cx="40" cy="71" rx="16" ry="21" fill="${GATO_C.pelo}"/>
    <path d="M33 56 q-3 6 0 12 M31 66 q-3 6 0 12" fill="none" stroke="${GATO_C.sombra}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="36" cy="83" r="11" fill="${GATO_C.pelo}"/>
    <ellipse cx="47" cy="92.5" rx="7" ry="3.6" fill="${GATO_C.sombra}"/>
    <path d="M45 66 L62 69" stroke="${GATO_C.sombra}" stroke-width="6" stroke-linecap="round"/>
    <g class="g-cabeza-perfil">
      <path d="M39 33 L40 20 L47 29 Z M48 28 L55 18 L57 32 Z" fill="${GATO_C.pelo}" stroke="${GATO_C.pelo}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M41.5 29 L42 23.5 L45 27.5 Z M50.5 27.5 L54 22 L54.6 29.5 Z" fill="${GATO_C.oreja}"/>
      <circle cx="49" cy="40" r="13" fill="${GATO_C.pelo}"/>
      <ellipse cx="57.5" cy="44" rx="5.5" ry="4.4" fill="${GATO_C.pelo}"/>
      <path d="M51.6 37.6 q2.6 -1.8 5.2 0" fill="none" stroke="${GATO_C.tinta}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M61.4 41.6 L63.2 42.6 L61.6 43.9 Z" fill="${GATO_C.nariz}"/>
      <path d="M59.6 47.6 q1.2 2.6 2.6 0.4 Z" fill="${GATO_C.rubor}"/>
      <path d="M57 44.5 h7 M57 46 l6 1.8" stroke="${GATO_C.sombra}" stroke-width="1" stroke-linecap="round" opacity=".7"/>
    </g>
    <g class="g-brazo">
      <path d="M46 58 L65 55" stroke="${GATO_C.pelo}" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M66 54.8 L72.5 53.6" stroke="#5cbfc7" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M72.5 53.6 L81 52" stroke="#aeb7bd" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="65.5" cy="55" r="3.6" fill="${GATO_C.pelo}"/>
    </g>
    <path class="g-chispa" d="M81 48 l1.4 -3.8 l1.4 3.8 l3.8 1.4 l-3.8 1.4 l-1.4 3.8 l-1.4 -3.8 l-3.8 -1.4 z" fill="#FAB219"/>
    <path class="g-chispa g-chispa2" d="M86 55 l1 -2.6 l1 2.6 l2.6 1 l-2.6 1 l-1 2.6 l-1 -2.6 l-2.6 -1 z" fill="#FAB219"/>
    <circle class="g-tornillo" cx="81" cy="54" r="1.6" fill="#aeb7bd"/>`,
  corriendo: () => `
    <g class="g-polvo"><circle cx="22" cy="80" r="3.5"/><circle cx="14" cy="77" r="2.5"/><circle cx="28" cy="83" r="2"/></g>
    <g class="g-cuerpo">
      <g class="g-cola-corre"><path d="M36 54 Q20 50 18 36" fill="none" stroke="${GATO_C.pelo}" stroke-width="6.5" stroke-linecap="round"/></g>
      <path class="g-pata-a" d="M46 60 L42 77" stroke="${GATO_C.sombra}" stroke-width="6" stroke-linecap="round"/>
      <path class="g-pata-b" d="M72 60 L76 77" stroke="${GATO_C.sombra}" stroke-width="6" stroke-linecap="round"/>
      <ellipse cx="58" cy="55" rx="24" ry="12.5" fill="${GATO_C.pelo}"/>
      <path d="M52 44 q2 6 0 12 M60 43 q2 6 0 13" fill="none" stroke="${GATO_C.sombra}" stroke-width="2.4" stroke-linecap="round"/>
      <path class="g-pata-c" d="M50 60 L54 78" stroke="${GATO_C.pelo}" stroke-width="6" stroke-linecap="round"/>
      <path class="g-pata-d" d="M76 59 L71 77" stroke="${GATO_C.pelo}" stroke-width="6" stroke-linecap="round"/>
      <path d="M78 37 L80 23 L88 33 Z M89 33 L96 23 L97 38 Z" fill="${GATO_C.pelo}" stroke="${GATO_C.pelo}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M81 33 L81.6 27 L85 31 Z M92 31 L95 27 L95.4 33 Z" fill="${GATO_C.oreja}"/>
      <circle cx="87" cy="44" r="12" fill="${GATO_C.pelo}"/>
      <circle cx="91.5" cy="42" r="2.3" fill="${GATO_C.tinta}"/><circle cx="92.2" cy="41.3" r=".7" fill="#fff"/>
      <path d="M97.5 46 L99.5 46.5 L98 48 Z" fill="${GATO_C.nariz}"/>
    </g>`,

  programando: () => `
    <g class="g-cola"><path d="M84 88 Q104 86 102 68 Q101 60 95 58" fill="none" stroke="${GATO_C.pelo}" stroke-width="7" stroke-linecap="round"/></g>
    <ellipse cx="60" cy="74" rx="25" ry="20" fill="${GATO_C.pelo}"/>
    <g class="g-cabeza-p">${gatoCabeza(60, 42)}
      <path d="M51 41 q3.3 2.3 6.6 0 M62.4 41 q3.3 2.3 6.6 0" fill="none" stroke="${GATO_C.tinta}" stroke-width="2.3" stroke-linecap="round"/>
    </g>
    <rect class="g-caja" x="35" y="58" width="50" height="29" rx="3.5"/>
    <circle class="g-led" cx="60" cy="72.5" r="2.6"/>
    <path class="g-teclado" d="M28 87 H92 L96 92 H24 Z"/>
    <rect class="g-teclea1" x="40" y="82" width="11" height="7" rx="3.5" fill="${GATO_C.pelo}"/>
    <rect class="g-teclea2" x="69" y="82" width="11" height="7" rx="3.5" fill="${GATO_C.pelo}"/>
    <g class="g-codigo"><rect x="92" y="44" width="12" height="3.4" rx="1.7"/><rect x="96" y="52" width="9" height="3.4" rx="1.7"/><rect x="90" y="36" width="7" height="3.4" rx="1.7"/></g>`,

  molesto: () => `
    <g class="g-cola-golpe"><path d="M82 90 Q104 92 104 74" fill="none" stroke="${GATO_C.pelo}" stroke-width="7" stroke-linecap="round"/></g>
    <ellipse cx="60" cy="77" rx="24" ry="18" fill="${GATO_C.pelo}"/>
    <rect x="47" y="87" width="10" height="7" rx="3.5" fill="${GATO_C.sombra}"/><rect x="63" y="87" width="10" height="7" rx="3.5" fill="${GATO_C.sombra}"/>
    <g class="g-cabeza-m">${gatoCabeza(60, 47, 'atras')}
      <path d="M50 40.5 L57 43 M70 40.5 L63 43" stroke="${GATO_C.tinta}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M51 46.5 H57 M63 46.5 H69" stroke="${GATO_C.tinta}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M57.2 55.5 q2.8 -2 5.6 0" fill="none" stroke="${GATO_C.tinta}" stroke-width="1.8" stroke-linecap="round"/>
    </g>
    <g class="g-globo"><rect x="80" y="6" width="36" height="19" rx="9.5" class="g-globo-f"/><path d="M88 24 L84 31 L94 24 Z" class="g-globo-f"/>
      <text x="98" y="19" text-anchor="middle" class="g-globo-t">mmm…</text></g>`,

  avergonzado: () => `
    <g class="g-cola"><path d="M80 90 Q98 92 96 80" fill="none" stroke="${GATO_C.pelo}" stroke-width="7" stroke-linecap="round"/></g>
    <ellipse cx="60" cy="77" rx="24" ry="18" fill="${GATO_C.pelo}"/>
    <g class="g-cabeza-a">${gatoCabeza(60, 48, 'caidas')}
      <ellipse cx="47.5" cy="52.5" rx="4.2" ry="2.5" fill="${GATO_C.rubor}"/><ellipse cx="72.5" cy="52.5" rx="4.2" ry="2.5" fill="${GATO_C.rubor}"/>
      <path d="M57.8 56.6 q2.2 1.6 4.4 0" fill="none" stroke="${GATO_C.tinta}" stroke-width="1.7" stroke-linecap="round"/>
    </g>
    <g class="g-manos"><rect x="45" y="40" width="14" height="10" rx="5" fill="${GATO_C.pelo}" stroke="${GATO_C.sombra}" stroke-width="1.6"/>
      <rect x="61" y="40" width="14" height="10" rx="5" fill="${GATO_C.pelo}" stroke="${GATO_C.sombra}" stroke-width="1.6"/></g>
    <path class="g-gota" d="M86 28 q-4 6 0 8 q4 -2 0 -8 Z" fill="#7cc4e6"/>`
};

function gatoSVG(pose = 'reparando', etiqueta) {
  const f = GATO_POSES[pose] || GATO_POSES.reparando;
  return `<svg class="gato g-${pose}" viewBox="0 0 120 100" ${etiqueta ? `role="img" aria-label="${etiqueta}"` : 'aria-hidden="true"'}>${f()}</svg>`;
}

// Bloque "cargando": el gato corre; si tarda más de 7 s se pone molesto
function gatoCargando(texto = 'Cargando…', clase = '') {
  return `<div class="gato-carga ${clase}" data-desde="${Date.now()}">${gatoSVG('corriendo')}<span>${texto}</span></div>`;
}
function gatoVacio(titulo, texto, extra = '') {
  return `<div class="hoja vacio gato-vacio">${gatoSVG('programando')}<strong>${titulo}</strong>${texto}${extra}</div>`;
}
function gatoError(texto) {
  return `<div class="gato-error" role="alert">${gatoSVG('avergonzado')}<div class="gato-dice">${texto}</div></div>`;
}
setInterval(() => {
  document.querySelectorAll('.gato-carga:not(.impaciente)').forEach(el => {
    if (Date.now() - Number(el.dataset.desde) > 7000) {
      el.classList.add('impaciente');
      el.querySelector('svg').outerHTML = gatoSVG('molesto');
      el.querySelector('span').textContent = 'Está tardando más de lo normal…';
    }
  });
}, 1000);

// Icono de la pestaña: el gato asomado al servidor, con la luz del color del estado
function gatoFavicon(color) {
  const s = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='14 18 92 80'><path d='M38 86 Q16 88 18 66 Q19 55 29 53' fill='none' stroke='#EE8A2E' stroke-width='8' stroke-linecap='round'/><path d='M44 51 L45 20 L56 32 Q63 29 70 32 L81 20 L82 51 Z' fill='#EE8A2E'/><ellipse cx='56.5' cy='40' rx='3' ry='3.8' fill='#121518'/><ellipse cx='69.5' cy='40' rx='3' ry='3.8' fill='#121518'/><rect x='32' y='47' width='68' height='49' rx='8' fill='#1d2327'/><rect x='46' y='42' width='12' height='9' rx='4.5' fill='#EE8A2E'/><rect x='68' y='42' width='12' height='9' rx='4.5' fill='#EE8A2E'/><circle cx='86' cy='82' r='8' fill='${color}'/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(s);
}
