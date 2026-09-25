// ---------- Texto seguro ----------
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Fechas (siempre como texto 'YYYY-MM-DD' para evitar corrimientos de zona horaria) ----------
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const ZONA_DEFECTO = 'America/Argentina/Buenos_Aires';

export function hoyEn(tz = ZONA_DEFECTO) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

/** Minutos transcurridos del día actual en la zona horaria del negocio */
export function minutosAhoraEn(tz = ZONA_DEFECTO) {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date()).split(':').map(Number);
  return partes[0] * 60 + partes[1];
}

export function parseFecha(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const aISO = (dt) => dt.toISOString().slice(0, 10);
export function sumarDias(s, n) {
  const d = parseFecha(s);
  d.setUTCDate(d.getUTCDate() + n);
  return aISO(d);
}
export function sumarMeses(s, n) {
  const d = parseFecha(s);
  return aISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}
export const diaSemana = (s) => parseFecha(s).getUTCDay();
export const primerDiaMes = (s) => s.slice(0, 8) + '01';
export function ultimoDiaMes(s) {
  const d = parseFecha(s);
  return aISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
/** Lunes de la semana de la fecha */
export function inicioSemana(s) {
  const dow = diaSemana(s);
  return sumarDias(s, dow === 0 ? -6 : 1 - dow);
}
export function fechaLarga(s, conAnio = false) {
  const d = parseFecha(s);
  const txt = `${DIAS[d.getUTCDay()].toLowerCase()} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
  return conAnio ? `${txt} de ${d.getUTCFullYear()}` : txt;
}
export function fechaCorta(s) {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function mesAnio(s) {
  const d = parseFecha(s);
  return `${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export const capitalizar = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------- Horas ----------
export const hhmm = (t) => String(t ?? '').slice(0, 5);
export function aMin(t) {
  const [h, m] = hhmm(t).split(':').map(Number);
  return h * 60 + m;
}
export const deMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function duracionTxt(min) {
  min = Number(min) || 0;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Fecha y hora local de un timestamp, en la zona del negocio */
export function fechaHoraDe(ts, tz = ZONA_DEFECTO) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('es-AR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts));
}
export function fechaDe(ts, tz = ZONA_DEFECTO) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ts));
}

// ---------- Dinero ----------
export function dinero(n, moneda = 'ARS') {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda,
      minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `$ ${v.toLocaleString('es-AR')}`;
  }
}

// ---------- Teléfono / WhatsApp ----------
export const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/** Convierte un teléfono argentino al formato internacional que usa wa.me (549 + área + número) */
export function telefonoWhatsApp(tel) {
  let d = soloDigitos(tel);
  if (!d) return '';
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) return '549' + d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length > 10) return d; // probablemente ya es internacional de otro país
  return '549' + d;
}
export function linkWhatsApp(tel, texto = '') {
  const num = telefonoWhatsApp(tel);
  return `https://wa.me/${num}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

// ---------- Validaciones ----------
export const emailValido = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e).trim());
export function telefonoValido(t) {
  let d = soloDigitos(t);
  if (d.startsWith('549')) d = d.slice(3);
  else if (d.startsWith('54')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.length >= 8 && d.length <= 15;
}

// ---------- Estados ----------
export const ESTADOS = {
  pendiente:  { txt: 'Pendiente',  clase: 'st-pendiente' },
  confirmado: { txt: 'Confirmado', clase: 'st-confirmado' },
  en_curso:   { txt: 'En curso',   clase: 'st-en_curso' },
  realizado:  { txt: 'Realizado',  clase: 'st-realizado' },
  cancelado:  { txt: 'Cancelado',  clase: 'st-cancelado' },
  no_asistio: { txt: 'No asistió', clase: 'st-no_asistio' },
};
export const ESTADOS_PAGO = {
  pendiente:   { txt: 'Pago pendiente', corto: 'Pendiente', clase: 'pg-pendiente' },
  parcial:     { txt: 'Pago parcial',   corto: 'Parcial',   clase: 'pg-parcial' },
  pagado:      { txt: 'Pagado',         corto: 'Pagado',    clase: 'pg-pagado' },
  reembolsado: { txt: 'Cancelado/reembolsado', corto: 'Reembolsado', clase: 'pg-reembolsado' },
};
export const chipEstado = (e) =>
  `<span class="chip ${ESTADOS[e]?.clase || ''}">${esc(ESTADOS[e]?.txt || e)}</span>`;
export const chipPago = (e) =>
  `<span class="chip ${ESTADOS_PAGO[e]?.clase || ''}">${esc(ESTADOS_PAGO[e]?.corto || e)}</span>`;

// ---------- Varios ----------
export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Link para agregar el turno a Google Calendar */
export function linkGoogleCalendar({ titulo, fecha, hora, horaFin, detalle = '', lugar = '', tz = ZONA_DEFECTO }) {
  const f = fecha.replace(/-/g, '');
  const h1 = hhmm(hora).replace(':', '') + '00';
  const h2 = hhmm(horaFin).replace(':', '') + '00';
  const p = new URLSearchParams({ action: 'TEMPLATE', text: titulo, dates: `${f}T${h1}/${f}T${h2}`, ctz: tz, details: detalle });
  if (lugar) p.set('location', lugar);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
