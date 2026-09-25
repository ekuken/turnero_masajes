import { sb, q } from '../api.js';
import { esc, fechaCorta, fechaHoraDe, hhmm, linkWhatsApp } from '../utils.js';
import { toast, confirmar } from '../ui.js';
import { ctx, notificarCambio, params, irA } from './contexto.js';

const TIPOS = { confirmacion: 'Confirmación', recordatorio: 'Recordatorio', cancelacion: 'Cancelación', cambio_horario: 'Cambio de horario' };
const CANALES = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS' };

export async function contarAvisosPendientes() {
  const { count, error } = await sb.from('notificaciones').select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente').lte('programada_para', new Date().toISOString());
  if (error) return 0;
  return count || 0;
}

export async function vistaAvisos(cont) {
  const p = params();
  const pestaña = p.ver === 'historial' ? 'historial' : 'pendientes';
  let consulta = sb.from('notificaciones')
    .select('*, turnos(id, fecha, hora_inicio, estado, clientes(nombre, apellido))')
    .order('creada', { ascending: pestaña === 'pendientes' }).limit(200);
  consulta = pestaña === 'pendientes' ? consulta.eq('estado', 'pendiente') : consulta.neq('estado', 'pendiente');
  const avisos = await q(consulta);

  cont.innerHTML = `
    <div class="herramientas">
      <div class="segmentado" role="group">
        <button type="button" data-ver="pendientes" aria-pressed="${pestaña === 'pendientes'}">Por enviar</button>
        <button type="button" data-ver="historial" aria-pressed="${pestaña === 'historial'}">Historial</button>
      </div>
      ${pestaña === 'pendientes' && avisos.length ? '<button type="button" class="btn btn-sec btn-chico" id="descartar-todos">Descartar todos</button>' : ''}
    </div>
    <div class="panel">
      <p class="leyenda" style="margin-top:0">El sistema prepara un aviso cada vez que se reserva, confirma, cancela o reprograma un turno (y el día anterior, si activaste los recordatorios).
      Si el cliente dejó email, el aviso va por email; si no, por WhatsApp. Mientras no conectes un servicio de envío automático, podés enviarlos desde acá con un toque.</p>
      ${avisos.length ? avisos.map((a) => tarjeta(a, pestaña)).join('') : `<p class="vacio">${pestaña === 'pendientes' ? 'No hay avisos por enviar.' : 'Todavía no hay avisos enviados.'}</p>`}
    </div>`;

  cont.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => irA('avisos', { ver: b.dataset.ver === 'historial' ? 'historial' : '' })));

  cont.querySelector('#descartar-todos')?.addEventListener('click', async () => {
    if (!(await confirmar(`Se marcan los ${avisos.length} avisos como no enviados. No se borra nada.`, { titulo: '¿Descartar todos?', aceptar: 'Descartar' }))) return;
    try {
      await q(sb.from('notificaciones').update({ estado: 'omitida' }).eq('estado', 'pendiente'));
      toast('Avisos descartados.');
      notificarCambio();
    } catch (e) { toast(e.message, 'error'); }
  });

  cont.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    const id = Number(b.dataset.id);
    const a = avisos.find((x) => x.id === id);
    const accion = b.dataset.accion;
    if (accion === 'copiar') {
      try { await navigator.clipboard.writeText(a.mensaje); toast('Mensaje copiado.'); } catch { toast('No se pudo copiar. Seleccioná el texto manualmente.', 'error'); }
      return;
    }
    // "enviar" abre WhatsApp o el correo (el enlace sigue su curso) y marca el aviso como enviado
    const estado = accion === 'omitir' ? 'omitida' : 'enviada';
    try {
      await q(sb.from('notificaciones').update({ estado, enviada_en: estado === 'enviada' ? new Date().toISOString() : null }).eq('id', id));
      if (accion !== 'enviar') toast(estado === 'enviada' ? 'Marcado como enviado.' : 'Aviso descartado.');
      notificarCambio();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function tarjeta(a, pestaña) {
  const t = a.turnos;
  const enlace = a.canal === 'whatsapp'
    ? linkWhatsApp(a.destinatario, a.mensaje)
    : a.canal === 'email'
      ? `mailto:${encodeURIComponent(a.destinatario)}?subject=${encodeURIComponent(a.asunto || '')}&body=${encodeURIComponent(a.mensaje)}`
      : `sms:${encodeURIComponent(a.destinatario)}?body=${encodeURIComponent(a.mensaje)}`;
  const turnoCancelado = t?.estado === 'cancelado' && a.tipo !== 'cancelacion';
  return `
    <article style="padding:1rem 0;border-bottom:1px solid var(--line)">
      <div class="panel-cab" style="margin-bottom:.4rem">
        <span><b>${esc(TIPOS[a.tipo] || a.tipo)}</b> · ${esc(CANALES[a.canal])} a ${esc(t?.clientes ? `${t.clientes.nombre} ${t.clientes.apellido}` : a.destinatario)}
          <small class="leyenda" style="display:block;margin:0">${esc(a.destinatario)}${t ? ` · turno del ${esc(fechaCorta(t.fecha))} ${hhmm(t.hora_inicio)}` : ''}</small></span>
        ${pestaña === 'historial' ? `<span class="chip ${a.estado === 'enviada' ? 'st-confirmado' : a.estado === 'error' ? 'st-cancelado' : 'st-no_asistio'}">${a.estado === 'enviada' ? `Enviado ${esc(fechaHoraDe(a.enviada_en, ctx.tz))}` : a.estado === 'error' ? 'Error' : 'Descartado'}</span>` : ''}
      </div>
      ${turnoCancelado ? '<p class="aviso-inline">Ese turno ya fue cancelado: probablemente no haga falta enviar este aviso.</p>' : ''}
      <p style="background:var(--bg);padding:.7rem .9rem;border-radius:var(--r-s);font-size:.92rem;white-space:pre-wrap;margin:.3rem 0 .6rem">${esc(a.mensaje)}</p>
      ${a.error ? `<p class="leyenda" style="color:var(--danger)">${esc(a.error)}</p>` : ''}
      ${pestaña === 'pendientes' ? `
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <a class="btn btn-pri btn-chico" href="${esc(enlace)}" target="_blank" rel="noopener" data-accion="enviar" data-id="${a.id}">Enviar por ${esc(CANALES[a.canal])}</a>
          <button type="button" class="btn btn-sec btn-chico" data-accion="copiar" data-id="${a.id}">Copiar texto</button>
          <button type="button" class="btn btn-sec btn-chico" data-accion="marcar" data-id="${a.id}">Ya lo envié</button>
          <button type="button" class="btn btn-texto btn-chico" data-accion="omitir" data-id="${a.id}">Descartar</button>
          ${t ? `<button type="button" class="btn btn-texto btn-chico" data-turno="${t.id}">Ver turno</button>` : ''}
        </div>` : ''}
    </article>`;
}
