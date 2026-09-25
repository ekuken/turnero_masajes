import { sb, q } from '../api.js';
import { dinero, hoyEn, ZONA_DEFECTO, soloDigitos } from '../utils.js';

export const ctx = {
  negocio: null,
  servicios: [],
  metodos: [],
  tz: ZONA_DEFECTO,
  usuario: null,
};

export async function cargarBase() {
  const [negocio, servicios, metodos] = await Promise.all([
    q(sb.from('negocio').select('*').eq('id', 1).single()),
    q(sb.from('servicios').select('*').order('orden').order('nombre')),
    q(sb.from('metodos_pago').select('*').order('orden').order('nombre')),
  ]);
  ctx.negocio = negocio;
  ctx.servicios = servicios;
  ctx.metodos = metodos;
  ctx.tz = negocio?.zona_horaria || ZONA_DEFECTO;
  document.getElementById('lateral-nombre').textContent = negocio?.nombre || 'Panel';
}

export const hoy = () => hoyEn(ctx.tz);
export const plata = (n) => dinero(n, ctx.negocio?.moneda || 'ARS');

/** Misma normalización que la base de datos (normalizar_telefono) */
export function normalizarTelefono(t) {
  const d = soloDigitos(t);
  if (d.startsWith('549')) return d.slice(3);
  if (d.startsWith('54')) return d.slice(2);
  if (d.startsWith('0')) return d.slice(1);
  return d;
}

/** Avisa a la vista actual que hubo cambios para que se actualice */
export function notificarCambio() {
  document.dispatchEvent(new CustomEvent('datos-cambiados'));
}

/**
 * Aplica un texto de búsqueda a una consulta sobre columnas de nombre/teléfono.
 * Cada palabra debe coincidir con alguna de las columnas (AND entre palabras, OR entre columnas).
 */
export function aplicarBusqueda(consulta, texto, { columnas, telefonoNorm }) {
  const palabras = String(texto || '').replace(/[,()*%\\:"']/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
  for (const p of palabras) {
    const partes = columnas.map((c) => `${c}.ilike.*${p}*`);
    const dig = soloDigitos(p);
    if (telefonoNorm && dig.length >= 3) partes.push(`${telefonoNorm}.ilike.*${normalizarTelefono(dig) || dig}*`);
    consulta = consulta.or(partes.join(','));
  }
  return consulta;
}

export const params = () => {
  const [, query = ''] = location.hash.split('?');
  return Object.fromEntries(new URLSearchParams(query));
};
export function irA(ruta, parametros = {}) {
  const qs = new URLSearchParams(Object.entries(parametros).filter(([, v]) => v !== '' && v != null)).toString();
  location.hash = `#/${ruta}${qs ? `?${qs}` : ''}`;
}
