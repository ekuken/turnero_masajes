import { configurado, rpc } from './api.js';
import {
  esc, dinero, duracionTxt, hoyEn, sumarDias, sumarMeses, primerDiaMes, ultimoDiaMes, diaSemana,
  DIAS, fechaLarga, mesAnio, capitalizar, telefonoValido, emailValido, linkWhatsApp,
  linkGoogleCalendar, aMin,
} from './utils.js';
import { toast } from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const cuerpo = $('#reserva-cuerpo');

let INFO = null;             // datos públicos del negocio
const estado = { paso: 1, servicio: null, fecha: null, hora: null, datos: {}, mes: null, resultado: null };
const cacheDias = new Map(); // `${servicio}|${mes}` -> Map(fecha -> libres)

document.getElementById('anio').textContent = new Date().getFullYear();

// ---------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------
async function iniciar() {
  if (!configurado) {
    $('#sin-config').hidden = false;
    $('#lista-servicios').innerHTML = '';
    cuerpo.innerHTML = '<p class="vacio">La reserva online se habilita cuando se conecta la base de datos.</p>';
    return;
  }
  try {
    INFO = await rpc('info_publica');
  } catch (e) {
    $('#lista-servicios').innerHTML = `<li><p class="vacio">No se pudo cargar la información: ${esc(e.message)}</p></li>`;
    cuerpo.innerHTML = '<p class="vacio">No se pudo cargar la reserva. Recargá la página en unos minutos.</p>';
    return;
  }
  pintarNegocio();
  pintarServicios();
  pintarHorarios();
  pintarContacto();
  irAPaso(1);
}

function pintarNegocio() {
  const n = INFO.negocio || {};
  document.title = `${n.nombre} · Reservá tu turno`;
  document.querySelectorAll('[data-negocio]').forEach((el) => {
    const v = n[el.dataset.negocio];
    el.textContent = v || '';
  });
  if (n.ubicacion) $('#hero-ubicacion').hidden = false;

  if (n.imagen_url && /^https?:\/\//i.test(n.imagen_url)) {
    const img = new Image();
    img.alt = `Espacio de ${n.nombre}`;
    img.loading = 'eager';
    img.onload = () => { const c = $('#hero-imagen'); c.innerHTML = ''; c.appendChild(img); };
    img.src = n.imagen_url;
  }
}

function pintarServicios() {
  const ul = $('#lista-servicios');
  const servicios = INFO.servicios || [];
  if (!servicios.length) {
    ul.innerHTML = '<li><p class="vacio">Pronto vas a ver los servicios disponibles acá.</p></li>';
    return;
  }
  ul.innerHTML = servicios.map((s) => `
    <li>
      <div>
        <h3 class="carta-nombre">${esc(s.nombre)}</h3>
        ${s.descripcion ? `<p class="carta-desc">${esc(s.descripcion)}</p>` : ''}
      </div>
      <div class="carta-meta">
        <span class="carta-dur">${duracionTxt(s.duracion)}</span>
        <span class="carta-precio">${dinero(s.precio, INFO.negocio.moneda)}</span>
        <button type="button" class="btn btn-suave btn-chico" data-reservar-servicio="${s.id}">Reservar</button>
      </div>
    </li>`).join('');
}

function tramosDelDia(dow) {
  return (INFO.horarios || []).filter((h) => h.dia_semana === dow);
}
function textoTramos(tramos) {
  return tramos.map((t) => `${t.hora_inicio} a ${t.hora_fin}`).join(' y ');
}

function pintarHorarios() {
  const tz = INFO.negocio.zona_horaria;
  const hoyDow = diaSemana(hoyEn(tz));
  const orden = [1, 2, 3, 4, 5, 6, 0];
  $('#tabla-horario').innerHTML = orden.map((d) => {
    const tr = tramosDelDia(d);
    return `<tr class="${d === hoyDow ? 'hoy' : ''}"><td>${DIAS[d]}</td><td>${tr.length ? tr.map((t) => `${t.hora_inicio}–${t.hora_fin}`).join('<br>') : 'Cerrado'}</td></tr>`;
  }).join('');

  const hoy = tramosDelDia(hoyDow);
  const el = $('#hero-hoy');
  el.hidden = false;
  el.querySelector('span').textContent = hoy.length ? `Hoy de ${textoTramos(hoy)}` : 'Hoy no atendemos';
}

function pintarContacto() {
  const n = INFO.negocio;
  const items = [];
  if (n.whatsapp) items.push(`<li><a href="${esc(linkWhatsApp(n.whatsapp))}" target="_blank" rel="noopener">WhatsApp ${esc(n.whatsapp)}</a></li>`);
  if (n.telefono) items.push(`<li><a href="tel:${esc(n.telefono.replace(/[^\d+]/g, ''))}">Tel. ${esc(n.telefono)}</a></li>`);
  if (n.email) items.push(`<li><a href="mailto:${esc(n.email)}">${esc(n.email)}</a></li>`);
  if (n.instagram) {
    const user = n.instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
    items.push(`<li><a href="https://instagram.com/${esc(user)}" target="_blank" rel="noopener">Instagram @${esc(user)}</a></li>`);
  }
  $('#lista-contacto').innerHTML = items.join('') || '<li class="carta-desc">Escribinos desde la reserva online.</li>';
}

// ---------------------------------------------------------------------
// Asistente de reserva
// ---------------------------------------------------------------------
const servicioActual = () => (INFO?.servicios || []).find((s) => s.id === estado.servicio);

function actualizarPasos() {
  document.querySelectorAll('#pasos li').forEach((li) => {
    const n = Number(li.dataset.paso);
    li.classList.toggle('activo', n === estado.paso);
    li.classList.toggle('hecho', n < estado.paso);
    const btn = li.querySelector('button');
    btn.disabled = !(n < estado.paso) || estado.paso === 6;
    if (n === estado.paso) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
  });
}
document.querySelectorAll('#pasos button').forEach((b) => b.addEventListener('click', () => {
  const n = Number(b.closest('li').dataset.paso);
  if (n < estado.paso && estado.paso !== 6) irAPaso(n);
}));

function irAPaso(n, { enfocar = false } = {}) {
  estado.paso = n;
  actualizarPasos();
  ({ 1: pasoServicio, 2: pasoFecha, 3: pasoHora, 4: pasoDatos, 5: pasoResumen, 6: pasoExito })[n]();
  if (enfocar) {
    const t = cuerpo.querySelector('h3');
    if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
    const top = $('#reservar').getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) $('#reservar').scrollIntoView({ behavior: 'smooth' });
  }
}

// Paso 1 ---------------------------------------------------------------
function pasoServicio() {
  const servicios = INFO.servicios || [];
  if (!servicios.length) {
    cuerpo.innerHTML = '<p class="vacio">Todavía no hay servicios disponibles para reservar.</p>';
    return;
  }
  cuerpo.innerHTML = `
    <h3 class="reserva-titulo">¿Qué masaje querés?</h3>
    <p class="reserva-sub">Elegí un servicio para ver los días disponibles.</p>
    <div class="opciones-servicio">
      ${servicios.map((s) => `
        <button type="button" class="opcion" data-servicio="${s.id}" aria-pressed="${s.id === estado.servicio}">
          <span class="opcion-nombre">${esc(s.nombre)}</span>
          <span class="opcion-meta"><span>${duracionTxt(s.duracion)}</span><span>${dinero(s.precio, INFO.negocio.moneda)}</span></span>
        </button>`).join('')}
    </div>`;
  cuerpo.querySelectorAll('[data-servicio]').forEach((b) => b.addEventListener('click', () => elegirServicio(Number(b.dataset.servicio))));
}

function elegirServicio(id) {
  if (estado.servicio !== id) { estado.fecha = null; estado.hora = null; }
  estado.servicio = id;
  irAPaso(2, { enfocar: true });
}

// Paso 2 ---------------------------------------------------------------
async function pasoFecha() {
  const tz = INFO.negocio.zona_horaria;
  const hoy = hoyEn(tz);
  const limite = sumarDias(hoy, INFO.negocio.anticipacion_max_dias || 60);
  if (!estado.mes) estado.mes = primerDiaMes(estado.fecha || hoy);
  const s = servicioActual();

  cuerpo.innerHTML = `
    <h3 class="reserva-titulo">¿Qué día?</h3>
    <p class="reserva-sub">${esc(s.nombre)} · ${duracionTxt(s.duracion)}. Los días con punto tienen horarios libres.</p>
    <div class="cal-reserva">
      <div class="cal-cab">
        <button type="button" class="btn-icono" data-mes="-1" aria-label="Mes anterior"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <span class="cal-mes">${esc(mesAnio(estado.mes))}</span>
        <button type="button" class="btn-icono" data-mes="1" aria-label="Mes siguiente"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="cal-grilla" id="cal-grilla">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}</div>
      <p class="leyenda" id="cal-leyenda"><span class="spinner"></span> Buscando disponibilidad…</p>
    </div>
    <div class="reserva-pie"><button type="button" class="btn btn-sec" data-volver>Cambiar servicio</button></div>`;

  const mesAnterior = sumarMeses(estado.mes, -1);
  const mesSiguiente = sumarMeses(estado.mes, 1);
  cuerpo.querySelector('[data-mes="-1"]').disabled = ultimoDiaMes(mesAnterior) < hoy;
  cuerpo.querySelector('[data-mes="1"]').disabled = mesSiguiente > limite;
  cuerpo.querySelectorAll('[data-mes]').forEach((b) => b.addEventListener('click', () => {
    estado.mes = sumarMeses(estado.mes, Number(b.dataset.mes));
    pasoFecha();
  }));
  cuerpo.querySelector('[data-volver]').addEventListener('click', () => irAPaso(1));

  const grilla = cuerpo.querySelector('#cal-grilla');
  const primero = estado.mes;
  const ultimo = ultimoDiaMes(primero);
  const offset = (diaSemana(primero) + 6) % 7; // lunes primero
  let html = '';
  for (let i = 0; i < offset; i++) html += '<div></div>';
  for (let f = primero; f <= ultimo; f = sumarDias(f, 1)) {
    html += `<button type="button" class="cal-dia${f === hoy ? ' hoy' : ''}" data-fecha="${f}" disabled
      aria-pressed="${f === estado.fecha}" aria-label="${esc(fechaLarga(f))}">${Number(f.slice(8))}</button>`;
  }
  grilla.insertAdjacentHTML('beforeend', html);

  // Disponibilidad del mes
  const desde = primero < hoy ? hoy : primero;
  const hasta = ultimo > limite ? limite : ultimo;
  const leyenda = cuerpo.querySelector('#cal-leyenda');
  if (desde > hasta) { leyenda.textContent = 'No hay fechas disponibles en este mes.'; return; }

  const clave = `${estado.servicio}|${primero}`;
  let dias = cacheDias.get(clave);
  const mesPedido = estado.mes;
  if (!dias) {
    try {
      const filas = await rpc('dias_disponibles', { p_servicio_id: estado.servicio, p_desde: desde, p_hasta: hasta });
      dias = new Map(filas.map((r) => [r.fecha, r.libres]));
      cacheDias.set(clave, dias);
      setTimeout(() => cacheDias.delete(clave), 60_000); // la disponibilidad cambia: no guardar mucho tiempo
    } catch (e) {
      leyenda.textContent = e.message;
      return;
    }
  }
  if (estado.paso !== 2 || estado.mes !== mesPedido) return; // el usuario ya cambió de vista

  let hayAlguno = false;
  grilla.querySelectorAll('[data-fecha]').forEach((b) => {
    const libres = dias.get(b.dataset.fecha) || 0;
    if (libres > 0) {
      hayAlguno = true;
      b.disabled = false;
      b.classList.add('disponible');
      b.setAttribute('aria-label', `${fechaLarga(b.dataset.fecha)}, ${libres} horario${libres === 1 ? '' : 's'} libre${libres === 1 ? '' : 's'}`);
      b.addEventListener('click', () => { estado.fecha = b.dataset.fecha; estado.hora = null; irAPaso(3, { enfocar: true }); });
    }
  });
  leyenda.textContent = hayAlguno
    ? 'Elegí un día para ver los horarios.'
    : 'No quedan horarios libres este mes. Probá con el mes siguiente.';
}

// Paso 3 ---------------------------------------------------------------
async function pasoHora() {
  const s = servicioActual();
  cuerpo.innerHTML = `
    <h3 class="reserva-titulo">¿A qué hora?</h3>
    <p class="reserva-sub">${esc(capitalizar(fechaLarga(estado.fecha)))} · ${esc(s.nombre)} (${duracionTxt(s.duracion)})</p>
    <div id="lista-horas"><div class="cargando-bloque"><span class="spinner"></span></div></div>
    <div class="reserva-pie"><button type="button" class="btn btn-sec" data-volver>Cambiar fecha</button></div>`;
  cuerpo.querySelector('[data-volver]').addEventListener('click', () => irAPaso(2));

  const cont = cuerpo.querySelector('#lista-horas');
  const fechaPedida = estado.fecha;
  let horas;
  try {
    horas = (await rpc('horarios_disponibles', { p_servicio_id: estado.servicio, p_fecha: estado.fecha })).map((r) => r.hora);
  } catch (e) {
    cont.innerHTML = `<p class="error-form">${esc(e.message)}</p>`;
    return;
  }
  if (estado.paso !== 3 || estado.fecha !== fechaPedida) return;

  if (!horas.length) {
    cont.innerHTML = '<p class="vacio">Ya no quedan horarios libres ese día. Elegí otra fecha.</p>';
    return;
  }
  const grupos = [
    ['Mañana', horas.filter((h) => aMin(h) < 12 * 60)],
    ['Tarde', horas.filter((h) => aMin(h) >= 12 * 60 && aMin(h) < 19 * 60)],
    ['Noche', horas.filter((h) => aMin(h) >= 19 * 60)],
  ].filter(([, l]) => l.length);
  cont.innerHTML = grupos.map(([nombre, lista]) => `
    <div class="horas-grupo">
      <h4>${nombre}</h4>
      <div class="horas">${lista.map((h) => `<button type="button" class="hora" data-hora="${h}" aria-pressed="${h === estado.hora}">${h}</button>`).join('')}</div>
    </div>`).join('');
  cont.querySelectorAll('[data-hora]').forEach((b) => b.addEventListener('click', () => {
    estado.hora = b.dataset.hora;
    irAPaso(4, { enfocar: true });
  }));
}

// Paso 4 ---------------------------------------------------------------
function pasoDatos() {
  const d = estado.datos;
  cuerpo.innerHTML = `
    <h3 class="reserva-titulo">Tus datos</h3>
    <p class="reserva-sub">Los usamos solo para confirmar y recordarte el turno.</p>
    <form id="form-datos" novalidate>
      <div class="error-form" id="error-datos" hidden></div>
      <div class="fila-campos">
        <div class="campo"><label for="f-nombre">Nombre</label><input id="f-nombre" name="nombre" autocomplete="given-name" maxlength="60" required value="${esc(d.nombre)}"></div>
        <div class="campo"><label for="f-apellido">Apellido</label><input id="f-apellido" name="apellido" autocomplete="family-name" maxlength="60" required value="${esc(d.apellido)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo">
          <label for="f-telefono">Teléfono / WhatsApp</label>
          <input id="f-telefono" name="telefono" type="tel" inputmode="tel" autocomplete="tel" maxlength="25" required placeholder="11 5555 1234" value="${esc(d.telefono)}">
          <span class="ayuda">Con código de área, sin 0 ni 15.</span>
        </div>
        <div class="campo">
          <label for="f-email">Email <span class="opcional">(opcional)</span></label>
          <input id="f-email" name="email" type="email" autocomplete="email" maxlength="120" value="${esc(d.email)}">
          <span class="ayuda">Para recibir la confirmación y el recordatorio.</span>
        </div>
      </div>
      <div class="campo">
        <label for="f-obs">Observaciones <span class="opcional">(opcional)</span></label>
        <textarea id="f-obs" name="observaciones" maxlength="500" placeholder="Lesiones, zonas a evitar, si es tu primera vez…">${esc(d.observaciones)}</textarea>
      </div>
      <div class="reserva-pie">
        <button type="button" class="btn btn-sec" data-volver>Cambiar horario</button>
        <button type="submit" class="btn btn-pri">Continuar</button>
      </div>
    </form>`;
  const form = cuerpo.querySelector('#form-datos');
  cuerpo.querySelector('[data-volver]').addEventListener('click', () => { guardarDatos(form); irAPaso(3); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    guardarDatos(form);
    const errores = validarDatos(estado.datos);
    form.querySelectorAll('.invalido').forEach((el) => el.classList.remove('invalido'));
    const caja = form.querySelector('#error-datos');
    if (errores.length) {
      caja.textContent = errores.map((x) => x.msg).join(' ');
      caja.hidden = false;
      errores.forEach((x) => form.elements[x.campo]?.classList.add('invalido'));
      form.elements[errores[0].campo]?.focus();
      return;
    }
    irAPaso(5, { enfocar: true });
  });
}
function guardarDatos(form) {
  for (const k of ['nombre', 'apellido', 'telefono', 'email', 'observaciones']) estado.datos[k] = form.elements[k].value.trim();
}
function validarDatos(d) {
  const e = [];
  if (!d.nombre) e.push({ campo: 'nombre', msg: 'Ingresá tu nombre.' });
  if (!d.apellido) e.push({ campo: 'apellido', msg: 'Ingresá tu apellido.' });
  if (!telefonoValido(d.telefono)) e.push({ campo: 'telefono', msg: 'Ingresá un teléfono válido, con código de área.' });
  if (d.email && !emailValido(d.email)) e.push({ campo: 'email', msg: 'El email no es válido.' });
  return e;
}

// Paso 5 ---------------------------------------------------------------
function pasoResumen() {
  const s = servicioActual();
  const d = estado.datos;
  cuerpo.innerHTML = `
    <h3 class="reserva-titulo">Revisá tu turno</h3>
    <p class="reserva-sub">Si está todo bien, confirmalo.</p>
    <dl class="resumen">
      <dt>Servicio</dt><dd>${esc(s.nombre)}</dd>
      <dt>Fecha</dt><dd>${esc(capitalizar(fechaLarga(estado.fecha, true)))}</dd>
      <dt>Hora</dt><dd>${esc(estado.hora)} h</dd>
      <dt>Duración</dt><dd>${duracionTxt(s.duracion)}</dd>
      <dt>Precio</dt><dd>${dinero(s.precio, INFO.negocio.moneda)}</dd>
      <dt>A nombre de</dt><dd>${esc(d.nombre)} ${esc(d.apellido)} · ${esc(d.telefono)}</dd>
    </dl>
    ${INFO.negocio.politica_cancelacion ? `<p class="nota">${esc(INFO.negocio.politica_cancelacion)}</p>` : ''}
    <div class="error-form" id="error-confirmar" hidden></div>
    <div class="reserva-pie">
      <button type="button" class="btn btn-sec" data-volver>Modificar datos</button>
      <button type="button" class="btn btn-pri btn-grande" id="btn-confirmar">Confirmar turno</button>
    </div>`;
  cuerpo.querySelector('[data-volver]').addEventListener('click', () => irAPaso(4));
  cuerpo.querySelector('#btn-confirmar').addEventListener('click', confirmarTurno);
}

let enviando = false;
async function confirmarTurno() {
  if (enviando) return; // evita doble clic
  enviando = true;
  const btn = cuerpo.querySelector('#btn-confirmar');
  const caja = cuerpo.querySelector('#error-confirmar');
  btn.disabled = true;
  btn.textContent = 'Reservando…';
  caja.hidden = true;
  try {
    const d = estado.datos;
    estado.resultado = await rpc('crear_reserva', {
      p_servicio_id: estado.servicio, p_fecha: estado.fecha, p_hora: estado.hora,
      p_nombre: d.nombre, p_apellido: d.apellido, p_telefono: d.telefono,
      p_email: d.email || null, p_observaciones: d.observaciones || null,
    });
    cacheDias.clear();
    try { localStorage.setItem('turnero-ultimo', JSON.stringify({ codigo: estado.resultado.codigo, telefono: d.telefono })); } catch { /* sin almacenamiento */ }
    irAPaso(6, { enfocar: true });
  } catch (e) {
    caja.innerHTML = esc(e.message);
    if (/horario/i.test(e.message)) {
      caja.insertAdjacentHTML('beforeend', ' <button type="button" class="btn-texto" data-otra-hora>Elegir otro horario</button>');
      caja.querySelector('[data-otra-hora]').addEventListener('click', () => { estado.hora = null; cacheDias.clear(); irAPaso(3); });
    }
    caja.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Confirmar turno';
  } finally {
    enviando = false;
  }
}

// Éxito ----------------------------------------------------------------
function pasoExito() {
  const r = estado.resultado;
  const n = INFO.negocio;
  document.querySelectorAll('#pasos li').forEach((li) => { li.classList.remove('activo'); li.classList.add('hecho'); });
  const cal = linkGoogleCalendar({
    titulo: `${r.servicio} · ${n.nombre}`, fecha: r.fecha, hora: r.hora, horaFin: r.hora_fin,
    detalle: `Código de turno: ${r.codigo}`, lugar: r.direccion || n.ubicacion || '', tz: n.zona_horaria,
  });
  cuerpo.innerHTML = `
    <div class="exito">
      <div class="exito-signo"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3 class="reserva-titulo">¡Turno reservado correctamente!</h3>
      ${r.estado === 'pendiente' ? '<p class="reserva-sub">Vamos a confirmarte el turno a la brevedad.</p>' : '<p class="reserva-sub">Te esperamos.</p>'}
      <dl class="resumen">
        <dt>Servicio</dt><dd>${esc(r.servicio)}</dd>
        <dt>Fecha</dt><dd>${esc(capitalizar(fechaLarga(r.fecha, true)))}</dd>
        <dt>Hora</dt><dd>${esc(r.hora)} a ${esc(r.hora_fin)} h</dd>
        <dt>Duración</dt><dd>${duracionTxt(r.duracion)}</dd>
        <dt>Precio</dt><dd>${dinero(r.precio, n.moneda)}</dd>
        <dt>Cliente</dt><dd>${esc(r.cliente.nombre)} ${esc(r.cliente.apellido)}<br><small>${esc(r.cliente.telefono)}${r.cliente.email ? ` · ${esc(r.cliente.email)}` : ''}</small></dd>
        ${r.direccion ? `<dt>Dirección</dt><dd>${esc(r.direccion)}${r.indicaciones ? `<br><small>${esc(r.indicaciones)}</small>` : ''}</dd>` : ''}
        <dt>Código</dt><dd><span class="codigo-turno">${esc(r.codigo)}</span></dd>
      </dl>
      <p class="nota">Guardá tu código: con él y tu teléfono podés ver o cancelar el turno desde <a href="mis-turnos.html">Mis turnos</a>.${r.politica_cancelacion ? ' ' + esc(r.politica_cancelacion) : ''}</p>
      <div class="acciones" style="justify-content:center">
        <a class="btn btn-sec" href="${esc(cal)}" target="_blank" rel="noopener">Agregar a Google Calendar</a>
        <button type="button" class="btn btn-pri" data-otro>Reservar otro turno</button>
      </div>
    </div>`;
  cuerpo.querySelector('[data-otro]').addEventListener('click', () => {
    Object.assign(estado, { servicio: null, fecha: null, hora: null, resultado: null, mes: null });
    irAPaso(1, { enfocar: true });
  });
}

// ---------------------------------------------------------------------
// Navegación general
// ---------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reservar-servicio]');
  if (b && INFO) {
    e.preventDefault();
    if (estado.paso === 6) Object.assign(estado, { fecha: null, hora: null, resultado: null, mes: null });
    elegirServicio(Number(b.dataset.reservarServicio));
    $('#reservar').scrollIntoView({ behavior: 'smooth' });
  }
});

// Borde de la cabecera y botón fijo en celular
const cab = $('#cabecera');
const cta = $('#cta-fija');
const seccionReserva = $('#reservar');
const obs = 'IntersectionObserver' in window ? new IntersectionObserver((entradas) => {
  entradas.forEach((en) => cta.classList.toggle('escondida', en.isIntersecting));
}, { threshold: 0.15 }) : null;
obs?.observe(seccionReserva);
window.addEventListener('scroll', () => cab.classList.toggle('con-borde', window.scrollY > 8), { passive: true });

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast('Ocurrió un error. Recargá la página e intentá de nuevo.', 'error');
});

iniciar();
