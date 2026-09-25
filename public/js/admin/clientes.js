import { sb, q } from '../api.js';
import { esc, fechaCorta, fechaDe, linkWhatsApp, telefonoValido, emailValido, debounce } from '../utils.js';
import { toast, abrirModal, confirmar, conCarga, mostrarError, datosFormulario, icono } from '../ui.js';
import { ctx, plata, notificarCambio, aplicarBusqueda, params, irA } from './contexto.js';
import { itemTurno, abrirTurno } from './turnos.js';

const POR_PAGINA = 50;

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-cliente]');
  if (el && !e.defaultPrevented) {
    e.preventDefault();
    abrirCliente(Number(el.dataset.cliente)).catch((err) => toast(err.message, 'error'));
  }
});

let enfocar = false;

export async function vistaClientes(cont) {
  const p = params();
  const f = { q: p.q || '', orden: p.orden || 'recientes', pag: Math.max(1, Number(p.pag) || 1) };
  const aplicar = (c) => {
    const n = { ...f, ...c };
    if (!('pag' in c)) n.pag = 1;
    irA('clientes', { q: n.q, orden: n.orden === 'recientes' ? '' : n.orden, pag: n.pag > 1 ? n.pag : '' });
  };

  let consulta = aplicarBusqueda(sb.from('clientes_resumen').select('*', { count: 'exact' }), f.q,
    { columnas: ['nombre', 'apellido', 'telefono', 'email'], telefonoNorm: 'telefono_norm' });
  if (f.orden === 'nombre') consulta = consulta.order('nombre').order('apellido');
  else if (f.orden === 'gastado') consulta = consulta.order('total_gastado', { ascending: false });
  else if (f.orden === 'ultimo') consulta = consulta.order('ultimo_turno', { ascending: false, nullsFirst: false });
  else consulta = consulta.order('fecha_registro', { ascending: false });
  const desde = (f.pag - 1) * POR_PAGINA;
  const { data: clientes, count, error } = await consulta.range(desde, desde + POR_PAGINA - 1);
  if (error) throw new Error(error.message);

  cont.innerHTML = `
    <div class="herramientas">
      <input class="crece" type="search" id="c-q" placeholder="Buscar por nombre, teléfono o email" value="${esc(f.q)}" aria-label="Buscar clientes">
      <select id="c-orden" aria-label="Ordenar">
        <option value="recientes">Registrados recientemente</option>
        <option value="nombre">Por nombre</option>
        <option value="ultimo">Último turno</option>
        <option value="gastado">Mayor gasto</option>
      </select>
      <button type="button" class="btn btn-pri" id="btn-nuevo-cliente">${icono.mas} Nuevo cliente</button>
    </div>
    <div class="panel">
      <div class="tabla-scroll">
        <table class="tabla tabla-fichas">
          <thead><tr><th>Cliente</th><th>Teléfono</th><th>Email</th><th class="num">Realizados</th><th class="num">Cancelaciones</th><th class="num">Total gastado</th><th>Último turno</th></tr></thead>
          <tbody>
            ${clientes.length ? clientes.map((c) => `
              <tr data-cliente="${c.id}" data-abrir>
                <td class="principal-ficha">${esc(c.nombre)} ${esc(c.apellido)}</td>
                <td data-t="Teléfono">${esc(c.telefono)}</td>
                <td data-t="Email">${esc(c.email || '—')}</td>
                <td class="num" data-t="Realizados">${c.turnos_realizados}</td>
                <td class="num" data-t="Cancelaciones">${c.cancelaciones}</td>
                <td class="num" data-t="Total gastado">${plata(c.total_gastado)}</td>
                <td data-t="Último turno">${c.ultimo_turno ? esc(fechaCorta(c.ultimo_turno)) : '—'}</td>
              </tr>`).join('')
              : `<tr><td colspan="7" class="tabla-vacia">${f.q ? 'No hay clientes que coincidan.' : 'Todavía no hay clientes. Se crean solos con cada reserva online, o podés cargarlos acá.'}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="paginacion">
        <span>${count} cliente${count === 1 ? '' : 's'}</span>
        ${count > POR_PAGINA ? `<span>
          <button type="button" class="btn btn-sec btn-chico" data-pag="${f.pag - 1}" ${f.pag <= 1 ? 'disabled' : ''}>Anterior</button>
          <button type="button" class="btn btn-sec btn-chico" data-pag="${f.pag + 1}" ${desde + POR_PAGINA >= count ? 'disabled' : ''}>Siguiente</button></span>` : ''}
      </div>
    </div>`;

  cont.querySelector('#c-orden').value = f.orden;
  cont.querySelector('#c-orden').addEventListener('change', (e) => aplicar({ orden: e.target.value }));
  const inputQ = cont.querySelector('#c-q');
  inputQ.addEventListener('input', debounce(() => { enfocar = true; aplicar({ q: inputQ.value.trim() }); }, 450));
  cont.querySelectorAll('[data-pag]').forEach((b) => b.addEventListener('click', () => aplicar({ pag: Number(b.dataset.pag) })));
  cont.querySelector('#btn-nuevo-cliente').addEventListener('click', () => abrirCliente(null));
  if (enfocar) {
    enfocar = false;
    requestAnimationFrame(() => { inputQ.focus(); inputQ.setSelectionRange(inputQ.value.length, inputQ.value.length); });
  }
}

export async function abrirCliente(id) {
  let c = null;
  let turnos = [];
  if (id) {
    [c, turnos] = await Promise.all([
      q(sb.from('clientes_resumen').select('*').eq('id', id).single()),
      q(sb.from('turnos_detalle').select('*').eq('cliente_id', id).order('fecha', { ascending: false }).order('hora_inicio', { ascending: false }).limit(200)),
    ]);
  }
  const m = abrirModal({ titulo: c ? `${c.nombre} ${c.apellido}` : 'Nuevo cliente', ancho: 'lg' });
  m.cuerpo.innerHTML = `
    ${c ? `
      <div class="stats-cliente">
        <div><b>${c.turnos_realizados}</b><small>Realizados</small></div>
        <div><b>${c.cancelaciones}</b><small>Cancelaciones</small></div>
        <div><b>${c.ausencias}</b><small>Ausencias</small></div>
        <div><b>${plata(c.total_gastado)}</b><small>Total gastado</small></div>
      </div>` : ''}
    <form id="form-cliente" novalidate>
      <div class="error-form" id="error-cliente" hidden></div>
      <div class="fila-campos">
        <div class="campo"><label for="cl-nombre">Nombre</label><input id="cl-nombre" name="nombre" maxlength="60" required value="${esc(c?.nombre)}"></div>
        <div class="campo"><label for="cl-apellido">Apellido</label><input id="cl-apellido" name="apellido" maxlength="60" value="${esc(c?.apellido)}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label for="cl-tel">Teléfono</label><input id="cl-tel" name="telefono" type="tel" maxlength="25" required value="${esc(c?.telefono)}"></div>
        <div class="campo"><label for="cl-email">Email <span class="opcional">(opcional)</span></label><input id="cl-email" name="email" type="email" maxlength="120" value="${esc(c?.email)}"></div>
        <div class="campo"><label for="cl-nac">Fecha de nacimiento <span class="opcional">(opcional)</span></label><input id="cl-nac" name="fecha_nacimiento" type="date" value="${esc(c?.fecha_nacimiento)}"></div>
      </div>
      <div class="campo"><label for="cl-notas">Notas internas</label><textarea id="cl-notas" name="notas" placeholder="Preferencias, zonas sensibles, contraindicaciones…">${esc(c?.notas)}</textarea></div>
      ${c ? `<p class="leyenda">Cliente desde el ${esc(fechaCorta(fechaDe(c.fecha_registro, ctx.tz)))}.</p>` : ''}
      <div class="acciones-ficha">
        <div class="grupo">
          ${c ? `<button type="button" class="btn btn-suave" data-nuevo-turno>${icono.mas} Nuevo turno</button>
                 <a class="btn btn-sec" target="_blank" rel="noopener" href="${esc(linkWhatsApp(c.telefono, `Hola ${c.nombre}!`))}">${icono.whatsapp} WhatsApp</a>` : ''}
          ${c && Number(c.total_turnos) === 0 ? '<button type="button" class="btn btn-texto" data-eliminar style="color:var(--danger)">Eliminar cliente</button>' : ''}
        </div>
        <div class="grupo">
          <button type="button" class="btn btn-sec" data-cerrar>Cerrar</button>
          <button type="submit" class="btn btn-pri">${c ? 'Guardar cambios' : 'Crear cliente'}</button>
        </div>
      </div>
    </form>
    ${c ? `
      <h3 style="margin-top:1.6rem">Historial de turnos</h3>
      <div class="lista-turnos">${turnos.length ? turnos.map((t) => itemTurno(t, { conFecha: true })).join('') : '<p class="vacio">Sin turnos todavía.</p>'}</div>
      ${turnos.length === 200 ? '<p class="leyenda">Se muestran los últimos 200 turnos.</p>' : ''}` : ''}`;

  const form = m.cuerpo.querySelector('#form-cliente');
  const caja = m.cuerpo.querySelector('#error-cliente');

  // Al abrir un turno del historial, cerrar esta ficha para no apilar ventanas
  m.cuerpo.querySelectorAll('[data-turno]').forEach((b) => b.addEventListener('click', () => m.cerrar()));
  m.cuerpo.querySelector('[data-nuevo-turno]')?.addEventListener('click', () => {
    m.cerrar();
    abrirTurno(null, { cliente: { id: c.id, nombre: c.nombre, apellido: c.apellido, telefono: c.telefono, email: c.email } });
  });
  m.cuerpo.querySelector('[data-eliminar]')?.addEventListener('click', async () => {
    const ok = await confirmar('Se borra la ficha del cliente. Solo es posible porque no tiene turnos.', { titulo: '¿Eliminar cliente?', aceptar: 'Eliminar', peligro: true });
    if (!ok) return;
    try {
      await q(sb.from('clientes').delete().eq('id', c.id));
      toast('Cliente eliminado.');
      m.cerrar();
      notificarCambio();
    } catch (e) { toast(e.message, 'error'); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(form);
    const errores = [];
    if (!d.nombre) errores.push('Ingresá el nombre.');
    if (!telefonoValido(d.telefono)) errores.push('Ingresá un teléfono válido, con código de área.');
    if (d.email && !emailValido(d.email)) errores.push('El email no es válido.');
    if (errores.length) return mostrarError(caja, errores.join(' '));
    mostrarError(caja, '');
    const datos = {
      nombre: d.nombre, apellido: d.apellido || '', telefono: d.telefono,
      email: d.email ? d.email.toLowerCase() : null, fecha_nacimiento: d.fecha_nacimiento || null, notas: d.notas || null,
    };
    try {
      await conCarga(form.querySelector('button[type=submit]'), async () => {
        if (c) await q(sb.from('clientes').update(datos).eq('id', c.id).select('id').single());
        else await q(sb.from('clientes').insert(datos).select('id').single());
      });
      toast(c ? 'Cliente actualizado.' : 'Cliente creado.');
      m.cerrar();
      notificarCambio();
    } catch (err) { mostrarError(caja, err.message); }
  });
}
