import { sb, q } from '../api.js';
import { esc, duracionTxt } from '../utils.js';
import { toast, abrirModal, confirmar, conCarga, mostrarError, datosFormulario, icono } from '../ui.js';
import { ctx, plata, cargarBase, notificarCambio } from './contexto.js';

export async function vistaServicios(cont) {
  await cargarBase();
  const servicios = ctx.servicios;
  cont.innerHTML = `
    <div class="herramientas">
      <p class="leyenda" style="margin:0;flex:1">Los servicios activos se muestran en la web en este orden. Los cambios de precio no afectan a los turnos ya reservados.</p>
      <button type="button" class="btn btn-pri" id="btn-nuevo-servicio">${icono.mas} Nuevo servicio</button>
    </div>
    <div class="panel">
      <div class="tabla-scroll">
        <table class="tabla tabla-fichas">
          <thead><tr><th>Orden</th><th>Servicio</th><th>Duración</th><th class="num">Precio</th><th>Estado</th></tr></thead>
          <tbody>
            ${servicios.length ? servicios.map((s) => `
              <tr data-servicio="${s.id}" data-abrir>
                <td data-t="Orden" class="suave">${s.orden}</td>
                <td class="principal-ficha">${esc(s.nombre)}${s.descripcion ? `<br><small class="suave" style="font-weight:400">${esc(s.descripcion)}</small>` : ''}</td>
                <td data-t="Duración">${duracionTxt(s.duracion)}</td>
                <td class="num" data-t="Precio">${plata(s.precio)}</td>
                <td>${s.activo ? '<span class="chip st-confirmado">Activo</span>' : '<span class="chip st-no_asistio">Inactivo</span>'}</td>
              </tr>`).join('')
              : '<tr><td colspan="5" class="tabla-vacia">Todavía no cargaste servicios. Creá el primero para habilitar las reservas.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  cont.querySelector('#btn-nuevo-servicio').addEventListener('click', () => abrirServicio(null));
  cont.querySelectorAll('[data-servicio]').forEach((tr) => tr.addEventListener('click', () =>
    abrirServicio(servicios.find((s) => s.id === Number(tr.dataset.servicio)))));
}

function abrirServicio(s) {
  const siguienteOrden = Math.max(0, ...ctx.servicios.map((x) => x.orden)) + 1;
  const m = abrirModal({ titulo: s ? 'Editar servicio' : 'Nuevo servicio' });
  m.cuerpo.innerHTML = `
    <form id="form-servicio" novalidate>
      <div class="error-form" id="error-servicio" hidden></div>
      <div class="campo"><label for="s-nombre">Nombre</label><input id="s-nombre" name="nombre" maxlength="80" required value="${esc(s?.nombre)}"></div>
      <div class="campo"><label for="s-desc">Descripción</label><textarea id="s-desc" name="descripcion" maxlength="400">${esc(s?.descripcion)}</textarea></div>
      <div class="fila-campos">
        <div class="campo"><label for="s-dur">Duración (minutos)</label><input id="s-dur" name="duracion" type="number" min="5" max="600" step="5" required value="${esc(s?.duracion ?? 60)}"></div>
        <div class="campo"><label for="s-precio">Precio</label><input id="s-precio" name="precio" type="number" min="0" step="0.01" required value="${esc(s?.precio ?? '')}"></div>
        <div class="campo"><label for="s-orden">Orden en la web</label><input id="s-orden" name="orden" type="number" step="1" value="${esc(s?.orden ?? siguienteOrden)}"></div>
      </div>
      <div class="campo"><label for="s-img">Imagen <span class="opcional">(opcional, dirección web de la foto)</span></label>
        <input id="s-img" name="imagen_url" type="url" placeholder="https://…" value="${esc(s?.imagen_url)}"></div>
      <label class="check"><input type="checkbox" name="activo" ${s?.activo === false ? '' : 'checked'}> Activo (se puede reservar)</label>
      <div class="acciones-ficha">
        <div class="grupo">${s ? '<button type="button" class="btn btn-texto" data-eliminar style="color:var(--danger)">Eliminar</button>' : ''}</div>
        <div class="grupo">
          <button type="button" class="btn btn-sec" data-cerrar>Cancelar</button>
          <button type="submit" class="btn btn-pri">${s ? 'Guardar cambios' : 'Crear servicio'}</button>
        </div>
      </div>
    </form>`;
  const form = m.cuerpo.querySelector('form');
  const caja = m.cuerpo.querySelector('#error-servicio');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(form);
    const dur = Number(d.duracion);
    const precio = Number(d.precio);
    const errores = [];
    if (!d.nombre) errores.push('Ingresá el nombre.');
    if (!Number.isInteger(dur) || dur < 5 || dur > 600) errores.push('La duración debe ser un número entero entre 5 y 600.');
    if (d.precio === '' || !(precio >= 0)) errores.push('Ingresá un precio válido.');
    if (d.imagen_url && !/^https?:\/\/\S+$/i.test(d.imagen_url)) errores.push('La imagen debe ser una dirección web que empiece con https://');
    if (errores.length) return mostrarError(caja, errores.join(' '));
    const datos = {
      nombre: d.nombre, descripcion: d.descripcion || '', duracion: dur, precio,
      orden: Number.parseInt(d.orden, 10) || 0, imagen_url: d.imagen_url || null, activo: d.activo,
    };
    try {
      await conCarga(form.querySelector('button[type=submit]'), async () => {
        if (s) await q(sb.from('servicios').update(datos).eq('id', s.id).select('id').single());
        else await q(sb.from('servicios').insert(datos).select('id').single());
      });
      toast(s ? 'Servicio actualizado.' : 'Servicio creado.');
      m.cerrar();
      await cargarBase();
      notificarCambio();
    } catch (err) { mostrarError(caja, err.message); }
  });

  m.cuerpo.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
    const ok = await confirmar('Si el servicio tiene turnos registrados no se puede borrar (para no perder el historial); en ese caso, desactivalo.',
      { titulo: '¿Eliminar servicio?', aceptar: 'Eliminar', peligro: true });
    if (!ok) return;
    try {
      await q(sb.from('servicios').delete().eq('id', s.id));
      toast('Servicio eliminado.');
      m.cerrar();
      await cargarBase();
      notificarCambio();
    } catch (err) { mostrarError(caja, err.message); }
  });
}
