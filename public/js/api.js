import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configurado =
  !!SUPABASE_URL && !SUPABASE_URL.includes('TU-PROYECTO') &&
  !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('TU-');

export const sb = configurado
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

export function mensajeError(error) {
  if (!error) return 'Ocurrió un error inesperado.';
  const code = error.code || '';
  const msg = error.message || String(error);
  if (code === '23P01') return 'Ese horario se superpone con otro turno. Elegí otro horario.';
  if (code === '23505') {
    if (msg.includes('clientes_telefono')) return 'Ya existe un cliente con ese teléfono.';
    if (msg.includes('metodos_pago')) return 'Ya existe un método de pago con ese nombre.';
    return 'Ese dato ya existe y no se puede repetir.';
  }
  if (code === '23503') return 'No se puede eliminar porque tiene turnos o pagos asociados. Podés desactivarlo en su lugar.';
  if (code === '23514') {
    if (msg.includes('telefono')) return 'El teléfono no es válido.';
    if (msg.includes('email')) return 'El email no es válido.';
    if (msg.includes('hora')) return 'La hora de fin tiene que ser posterior a la de inicio.';
    return 'Algún dato no es válido. Revisá el formulario.';
  }
  if (code === '42501' || msg.includes('row-level security')) return 'No tenés permiso para hacer esto.';
  if (code === 'P0001') return msg;
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'No hay conexión. Revisá internet e intentá de nuevo.';
  if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (msg.includes('JWT expired')) return 'La sesión venció. Volvé a ingresar.';
  return msg;
}

/** Llama a una función RPC y devuelve los datos o lanza un Error con mensaje claro. */
export async function rpc(nombre, args = {}) {
  const { data, error } = await sb.rpc(nombre, args);
  if (error) throw new Error(mensajeError(error));
  return data;
}

/** Ejecuta una consulta de supabase-js y devuelve los datos o lanza un Error claro. */
export async function q(consulta) {
  const { data, error } = await consulta;
  if (error) throw new Error(mensajeError(error));
  return data;
}
