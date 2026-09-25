import { sb, q, rpc } from '../api.js';
import {
  esc, fechaCorta, fechaLarga, hhmm, aMin, deMin, duracionTxt, chipEstado, chipPago,
  ESTADOS, ESTADOS_PAGO, linkWhatsApp, telefonoValido, emailValido, debounce, fechaDe,
} from '../utils.js';
import { toast, abrirModal, confirmar, conCarga, mostrarError, datosFormulario, icono } from '../ui.js';
import { ctx, hoy, plata, normalizarTelefono, notificarCambio, aplicarBusqueda, params, irA } from './contexto.js';

const POR_PAGINA = 50;
const ACTIVOS = ['pendiente', 'confirmado'];

// ---------------------------------------------------------------------
// Elementos reutilizables
// ---------------------------------------------------------------------
export function itemTurno(t, { conFecha = false } = {}) {
  const pide = t.solicitud_cancelacion && ACTIVOS.includes(t.estado);
  return `
    <button type="button" class="item-turno" data-turno="${t.id}">
      <span class="item-hora">${hhmm(t.hora_inicio)}<small>${conFecha ? esc(fechaCorta(t.fecha).slice(0, 5)) : duracionTxt(t.duracion)}</small></span>
      <span class="item-detalle">
        <strong>${esc(t.cliente_nombre)} ${esc(t.cliente_apellido)}</strong>
        <small>${esc(t.servicio_nombre)}${conFecha ? ` · ${duracionTxt(t.duracion)}` : ''}</small>
      </span>
      <span class="item-chips">${pide ? '<span class="chip st-cancelado">Pide cancelar</span>' : ''}${chipEstado(t.estado)}${chipPago(t.estado_pago)}</span>
    </button>`;
}

// Abrir un turno desde cualquier lista
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-turno]');
  if (el && !e.defaultPrevented) {
    e.preventDefault();
    abrirTurno(Number(el.dataset.turno)).catch((err) => toast(err.message, 'error'));
  }
});

// ---------------------------------------------------------------------
// Vista: listado de turnos
// ---------------------------------------------------------------------
let enfocarBusqueda = false;

export async function vistaTurnos(cont) {
  const p = params();
  const f = {
    q: p.q || '',
    desde: 'desde' in p ? p.desde : (p.todos ? '' : hoy()),
    hasta: p.hasta || '',
    estado: p.estado || '',
    pago: p.pago || '',
    servicio: p.servicio || '',
    sol: p.sol === '1',
    pag: Math.max(1, Number(p.pag) || 1),
  };
  const aplicar = (cambios) => {
    const n = { ...f, ...cambios };
    if (!('pag' in cambios)) n.pag = 1;
    irA('turnos', { q: n.q, desde: n.desde, hasta: n.hasta, estado: n.estado, pago: n.pago,
      servicio: n.servicio, sol: n.sol ? '1' : '', pag: n.pag > 1 ? n.pag : '', todos: n.desde ? '' : '1' });
  };

  let consulta = sb.from('turnos_detalle').select('*', { count: 'exact' });
  if (f.desde) consulta = consulta.gte('fecha', f.desde);
  if (f.hasta) consulta = consulta.lte('fecha', f.hasta);
  if (f.estado) consulta = consulta.eq('estado', f.estado);
  if (f.pago) consulta = consulta.eq('estado_pago', f.pago);
  if (f.servicio) consulta = consulta.eq('servicio_id', Number(f.servicio));
  if (f.sol) consulta = consulta.eq('solicitud_cancelacion', true).in('estado', ACTIVOS);
  consulta = aplicarBusqueda(consulta, f.q, {
    columnas: ['cliente_nombre', 'cliente_apellido', 'cliente_telefono', 'servicio_nombre', 'codigo'],
    telefonoNorm: 'cliente_telefono_norm',
  });
  const asc = !!f.desde;
  const desdeFila = (f.pag - 1) * POR_PAGINA;
  consulta = consulta.order('fecha', { ascending: asc }).order('hora_inicio', { ascending: asc }).range(desdeFila, desdeFila + POR_PAGINA - 1);

  const [{ data: turnos, count, error }, clientes] = await Promise.all([
    consulta,
    f.q && f.pag === 1
      ? q(aplicarBusqueda(sb.from('clientes').select('id,nombre,apellido,telefono'), f.q,
        { columnas: ['nombre', 'apellido', 'telefono', 'email'], telefonoNorm: 'telefono_norm' }).limit(6))
      : Promise.resolve([]),
  ]);
  if (error) throw new Error(error.message);

  const rapido = !f.desde && !f.hasta ? 'todos' : (f.desde === hoy() && f.hasta === hoy() ? 'hoy' : (f.desde === hoy() && !f.hasta ? 'proximos' : ''));
  cont.innerHTML = `
    <div class="herramientas">
      <div class="segmentado" role="group" aria-label="Período">
        <button type="button" data-rapido="hoy" aria-pressed="${rapido === 'hoy'}">Hoy</button>
        <button type="button" data-rapido="proximos" aria-pressed="${rapido === 'proximos'}">Próximos</button>
        <button type="button" data-rapido="todos" aria-pressed="${rapido === 'todos'}">Todos</button>
      </div>
      <input class="crece" type="search" id="f-q" placeholder="Cliente, teléfono, servicio o código" value="${esc(f.q)}" aria-label="Buscar">
    </div>
    <div class="herramientas">
      <label class="check"><span class="etiqueta">Desde</span><input type="date" id="f-desde" value="${esc(f.desde)}"></label>
      <label class="check"><span class="etiqueta">Hasta</span><input type="date" id="f-hasta" value="${esc(f.hasta)}"></label>
      <select id="f-estado" aria-label="Estado del turno"><option value="">Todos los estados</option>
        ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${k === f.estado ? 'selected' : ''}>${v.txt}</option>`).join('')}</select>
      <select id="f-pago" aria-label="Estado del pago"><option value="">Todos los pagos</option>
        ${Object.entries(ESTADOS_PAGO).map(([k, v]) => `<option value="${k}" ${k === f.pago ? 'selected' : ''}>${v.txt}</option>`).join('')}</select>
      <select id="f-servicio" aria-label="Servicio"><option value="">Todos los servicios</option>
        ${ctx.servicios.map((s) => `<option value="${s.id}" ${String(s.id) === f.servicio ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" id="f-sol" ${f.sol ? 'checked' : ''}> Pedidos de cancelación</label>
    </div>
    ${clientes.length ? `<div class="herramientas"><span class="etiqueta">Clientes:</span>${clientes.map((c) =>
      `<button type="button" class="btn btn-suave btn-chico" data-cliente="${c.id}">${esc(c.nombre)} ${esc(c.apellido)}</button>`).join('')}</div>` : ''}
    <div class="panel">
      <div class="tabla-scroll">
        <table class="tabla tabla-fichas">
          <thead><tr><th>Fecha</th><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Estado</th><th>Pago</th><th class="num">Precio</th><th class="num">Saldo</th></tr></thead>
          <tbody>
            ${turnos.length ? turnos.map((t) => `
              <tr data-turno="${t.id}" data-abrir>
                <td class="principal-ficha">${esc(fechaCorta(t.fecha))}</td>
                <td data-t="Hora">${hhmm(t.hora_inicio)}–${hhmm(t.hora_fin)}</td>
                <td data-t="Cliente">${esc(t.cliente_nombre)} ${esc(t.cliente_apellido)}<br><small class="suave">${esc(t.cliente_telefono)}</small></td>
                <td data-t="Servicio">${esc(t.servicio_nombre)}</td>
                <td>${chipEstado(t.estado)}${t.solicitud_cancelacion && ACTIVOS.includes(t.estado) ? ' <span class="chip st-cancelado">Pide cancelar</span>' : ''}</td>
                <td>${chipPago(t.estado_pago)}</td>
                <td class="num" data-t="Precio">${plata(t.precio)}</td>
                <td class="num" data-t="Saldo">${t.estado === 'cancelado' ? '<span class="suave">—</span>' : plata(t.saldo)}</td>
              </tr>`).join('')
              : `<tr><td colspan="8" class="tabla-vacia">No hay turnos con estos filtros.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${count > POR_PAGINA ? `
        <div class="paginacion">
          <span>${desdeFila + 1}–${Math.min(desdeFila + POR_PAGINA, count)} de ${count}</span>
          <span>
            <button type="button" class="btn btn-sec btn-chico" data-pag="${f.pag - 1}" ${f.pag <= 1 ? 'disabled' : ''}>Anterior</button>
            <button type="button" class="btn btn-sec btn-chico" data-pag="${f.pag + 1}" ${desdeFila + POR_PAGINA >= count ? 'disabled' : ''}>Siguiente</button>
          </span>
        </div>` : `<div class="paginacion"><span>${count} turno${count === 1 ? '' : 's'}</span></div>`}
    </div>`;

  cont.querySelectorAll('[data-rapido]').forEach((b) => b.addEventListener('click', () => {
    const r = b.dataset.rapido;
    if (r === 'hoy') aplicar({ desde: hoy(), hasta: hoy() });
    if (r === 'proximos') aplicar({ desde: hoy(), hasta: '' });
    if (r === 'todos') aplicar({ desde: '', hasta: '' });
  }));
  const inputQ = cont.querySelector('#f-q');
  inputQ.addEventListener('input', debounce(() => { enfocarBusqueda = true; aplicar({ q: inputQ.value.trim() }); }, 450));
  cont.querySelector('#f-desde').addEventListener('change', (e) => aplicar({ desde: e.target.value }));
  cont.querySelector('#f-hasta').addEventListener('change', (e) => aplicar({ hasta: e.target.value }));
  cont.querySelector('#f-estado').addEventListener('change', (e) => aplicar({ estado: e.target.value }));
  cont.querySelector('#f-pago').addEventListener('change', (e) => aplicar({ pago: e.target.value }));
  cont.querySelector('#f-servicio').addEventListener('change', (e) => aplicar({ servicio: e.target.value }));
  cont.querySelector('#f-sol').addEventListener('change', (e) => aplicar({ sol: e.target.checked }));
  cont.querySelectorAll('[data-pag]').forEach((b) => b.addEventListener('click', () => aplicar({ pag: Number(b.dataset.pag) })));

  if (enfocarBusqueda) {
    enfocarBusqueda = false;
    requestAnimationFrame(() => { inputQ.focus(); inputQ.setSelectionRange(inputQ.value.length, inputQ.value.length); });
  }
}

// ---------------------------------------------------------------------
// Ficha de turno (crear / editar)
// ---------------------------------------------------------------------
/**
 * @param {number|null} id  turno a editar, o null para uno nuevo
 * @param {{fecha?:string, hora?:string, cliente?:object, servicio_id?:number}} preset
 */
export async function abrirTurno(id, preset = {}) {
  let t = null;
  if (id) t = await q(sb.from('turnos_detalle').select('*').eq('id', id).single());
  const esNuevo = !t;

  let cliente = t
    ? { id: t.cliente_id, nombre: t.cliente_nombre, apellido: t.cliente_apellido, telefono: t.cliente_telefono, email: t.cliente_email }
    : (preset.cliente || null);
  let modoCliente = cliente ? 'elegido' : 'buscar';

  const servicios = ctx.servicios.filter((s) => s.activo || s.id === t?.servicio_id);
  const servicioIni = t?.servicio_id ?? preset.servicio_id ?? servicios[0]?.id;
  const sIni = ctx.servicios.find((s) => s.id === servicioIni);

  const v = {
    fecha: t?.fecha ?? preset.fecha ?? hoy(),
    hora: hhmm(t?.hora_inicio ?? preset.hora ?? ''),
    duracion: t?.duracion ?? sIni?.duracion ?? 60,
    precio: t?.precio ?? sIni?.precio ?? 0,
    estado: t?.estado ?? 'confirmado',
  };

  const titulo = esNuevo ? 'Nuevo turno' : `Turno de ${t.cliente_nombre} ${t.cliente_apellido}`;
  const m = abrirModal({ titulo, ancho: 'lg' });

  m.cuerpo.innerHTML = `
    ${t ? `
      <div class="ficha-top">
        ${chipEstado(t.estado)} ${chipPago(t.estado_pago)}
        <span class="chip">${t.origen === 'web' ? 'Reservado online' : 'Cargado en el panel'}</span>
        <span class="chip">Código ${esc(t.codigo)}</span>
      </div>
      ${t.solicitud_cancelacion && ACTIVOS.includes(t.estado) ? `
        <div class="alerta"><span>El cliente pidió cancelar este turno.</span>
          <span class="grupo" style="display:flex;gap:.4rem;flex-wrap:wrap">
            <button type="button" class="btn btn-peligro btn-chico" data-sol="aprobar">Cancelar turno</button>
            <button type="button" class="btn btn-sec btn-chico" data-sol="rechazar">Mantener turno</button>
          </span></div>` : ''}
      <div class="herramientas" id="acciones-rapidas"></div>` : ''}
    <form id="form-turno" novalidate>
      <div class="error-form" id="error-turno" hidden></div>
      <div class="campo"><span class="etiqueta">Cliente</span><div id="caja-cliente"></div></div>
      <div class="fila-campos">
        <div class="campo"><label for="t-servicio">Servicio</label>
          <select id="t-servicio" name="servicio_id" required>
            ${servicios.map((s) => `<option value="${s.id}" ${s.id === servicioIni ? 'selected' : ''}>${esc(s.nombre)}${s.activo ? '' : ' (inactivo)'}</option>`).join('')}
          </select></div>
        <div class="campo"><label for="t-fecha">Fecha</label><input id="t-fecha" name="fecha" type="date" required value="${esc(v.fecha)}"></div>
        <div class="campo"><label for="t-hora">Hora</label><input id="t-hora" name="hora" type="time" step="300" required value="${esc(v.hora)}"></div>
      </div>
      <div class="campo" style="margin-top:-.6rem"><div class="sugerencias-hora" id="sugerencias"></div></div>
      <div class="fila-campos">
        <div class="campo"><label for="t-duracion">Duración (min)</label><input id="t-duracion" name="duracion" type="number" min="5" max="600" step="5" required value="${esc(v.duracion)}"></div>
        <div class="campo"><label for="t-precio">Precio</label><input id="t-precio" name="precio" type="number" min="0" step="0.01" required value="${esc(v.precio)}"></div>
        <div class="campo"><label for="t-estado">Estado</label>
          <select id="t-estado" name="estado">${Object.entries(ESTADOS).map(([k, e]) => `<option value="${k}" ${k === v.estado ? 'selected' : ''}>${e.txt}</option>`).join('')}</select></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label for="t-obs">Observaciones del cliente</label><textarea id="t-obs" name="observaciones" maxlength="1000">${esc(t?.observaciones)}</textarea></div>
        <div class="campo"><label for="t-notas">Notas internas <span class="opcional">(no las ve el cliente)</span></label><textarea id="t-notas" name="notas_internas">${esc(t?.notas_internas)}</textarea></div>
      </div>
      <div class="acciones-ficha">
        <div class="grupo">
          ${t && t.estado !== 'cancelado' ? '<button type="button" class="btn btn-sec" data-cancelar-turno>Cancelar turno</button>' : ''}
          ${t ? `<a class="btn btn-sec" target="_blank" rel="noopener" href="${esc(linkWhatsApp(t.cliente_telefono,
            `Hola ${t.cliente_nombre}, te escribo por tu turno de ${t.servicio_nombre} del ${fechaLarga(t.fecha)} a las ${hhmm(t.hora_inicio)}.`))}">${icono.whatsapp} WhatsApp</a>` : ''}
        </div>
        <div class="grupo">
          <button type="button" class="btn btn-sec" data-cerrar>Cerrar</button>
          <button type="submit" class="btn btn-pri">${esNuevo ? 'Crear turno' : 'Guardar cambios'}</button>
        </div>
      </div>
    </form>
    ${t ? '<section class="bloque-pagos" id="bloque-pagos"><div class="cargando-bloque"><span class="spinner"></span></div></section>' : ''}`;

  const form = m.cuerpo.querySelector('#form-turno');
  const cajaError = m.cuerpo.querySelector('#error-turno');

  // --- Cliente ---
  const cajaCliente = m.cuerpo.querySelector('#caja-cliente');
  function pintarCliente() {
    if (modoCliente === 'elegido') {
      cajaCliente.innerHTML = `
        <div class="cliente-elegido">
          <span><b>${esc(cliente.nombre)} ${esc(cliente.apellido)}</b><br><small>${esc(cliente.telefono)}${cliente.email ? ` · ${esc(cliente.email)}` : ''}</small></span>
          ${esNuevo ? '<button type="button" class="btn-texto" data-cambiar>Cambiar</button>' : '<button type="button" class="btn-texto" data-cambiar>Cambiar cliente</button>'}
        </div>`;
      cajaCliente.querySelector('[data-cambiar]').addEventListener('click', () => { modoCliente = 'buscar'; pintarCliente(); cajaCliente.querySelector('input')?.focus(); });
    } else if (modoCliente === 'buscar') {
      cajaCliente.innerHTML = `
        <div class="buscador-cliente">
          <input type="search" id="buscar-cliente" placeholder="Buscar por nombre o teléfono" autocomplete="off" aria-label="Buscar cliente">
          <div class="resultados-cliente" id="resultados-cliente" hidden></div>
        </div>
        <button type="button" class="btn-texto" data-nuevo-cliente>+ Cliente nuevo</button>`;
      const input = cajaCliente.querySelector('#buscar-cliente');
      const res = cajaCliente.querySelector('#resultados-cliente');
      input.addEventListener('input', debounce(async () => {
        const txt = input.value.trim();
        if (txt.length < 2) { res.hidden = true; return; }
        try {
          const lista = await q(aplicarBusqueda(sb.from('clientes').select('id,nombre,apellido,telefono,email'), txt,
            { columnas: ['nombre', 'apellido', 'telefono', 'email'], telefonoNorm: 'telefono_norm' }).order('nombre').limit(8));
          res.innerHTML = lista.length
            ? lista.map((c) => `<button type="button" data-id="${c.id}">${esc(c.nombre)} ${esc(c.apellido)} <small class="suave">· ${esc(c.telefono)}</small></button>`).join('')
            : '<div class="vacio" style="padding:.8rem">Sin resultados. Podés cargarlo como cliente nuevo.</div>';
          res.hidden = false;
          res.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
            cliente = lista.find((c) => c.id === Number(b.dataset.id));
            modoCliente = 'elegido';
            pintarCliente();
          }));
        } catch (e) { toast(e.message, 'error'); }
      }, 300));
      cajaCliente.querySelector('[data-nuevo-cliente]').addEventListener('click', () => { modoCliente = 'nuevo'; pintarCliente(); });
    } else {
      cajaCliente.innerHTML = `
        <div class="fila-campos">
          <div class="campo"><label for="nc-nombre">Nombre</label><input id="nc-nombre" data-nc="nombre" maxlength="60"></div>
          <div class="campo"><label for="nc-apellido">Apellido</label><input id="nc-apellido" data-nc="apellido" maxlength="60"></div>
          <div class="campo"><label for="nc-tel">Teléfono</label><input id="nc-tel" data-nc="telefono" type="tel" maxlength="25"></div>
          <div class="campo"><label for="nc-email">Email <span class="opcional">(opcional)</span></label><input id="nc-email" data-nc="email" type="email" maxlength="120"></div>
        </div>
        <button type="button" class="btn-texto" data-buscar-existente>Buscar un cliente existente</button>`;
      cajaCliente.querySelector('[data-buscar-existente]').addEventListener('click', () => { modoCliente = 'buscar'; pintarCliente(); });
      cajaCliente.querySelector('#nc-nombre').focus();
    }
  }
  pintarCliente();

  // --- Servicio / sugerencias de horario ---
  const selServicio = form.elements.servicio_id;
  let libres = null; // horarios libres para servicio+fecha actuales
  const sugerencias = m.cuerpo.querySelector('#sugerencias');
  async function cargarSugerencias() {
    libres = null;
    const sid = Number(selServicio.value);
    const fecha = form.elements.fecha.value;
    if (!sid || !fecha) { sugerencias.innerHTML = ''; return; }
    sugerencias.innerHTML = '<span class="leyenda">Buscando horarios libres…</span>';
    try {
      const filas = await rpc('horarios_disponibles_admin', { p_servicio_id: sid, p_fecha: fecha, p_excluir_turno: t?.id ?? null });
      if (form.elements.fecha.value !== fecha || Number(selServicio.value) !== sid) return;
      libres = filas.map((r) => r.hora);
      sugerencias.innerHTML = libres.length
        ? `<span class="leyenda" style="margin:0 .3rem 0 0">Libres:</span>${libres.map((h) => `<button type="button" data-h="${h}">${h}</button>`).join('')}`
        : '<span class="leyenda" style="margin:0">No hay horarios libres dentro del horario de atención ese día. Podés cargar uno manual igual.</span>';
      sugerencias.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => { form.elements.hora.value = b.dataset.h; }));
    } catch (e) {
      sugerencias.innerHTML = `<span class="leyenda">${esc(e.message)}</span>`;
    }
  }
  selServicio.addEventListener('change', () => {
    const s = ctx.servicios.find((x) => x.id === Number(selServicio.value));
    if (s) { form.elements.duracion.value = s.duracion; form.elements.precio.value = s.precio; }
    cargarSugerencias();
  });
  form.elements.fecha.addEventListener('change', cargarSugerencias);
  cargarSugerencias();

  // --- Guardar ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    mostrarError(cajaError, '');
    const d = datosFormulario(form);
    const errores = [];
    if (!d.servicio_id) errores.push('Elegí un servicio.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) errores.push('Elegí una fecha válida.');
    if (!/^\d{2}:\d{2}$/.test(d.hora)) errores.push('Indicá la hora.');
    const dur = Number(d.duracion);
    if (!Number.isInteger(dur) || dur < 5 || dur > 600) errores.push('La duración debe ser entre 5 y 600 minutos.');
    const precio = Number(d.precio);
    if (!(precio >= 0)) errores.push('El precio no es válido.');
    let finMin = 0;
    if (/^\d{2}:\d{2}$/.test(d.hora)) {
      finMin = aMin(d.hora) + dur;
      if (finMin > 24 * 60) errores.push('El turno no puede terminar después de la medianoche.');
    }

    // Cliente nuevo
    let nuevoCliente = null;
    if (modoCliente === 'nuevo') {
      const g = (k) => cajaCliente.querySelector(`[data-nc="${k}"]`).value.trim();
      nuevoCliente = { nombre: g('nombre'), apellido: g('apellido'), telefono: g('telefono'), email: g('email') || null };
      if (!nuevoCliente.nombre) errores.push('Ingresá el nombre del cliente.');
      if (!telefonoValido(nuevoCliente.telefono)) errores.push('Ingresá un teléfono válido para el cliente.');
      if (nuevoCliente.email && !emailValido(nuevoCliente.email)) errores.push('El email del cliente no es válido.');
    } else if (modoCliente !== 'elegido' || !cliente) {
      errores.push('Elegí un cliente o cargá uno nuevo.');
    }
    if (errores.length) return mostrarError(cajaError, errores.join(' '));

    // Aviso si está fuera de la disponibilidad habitual (no bloquea: la superposición la impide la base de datos)
    const cambioHorario = esNuevo || d.fecha !== t.fecha || d.hora !== hhmm(t.hora_inicio) || Number(d.servicio_id) !== t.servicio_id;
    if (cambioHorario && d.estado !== 'cancelado' && Array.isArray(libres) && !libres.includes(d.hora)) {
      const ok = await confirmar('Ese horario está fuera de la disponibilidad habitual (horario de atención, bloqueos, anticipación o descanso entre turnos). ¿Guardarlo igual?',
        { titulo: 'Horario fuera de agenda', aceptar: 'Guardar igual' });
      if (!ok) return;
    }

    const btn = form.querySelector('button[type=submit]');
    try {
      await conCarga(btn, async () => {
        let clienteId = cliente?.id;
        if (nuevoCliente) {
          const existentes = await q(sb.from('clientes').select('id,nombre,apellido,telefono,email').eq('telefono_norm', normalizarTelefono(nuevoCliente.telefono)).limit(1));
          if (existentes.length) {
            cliente = existentes[0];
            toast(`Ya existía ${cliente.nombre} ${cliente.apellido} con ese teléfono: se usó esa ficha.`);
          } else {
            cliente = await q(sb.from('clientes').insert(nuevoCliente).select('id,nombre,apellido,telefono,email').single());
          }
          clienteId = cliente.id;
          modoCliente = 'elegido';
          pintarCliente();
        }
        const payload = {
          cliente_id: clienteId,
          servicio_id: Number(d.servicio_id),
          fecha: d.fecha,
          hora_inicio: d.hora,
          hora_fin: deMin(finMin),
          precio,
          estado: d.estado,
          observaciones: d.observaciones || null,
          notas_internas: d.notas_internas || null,
        };
        if (d.estado === 'cancelado' && t?.estado !== 'cancelado') payload.cancelado_por = 'admin';
        if (esNuevo) {
          await q(sb.from('turnos').insert({ ...payload, origen: 'admin' }).select('id').single());
          toast('Turno creado.');
        } else {
          await q(sb.from('turnos').update(payload).eq('id', t.id).select('id').single());
          toast('Cambios guardados.');
        }
      });
      m.cerrar();
      notificarCambio();
    } catch (err) {
      mostrarError(cajaError, err.message);
    }
  });

  if (!t) return;

  // --- Acciones rápidas de estado ---
  const rapidas = m.cuerpo.querySelector('#acciones-rapidas');
  const transiciones = {
    pendiente: [['confirmado', 'Confirmar']],
    confirmado: [['en_curso', 'En curso'], ['realizado', 'Marcar realizado'], ['no_asistio', 'No asistió']],
    en_curso: [['realizado', 'Marcar realizado']],
    realizado: [], cancelado: [], no_asistio: [['realizado', 'Marcar realizado']],
  };
  rapidas.innerHTML = (transiciones[t.estado] || []).map(([e, txt]) => `<button type="button" class="btn btn-suave btn-chico" data-estado="${e}">${txt}</button>`).join('');
  rapidas.hidden = !rapidas.innerHTML;
  rapidas.querySelectorAll('[data-estado]').forEach((b) => b.addEventListener('click', () => cambiarEstado(b.dataset.estado, b)));

  async function cambiarEstado(nuevo, boton, extra = {}) {
    try {
      await conCarga(boton, () => q(sb.from('turnos').update({ estado: nuevo, ...extra }).eq('id', t.id).select('id').single()), '…');
      toast(`Turno: ${ESTADOS[nuevo].txt.toLowerCase()}.`);
      m.cerrar();
      notificarCambio();
    } catch (err) { toast(err.message, 'error'); }
  }

  m.cuerpo.querySelector('[data-cancelar-turno]')?.addEventListener('click', async (e) => {
    const ok = await confirmar('El horario quedará libre para otras reservas. Si el cliente tiene email o WhatsApp, se genera un aviso de cancelación.',
      { titulo: '¿Cancelar este turno?', aceptar: 'Cancelar turno', cancelar: 'Volver', peligro: true });
    if (ok) cambiarEstado('cancelado', e.target, { cancelado_por: 'admin' });
  });
  m.cuerpo.querySelectorAll('[data-sol]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.sol === 'aprobar') return cambiarEstado('cancelado', b, { cancelado_por: 'cliente' });
    try {
      await q(sb.from('turnos').update({ solicitud_cancelacion: false }).eq('id', t.id).select('id').single());
      toast('Se mantiene el turno. Avisale al cliente.');
      m.cerrar();
      notificarCambio();
    } catch (err) { toast(err.message, 'error'); }
  }));

  // --- Pagos ---
  await pintarPagos(m.cuerpo.querySelector('#bloque-pagos'), t.id);
}

async function pintarPagos(bloque, turnoId) {
  const [t, pagos] = await Promise.all([
    q(sb.from('turnos_detalle').select('id,precio,monto_pagado,saldo,estado_pago,estado').eq('id', turnoId).single()),
    q(sb.from('pagos').select('*').eq('turno_id', turnoId).order('fecha_pago')),
  ]);
  const metodos = ctx.metodos.filter((x) => x.activo);
  bloque.innerHTML = `
    <div class="panel-cab" style="margin-bottom:0">
      <h3>Pago</h3>
      <label class="check"><span class="etiqueta">Estado</span>
        <select id="p-estado" style="width:auto">${Object.entries(ESTADOS_PAGO).map(([k, e]) => `<option value="${k}" ${k === t.estado_pago ? 'selected' : ''}>${e.txt}</option>`).join('')}</select>
      </label>
    </div>
    <div class="saldos">
      <div><small>Precio</small><b>${plata(t.precio)}</b></div>
      <div><small>Abonado</small><b>${plata(t.monto_pagado)}</b></div>
      <div><small>Pendiente</small><b>${plata(t.saldo)}</b></div>
    </div>
    ${pagos.map((p) => `
      <div class="pago-fila ${p.estado !== 'aprobado' ? 'anulado' : ''}">
        <span>${esc(fechaCorta(fechaDe(p.fecha_pago, ctx.tz)))} · ${esc(p.metodo)}${p.estado !== 'aprobado' ? ` (${p.estado})` : ''}</span>
        <span style="display:flex;gap:.5rem;align-items:center"><b>${plata(p.monto)}</b>
          ${p.estado === 'aprobado' ? `
            <button type="button" class="btn-texto" data-pago="${p.id}" data-accion="reembolsado">Reembolsar</button>
            <button type="button" class="btn-texto" data-pago="${p.id}" data-accion="anulado">Anular</button>` : ''}
        </span>
      </div>`).join('')}
    <form class="form-pago" id="form-pago" novalidate>
      <div class="campo"><label for="p-monto">Monto</label><input id="p-monto" name="monto" type="number" min="0.01" step="0.01" value="${Number(t.saldo) > 0 ? t.saldo : ''}" required></div>
      <div class="campo"><label for="p-metodo">Método</label><select id="p-metodo" name="metodo">${metodos.map((x) => `<option>${esc(x.nombre)}</option>`).join('')}</select></div>
      <div class="campo"><label for="p-fecha">Fecha</label><input id="p-fecha" name="fecha" type="date" value="${hoy()}" required></div>
      <button type="submit" class="btn btn-pri">Registrar pago</button>
    </form>`;

  const recargar = async () => { await pintarPagos(bloque, turnoId); notificarCambio(); };

  bloque.querySelector('#p-estado').addEventListener('change', async (e) => {
    try {
      await q(sb.from('turnos').update({ estado_pago: e.target.value }).eq('id', turnoId).select('id').single());
      toast('Estado del pago actualizado.');
      await recargar();
    } catch (err) { toast(err.message, 'error'); }
  });

  bloque.querySelectorAll('[data-pago]').forEach((b) => b.addEventListener('click', async () => {
    const accion = b.dataset.accion;
    const ok = await confirmar(accion === 'anulado'
      ? 'El pago se marca como anulado (por ejemplo, si se cargó por error). Queda en el historial.'
      : 'El pago se marca como devuelto al cliente. Queda en el historial.',
    { titulo: accion === 'anulado' ? '¿Anular pago?' : '¿Registrar reembolso?', aceptar: accion === 'anulado' ? 'Anular pago' : 'Registrar reembolso', peligro: true });
    if (!ok) return;
    try {
      await q(sb.from('pagos').update({ estado: accion }).eq('id', Number(b.dataset.pago)).select('id').single());
      toast(accion === 'anulado' ? 'Pago anulado.' : 'Reembolso registrado.');
      await recargar();
    } catch (err) { toast(err.message, 'error'); }
  }));

  const fp = bloque.querySelector('#form-pago');
  fp.addEventListener('submit', async (e) => {
    e.preventDefault();
    const monto = Math.round(Number(fp.elements.monto.value) * 100) / 100;
    const fecha = fp.elements.fecha.value;
    if (!(monto > 0)) return toast('Ingresá un monto mayor a cero.', 'error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return toast('Elegí la fecha del pago.', 'error');
    if (!fp.elements.metodo.value) return toast('Configurá al menos un método de pago en Ajustes.', 'error');
    if (Number(t.saldo) > 0 && monto > Number(t.saldo)) {
      const ok = await confirmar(`El monto supera lo pendiente (${plata(t.saldo)}). ¿Registrarlo igual?`, { aceptar: 'Registrar' });
      if (!ok) return;
    }
    // Si es de hoy, se guarda la hora actual; si no, el mediodía de ese día (evita corrimientos por zona horaria)
    const fechaPago = fecha === hoy() ? new Date().toISOString() : `${fecha}T15:00:00Z`;
    try {
      await conCarga(fp.querySelector('button'), () =>
        q(sb.from('pagos').insert({ turno_id: turnoId, monto, metodo: fp.elements.metodo.value, fecha_pago: fechaPago }).select('id').single()));
      toast('Pago registrado.');
      await recargar();
    } catch (err) { toast(err.message, 'error'); }
  });
}

