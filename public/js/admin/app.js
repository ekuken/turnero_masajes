import { configurado, sb, rpc, mensajeError } from '../api.js';
import { esc } from '../utils.js';
import { toast, abrirModal, icono, mostrarError } from '../ui.js';
import { ctx, cargarBase, irA } from './contexto.js';
import { vistaInicio } from './dashboard.js';
import { vistaCalendario } from './calendario.js';
import { vistaTurnos, abrirTurno } from './turnos.js';
import { vistaClientes } from './clientes.js';
import { vistaServicios } from './servicios.js';
import { vistaHorarios } from './horarios.js';
import { vistaPagos } from './pagos.js';
import { vistaAvisos, contarAvisosPendientes } from './avisos.js';
import { vistaAjustes } from './ajustes.js';

const $ = (s) => document.querySelector(s);

const RUTAS = {
  inicio:     { titulo: 'Inicio',        icono: icono.inicio,     render: vistaInicio,     movil: true },
  calendario: { titulo: 'Calendario',    icono: icono.calendario, render: vistaCalendario, movil: true },
  turnos:     { titulo: 'Turnos',        icono: icono.lista,      render: vistaTurnos,     movil: true },
  clientes:   { titulo: 'Clientes',      icono: icono.clientes,   render: vistaClientes,   movil: true },
  pagos:      { titulo: 'Pagos',         icono: icono.pagos,      render: vistaPagos },
  servicios:  { titulo: 'Servicios',     icono: icono.servicios,  render: vistaServicios },
  horarios:   { titulo: 'Horarios y bloqueos', icono: icono.reloj, render: vistaHorarios },
  avisos:     { titulo: 'Avisos a clientes', icono: icono.avisos, render: vistaAvisos },
  ajustes:    { titulo: 'Ajustes',       icono: icono.ajustes,    render: vistaAjustes },
};

// ---------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------
async function iniciar() {
  $('#cargando-inicial').hidden = true;
  if (!configurado) { $('#sin-config').hidden = false; return; }

  const { data: { session } } = await sb.auth.getSession();
  if (session) await entrar();
  else mostrarLogin();

  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') mostrarLogin();
  });
}

function mostrarLogin(mensaje = '') {
  $('#app').hidden = true;
  $('#pantalla-login').hidden = false;
  mostrarError($('#error-login'), mensaje);
  $('#l-email').focus();
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const caja = $('#error-login');
  const email = f.elements.email.value.trim();
  const password = f.elements.password.value;
  if (!email || !password) return mostrarError(caja, 'Completá email y contraseña.');
  const btn = f.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Ingresando…';
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(mensajeError(error));
    f.elements.password.value = '';
    await entrar();
  } catch (err) {
    mostrarError(caja, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});

async function entrar() {
  let esAdmin = false;
  try { esAdmin = await rpc('es_admin'); } catch { esAdmin = false; }
  if (!esAdmin) {
    await sb.auth.signOut();
    mostrarLogin('Esta cuenta no tiene acceso al panel. Pedile al administrador que la habilite.');
    return;
  }
  try {
    const { data: { user } } = await sb.auth.getUser();
    ctx.usuario = user;
    await cargarBase();
  } catch (e) {
    mostrarLogin(e.message);
    return;
  }
  $('#pantalla-login').hidden = true;
  $('#app').hidden = false;
  armarMenus();
  if (!location.hash.startsWith('#/')) location.hash = '#/inicio';
  else navegar();
  actualizarBadges();
}

$('#btn-salir').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.hash = '';
});

// ---------------------------------------------------------------------
// Menús
// ---------------------------------------------------------------------
function itemMenu(clave, r) {
  return `<a class="menu-item" href="#/${clave}" data-ruta="${clave}">${r.icono}<span class="menu-txt">${r.titulo}</span></a>`;
}
function armarMenus() {
  $('#menu').innerHTML = Object.entries(RUTAS).map(([k, r]) => itemMenu(k, r)).join('');
  $('#nav-movil').innerHTML = Object.entries(RUTAS).filter(([, r]) => r.movil).map(([k, r]) => itemMenu(k, { ...r, titulo: r.titulo.split(' ')[0] })).join('')
    + `<button type="button" class="menu-item" id="btn-mas" data-ruta="mas">${icono.ajustes}<span class="menu-txt">Más</span></button>`;
  $('#btn-nuevo-turno').innerHTML = `${icono.mas}<span class="btn-txt">Nuevo turno</span>`;
  $('#btn-mas').addEventListener('click', () => {
    const m = abrirModal({
      titulo: 'Más opciones', ancho: 'sm',
      contenido: `<nav class="menu-mas">${Object.entries(RUTAS).filter(([, r]) => !r.movil).map(([k, r]) => itemMenu(k, r)).join('')}
        <a class="menu-item" href="index.html" target="_blank" rel="noopener">${icono.inicio}<span class="menu-txt">Ver sitio público</span></a>
        <button type="button" class="menu-item" data-salir>${icono.salir}<span class="menu-txt">Salir</span></button></nav>`,
    });
    m.cuerpo.addEventListener('click', (e) => {
      if (e.target.closest('a')) m.cerrar();
      if (e.target.closest('[data-salir]')) { m.cerrar(); $('#btn-salir').click(); }
    });
  });
}

/** Actualiza los contadores del menú (avisos por enviar, solicitudes de cancelación) */
async function actualizarBadges() {
  try {
    const [avisos, { count }] = await Promise.all([
      contarAvisosPendientes(),
      sb.from('turnos').select('id', { count: 'exact', head: true })
        .eq('solicitud_cancelacion', true).in('estado', ['pendiente', 'confirmado']),
    ]);
    pintarBadge('avisos', avisos);
    pintarBadge('turnos', count || 0);
  } catch { /* no es crítico */ }
}
function pintarBadge(ruta, n) {
  document.querySelectorAll(`[data-ruta="${ruta}"]`).forEach((el) => {
    el.querySelector('.menu-badge')?.remove();
    if (n > 0) el.insertAdjacentHTML('beforeend', `<span class="menu-badge">${n}</span>`);
  });
}

// ---------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------
let renderActual = 0;
async function navegar({ mantenerScroll = false } = {}) {
  if ($('#app').hidden) return;
  const [ruta] = location.hash.replace(/^#\//, '').split('?');
  const clave = RUTAS[ruta] ? ruta : 'inicio';
  const r = RUTAS[clave];
  document.querySelectorAll('[data-ruta]').forEach((el) => el.classList.toggle('activo', el.dataset.ruta === clave));
  $('#titulo-vista').textContent = r.titulo;
  document.title = `${r.titulo} · ${ctx.negocio?.nombre || 'Administración'}`;

  const vista = $('#vista');
  const scroll = window.scrollY;
  const token = ++renderActual;
  if (!mantenerScroll) vista.innerHTML = '<div class="cargando-bloque"><span class="spinner"></span></div>';
  try {
    const cont = document.createElement('div');
    await r.render(cont, { esActual: () => token === renderActual });
    if (token !== renderActual) return;
    vista.replaceChildren(cont);
    if (mantenerScroll) window.scrollTo(0, scroll);
    else window.scrollTo(0, 0);
  } catch (e) {
    if (token !== renderActual) return;
    console.error(e);
    vista.innerHTML = `<div class="panel"><p class="error-form">${esc(e.message)}</p><a class="btn btn-sec" href="">Recargar</a></div>`;
  }
}
window.addEventListener('hashchange', () => navegar());
document.addEventListener('datos-cambiados', () => { navegar({ mantenerScroll: true }); actualizarBadges(); });

// ---------------------------------------------------------------------
// Acciones globales
// ---------------------------------------------------------------------
$('#btn-nuevo-turno').addEventListener('click', () => abrirTurno(null));
$('#form-buscar').addEventListener('submit', (e) => {
  e.preventDefault();
  const texto = $('#buscar-global').value.trim();
  irA('turnos', { q: texto, desde: '', todos: texto ? '1' : '' });
  $('#buscar-global').blur();
});

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(e.reason?.message || 'Ocurrió un error inesperado.', 'error');
});

iniciar();
