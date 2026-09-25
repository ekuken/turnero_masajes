import { sb, q, rpc } from '../api.js';
import {
  esc, fechaCorta, fechaDe, sumarDias, inicioSemana, primerDiaMes, ultimoDiaMes, parseFecha, MESES,
  minutosAhoraEn, aMin, capitalizar, fechaLarga,
} from '../utils.js';
import { ctx, hoy, plata, params, irA } from './contexto.js';
import { itemTurno } from './turnos.js';

const PERIODOS = { hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', rango: 'Rango' };

function rangoDe(p) {
  const h = hoy();
  if (p.per === 'hoy') return [h, h];
  if (p.per === 'semana') { const i = inicioSemana(h); return [i, sumarDias(i, 6)]; }
  if (p.per === 'rango' && /^\d{4}-\d{2}-\d{2}$/.test(p.desde || '') && /^\d{4}-\d{2}-\d{2}$/.test(p.hasta || '')) {
    return p.desde <= p.hasta ? [p.desde, p.hasta] : [p.hasta, p.desde];
  }
  return [primerDiaMes(h), ultimoDiaMes(h)];
}

export async function vistaInicio(cont) {
  const p = params();
  p.per = PERIODOS[p.per] ? p.per : 'mes';
  const [desde, hasta] = rangoDe(p);
  const h = hoy();

  const [st, proximosCrudos, clientes] = await Promise.all([
    rpc('estadisticas', { p_desde: desde, p_hasta: hasta }),
    q(sb.from('turnos_detalle').select('*').gte('fecha', h).in('estado', ['pendiente', 'confirmado', 'en_curso'])
      .order('fecha').order('hora_inicio').limit(20)),
    q(sb.from('clientes').select('id,nombre,apellido,telefono,fecha_registro').order('fecha_registro', { ascending: false }).limit(6)),
  ]);
  const ahora = minutosAhoraEn(ctx.tz);
  const proximos = proximosCrudos.filter((t) => t.fecha > h || aMin(t.hora_fin) > ahora).slice(0, 8);
  const per = st.periodo;
  const nombrePer = p.per === 'rango' ? `${fechaCorta(desde)} al ${fechaCorta(hasta)}` : PERIODOS[p.per].toLowerCase();

  cont.innerHTML = `
    <div class="herramientas">
      <div class="segmentado" role="group" aria-label="Período">
        ${Object.entries(PERIODOS).map(([k, v]) => `<button type="button" data-per="${k}" aria-pressed="${k === p.per}">${v}</button>`).join('')}
      </div>
      <span id="rango" ${p.per === 'rango' ? '' : 'hidden'} style="display:flex;gap:.5rem;flex-wrap:wrap">
        <input type="date" id="r-desde" value="${desde}" aria-label="Desde">
        <input type="date" id="r-hasta" value="${hasta}" aria-label="Hasta">
      </span>
    </div>

    ${st.solicitudes_cancelacion > 0 ? `
      <div class="alerta"><span>Hay ${st.solicitudes_cancelacion} pedido${st.solicitudes_cancelacion === 1 ? '' : 's'} de cancelación para revisar.</span>
      <a class="btn btn-sec btn-chico" href="#/turnos?sol=1&todos=1">Revisar</a></div>` : ''}

    <div class="metricas">
      ${metrica(st.turnos_hoy, 'Turnos de hoy', '#/calendario?vista=dia')}
      ${metrica(per.pendientes, `Pendientes (${nombrePer})`, `#/turnos?estado=pendiente&desde=${desde}&hasta=${hasta}`)}
      ${metrica(per.confirmados, `Confirmados (${nombrePer})`, `#/turnos?estado=confirmado&desde=${desde}&hasta=${hasta}`)}
      ${metrica(per.realizados, `Realizados (${nombrePer})`, `#/turnos?estado=realizado&desde=${desde}&hasta=${hasta}`)}
      ${metrica(per.cancelados, `Cancelaciones (${nombrePer})`, `#/turnos?estado=cancelado&desde=${desde}&hasta=${hasta}`)}
      ${metrica(plata(st.cobrado_hoy), 'Cobrado hoy', '#/pagos?per=hoy', true)}
      ${metrica(plata(st.cobrado_mes), 'Cobrado este mes', '#/pagos', true)}
      ${metrica(plata(st.pendiente_cobro), `Pendiente de cobro (${nombrePer})`, `#/turnos?pago=pendiente&desde=${desde}&hasta=${hasta}`, true)}
    </div>

    <div class="grilla-2">
      <section class="panel">
        <div class="panel-cab"><h2>Próximos turnos</h2><a class="btn btn-texto" href="#/turnos">Ver todos</a></div>
        <div class="lista-turnos">
          ${proximos.length ? agruparPorDia(proximos, h) : '<p class="vacio">No hay turnos próximos.</p>'}
        </div>
      </section>
      <section class="panel">
        <div class="panel-cab"><h2>Ingresos · ${esc(nombrePer)}</h2><b>${plata(st.cobrado_periodo)}</b></div>
        ${graficoIngresos(st.ingresos_por_dia, desde, hasta)}
        ${st.ingresos_por_metodo.length ? `<ul class="lista-simple" style="margin-top:1rem">${st.ingresos_por_metodo.map((x) =>
          `<li><span>${esc(x.metodo)}</span><b>${plata(x.total)}</b></li>`).join('')}</ul>` : ''}
      </section>
      <section class="panel">
        <div class="panel-cab"><h2>Servicios más reservados</h2></div>
        ${ranking(st.servicios_top)}
      </section>
      <section class="panel">
        <div class="panel-cab"><h2>Últimos clientes</h2><a class="btn btn-texto" href="#/clientes">Ver todos</a></div>
        ${clientes.length ? `<ul class="lista-simple">${clientes.map((c) => `
          <li><button type="button" class="btn-texto" data-cliente="${c.id}" style="padding:0">${esc(c.nombre)} ${esc(c.apellido)}</button>
          <small>${esc(c.telefono)} · desde ${esc(fechaCorta(fechaDe(c.fecha_registro, ctx.tz)))}</small></li>`).join('')}</ul>`
          : '<p class="vacio">Todavía no hay clientes.</p>'}
      </section>
    </div>`;

  cont.querySelectorAll('[data-per]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.per === 'rango') {
      cont.querySelector('#rango').hidden = false;
      cont.querySelectorAll('[data-per]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      cont.querySelector('#r-desde').focus();
      return;
    }
    irA('inicio', { per: b.dataset.per });
  }));
  const cambiarRango = () => {
    const d = cont.querySelector('#r-desde').value;
    const hh = cont.querySelector('#r-hasta').value;
    if (d && hh) irA('inicio', { per: 'rango', desde: d, hasta: hh });
  };
  cont.querySelector('#r-desde').addEventListener('change', cambiarRango);
  cont.querySelector('#r-hasta').addEventListener('change', cambiarRango);
}

function metrica(valor, nombre, href, dinero = false) {
  return `<a class="metrica ${dinero ? 'metrica-dinero' : ''}" href="${href}" style="text-decoration:none;color:inherit">
    <div class="metrica-valor">${esc(valor)}</div><div class="metrica-nombre">${esc(nombre)}</div></a>`;
}

function agruparPorDia(turnos, h) {
  let html = '';
  let actual = null;
  for (const t of turnos) {
    if (t.fecha !== actual) {
      actual = t.fecha;
      const etiqueta = t.fecha === h ? 'Hoy' : t.fecha === sumarDias(h, 1) ? 'Mañana' : capitalizar(fechaLarga(t.fecha));
      html += `<h3 style="font-family:var(--font-body);font-size:.85rem;font-weight:700;color:var(--muted);margin:.8rem 0 .2rem">${esc(etiqueta)}</h3>`;
    }
    html += itemTurno(t);
  }
  return html;
}

function ranking(lista) {
  if (!lista.length) return '<p class="vacio">Sin turnos en este período.</p>';
  const max = Math.max(...lista.map((x) => x.cantidad));
  return `<ul class="ranking">${lista.map((x) => `
    <li><div class="ranking-fila"><span>${esc(x.nombre)}</span><b>${x.cantidad}</b></div>
    <div class="ranking-barra"><span style="width:${Math.max(4, (x.cantidad / max) * 100)}%"></span></div></li>`).join('')}</ul>`;
}

function graficoIngresos(datos, desde, hasta) {
  const mapa = new Map(datos.map((d) => [d.dia, Number(d.total)]));
  const dias = Math.round((parseFecha(hasta) - parseFecha(desde)) / 86400000) + 1;
  let columnas = [];
  if (dias <= 62) {
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) columnas.push({ etiqueta: fechaCorta(f).slice(0, 5), total: mapa.get(f) || 0 });
  } else {
    const porMes = new Map();
    for (const [dia, total] of mapa) {
      const clave = dia.slice(0, 7);
      porMes.set(clave, (porMes.get(clave) || 0) + total);
    }
    for (let f = primerDiaMes(desde); f <= hasta; ) {
      const clave = f.slice(0, 7);
      const d = parseFecha(f);
      columnas.push({ etiqueta: `${MESES[d.getUTCMonth()].slice(0, 3)} ${String(d.getUTCFullYear()).slice(2)}`, total: porMes.get(clave) || 0 });
      f = sumarDias(ultimoDiaMes(f), 1);
    }
  }
  if (columnas.length === 1) {
    return `<p class="vacio" style="padding:1rem 0">${columnas[0].total ? `Cobrado: ${plata(columnas[0].total)}` : 'Sin cobros registrados hoy.'}</p>`;
  }
  const max = Math.max(1, ...columnas.map((c) => c.total));
  return `
    <div class="barras" role="img" aria-label="Ingresos por ${dias <= 62 ? 'día' : 'mes'}">
      ${columnas.map((c) => `<div class="barra-col" title="${esc(c.etiqueta)}: ${esc(plata(c.total))}">
        <span class="${c.total ? '' : 'cero'}" style="height:${c.total ? Math.max(3, (c.total / max) * 100) : 1}%"></span></div>`).join('')}
    </div>
    <div class="barras-eje"><span>${esc(columnas[0].etiqueta)}</span><span>${esc(columnas[columnas.length - 1].etiqueta)}</span></div>`;
}
