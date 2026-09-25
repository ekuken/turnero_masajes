import { sb, q } from '../api.js';
import { esc, fechaCorta, fechaDe, fechaHoraDe, sumarDias, inicioSemana, primerDiaMes, ultimoDiaMes } from '../utils.js';
import { ctx, hoy, plata, params, irA } from './contexto.js';

const PERIODOS = { hoy: 'Hoy', semana: 'Esta semana', mes: 'Este mes', rango: 'Rango' };
const ESTADO_PAGO_TXT = { aprobado: 'Cobrado', reembolsado: 'Reembolsado', anulado: 'Anulado' };

export async function vistaPagos(cont) {
  const p = params();
  const per = PERIODOS[p.per] ? p.per : 'mes';
  const h = hoy();
  let desde, hasta;
  if (per === 'hoy') desde = hasta = h;
  else if (per === 'semana') { desde = inicioSemana(h); hasta = sumarDias(desde, 6); }
  else if (per === 'rango' && p.desde && p.hasta) { [desde, hasta] = p.desde <= p.hasta ? [p.desde, p.hasta] : [p.hasta, p.desde]; }
  else { desde = primerDiaMes(h); hasta = ultimoDiaMes(h); }
  const metodo = p.metodo || '';

  // Se trae un margen de un día y se filtra por la fecha local del negocio (evita errores de zona horaria)
  let consulta = sb.from('pagos')
    .select('*, turnos(id, fecha, hora_inicio, clientes(nombre, apellido), servicios(nombre))')
    .gte('fecha_pago', `${sumarDias(desde, -1)}T00:00:00Z`)
    .lte('fecha_pago', `${sumarDias(hasta, 1)}T23:59:59Z`)
    .order('fecha_pago', { ascending: false })
    .limit(1000);
  if (metodo) consulta = consulta.eq('metodo', metodo);
  const crudos = await q(consulta);
  const pagos = crudos.filter((x) => {
    const f = fechaDe(x.fecha_pago, ctx.tz);
    return f >= desde && f <= hasta;
  });

  const cobrados = pagos.filter((x) => x.estado === 'aprobado');
  const total = cobrados.reduce((s, x) => s + Number(x.monto), 0);
  const porMetodo = new Map();
  for (const x of cobrados) porMetodo.set(x.metodo, (porMetodo.get(x.metodo) || 0) + Number(x.monto));
  const metodosFiltro = [...new Set([...ctx.metodos.map((m) => m.nombre), ...pagos.map((x) => x.metodo)])];

  cont.innerHTML = `
    <div class="herramientas">
      <div class="segmentado" role="group" aria-label="Período">
        ${Object.entries(PERIODOS).map(([k, v]) => `<button type="button" data-per="${k}" aria-pressed="${k === per}">${v}</button>`).join('')}
      </div>
      <span id="rango" ${per === 'rango' ? '' : 'hidden'} style="display:flex;gap:.5rem;flex-wrap:wrap">
        <input type="date" id="r-desde" value="${desde}" aria-label="Desde"><input type="date" id="r-hasta" value="${hasta}" aria-label="Hasta">
      </span>
      <select id="f-metodo" aria-label="Método de pago"><option value="">Todos los métodos</option>
        ${metodosFiltro.map((m) => `<option ${m === metodo ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
    </div>
    <div class="metricas" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="metrica metrica-dinero"><div class="metrica-valor">${plata(total)}</div><div class="metrica-nombre">Cobrado (${fechaCorta(desde)} al ${fechaCorta(hasta)})</div></div>
      ${[...porMetodo].map(([m, v]) => `<div class="metrica"><div class="metrica-valor">${plata(v)}</div><div class="metrica-nombre">${esc(m)}</div></div>`).join('')}
    </div>
    <div class="panel">
      <p class="leyenda" style="margin-top:0">Los pagos se registran desde la ficha de cada turno.</p>
      <div class="tabla-scroll">
        <table class="tabla tabla-fichas">
          <thead><tr><th>Fecha</th><th>Cliente</th><th>Servicio y turno</th><th>Método</th><th>Estado</th><th class="num">Monto</th></tr></thead>
          <tbody>
            ${pagos.length ? pagos.map((x) => `
              <tr data-turno="${x.turno_id}" data-abrir>
                <td class="principal-ficha">${esc(fechaHoraDe(x.fecha_pago, ctx.tz))}</td>
                <td data-t="Cliente">${esc(x.turnos?.clientes?.nombre)} ${esc(x.turnos?.clientes?.apellido)}</td>
                <td data-t="Turno">${esc(x.turnos?.servicios?.nombre)} · ${esc(fechaCorta(x.turnos?.fecha))}</td>
                <td data-t="Método">${esc(x.metodo)}</td>
                <td data-t="Estado">${esc(ESTADO_PAGO_TXT[x.estado] || x.estado)}</td>
                <td class="num" data-t="Monto" style="${x.estado !== 'aprobado' ? 'text-decoration:line-through;color:var(--muted)' : ''}">${plata(x.monto)}</td>
              </tr>`).join('') : '<tr><td colspan="6" class="tabla-vacia">No hay pagos en este período.</td></tr>'}
          </tbody>
        </table>
      </div>
      ${crudos.length >= 1000 ? '<p class="leyenda">Se muestran hasta 1000 pagos. Acotá el período para ver el resto.</p>' : ''}
    </div>`;

  const ir = (c) => irA('pagos', { per, desde: per === 'rango' ? desde : '', hasta: per === 'rango' ? hasta : '', metodo, ...c });
  cont.querySelectorAll('[data-per]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.per === 'rango') {
      cont.querySelector('#rango').hidden = false;
      cont.querySelectorAll('[data-per]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      return;
    }
    ir({ per: b.dataset.per, desde: '', hasta: '' });
  }));
  const cambiarRango = () => {
    const d = cont.querySelector('#r-desde').value, hh = cont.querySelector('#r-hasta').value;
    if (d && hh) ir({ per: 'rango', desde: d, hasta: hh });
  };
  cont.querySelector('#r-desde').addEventListener('change', cambiarRango);
  cont.querySelector('#r-hasta').addEventListener('change', cambiarRango);
  cont.querySelector('#f-metodo').addEventListener('change', (e) => ir({ metodo: e.target.value }));
}
