import { esc } from './utils.js';

// ---------- Avisos breves ----------
let zonaToast;
export function toast(mensaje, tipo = 'ok', ms = 3800) {
  if (!zonaToast) {
    zonaToast = document.createElement('div');
    zonaToast.className = 'toasts';
    zonaToast.setAttribute('role', 'status');
    zonaToast.setAttribute('aria-live', 'polite');
    document.body.appendChild(zonaToast);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = mensaje;
  zonaToast.appendChild(el);
  setTimeout(() => el.classList.add('saliendo'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// ---------- Ventanas modales ----------
/**
 * Abre una ventana modal. Devuelve { el, cerrar, cuerpo }.
 * onCerrar se llama al cerrarse por cualquier vía.
 */
export function abrirModal({ titulo, contenido = '', ancho = 'md', onCerrar } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal modal-${ancho}`;
  dlg.innerHTML = `
    <div class="modal-cab">
      <h2 class="modal-titulo">${esc(titulo)}</h2>
      <button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="modal-cuerpo"></div>`;
  const cuerpo = dlg.querySelector('.modal-cuerpo');
  if (typeof contenido === 'string') cuerpo.innerHTML = contenido;
  else if (contenido) cuerpo.appendChild(contenido);
  document.body.appendChild(dlg);

  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    if (dlg.open) dlg.close();
    dlg.remove();
    onCerrar?.();
  };
  dlg.addEventListener('close', cerrar);
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar]')) cerrar();
    // clic fuera del cuadro
    if (e.target === dlg) {
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cerrar();
    }
  });
  dlg.showModal();
  return { el: dlg, cuerpo, cerrar };
}

/** Pide confirmación. Devuelve una promesa con true/false. */
export function confirmar(mensaje, { titulo = '¿Confirmás?', aceptar = 'Confirmar', cancelar = 'Volver', peligro = false } = {}) {
  return new Promise((resolve) => {
    let respuesta = false;
    const m = abrirModal({
      titulo, ancho: 'sm',
      contenido: `<p class="confirmar-texto">${esc(mensaje)}</p>
        <div class="acciones">
          <button type="button" class="btn btn-sec" data-cerrar>${esc(cancelar)}</button>
          <button type="button" class="btn ${peligro ? 'btn-peligro' : 'btn-pri'}" data-ok>${esc(aceptar)}</button>
        </div>`,
      onCerrar: () => resolve(respuesta),
    });
    m.cuerpo.querySelector('[data-ok]').addEventListener('click', () => { respuesta = true; m.cerrar(); });
    m.cuerpo.querySelector('[data-ok]').focus();
  });
}

/** Deshabilita un botón mientras corre una tarea asíncrona. */
export async function conCarga(boton, tarea, textoCarga = 'Guardando…') {
  const original = boton?.innerHTML;
  if (boton) { boton.disabled = true; boton.classList.add('cargando'); boton.textContent = textoCarga; }
  try {
    return await tarea();
  } finally {
    if (boton) { boton.disabled = false; boton.classList.remove('cargando'); boton.innerHTML = original; }
  }
}

/** Lee los campos de un formulario como objeto (strings recortados; checkboxes como booleanos). */
export function datosFormulario(form) {
  const obj = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') obj[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) obj[el.name] = el.value; }
    else obj[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
  }
  return obj;
}

/** Muestra un mensaje de error dentro de un contenedor del formulario. */
export function mostrarError(contenedor, mensaje) {
  if (!contenedor) return;
  contenedor.textContent = mensaje || '';
  contenedor.hidden = !mensaje;
}

export const icono = {
  calendario: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  inicio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5L12 5l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/></svg>',
  lista: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  clientes: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 5.2a3.3 3.3 0 010 6.6M18 14.8c1.8.7 3 2.4 3.5 5.2"/></svg>',
  servicios: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3 4 5 6.5 5 9.5a5 5 0 01-10 0C7 9.5 9 7 12 3z"/><path d="M12 17v4"/></svg>',
  reloj: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  pagos: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/></svg>',
  avisos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 004 0"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"/></svg>',
  salir: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4.5A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5H14M10 16l-4-4 4-4M6 12h10"/></svg>',
  mas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  buscar: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-3.6A8 8 0 1112 20a8 8 0 01-3.8-1z"/><path d="M9 8.5c0 3.5 2.5 6.5 6.5 6.5l1-1.6-2-1-1 .8c-1.1-.5-2.2-1.6-2.7-2.7l.8-1-1-2z"/></svg>',
  atras: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  adelante: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};
