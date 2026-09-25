import { configurado, rpc } from './api.js';
import { esc, dinero, parseFecha, DIAS_CORTOS, MESES, chipEstado, telefonoValido, linkWhatsApp } from './utils.js';
import { toast, confirmar, mostrarError } from './ui.js';

const $ = (s) => document.querySelector(s);
const form = $('#form-consulta');
let credenciales = null; // { codigo, telefono }
let negocio = null;

async function iniciar() {
  if (!configurado) { $('#sin-config').hidden = false; $('#bloque-consulta').hidden = true; return; }
  rpc('info_publica').then((i) => { negocio = i.negocio; $('#nombre-negocio').textContent = negocio.nombre; }).catch(() => {});

  const url = new URLSearchParams(location.search);
  let guardado = null;
  try { guardado = JSON.parse(localStorage.getItem('turnero-ultimo') || 'null'); } catch { /* sin almacenamiento */ }
  form.elements.codigo.value = url.get('codigo') || guardado?.codigo || '';
  form.elements.telefono.value = guardado?.telefono || '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const codigo = form.elements.codigo.value.trim().toUpperCase();
  const telefono = form.elements.telefono.value.trim();
  const caja = $('#error-consulta');
  if (!/^[0-9A-F]{6,12}$/.test(codigo)) return mostrarError(caja, 'Revisá el código: son 8 letras y números.');
  if (!telefonoValido(telefono)) return mostrarError(caja, 'Ingresá el teléfono con código de área.');
  mostrarError(caja, '');
  credenciales = { codigo, telefono };
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try { await cargar(); } catch (err) { mostrarError(caja, err.message); } finally { btn.disabled = false; }
});

async function cargar() {
  const data = await rpc('mis_turnos', { p_telefono: credenciales.telefono, p_codigo: credenciales.codigo });
  $('#bloque-consulta').hidden = true;
  $('#bloque-turnos').hidden = false;
  $('#saludo').textContent = `Hola, ${data.cliente.nombre}. Estos son tus turnos.`;
  const pol = $('#politica');
  pol.hidden = !data.politica_cancelacion;
  pol.textContent = data.politica_cancelacion || '';

  const proximos = data.turnos.filter((t) => t.futuro && ['pendiente', 'confirmado', 'en_curso'].includes(t.estado)).reverse();
  const historial = data.turnos.filter((t) => !proximos.includes(t));
  $('#lista-proximos').innerHTML = proximos.length ? proximos.map(fila).join('') : '<p class="vacio">No tenés turnos próximos. <a href="index.html#reservar">Reservá uno</a>.</p>';
  $('#lista-historial').innerHTML = historial.length ? historial.map(fila).join('') : '<p class="vacio">Todavía no hay turnos anteriores.</p>';
}

function fila(t) {
  const d = parseFecha(t.fecha);
  let accion = '';
  if (t.solicitud_cancelacion && t.cancelable) {
    accion = '<span class="chip st-pendiente">Cancelación solicitada</span>';
  } else if (t.cancelable) {
    accion = `<button type="button" class="btn btn-sec btn-chico" data-cancelar="${esc(t.codigo)}" data-directa="${t.cancelacion_directa}">
      ${t.cancelacion_directa ? 'Cancelar turno' : 'Solicitar cancelación'}</button>`;
  } else {
    accion = chipEstado(t.estado);
  }
  return `
    <div class="turno-cliente">
      <div class="turno-fecha"><b>${d.getUTCDate()}</b><span>${DIAS_CORTOS[d.getUTCDay()]} · ${MESES[d.getUTCMonth()].slice(0, 3)}</span></div>
      <div class="turno-info">
        <strong>${esc(t.servicio)}</strong>
        <small>${esc(t.hora)} a ${esc(t.hora_fin)} h · ${dinero(t.precio, negocio?.moneda || 'ARS')} · Código ${esc(t.codigo)}</small>
        ${t.cancelable ? `<div style="margin-top:.3rem">${chipEstado(t.estado)}</div>` : ''}
      </div>
      <div>${accion}</div>
    </div>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancelar]');
  if (!b) return;
  const directa = b.dataset.directa === 'true';
  const ok = await confirmar(
    directa
      ? 'El turno se va a cancelar y el horario quedará libre para otra persona.'
      : 'Falta poco para el turno, así que vamos a enviar una solicitud de cancelación. Te contactaremos para confirmarla.',
    { titulo: directa ? '¿Cancelar este turno?' : '¿Solicitar la cancelación?', aceptar: directa ? 'Cancelar turno' : 'Enviar solicitud', cancelar: 'Mantener turno', peligro: true });
  if (!ok) return;
  b.disabled = true;
  try {
    const r = await rpc('cancelar_turno_cliente', { p_codigo: b.dataset.cancelar, p_telefono: credenciales.telefono });
    toast(r.resultado === 'cancelado' ? 'Turno cancelado.' : 'Solicitud de cancelación enviada.');
    await cargar();
    if (r.resultado === 'solicitud' && negocio?.whatsapp) {
      const pol = $('#politica');
      pol.hidden = false;
      pol.innerHTML = `Recibimos tu pedido de cancelación. Si es urgente, <a href="${esc(linkWhatsApp(negocio.whatsapp, `Hola, pedí cancelar mi turno con código ${b.dataset.cancelar}.`))}" target="_blank" rel="noopener">escribinos por WhatsApp</a>.`;
    }
  } catch (err) {
    toast(err.message, 'error');
    b.disabled = false;
  }
});

$('#btn-salir').addEventListener('click', () => {
  $('#bloque-turnos').hidden = true;
  $('#bloque-consulta').hidden = false;
  form.elements.codigo.value = '';
  form.elements.codigo.focus();
});

iniciar();
