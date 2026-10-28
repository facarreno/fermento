// Fermento · motor de la alpha. Sin dependencias ni build: este módulo se sirve tal cual.
// Contenido: data/contenido.json (lo genera tools/construir.py). Progreso: localStorage del teléfono.

const CLAVE = 'fermento.v1';
const ORDEN = { basico: 0, intermedio: 1, dificil: 2 };
const NOMBRE_NIVEL = { basico: 'Básico', intermedio: 'Intermedio', dificil: 'Difícil' };
const XP_BASE = { basico: 10, intermedio: 20, dificil: 30 };
const XP_LECTURA = 15;
const XP_INTENTO = 2;            // por responder mal: el esfuerzo también cuenta
const META_DIARIA = 60;
const UMBRAL_DESBLOQUEO = 0.6;   // fracción del nivel anterior acertada al menos una vez
const DIAS_CONSOLIDADA = 7;      // intervalo desde el que una tarjeta cuenta como consolidada
const RANGOS = ['Mosto', 'Inóculo', 'Fase lag', 'Fase exponencial', 'Burbujeo', 'Espuma',
  'Fermento vivo', 'Masa madre', 'Cultivo madre', 'Maestro fermentador'];

let D = null;     // contenido
let E = null;     // estado persistente
let S = null;     // sesión en curso
let vista = 'inicio';
const $app = document.getElementById('app');

// =============================================================== utilidades
const fecha = d => d.toLocaleDateString('sv-SE');                 // YYYY-MM-DD local
const hoy = () => fecha(new Date());
const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + n); return fecha(d); };
const num = x => Number(x).toLocaleString('es-CL', { maximumFractionDigits: 3 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const barajar = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function toast(txt) {
  const t = document.getElementById('toast');
  t.textContent = txt; t.classList.add('ver');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('ver'), 2600);
}
function flotarXP(x) {
  if (!x) return;
  const el = document.createElement('div');
  el.className = 'xp-flota'; el.textContent = `+${x} XP`;
  document.body.append(el); setTimeout(() => el.remove(), 1000);
}
const vibrar = p => { try { navigator.vibrate?.(p); } catch { /* sin vibración */ } };

// =============================================================== estado
function nuevoEstado() {
  return { xp: 0, racha: { dias: 0, ultimo: null }, tarjetas: {}, lecturas: {}, diario: {}, notas: [],
    ajustes: { porSesion: 10, nuevas: 4, todo: false } };
}
function cargarEstado() {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE));
    if (s && typeof s === 'object') return { ...nuevoEstado(), ...s, ajustes: { ...nuevoEstado().ajustes, ...s.ajustes } };
  } catch { /* almacenamiento bloqueado o corrupto: se parte de cero */ }
  return nuevoEstado();
}
function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify(E)); } catch { /* modo privado */ } }

// niveles del jugador: el nivel n empieza en 50·n·(n−1) XP
const xpDeNivel = n => 50 * n * (n - 1);
function nivelJugador(xp = E.xp) {
  let n = 1; while (xp >= xpDeNivel(n + 1)) n++;
  const desde = xpDeNivel(n), hasta = xpDeNivel(n + 1);
  return { n, rango: RANGOS[Math.min(n - 1, RANGOS.length - 1)], avance: (xp - desde) / (hasta - desde), falta: hasta - xp };
}
function sumarXP(x) {
  if (!x) return;
  const antes = nivelJugador().n;
  E.xp += x;
  const d = E.diario[hoy()] ??= { xp: 0, resp: 0, ok: 0 };
  d.xp += x;
  const ahora = nivelJugador();
  if (ahora.n > antes) setTimeout(() => toast(`¡Nivel ${ahora.n} · ${ahora.rango}!`), 600);
}
function marcarRacha() {
  const t = hoy();
  if (E.racha.ultimo === t) return;
  E.racha.dias = E.racha.ultimo === sumarDias(t, -1) ? E.racha.dias + 1 : 1;
  E.racha.ultimo = t;
}
function rachaVigente() {
  const u = E.racha.ultimo;
  return u === hoy() || u === sumarDias(hoy(), -1) ? E.racha.dias : 0;
}

// =============================================================== repaso espaciado (SM-2 simplificado, en días)
// calidad: 5 perfecta · 4 correcta · 3 justa · <3 fallo
function repasar(id, calidad) {
  const t = E.tarjetas[id] ??= { rep: 0, int: 0, ease: 2.5, due: hoy(), lapsos: 0, vistas: 0, aciertos: 0 };
  t.vistas++;
  t.ultima = hoy();
  if (calidad < 3) {
    t.rep = 0; t.int = 0; t.lapsos++;
    t.ease = Math.max(1.3, t.ease - 0.2);
    t.due = hoy();                                   // vuelve hoy mismo (y al final de la sesión)
  } else {
    t.aciertos++;
    t.rep++;
    t.int = t.rep === 1 ? 1 : t.rep === 2 ? 3 : Math.round(t.int * t.ease);
    t.ease = Math.max(1.3, t.ease + 0.1 - (5 - calidad) * (0.08 + (5 - calidad) * 0.02));
    t.due = sumarDias(hoy(), t.int);
  }
  const d = E.diario[hoy()] ??= { xp: 0, resp: 0, ok: 0 };
  d.resp++; if (calidad >= 3) d.ok++;
}

// =============================================================== contenido disponible
function preguntas() {
  const lista = D.items.map(p => ({ ...p, origen: 'item' }));
  for (const l of D.lecturas) {
    if (!E.lecturas[l.id]) continue;
    for (const p of l.preguntas) lista.push({ ...p, origen: 'lectura', lectura: l.id });
  }
  return lista;
}
function desbloqueado(modulo, nivel) {
  if (E.ajustes.todo || nivel === 'basico') return true;
  const previo = nivel === 'intermedio' ? 'basico' : 'intermedio';
  const delPrevio = D.items.filter(i => i.modulo === modulo && i.nivel === previo);
  if (!delPrevio.length) return true;
  const ok = delPrevio.filter(i => (E.tarjetas[i.id]?.aciertos || 0) > 0).length;
  return ok / delPrevio.length >= UMBRAL_DESBLOQUEO && desbloqueado(modulo, previo);
}
function avanceDesbloqueo(modulo, nivel) {
  const previo = nivel === 'intermedio' ? 'basico' : 'intermedio';
  const del = D.items.filter(i => i.modulo === modulo && i.nivel === previo);
  const ok = del.filter(i => (E.tarjetas[i.id]?.aciertos || 0) > 0).length;
  return { ok, necesita: Math.ceil(del.length * UMBRAL_DESBLOQUEO) };
}

// Una sesión: primero lo vencido (más atrasado primero), luego nuevas de niveles desbloqueados.
function armarSesion({ filtro = null, libre = false } = {}) {
  const pool = preguntas().filter(p => !filtro || filtro(p));
  const t = hoy(), n = E.ajustes.porSesion;
  const vistas = pool.filter(p => E.tarjetas[p.id]);
  const vencidas = vistas.filter(p => E.tarjetas[p.id].due <= t)
    .sort((a, b) => E.tarjetas[a.id].due.localeCompare(E.tarjetas[b.id].due));
  const nuevas = pool.filter(p => !E.tarjetas[p.id] && (filtro || p.origen === 'lectura' || desbloqueado(p.modulo, p.nivel)))
    .sort((a, b) => (a.origen === 'lectura' ? 0 : 1) - (b.origen === 'lectura' ? 0 : 1) || ORDEN[a.nivel] - ORDEN[b.nivel]);
  let cola = vencidas.slice(0, n);
  const cupo = filtro ? n - cola.length : Math.min(E.ajustes.nuevas, n - cola.length);
  cola = cola.concat(nuevas.slice(0, Math.max(0, cupo)));
  if (!cola.length && libre) cola = barajar(vistas).slice(0, n);
  return { cola: barajar(cola), vencidas: Math.min(vencidas.length, n), nuevas: cola.length - Math.min(vencidas.length, n) };
}

// =============================================================== corrección
function leerNumero(s) {
  s = String(s ?? '').trim().replace(/[\s  ]/g, '').replace(/−/g, '-').replace(',', '.');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : null;
}
function evaluar(p, valor) {
  if (p.tipo === 'vf') return valor === p.respuesta;
  if (p.tipo === 'opcion') return valor === p.correcta;
  if (p.tipo === 'numerico') {
    let x = leerNumero(valor), r = p.respuesta;
    if (x === null) return null;
    if (p.ignorar_signo) { x = Math.abs(x); r = Math.abs(r); }
    const tol = (p.tolerancia ?? 0.02) * Math.abs(r) || 1e-9;
    return Math.abs(x - r) <= tol * (1 + 1e-9);
  }
  return null;
}
function respuestaCorrecta(p) {
  if (p.tipo === 'vf') return p.respuesta ? 'Verdadero' : 'Falso';
  if (p.tipo === 'opcion') return p.opciones[p.correcta];
  if (p.tipo === 'numerico') return `${num(p.respuesta)} ${p.unidad || ''}`.trim();
  return '';
}
const textoFuentes = fs => (fs || []).map(f => `${f.cita}${f.ubicacion ? ', ' + f.ubicacion : ''}`).join(' · ');

// =============================================================== render: piezas comunes
function tagsDe(p) {
  const tema = D.temas[p.tema] || p.tema;
  return `<div class="tags"><span class="tag ${p.nivel}">${NOMBRE_NIVEL[p.nivel]}</span><span class="tag">${esc(tema)}</span>`
    + (p.pendiente ? '<span class="tag pend">sin revisar</span>' : '') + '</div>';
}

// Controles de respuesta para una pregunta simple. Llama a alResponder(valor) una sola vez.
function controles(p, alResponder) {
  const caja = document.createElement('div');
  if (p.tipo === 'vf') {
    caja.className = 'fila';
    caja.innerHTML = '<button class="op" data-v="true">Verdadero</button><button class="op" data-v="false">Falso</button>';
    caja.onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled) return;
      bloquear(caja); alResponder(b.dataset.v === 'true', b); };
  } else if (p.tipo === 'opcion') {
    caja.className = 'ops';
    const orden = barajar(p.opciones.map((_, i) => i));
    caja.innerHTML = orden.map(i => `<button class="op" data-v="${i}">${esc(p.opciones[i])}</button>`).join('');
    caja.onclick = e => { const b = e.target.closest('button'); if (!b || b.disabled) return;
      bloquear(caja); alResponder(Number(b.dataset.v), b); };
  } else if (p.tipo === 'numerico') {
    caja.innerHTML = `<form class="numin"><input inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="Tu respuesta" aria-label="Respuesta">
      <span class="unidad">${esc(p.unidad || '')}</span></form><p class="peq mut">Coma o punto decimal.${p.ignorar_signo ? ' Magnitud, sin signo.' : ''}</p>`;
    const f = caja.querySelector('form'), inp = caja.querySelector('input');
    f.onsubmit = e => { e.preventDefault();
      if (leerNumero(inp.value) === null) { inp.focus(); toast('Escribe un número'); return; }
      inp.disabled = true; alResponder(inp.value, null); };
    setTimeout(() => inp.focus(), 50);
  }
  return caja;
}
function bloquear(caja) { caja.querySelectorAll('button').forEach(b => b.disabled = true); }
function pintarOpciones(caja, p, valor) {
  caja.querySelectorAll('.op').forEach(b => {
    const v = p.tipo === 'vf' ? b.dataset.v === 'true' : Number(b.dataset.v);
    const correcta = p.tipo === 'vf' ? p.respuesta : p.correcta;
    if (v === correcta) b.classList.add('ok'); else if (v === valor) b.classList.add('no');
  });
}
function feedback(p, ok, id) {
  const div = document.createElement('div');
  div.className = `fb ${ok ? 'ok' : 'no'}`;
  div.innerHTML = `<div class="tit">${ok ? '✓ Correcto' : '✗ Respuesta: ' + esc(respuestaCorrecta(p))}</div>`
    + (p.explicacion ? `<div>${esc(p.explicacion)}</div>` : '')
    + (p.fuentes?.length ? `<div class="fuentes">📖 ${esc(textoFuentes(p.fuentes))}</div>` : '')
    + (id ? '<button class="anotar">⚑ Algo está mal aquí</button>' : '');
  div.querySelector('.anotar')?.addEventListener('click', () => anotar(id));
  return div;
}
function anotar(id) {
  const txt = prompt(`Nota sobre ${id} (queda guardada en Progreso → Notas):`);
  if (!txt) return;
  E.notas.push({ id, fecha: hoy(), txt }); guardar(); toast('Nota guardada');
}
function pie(txt, fn) {
  document.querySelector('.pie')?.remove();
  const d = document.createElement('div');
  d.className = 'pie'; d.innerHTML = `<button class="btn">${esc(txt)}</button>`;
  d.firstChild.onclick = () => { d.remove(); fn(); };
  $app.append(d);
  d.firstChild.focus({ preventScroll: true });
}

// =============================================================== sesión
function iniciarSesion(cola, titulo = 'Sesión') {
  if (!cola.length) { toast('No hay tarjetas para esta selección'); return; }
  S = { cola: [...cola], i: 0, titulo, xp: 0, ok: 0, total: 0, falladas: new Set(), repetidas: new Set() };
  mostrar('sesion');
}
function siguiente() { S.i++; S.i < S.cola.length ? pintarTarjeta() : pintarResumen(); }

function cabeceraSesion() {
  const avance = S.i / S.cola.length;
  return `<div class="top"><button class="cerrar" aria-label="Salir">×</button><div class="barra"><i style="width:${avance * 100}%"></i></div>
    <span class="peq mut">${S.i + 1}/${S.cola.length}</span></div>`;
}
function pintarTarjeta() {
  const p = S.cola[S.i];
  $app.innerHTML = cabeceraSesion();
  $app.querySelector('.cerrar').onclick = () => { if (confirm('¿Salir de la sesión? Lo respondido queda guardado.')) { guardar(); mostrar('inicio'); } };
  const card = document.createElement('div');
  card.className = 'card';
  $app.append(card);
  window.scrollTo(0, 0);
  if (p.tipo === 'etapas') return pintarEtapas(card, p);

  card.innerHTML = tagsDe(p) + `<p class="enun">${esc(p.enunciado)}</p>`;
  const caja = controles(p, valor => {
    const ok = evaluar(p, valor);
    if (p.tipo !== 'numerico') pintarOpciones(caja, p, valor);
    registrar(p, ok ? 4 : 1, ok);
    card.append(feedback(p, ok, p.id));
    pie('Continuar', siguiente);
  });
  card.append(caja);
}

// Un problema por etapas: cada etapa desbloquea la siguiente; un error muestra la respuesta y se sigue.
function pintarEtapas(card, p) {
  const st = { k: 0, aciertos: 0 };
  card.innerHTML = tagsDe(p) + (p.titulo ? `<h2 style="margin-top:0">${esc(p.titulo)}</h2>` : '')
    + `<div class="contexto">${esc(p.enunciado)}</div><div class="hechas"></div><div class="actual"></div>`;
  const hechas = card.querySelector('.hechas'), actual = card.querySelector('.actual');
  const pintar = () => {
    const e = { ...p.etapas[st.k], fuentes: p.fuentes };
    actual.innerHTML = `<p class="peq mut">Etapa ${st.k + 1} de ${p.etapas.length}</p><p class="enun">${esc(e.enunciado)}</p>`;
    const caja = controles(e, valor => {
      const ok = evaluar(e, valor);
      if (e.tipo !== 'numerico') pintarOpciones(caja, e, valor);
      if (ok) st.aciertos++;
      vibrar(ok ? 15 : [30, 40, 30]);
      actual.append(feedback({ ...e, fuentes: null }, ok, null));
      const cerrarEtapa = () => {
        hechas.insertAdjacentHTML('beforeend', `<div class="etapa-hecha ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} <b>Etapa ${st.k + 1}.</b> ${esc(respuestaCorrecta(e))}</div>`);
        st.k++;
        if (st.k < p.etapas.length) { pintar(); actual.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else terminar();
      };
      pie(st.k + 1 < p.etapas.length ? 'Siguiente etapa' : 'Ver resultado', cerrarEtapa);
    });
    actual.append(caja);
  };
  const terminar = () => {
    const frac = st.aciertos / p.etapas.length;
    const calidad = frac === 1 ? 5 : frac >= 0.75 ? 4 : frac >= 0.5 ? 3 : 1;
    const xp = Math.round(XP_BASE[p.nivel] * (0.5 + frac) * (S.repetidas.has(p.id) ? 0.3 : 1));
    registrar(p, calidad, calidad >= 3, xp);
    actual.innerHTML = '';
    const fb = feedback({ ...p, explicacion: `${st.aciertos} de ${p.etapas.length} etapas a la primera.`, tipo: 'etapas' }, calidad >= 3, p.id);
    fb.querySelector('.tit').textContent = calidad >= 3 ? `✓ Problema resuelto (${Math.round(frac * 100)} %)` : `✗ Vuelve pronto (${Math.round(frac * 100)} %)`;
    actual.append(fb);
    pie('Continuar', siguiente);
  };
  pintar();
}

// Registra una respuesta: repaso espaciado (solo el primer intento de la sesión), XP, racha y reintento.
function registrar(p, calidad, ok, xpFijo = null) {
  const repetida = S.repetidas.has(p.id);
  if (!repetida) repasar(p.id, calidad);
  const xp = xpFijo ?? (ok ? Math.round(XP_BASE[p.nivel] * (repetida ? 0.3 : 1)) : XP_INTENTO);
  sumarXP(xp); flotarXP(xp);
  S.xp += xp; S.total++; if (ok) S.ok++;
  if (!ok && !repetida) { S.cola.push(p); S.repetidas.add(p.id); S.falladas.add(p.id); }
  if (p.tipo !== 'etapas') vibrar(ok ? 15 : [30, 40, 30]);
  marcarRacha();
  guardar();
}

function pintarResumen() {
  const d = E.diario[hoy()] || { xp: 0 };
  const nv = nivelJugador();
  const proximas = Object.values(E.tarjetas).filter(t => t.due === sumarDias(hoy(), 1)).length;
  $app.innerHTML = `<div class="resumen">
    <div class="grande">+${S.xp} XP</div>
    <p>${S.ok} de ${S.total} respuestas correctas${S.falladas.size ? ` · ${S.falladas.size} volverán pronto` : ''}</p>
    <div class="card" style="text-align:left">
      <div class="perfil"><div class="insignia">${nv.n}</div><div style="flex:1"><div class="rango">${esc(nv.rango)}</div>
      <div class="barra"><i style="width:${nv.avance * 100}%"></i></div><div class="peq mut">${nv.falta} XP para el nivel ${nv.n + 1}</div></div></div>
    </div>
    <p class="mut">Hoy: ${d.xp}/${META_DIARIA} XP · racha ${rachaVigente()} 🔥${proximas ? ` · mañana vencen ${proximas}` : ''}</p>
  </div>`;
  if (d.xp >= META_DIARIA && d.xp - S.xp < META_DIARIA) setTimeout(() => toast('Meta diaria cumplida 🎉'), 400);
  S = null;
  pie('Volver al inicio', () => mostrar('inicio'));
}

// =============================================================== vistas
function vistaInicio() {
  if (!D.items.length && !D.lecturas.length) {
    $app.innerHTML = `<h1>Fermento</h1><div class="card"><h2 style="margin-top:0">Aún no hay contenido aprobado</h2>
      <p class="mut">Cada pregunta, lectura y dato pasa por revisión antes de llegar aquí. Vuelve cuando se publique el primer lote.</p>
      <p class="peq mut" style="margin-bottom:0">Contenido ${esc(D.version)} · ${esc(D.generado)}</p></div>`;
    return;
  }
  const nv = nivelJugador(), d = E.diario[hoy()] || { xp: 0 };
  const plan = armarSesion();
  const sinLeer = D.lecturas.filter(l => !E.lecturas[l.id]).length;
  const total = preguntas().length, vistas = Object.keys(E.tarjetas).length;
  $app.innerHTML = `
    <h1>Fermento</h1>
    <div class="perfil card"><div class="insignia">${nv.n}</div><div style="flex:1"><div class="rango">${esc(nv.rango)}</div>
      <div class="barra"><i style="width:${nv.avance * 100}%"></i></div><div class="peq mut">${E.xp} XP · ${nv.falta} para el nivel ${nv.n + 1}</div></div></div>
    <div class="stats">
      <div class="stat"><b>${rachaVigente()} 🔥</b><span>racha</span></div>
      <div class="stat"><b>${Math.min(d.xp, 999)}/${META_DIARIA}</b><span>XP de hoy</span></div>
      <div class="stat"><b>${vistas}/${total}</b><span>tarjetas vistas</span></div>
    </div>
    <div class="card sesion-cta">
      <h2>${plan.cola.length ? 'Sesión de hoy' : 'Al día'}</h2>
      <p class="mut">${plan.cola.length
        ? `${plan.vencidas} repaso${plan.vencidas === 1 ? '' : 's'} · ${plan.nuevas} nueva${plan.nuevas === 1 ? '' : 's'} · unos ${Math.max(2, Math.round(plan.cola.length * 0.5))} min`
        : 'No hay repasos vencidos ni tarjetas nuevas desbloqueadas. Puedes practicar libre o leer.'}</p>
      <button class="btn" id="go">${plan.cola.length ? 'Empezar' : 'Práctica libre'}</button>
    </div>
    <div class="accesos">
      <button class="acceso" data-ir="lecturas"><b>Lecturas</b><span class="peq mut">${sinLeer ? `${sinLeer} sin leer` : 'todas leídas'}</span></button>
      <button class="acceso" data-ir="explorar"><b>Explorar</b><span class="peq mut">por tema y nivel</span></button>
    </div>
    ${bloqueoTexto()}`;
  $app.querySelector('#go').onclick = () => {
    const s = plan.cola.length ? plan : armarSesion({ libre: true });
    iniciarSesion(s.cola, 'Sesión');
  };
}
function bloqueoTexto() {
  if (E.ajustes.todo) return '';
  const msgs = [];
  for (const m of Object.keys(D.modulos)) {
    for (const nv of ['intermedio', 'dificil']) {
      if (!D.items.some(i => i.modulo === m && i.nivel === nv)) continue;
      if (desbloqueado(m, nv)) continue;
      const a = avanceDesbloqueo(m, nv);
      msgs.push(`${NOMBRE_NIVEL[nv]} de ${m}: acierta ${a.necesita - a.ok} más del nivel anterior para desbloquearlo.`);
      break;
    }
  }
  return msgs.length ? `<p class="peq mut" style="margin-top:14px">🔒 ${msgs.map(esc).join('<br>')}</p>` : '';
}

function vistaLecturas() {
  const grupos = ['basico', 'intermedio', 'dificil'].map(nv => {
    const ls = D.lecturas.filter(l => l.nivel === nv);
    if (!ls.length) return '';
    return `<h2>${NOMBRE_NIVEL[nv]}</h2>` + ls.map(l => `<button class="acceso" data-lectura="${esc(l.id)}">
      <div><b>${esc(l.titulo)}</b><span class="peq mut">${l.minutos} min · ${esc(D.temas[l.tema] || l.tema)}${l.pendiente ? ' · sin revisar' : ''}</span></div>
      <span class="check">${E.lecturas[l.id] ? '✓' : ''}</span></button>`).join('');
  }).join('');
  $app.innerHTML = `<h1>Lecturas</h1><p class="mut">Textos de 1 a 3 minutos. Al terminar respondes sus preguntas y entran al repaso.</p>
    <div class="lista-lect">${grupos || '<p class="mut">Aún no hay lecturas aprobadas.</p>'}</div>`;
  $app.querySelectorAll('[data-lectura]').forEach(b => b.onclick = () => abrirLectura(b.dataset.lectura));
}
function abrirLectura(id) {
  const l = D.lecturas.find(x => x.id === id);
  vista = 'lectura';
  document.getElementById('nav').hidden = true;      // modo lectura: sin distracciones y con espacio para el pie
  $app.innerHTML = `<div class="top"><button class="cerrar" aria-label="Volver">‹</button><span class="peq mut">${l.minutos} min de lectura</span></div>
    ${tagsDe(l)}<h1>${esc(l.titulo)}</h1><article class="lectura">${l.html}</article>
    ${l.fuentes?.length ? `<p class="peq mut">📖 ${esc(textoFuentes(l.fuentes))}</p>` : ''}`;
  $app.querySelector('.cerrar').onclick = () => mostrar('lecturas');
  window.scrollTo(0, 0);
  const n = l.preguntas.length;
  pie(n ? `Terminé · responder ${n} pregunta${n === 1 ? '' : 's'}` : 'Terminé', () => {
    if (!E.lecturas[l.id]) { E.lecturas[l.id] = { leida: hoy() }; sumarXP(XP_LECTURA); flotarXP(XP_LECTURA); marcarRacha(); guardar(); }
    const cola = l.preguntas.map(p => ({ ...p, origen: 'lectura', lectura: l.id }));
    n ? iniciarSesion(cola, l.titulo) : mostrar('lecturas');
  });
}

const filtroExplorar = { temas: new Set(), niveles: new Set() };
function vistaExplorar() {
  const pool = preguntas();
  const temas = [...new Set(pool.map(p => p.tema))];
  const sel = p => (!filtroExplorar.temas.size || filtroExplorar.temas.has(p.tema)) && (!filtroExplorar.niveles.size || filtroExplorar.niveles.has(p.nivel));
  const n = pool.filter(sel).length;
  $app.innerHTML = `<h1>Explorar</h1><p class="mut">Elige temas y niveles. Sin selección, entra todo. Aquí no hay candados.</p>
    <h2>Nivel</h2><div class="chips">${['basico', 'intermedio', 'dificil'].map(nv =>
      `<button class="chip ${filtroExplorar.niveles.has(nv) ? 'on' : ''}" data-nivel="${nv}">${NOMBRE_NIVEL[nv]}</button>`).join('')}</div>
    <h2>Tema</h2><div class="chips">${temas.map(t =>
      `<button class="chip ${filtroExplorar.temas.has(t) ? 'on' : ''}" data-tema="${esc(t)}">${esc(D.temas[t] || t)}</button>`).join('')}</div>
    <p class="mut">${n} tarjeta${n === 1 ? '' : 's'} en la selección.</p>
    <button class="btn" id="go" ${n ? '' : 'disabled'}>Practicar selección</button>`;
  $app.querySelectorAll('[data-nivel]').forEach(b => b.onclick = () => { alternar(filtroExplorar.niveles, b.dataset.nivel); vistaExplorar(); });
  $app.querySelectorAll('[data-tema]').forEach(b => b.onclick = () => { alternar(filtroExplorar.temas, b.dataset.tema); vistaExplorar(); });
  $app.querySelector('#go').onclick = () => iniciarSesion(armarSesion({ filtro: sel, libre: true }).cola, 'Práctica');
}
const alternar = (set, v) => set.has(v) ? set.delete(v) : set.add(v);

function vistaProgreso() {
  const pool = preguntas();
  const temas = [...new Set(pool.map(p => p.tema))];
  const filaTema = t => {
    const ps = pool.filter(p => p.tema === t);
    const cons = ps.filter(p => (E.tarjetas[p.id]?.int || 0) >= DIAS_CONSOLIDADA).length;
    const vis = ps.filter(p => E.tarjetas[p.id]).length - cons;
    return `<div class="tema-fila"><div class="cab"><span>${esc(D.temas[t] || t)}</span><span class="mut">${cons + vis}/${ps.length}</span></div>
      <div class="barra multi"><i style="width:${cons / ps.length * 100}%"></i><i class="vista" style="width:${vis / ps.length * 100}%"></i></div></div>`;
  };
  const t = hoy(), ts = Object.values(E.tarjetas);
  const venceHoy = ts.filter(x => x.due <= t).length, manana = ts.filter(x => x.due === sumarDias(t, 1)).length;
  const semana = ts.filter(x => x.due > sumarDias(t, 1) && x.due <= sumarDias(t, 7)).length;
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(t, i - 6));
  const maxXP = Math.max(META_DIARIA, ...dias.map(f => E.diario[f]?.xp || 0));
  $app.innerHTML = `<h1>Progreso</h1>
    <div class="card"><b>Últimos 7 días</b>
      <div style="display:flex;gap:6px;align-items:flex-end;height:80px;margin-top:10px">${dias.map(f => {
        const x = E.diario[f]?.xp || 0;
        return `<div style="flex:1;text-align:center"><div style="height:${Math.max(3, x / maxXP * 60)}px;background:${x >= META_DIARIA ? 'var(--acc)' : 'var(--card2)'};border-radius:4px"></div>
          <div class="peq mut">${'DLMMJVS'[new Date(f + 'T12:00').getDay()]}</div></div>`; }).join('')}</div>
      <p class="peq mut" style="margin-bottom:0">Repasos: ${venceHoy} hoy · ${manana} mañana · ${semana} en la semana</p></div>
    <div class="card"><b>Dominio por tema</b><p class="peq mut" style="margin:2px 0 0">Oscuro: consolidada (intervalo ≥ ${DIAS_CONSOLIDADA} d). Claro: vista.</p>
      ${temas.map(filaTema).join('')}</div>
    <div class="card"><b>Ajustes</b>
      <div class="ajuste"><span>Tarjetas por sesión</span><select id="porSesion">${[6, 10, 15, 20].map(v => `<option ${v === E.ajustes.porSesion ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="ajuste"><span>Nuevas por sesión</span><select id="nuevas">${[2, 4, 6, 10].map(v => `<option ${v === E.ajustes.nuevas ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="ajuste"><span>Desbloquear todos los niveles</span><input type="checkbox" id="todo" ${E.ajustes.todo ? 'checked' : ''}></div>
    </div>
    <div class="card"><b>Notas de revisión (${E.notas.length})</b>
      <p class="peq mut">Lo que marcaste con ⚑ durante las sesiones.</p>
      ${E.notas.slice(-5).reverse().map(n => `<p class="peq"><code>${esc(n.id)}</code> ${esc(n.txt)}</p>`).join('')}
      <div class="fila"><button class="btn sec" id="copiarNotas" ${E.notas.length ? '' : 'disabled'}>Copiar notas</button>
      <button class="btn sec" id="borrarNotas" ${E.notas.length ? '' : 'disabled'}>Vaciar</button></div></div>
    <div class="card"><b>Respaldo</b><p class="peq mut">El progreso vive solo en este teléfono. Exporta un respaldo de vez en cuando.</p>
      <div class="fila"><button class="btn sec" id="exportar">Exportar</button><button class="btn sec" id="importar">Importar</button></div>
      <input type="file" id="archivo" accept="application/json" hidden>
      <button class="btn sec" id="reiniciar" style="margin-top:10px;color:var(--no)">Reiniciar progreso</button></div>
    <p class="peq mut">Contenido ${esc(D.version)} · ${esc(D.generado)}${D.borrador ? ' · BORRADOR' : ''}</p>`;
  const set = (k, v) => { E.ajustes[k] = v; guardar(); };
  $app.querySelector('#porSesion').onchange = e => set('porSesion', Number(e.target.value));
  $app.querySelector('#nuevas').onchange = e => set('nuevas', Number(e.target.value));
  $app.querySelector('#todo').onchange = e => set('todo', e.target.checked);
  $app.querySelector('#copiarNotas').onclick = async () => {
    const txt = E.notas.map(n => `${n.fecha} ${n.id}: ${n.txt}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Notas copiadas'); } catch { prompt('Copia las notas:', txt); }
  };
  $app.querySelector('#borrarNotas').onclick = () => { if (confirm('¿Vaciar las notas?')) { E.notas = []; guardar(); vistaProgreso(); } };
  $app.querySelector('#exportar').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(E, null, 1)], { type: 'application/json' }));
    a.download = `fermento_respaldo_${hoy()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const archivo = $app.querySelector('#archivo');
  $app.querySelector('#importar').onclick = () => archivo.click();
  archivo.onchange = async () => {
    try {
      const s = JSON.parse(await archivo.files[0].text());
      if (typeof s.xp !== 'number' || !s.tarjetas) throw new Error('formato');
      if (!confirm('Esto reemplaza el progreso actual por el del respaldo. ¿Seguir?')) return;
      E = { ...nuevoEstado(), ...s }; guardar(); toast('Respaldo importado'); vistaProgreso();
    } catch { toast('No es un respaldo de Fermento'); }
  };
  $app.querySelector('#reiniciar').onclick = () => {
    if (confirm('¿Borrar todo el progreso de este teléfono? Exporta antes si quieres conservarlo.')) { E = nuevoEstado(); guardar(); mostrar('inicio'); }
  };
}

// =============================================================== navegación
const VISTAS = { inicio: vistaInicio, lecturas: vistaLecturas, explorar: vistaExplorar, progreso: vistaProgreso, sesion: pintarTarjeta };
function mostrar(v) {
  vista = v;
  if (v !== 'sesion') S = null;
  document.querySelector('.pie')?.remove();
  document.getElementById('nav').hidden = v === 'sesion';
  marcarNav();
  VISTAS[v]();
  if (v !== 'sesion') window.scrollTo(0, 0);
}
function marcarNav() {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.ir === vista));
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ir]');
  if (b && !S) mostrar(b.dataset.ir);
});

// =============================================================== arranque
async function arrancar() {
  try {
    const r = await fetch('data/contenido.json', { cache: 'no-cache' });
    D = await r.json();
  } catch {
    $app.innerHTML = '<p class="cargando">No pude cargar el contenido. Revisa la conexión y recarga.</p>';
    return;
  }
  E = cargarEstado();
  document.getElementById('borrador').hidden = !D.borrador;
  mostrar('inicio');
}
arrancar();
