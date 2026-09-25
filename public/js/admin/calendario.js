import { sb, q } from '../api.js';
import {
  esc, sumarDias, sumarMeses, inicioSemana, primerDiaMes, ultimoDiaMes, diaSemana, parseFecha, DIAS_CORTOS,
  MESES, fechaLarga, capitalizar, mesAnio, hhmm, aMin, deMin, minutosAhoraEn, chipEstado, ESTADOS, ESTADOS_PAGO,
} from '../utils.js';
import { icono } from '../ui.js';
import { ctx, hoy, params, irA } from './contexto.js';
import { abrirTurno, itemTurno } from './turnos.js';

const PX_MIN = 1; // 1 px por minuto -> 60 px por hora
const esCelular = () => window.matchMedia('(max-width: 700px)').matches;

export async function vistaCalendario(cont) {
  const p = params();
  const vista = ['dia', 'semana', 'mes'].includes(p.vista) ? p.vista : (esCelular() ? 'dia' : 'semana');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(p.fecha || '') ? p.fecha : hoy();
  const verCancelados = p.canc === '1';

  let desde, hasta;
  if (vista === 'dia') { desde = hasta = fecha; }
  else if (vista === 'semana') { desde = inicioSemana(fecha); hasta = sumarDias(desde, 6); }
  else { desde = inicioSemana(primerDiaMes(fecha)); hasta = sumarDias(inicioSemana(ultimoDiaMes(fecha)), 6); }

  let consultaTurnos = sb.from('turnos_detalle').select('*').gte('fecha', desde).lte('fecha', hasta)
    .order('fecha').order('hora_inicio');
  if (!verCancelados) consultaTurnos = consultaTurnos.neq('estado', 'cancelado');

  const [turnos, bloqueos, horarios, excepciones] = await Promise.all([
    q(consultaTurnos),
    q(sb.from('bloqueos').select('*').lte('fecha', hasta)
      .or(`fecha_hasta.gte.${desde},and(fecha_hasta.is.null,fecha.gte.${desde})`)),
    q(sb.from('horarios').select('*').eq('activo', true)),
    q(sb.from('excepciones_horario').select('*').gte('fecha', desde).lte('fecha', hasta)),
  ]);

  const tramosDe = (f) => {
    const exc = excepciones.filter((x) => x.fecha === f);
    const lista = exc.length ? exc : horarios.filter((h) => h.dia_semana === diaSemana(f));
    return lista.map((x) => [aMin(x.hora_inicio), aMin(x.hora_fin)]).sort((a, b) => a[0] - b[0]);
  };
  const bloqueosDe = (f) => bloqueos.filter((b) => f >= b.fecha && f <= (b.fecha_hasta || b.fecha));
  const turnosDe = (f) => turnos.filter((t) => t.fecha === f);

  // Título
  let titulo;
  if (vista === 'dia') titulo = capitalizar(fechaLarga(fecha, true));
  else if (vista === 'semana') {
    const a = parseFecha(desde), b = parseFecha(hasta);
    titulo = a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]}`
      : `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]}`;
  } else titulo = mesAnio(fecha);

  const paso = (n) => (vista === 'dia' ? sumarDias(fecha, n) : vista === 'semana' ? sumarDias(fecha, 7 * n) : sumarMeses(fecha, n));
  const ir = (cambios) => irA('calendario', { vista, fecha, canc: verCancelados ? '1' : '', ...cambios });

  cont.innerHTML = `
    <div class="cal-barra">
      <div class="cal-nav">
        <button type="button" class="btn-icono" data-ir="${paso(-1)}" aria-label="Anterior">${icono.atras}</button>
        <button type="button" class="btn btn-sec btn-chico" data-ir="${hoy()}">Hoy</button>
        <button type="button" class="btn-icono" data-ir="${paso(1)}" aria-label="Siguiente">${icono.adelante}</button>
      </div>
      <h2 class="cal-titulo">${esc(titulo)}</h2>
      <div class="segmentado" role="group" aria-label="Vista">
        <button type="button" data-vista="dia" aria-pressed="${vista === 'dia'}">Día</button>
        <button type="button" data-vista="semana" aria-pressed="${vista === 'semana'}">Semana</button>
        <button type="button" data-vista="mes" aria-pressed="${vista === 'mes'}">Mes</button>
      </div>
      <label class="check"><input type="checkbox" id="ver-cancelados" ${verCancelados ? 'checked' : ''}> Cancelados</label>
    </div>
    <div id="cal-cuerpo"></div>
    <div class="leyenda-estados">${Object.keys(ESTADOS).map((e) => chipEstado(e)).join('')}</div>`;

  cont.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => ir({ fecha: b.dataset.ir })));
  cont.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => ir({ vista: b.dataset.vista })));
  cont.querySelector('#ver-cancelados').addEventListener('change', (e) => ir({ canc: e.target.checked ? '1' : '' }));

  const cuerpo = cont.querySelector('#cal-cuerpo');
  if (vista === 'mes') {
    pintarMes(cuerpo, { fecha, desde, hasta, turnosDe, bloqueosDe, tramosDe, ir });
  } else if (vista === 'semana' && esCelular()) {
    pintarLista(cuerpo, { desde, hasta, turnosDe, bloqueosDe, tramosDe });
  } else {
    const dias = [];
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) dias.push(f);
    pintarAgenda(cuerpo, { dias, turnosDe, bloqueosDe, tramosDe, ir, vista });
  }
}

// ---------------------------------------------------------------------
// Día / semana: grilla horaria
// ---------------------------------------------------------------------
function pintarAgenda(cuerpo, { dias, turnosDe, bloqueosDe, tramosDe, ir, vista }) {
  // Rango horario visible: el horario de atención y cualquier turno que quede afuera
  let minIni = Infinity, maxFin = -Infinity;
  for (const f of dias) {
    for (const [a, b] of tramosDe(f)) { minIni = Math.min(minIni, a); maxFin = Math.max(maxFin, b); }
    for (const t of turnosDe(f)) { minIni = Math.min(minIni, aMin(t.hora_inicio)); maxFin = Math.max(maxFin, aMin(t.hora_fin)); }
  }
  if (!Number.isFinite(minIni)) { minIni = 9 * 60; maxFin = 20 * 60; }
  const h0 = Math.max(0, Math.floor(minIni / 60) - (minIni % 60 === 0 && minIni > 0 ? 1 : 0)) * 60;
  const h1 = Math.min(24 * 60, Math.ceil(maxFin / 60) * 60 + 60);
  const alto = (h1 - h0) * PX_MIN;
  const hoyF = hoy();
  const ahora = minutosAhoraEn(ctx.tz);

  let html = `<div class="agenda" style="--cols:${dias.length};--hora-px:${60 * PX_MIN}px">
    <div class="agenda-cab"></div>
    ${dias.map((f) => {
      const d = parseFecha(f);
      return `<div class="agenda-cab ${f === hoyF ? 'hoy' : ''}"><button type="button" data-dia="${f}">${DIAS_CORTOS[d.getUTCDay()]}<b>${d.getUTCDate()}</b></button></div>`;
    }).join('')}
    <div class="agenda-horas" style="height:${alto}px">
      ${Array.from({ length: (h1 - h0) / 60 }, (_, i) => i === 0 ? '' : `<span class="agenda-hora" style="top:${i * 60 * PX_MIN}px">${deMin(h0 + i * 60)}</span>`).join('')}
    </div>`;

  for (const f of dias) {
    const tramos = tramosDe(f);
    const bls = bloqueosDe(f);
    const diaCompleto = bls.find((b) => !b.hora_inicio);
    let capas = '';
    // Franjas fuera del horario de atención
    if (!tramos.length || diaCompleto) {
      capas += `<div class="agenda-fuera" style="top:0;height:${alto}px"></div>`;
    } else {
      let cursor = h0;
      for (const [a, b] of tramos) {
        if (a > cursor) capas += `<div class="agenda-fuera" style="top:${(cursor - h0) * PX_MIN}px;height:${(a - cursor) * PX_MIN}px"></div>`;
        cursor = Math.max(cursor, b);
      }
      if (cursor < h1) capas += `<div class="agenda-fuera" style="top:${(cursor - h0) * PX_MIN}px;height:${(h1 - cursor) * PX_MIN}px"></div>`;
    }
    for (const b of bls) {
      const ini = b.hora_inicio ? aMin(b.hora_inicio) : h0;
      const fin = b.hora_fin ? aMin(b.hora_fin) : h1;
      const top = Math.max(0, ini - h0) * PX_MIN;
      capas += `<div class="agenda-bloqueo" style="top:${top}px;height:${Math.max(18, (Math.min(fin, h1) - Math.max(ini, h0)) * PX_MIN)}px">${esc(b.motivo || tipoBloqueo(b.tipo))}</div>`;
    }
    if (f === hoyF && ahora >= h0 && ahora <= h1) capas += `<div class="agenda-ahora" style="top:${(ahora - h0) * PX_MIN}px"></div>`;

    const eventos = turnosDe(f).map((t) => {
      const ini = aMin(t.hora_inicio), fin = aMin(t.hora_fin);
      const h = Math.max(24, (fin - ini) * PX_MIN - 2);
      const pago = ESTADOS_PAGO[t.estado_pago]?.corto || '';
      const tituloEv = `${hhmm(t.hora_inicio)}–${hhmm(t.hora_fin)} · ${t.cliente_nombre} ${t.cliente_apellido} · ${t.servicio_nombre} · ${ESTADOS[t.estado]?.txt} · ${ESTADOS_PAGO[t.estado_pago]?.txt}`;
      return `<button type="button" class="evento ev-${t.estado}" data-turno="${t.id}" title="${esc(tituloEv)}"
        style="top:${(ini - h0) * PX_MIN + 1}px;height:${h}px">
        ${t.estado_pago === 'pagado' ? '<span class="ev-pago" aria-hidden="true">$</span>' : ''}
        <b>${esc(t.cliente_nombre)} ${esc(t.cliente_apellido)}</b>
        <span class="ev-meta">${hhmm(t.hora_inicio)}–${hhmm(t.hora_fin)} · ${esc(t.servicio_nombre)}</span>
        ${h >= 58 ? `<span class="ev-meta">${esc(ESTADOS[t.estado]?.txt)} · ${esc(pago)}</span>` : ''}
      </button>`;
    }).join('');

    html += `<div class="agenda-col ${!tramos.length ? 'cerrado' : ''}" data-col="${f}" style="height:${alto}px" title="Clic en un espacio libre para crear un turno">${capas}${eventos}</div>`;
  }
  html += '</div>';
  cuerpo.innerHTML = html;

  cuerpo.querySelectorAll('[data-dia]').forEach((b) => b.addEventListener('click', () => ir({ vista: 'dia', fecha: b.dataset.dia })));
  cuerpo.querySelectorAll('[data-col]').forEach((col) => col.addEventListener('click', (e) => {
    if (e.target.closest('[data-turno]')) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const intervalo = ctx.negocio?.intervalo_min || 30;
    let min = h0 + Math.floor(y / PX_MIN / intervalo) * intervalo;
    min = Math.min(Math.max(min, 0), 24 * 60 - 5);
    abrirTurno(null, { fecha: col.dataset.col, hora: deMin(min) });
  }));

  // En la vista de día, llevar la hora actual (o el primer turno) a la vista
  if (vista === 'dia') {
    requestAnimationFrame(() => {
      const primero = cuerpo.querySelector('.evento, .agenda-ahora');
      if (primero && primero.getBoundingClientRect().top > window.innerHeight) primero.scrollIntoView({ block: 'center' });
    });
  }
}

const tipoBloqueo = (t) => ({ feriado: 'Feriado', vacaciones: 'Vacaciones' }[t] || 'Bloqueado');

// ---------------------------------------------------------------------
// Semana en celular: lista por día
// ---------------------------------------------------------------------
function pintarLista(cuerpo, { desde, hasta, turnosDe, bloqueosDe, tramosDe }) {
  const hoyF = hoy();
  let html = '<div class="agenda-lista">';
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const ts = turnosDe(f);
    const bls = bloqueosDe(f);
    const cerrado = !tramosDe(f).length;
    html += `<section class="panel dia-lista">
      <div class="panel-cab" style="margin-bottom:.3rem">
        <h3 class="${f === hoyF ? 'hoy' : ''}">${esc(fechaLarga(f))}${f === hoyF ? ' · hoy' : ''}</h3>
        <button type="button" class="btn btn-texto btn-chico" data-nuevo="${f}">+ Turno</button>
      </div>
      ${bls.map((b) => `<p class="aviso-inline">${esc(b.motivo || tipoBloqueo(b.tipo))}${b.hora_inicio ? ` · ${hhmm(b.hora_inicio)}–${hhmm(b.hora_fin)}` : ' · todo el día'}</p>`).join('')}
      <div class="lista-turnos">${ts.length ? ts.map((t) => itemTurno(t)).join('') : `<p class="leyenda" style="margin:0">${cerrado ? 'Cerrado' : 'Sin turnos'}</p>`}</div>
    </section>`;
  }
  html += '</div>';
  cuerpo.innerHTML = html;
  cuerpo.querySelectorAll('[data-nuevo]').forEach((b) => b.addEventListener('click', () => abrirTurno(null, { fecha: b.dataset.nuevo })));
}

// ---------------------------------------------------------------------
// Mes
// ---------------------------------------------------------------------
function pintarMes(cuerpo, { fecha, desde, hasta, turnosDe, bloqueosDe, tramosDe, ir }) {
  const hoyF = hoy();
  const mes = fecha.slice(0, 7);
  let html = `<div class="mes-grilla">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => `<div class="mes-dow">${d}</div>`).join('')}`;
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    const ts = turnosDe(f);
    const bl = bloqueosDe(f).find((b) => !b.hora_inicio);
    const visibles = ts.slice(0, 3);
    html += `<div class="mes-dia ${f.slice(0, 7) !== mes ? 'otro-mes' : ''} ${f === hoyF ? 'hoy' : ''}" data-dia="${f}" role="button" tabindex="0"
      aria-label="${esc(fechaLarga(f))}: ${ts.length} turno${ts.length === 1 ? '' : 's'}">
      <span class="mes-num">${Number(f.slice(8))}</span>
      ${bl ? `<span class="mes-mas">${esc(bl.motivo || tipoBloqueo(bl.tipo))}</span>` : (!tramosDe(f).length && !ts.length ? '<span class="mes-mas">Cerrado</span>' : '')}
      ${visibles.map((t) => `<button type="button" class="mes-ev ev-${t.estado}" data-turno="${t.id}" title="${esc(`${hhmm(t.hora_inicio)} ${t.cliente_nombre} ${t.cliente_apellido} · ${t.servicio_nombre}`)}">${hhmm(t.hora_inicio)} ${esc(t.cliente_nombre)}</button>`).join('')}
      ${ts.length > 3 ? `<span class="mes-mas">+${ts.length - 3} más</span>` : ''}
    </div>`;
  }
  html += '</div>';
  cuerpo.innerHTML = html;
  cuerpo.querySelectorAll('[data-dia]').forEach((c) => {
    const abrir = (e) => { if (!e.target.closest('[data-turno]')) ir({ vista: 'dia', fecha: c.dataset.dia }); };
    c.addEventListener('click', abrir);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(e); } });
  });
}
