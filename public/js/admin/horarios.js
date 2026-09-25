import { sb, q } from '../api.js';
import { esc, DIAS, fechaCorta, fechaLarga, capitalizar, hhmm, aMin } from '../utils.js';
import { toast, confirmar, conCarga, mostrarError, datosFormulario, abrirModal } from '../ui.js';
import { hoy, notificarCambio } from './contexto.js';
import { itemTurno } from './turnos.js';

const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const TIPOS = { bloqueo: 'Bloqueo', feriado: 'Feriado', vacaciones: 'Vacaciones' };

// Cambios del horario semanal sin guardar: se conservan aunque la vista se vuelva a dibujar
let borrador = null;
window.addEventListener('beforeunload', (ev) => { if (borrador) { ev.preventDefault(); ev.returnValue = ''; } });

export async function vistaHorarios(cont) {
  const h = hoy();
  const [horarios, excepciones, bloqueos] = await Promise.all([
    q(sb.from('horarios').select('*').order('dia_semana').order('hora_inicio')),
    q(sb.from('excepciones_horario').select('*').gte('fecha', h).order('fecha').order('hora_inicio')),
    q(sb.from('bloqueos').select('*').or(`fecha_hasta.gte.${h},and(fecha_hasta.is.null,fecha.gte.${h})`).order('fecha')),
  ]);

  // Estado editable del horario semanal
  const tramos = borrador || horarios.map((x) => ({ id: x.id, dia: x.dia_semana, ini: hhmm(x.hora_inicio), fin: hhmm(x.hora_fin), activo: x.activo }));
  const marcarCambio = () => { borrador = tramos; cont.querySelector('#aviso-borrador').hidden = false; };

  cont.innerHTML = `
    <div class="grilla-2">
      <section class="panel">
        <div class="panel-cab"><h2>Horario semanal</h2><button type="button" class="btn btn-pri" id="btn-guardar-horario">Guardar horario</button></div>
        <p class="leyenda" style="margin-top:0">Un día sin franjas queda cerrado. Podés tener varias franjas por día (por ejemplo, mañana y tarde).</p>
        <p class="aviso-inline" id="aviso-borrador" ${borrador ? '' : 'hidden'}>Tenés cambios sin guardar en el horario semanal.</p>
        <div class="error-form" id="error-horario" hidden></div>
        <div id="dias"></div>
      </section>
      <div>
        <section class="panel">
          <div class="panel-cab"><h2>Bloqueos, feriados y vacaciones</h2></div>
          <form id="form-bloqueo" novalidate>
            <div class="error-form" id="error-bloqueo" hidden></div>
            <div class="fila-campos">
              <div class="campo"><label for="b-tipo">Tipo</label><select id="b-tipo" name="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
              <div class="campo"><label for="b-fecha">Desde</label><input id="b-fecha" name="fecha" type="date" min="${h}" required></div>
              <div class="campo"><label for="b-hasta">Hasta <span class="opcional">(opcional)</span></label><input id="b-hasta" name="fecha_hasta" type="date" min="${h}"></div>
            </div>
            <label class="check" style="margin-bottom:1rem"><input type="checkbox" name="dia_completo" checked> Todo el día</label>
            <div class="fila-campos" id="b-horas" hidden>
              <div class="campo"><label for="b-ini">Desde las</label><input id="b-ini" name="hora_inicio" type="time"></div>
              <div class="campo"><label for="b-fin">Hasta las</label><input id="b-fin" name="hora_fin" type="time"></div>
            </div>
            <div class="campo"><label for="b-motivo">Motivo <span class="opcional">(solo lo ves vos)</span></label><input id="b-motivo" name="motivo" maxlength="120" placeholder="Ej: turno médico, Navidad, viaje"></div>
            <button type="submit" class="btn btn-pri">Agregar bloqueo</button>
          </form>
          <h3 style="margin-top:1.5rem">Próximos bloqueos</h3>
          <ul class="lista-simple">
            ${bloqueos.length ? bloqueos.map((b) => `
              <li><span><b>${esc(TIPOS[b.tipo])}</b> · ${esc(rangoTxt(b))}${b.motivo ? `<br><small>${esc(b.motivo)}</small>` : ''}</span>
              <button type="button" class="btn btn-texto" data-borrar-bloqueo="${b.id}">Quitar</button></li>`).join('')
              : '<li><span class="leyenda" style="margin:0">No hay bloqueos cargados.</span></li>'}
          </ul>
        </section>
        <section class="panel">
          <div class="panel-cab"><h2>Horarios especiales</h2></div>
          <p class="leyenda" style="margin-top:0">Para una fecha puntual con horario distinto al habitual. Reemplaza el horario semanal de ese día.</p>
          <form id="form-excepcion" class="fila-campos" novalidate style="align-items:end">
            <div class="campo"><label for="e-fecha">Fecha</label><input id="e-fecha" name="fecha" type="date" min="${h}" required></div>
            <div class="campo"><label for="e-ini">Desde</label><input id="e-ini" name="hora_inicio" type="time" required></div>
            <div class="campo"><label for="e-fin">Hasta</label><input id="e-fin" name="hora_fin" type="time" required></div>
            <div class="campo"><button type="submit" class="btn btn-pri">Agregar</button></div>
          </form>
          <ul class="lista-simple">
            ${excepciones.length ? excepciones.map((x) => `
              <li><span>${esc(capitalizar(fechaLarga(x.fecha)))} · ${hhmm(x.hora_inicio)} a ${hhmm(x.hora_fin)}</span>
              <button type="button" class="btn btn-texto" data-borrar-excepcion="${x.id}">Quitar</button></li>`).join('')
              : '<li><span class="leyenda" style="margin:0">No hay horarios especiales.</span></li>'}
          </ul>
        </section>
      </div>
    </div>`;

  // ---------- Horario semanal ----------
  const contDias = cont.querySelector('#dias');
  function pintarDias() {
    contDias.innerHTML = ORDEN_DIAS.map((d) => {
      const delDia = tramos.map((t, i) => ({ ...t, i })).filter((t) => t.dia === d);
      return `
        <div class="dia-horario">
          <div class="dia-nombre">${DIAS[d]}</div>
          <div class="tramos">
            ${delDia.length ? delDia.map((t) => `
              <div class="tramo">
                <input type="time" value="${esc(t.ini)}" data-i="${t.i}" data-k="ini" aria-label="${DIAS[d]} desde">
                <span>a</span>
                <input type="time" value="${esc(t.fin)}" data-i="${t.i}" data-k="fin" aria-label="${DIAS[d]} hasta">
                <button type="button" class="btn-icono" data-quitar="${t.i}" aria-label="Quitar franja">
                  <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
              </div>`).join('') : '<div class="cerrado-txt">Cerrado</div>'}
            <div><button type="button" class="btn btn-texto btn-chico" data-agregar="${d}">+ Agregar franja</button></div>
          </div>
        </div>`;
    }).join('');
  }
  pintarDias();

  contDias.addEventListener('input', (e) => {
    const el = e.target.closest('[data-i]');
    if (!el) return;
    tramos[Number(el.dataset.i)][el.dataset.k] = el.value;
    marcarCambio();
  });
  contDias.addEventListener('click', (e) => {
    const quitar = e.target.closest('[data-quitar]');
    const agregar = e.target.closest('[data-agregar]');
    if (quitar) { tramos.splice(Number(quitar.dataset.quitar), 1); marcarCambio(); pintarDias(); }
    if (agregar) {
      const d = Number(agregar.dataset.agregar);
      const previos = tramos.filter((t) => t.dia === d).sort((a, b) => a.fin.localeCompare(b.fin));
      const ultimo = previos[previos.length - 1];
      tramos.push({ dia: d, ini: ultimo ? ultimo.fin : '09:00', fin: ultimo ? '20:00' : '13:00', activo: true });
      marcarCambio();
      pintarDias();
    }
  });

  cont.querySelector('#btn-guardar-horario').addEventListener('click', async (e) => {
    const caja = cont.querySelector('#error-horario');
    // Validación
    const errores = [];
    for (const d of ORDEN_DIAS) {
      const lista = tramos.filter((t) => t.dia === d).sort((a, b) => a.ini.localeCompare(b.ini));
      lista.forEach((t, i) => {
        if (!t.ini || !t.fin) errores.push(`${DIAS[d]}: completá las horas.`);
        else if (aMin(t.fin) <= aMin(t.ini)) errores.push(`${DIAS[d]}: la hora de cierre tiene que ser posterior a la de apertura.`);
        else if (i > 0 && aMin(t.ini) < aMin(lista[i - 1].fin)) errores.push(`${DIAS[d]}: hay franjas que se superponen.`);
      });
    }
    if (errores.length) return mostrarError(caja, [...new Set(errores)].join(' '));
    mostrarError(caja, '');

    const idsActuales = new Set(tramos.filter((t) => t.id).map((t) => t.id));
    const borrar = horarios.filter((x) => !idsActuales.has(x.id)).map((x) => x.id);
    const actualizar = tramos.filter((t) => t.id).filter((t) => {
      const orig = horarios.find((x) => x.id === t.id);
      return hhmm(orig.hora_inicio) !== t.ini || hhmm(orig.hora_fin) !== t.fin || !orig.activo;
    });
    const nuevos = tramos.filter((t) => !t.id);
    try {
      await conCarga(e.currentTarget, async () => {
        if (borrar.length) await q(sb.from('horarios').delete().in('id', borrar));
        for (const t of actualizar) {
          await q(sb.from('horarios').update({ hora_inicio: t.ini, hora_fin: t.fin, activo: true }).eq('id', t.id));
        }
        if (nuevos.length) {
          await q(sb.from('horarios').insert(nuevos.map((t) => ({ dia_semana: t.dia, hora_inicio: t.ini, hora_fin: t.fin, activo: true }))));
        }
      });
      borrador = null;
      toast('Horario guardado.');
      notificarCambio();
    } catch (err) { mostrarError(caja, err.message); }
  });

  // ---------- Bloqueos ----------
  const fb = cont.querySelector('#form-bloqueo');
  fb.elements.dia_completo.addEventListener('change', () => { cont.querySelector('#b-horas').hidden = fb.elements.dia_completo.checked; });
  fb.addEventListener('submit', async (e) => {
    e.preventDefault();
    const caja = cont.querySelector('#error-bloqueo');
    const d = datosFormulario(fb);
    const errores = [];
    if (!d.fecha) errores.push('Elegí la fecha.');
    if (d.fecha && d.fecha < h) errores.push('La fecha no puede ser anterior a hoy.');
    if (d.fecha_hasta && d.fecha && d.fecha_hasta < d.fecha) errores.push('La fecha "hasta" debe ser igual o posterior a "desde".');
    if (!d.dia_completo) {
      if (!d.hora_inicio || !d.hora_fin) errores.push('Completá el horario a bloquear.');
      else if (aMin(d.hora_fin) <= aMin(d.hora_inicio)) errores.push('La hora final tiene que ser posterior a la inicial.');
    }
    if (errores.length) return mostrarError(caja, errores.join(' '));
    mostrarError(caja, '');
    const datos = {
      tipo: d.tipo, fecha: d.fecha, fecha_hasta: d.fecha_hasta && d.fecha_hasta !== d.fecha ? d.fecha_hasta : null,
      hora_inicio: d.dia_completo ? null : d.hora_inicio, hora_fin: d.dia_completo ? null : d.hora_fin, motivo: d.motivo || null,
    };
    try {
      await conCarga(fb.querySelector('button[type=submit]'), () => q(sb.from('bloqueos').insert(datos).select('id').single()));
      toast('Bloqueo agregado. Esos horarios ya no se ofrecen en la web.');
      await avisarTurnosAfectados(datos);
      notificarCambio();
    } catch (err) { mostrarError(caja, err.message); }
  });

  cont.querySelectorAll('[data-borrar-bloqueo]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('Esos días u horarios vuelven a estar disponibles para reservar.', { titulo: '¿Quitar bloqueo?', aceptar: 'Quitar' }))) return;
    try {
      await q(sb.from('bloqueos').delete().eq('id', Number(b.dataset.borrarBloqueo)));
      toast('Bloqueo quitado.');
      notificarCambio();
    } catch (err) { toast(err.message, 'error'); }
  }));

  // ---------- Excepciones ----------
  const fe = cont.querySelector('#form-excepcion');
  fe.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(fe);
    if (!d.fecha || !d.hora_inicio || !d.hora_fin) return toast('Completá fecha y horario.', 'error');
    if (aMin(d.hora_fin) <= aMin(d.hora_inicio)) return toast('La hora final tiene que ser posterior a la inicial.', 'error');
    try {
      await conCarga(fe.querySelector('button'), () => q(sb.from('excepciones_horario').insert(d).select('id').single()));
      toast('Horario especial agregado.');
      notificarCambio();
    } catch (err) { toast(err.message, 'error'); }
  });
  cont.querySelectorAll('[data-borrar-excepcion]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('Ese día vuelve a usar el horario semanal habitual.', { titulo: '¿Quitar horario especial?', aceptar: 'Quitar' }))) return;
    try {
      await q(sb.from('excepciones_horario').delete().eq('id', Number(b.dataset.borrarExcepcion)));
      toast('Horario especial quitado.');
      notificarCambio();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function rangoTxt(b) {
  const fechas = b.fecha_hasta ? `del ${fechaCorta(b.fecha)} al ${fechaCorta(b.fecha_hasta)}` : fechaCorta(b.fecha);
  return b.hora_inicio ? `${fechas}, de ${hhmm(b.hora_inicio)} a ${hhmm(b.hora_fin)}` : `${fechas}, todo el día`;
}

/** Si ya había turnos en el período bloqueado, los muestra para reprogramarlos o cancelarlos */
async function avisarTurnosAfectados(b) {
  const hasta = b.fecha_hasta || b.fecha;
  let turnos = await q(sb.from('turnos_detalle').select('*').gte('fecha', b.fecha).lte('fecha', hasta)
    .in('estado', ['pendiente', 'confirmado']).order('fecha').order('hora_inicio'));
  if (b.hora_inicio) {
    const i = aMin(b.hora_inicio), f = aMin(b.hora_fin);
    turnos = turnos.filter((t) => aMin(t.hora_inicio) < f && aMin(t.hora_fin) > i);
  }
  if (!turnos.length) return;
  const m = abrirModal({
    titulo: 'Hay turnos en ese período', ancho: 'lg',
    contenido: `<p>El bloqueo no cancela turnos automáticamente. Estos ${turnos.length} turno${turnos.length === 1 ? '' : 's'} siguen activos: abrilos para reprogramarlos o cancelarlos.</p>
      <div class="lista-turnos">${turnos.map((t) => itemTurno(t, { conFecha: true })).join('')}</div>
      <div class="acciones"><button type="button" class="btn btn-pri" data-cerrar>Entendido</button></div>`,
  });
  m.cuerpo.querySelectorAll('[data-turno]').forEach((x) => x.addEventListener('click', () => m.cerrar()));
}
