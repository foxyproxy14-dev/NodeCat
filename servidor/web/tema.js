// Aplica el tema guardado antes de pintar, para que no parpadee
try { const t = JSON.parse(localStorage.getItem('atalaya.tema')); if (t) document.documentElement.dataset.tema = t; } catch (e) { }
