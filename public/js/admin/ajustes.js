import { sb, q } from '../api.js';
import { esc, emailValido } from '../utils.js';
import { toast, confirmar, conCarga, mostrarError, datosFormulario } from '../ui.js';
import { ctx, cargarBase, notificarCambio } from './contexto.js';

const ZONAS = [
  'America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba', 'America/Argentina/Mendoza',
  'America/Montevideo', 'America/Santiago', 'America/Asuncion', 'America/La_Paz', 'America/Lima',
  'America/Bogota', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/Madrid',
];

export async function vistaAjustes(cont) {
  await cargarBase();
  const n = ctx.negocio;
  const zonas = ZONAS.includes(n.zona_horaria) ? ZONAS : [n.zona_horaria, ...ZONAS];

  cont.innerHTML = `
    <div class="grilla-2">
      <section class="panel">
        <div class="panel-cab"><h2>Datos del negocio</h2></div>
        <form id="form-negocio" novalidate>
          <div class="error-form" id="error-negocio" hidden></div>
          <div class="campo"><label for="n-nombre">Nombre</label><input id="n-nombre" name="nombre" maxlength="80" required value="${esc(n.nombre)}"></div>
          <div class="campo"><label for="n-desc">Descripción breve</label><textarea id="n-desc" name="descripcion" maxlength="400">${esc(n.descripcion)}</textarea></div>
          <div class="fila-campos">
            <div class="campo"><label for="n-wa">WhatsApp</label><input id="n-wa" name="whatsapp" type="tel" value="${esc(n.whatsapp)}"></div>
            <div class="campo"><label for="n-tel">Teléfono</label><input id="n-tel" name="telefono" type="tel" value="${esc(n.telefono)}"></div>
          </div>
          <div class="fila-campos">
            <div class="campo"><label for="n-email">Email</label><input id="n-email" name="email" type="email" value="${esc(n.email)}"></div>
            <div class="campo"><label for="n-ig">Instagram</label><input id="n-ig" name="instagram" placeholder="@usuario" value="${esc(n.instagram)}"></div>
          </div>
          <div class="campo"><label for="n-ubic">Ubicación que se muestra en la web</label><input id="n-ubic" name="ubicacion_publica" placeholder="Ej: Palermo, CABA" value="${esc(n.ubicacion_publica)}">
            <span class="ayuda">Mostrá solo el barrio o la zona.</span></div>
          <div class="campo"><label for="n-dir">Dirección exacta <span class="opcional">(privada)</span></label><input id="n-dir" name="direccion" value="${esc(n.direccion)}">
            <span class="ayuda">No aparece en la web: solo se envía al cliente cuando reserva, en la confirmación y el recordatorio.</span></div>
          <div class="campo"><label for="n-ind">Indicaciones para llegar <span class="opcional">(privadas)</span></label><input id="n-ind" name="indicaciones_llegada" placeholder="Ej: tocar timbre 3B" value="${esc(n.indicaciones_llegada)}"></div>
          <div class="campo"><label for="n-img">Foto principal <span class="opcional">(dirección web de la imagen)</span></label><input id="n-img" name="imagen_url" type="url" placeholder="https://…" value="${esc(n.imagen_url)}"></div>
          <div class="acciones"><button type="submit" class="btn btn-pri">Guardar datos</button></div>
        </form>
      </section>

      <div>
        <section class="panel">
          <div class="panel-cab"><h2>Reglas de reserva</h2></div>
          <form id="form-reglas" novalidate>
            <div class="error-form" id="error-reglas" hidden></div>
            <div class="fila-campos">
              <div class="campo"><label for="r-int">Cada cuántos minutos se ofrecen turnos</label><input id="r-int" name="intervalo_min" type="number" min="5" max="240" step="5" value="${n.intervalo_min}"></div>
              <div class="campo"><label for="r-desc">Descanso entre turnos (min)</label><input id="r-desc" name="descanso_min" type="number" min="0" max="240" step="5" value="${n.descanso_min}"></div>
            </div>
            <div class="fila-campos">
              <div class="campo"><label for="r-amin">Anticipación mínima (horas)</label><input id="r-amin" name="anticipacion_min_horas" type="number" min="0" max="720" value="${n.anticipacion_min_horas}"></div>
              <div class="campo"><label for="r-amax">Reservas hasta (días adelante)</label><input id="r-amax" name="anticipacion_max_dias" type="number" min="1" max="365" value="${n.anticipacion_max_dias}"></div>
            </div>
            <div class="fila-campos">
              <div class="campo"><label for="r-canc">Cancelación sin aviso hasta (horas antes)</label><input id="r-canc" name="cancelacion_min_horas" type="number" min="0" max="720" value="${n.cancelacion_min_horas}">
                <span class="ayuda">Más cerca del turno, el cliente solo puede pedir la cancelación.</span></div>
              <div class="campo"><label for="r-max">Turnos activos por cliente</label><input id="r-max" name="max_turnos_activos" type="number" min="1" max="50" value="${n.max_turnos_activos}"></div>
            </div>
            <div class="campo"><label for="r-pol">Política de cancelación (se muestra al reservar)</label><textarea id="r-pol" name="politica_cancelacion" maxlength="400">${esc(n.politica_cancelacion)}</textarea></div>
            <div class="fila-campos">
              <div class="campo"><label for="r-tz">Zona horaria</label><select id="r-tz" name="zona_horaria">${zonas.map((z) => `<option ${z === n.zona_horaria ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
              <div class="campo"><label for="r-mon">Moneda</label><select id="r-mon" name="moneda">${['ARS', 'UYU', 'CLP', 'USD', 'EUR', 'MXN', 'COP', 'PEN', 'BRL'].map((m) => `<option ${m === n.moneda ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
            </div>
            <label class="check"><input type="checkbox" name="confirmacion_automatica" ${n.confirmacion_automatica ? 'checked' : ''}> Confirmar automáticamente las reservas online</label>
            <p class="leyenda">Si lo desactivás, las reservas web quedan "pendientes" hasta que las confirmes.</p>
            <div class="acciones"><button type="submit" class="btn btn-pri">Guardar reglas</button></div>
          </form>
        </section>

        <section class="panel">
          <div class="panel-cab"><h2>Métodos de pago</h2></div>
          <ul class="lista-simple" id="lista-metodos">
            ${ctx.metodos.map((m) => `
              <li><label class="check"><input type="checkbox" data-metodo-activo="${m.id}" ${m.activo ? 'checked' : ''}> ${esc(m.nombre)}</label>
                <button type="button" class="btn btn-texto btn-chico" data-metodo-borrar="${m.id}">Quitar</button></li>`).join('')}
          </ul>
          <form id="form-metodo" class="herramientas" style="margin:1rem 0 0" novalidate>
            <input class="crece" name="nombre" maxlength="40" placeholder="Nuevo método (ej: Cuenta DNI)" aria-label="Nuevo método de pago">
            <button type="submit" class="btn btn-sec">Agregar</button>
          </form>
        </section>

        <section class="panel">
          <div class="panel-cab"><h2>Tu cuenta</h2></div>
          <p class="leyenda" style="margin-top:0">Ingresaste como ${esc(ctx.usuario?.email)}.</p>
          <form id="form-clave" novalidate>
            <div class="error-form" id="error-clave" hidden></div>
            <div class="fila-campos">
              <div class="campo"><label for="k-1">Nueva contraseña</label><input id="k-1" name="clave" type="password" autocomplete="new-password" minlength="8"></div>
              <div class="campo"><label for="k-2">Repetir contraseña</label><input id="k-2" name="clave2" type="password" autocomplete="new-password"></div>
            </div>
            <div class="acciones"><button type="submit" class="btn btn-sec">Cambiar contraseña</button></div>
          </form>
        </section>
      </div>
    </div>`;

  // Datos del negocio
  const fn = cont.querySelector('#form-negocio');
  fn.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(fn);
    const caja = cont.querySelector('#error-negocio');
    const errores = [];
    if (!d.nombre) errores.push('Ingresá el nombre del negocio.');
    if (d.email && !emailValido(d.email)) errores.push('El email no es válido.');
    if (d.imagen_url && !/^https?:\/\/\S+$/i.test(d.imagen_url)) errores.push('La foto debe ser una dirección web que empiece con https://');
    if (errores.length) return mostrarError(caja, errores.join(' '));
    mostrarError(caja, '');
    const datos = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === '' ? null : v]));
    datos.nombre = d.nombre;
    datos.descripcion = d.descripcion || '';
    await guardarNegocio(datos, fn.querySelector('button[type=submit]'), caja, 'Datos guardados.');
  });

  // Reglas
  const fr = cont.querySelector('#form-reglas');
  fr.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = datosFormulario(fr);
    const caja = cont.querySelector('#error-reglas');
    const num = (k, min, max, nombre) => {
      const v = Number(d[k]);
      if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${nombre}: ingresá un número entre ${min} y ${max}.`);
      return v;
    };
    let datos;
    try {
      datos = {
        intervalo_min: num('intervalo_min', 5, 240, 'Intervalo'),
        descanso_min: num('descanso_min', 0, 240, 'Descanso'),
        anticipacion_min_horas: num('anticipacion_min_horas', 0, 720, 'Anticipación mínima'),
        anticipacion_max_dias: num('anticipacion_max_dias', 1, 365, 'Días de anticipación'),
        cancelacion_min_horas: num('cancelacion_min_horas', 0, 720, 'Cancelación'),
        max_turnos_activos: num('max_turnos_activos', 1, 50, 'Turnos activos'),
        politica_cancelacion: d.politica_cancelacion || null,
        zona_horaria: d.zona_horaria,
        moneda: d.moneda,
        confirmacion_automatica: d.confirmacion_automatica,
      };
    } catch (err) { return mostrarError(caja, err.message); }
    mostrarError(caja, '');
    await guardarNegocio(datos, fr.querySelector('button[type=submit]'), caja, 'Reglas guardadas. Se aplican a las próximas reservas.');
  });

  // Métodos de pago
  cont.querySelectorAll('[data-metodo-activo]').forEach((c) => c.addEventListener('change', async () => {
    try {
      await q(sb.from('metodos_pago').update({ activo: c.checked }).eq('id', Number(c.dataset.metodoActivo)));
      toast(c.checked ? 'Método activado.' : 'Método desactivado.');
      await cargarBase();
    } catch (err) { c.checked = !c.checked; toast(err.message, 'error'); }
  }));
  cont.querySelectorAll('[data-metodo-borrar]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar('Los pagos ya registrados con este método no se modifican.', { titulo: '¿Quitar método de pago?', aceptar: 'Quitar' }))) return;
    try {
      await q(sb.from('metodos_pago').delete().eq('id', Number(b.dataset.metodoBorrar)));
      toast('Método quitado.');
      await cargarBase();
      notificarCambio();
    } catch (err) { toast(err.message, 'error'); }
  }));
  const fm = cont.querySelector('#form-metodo');
  fm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = fm.elements.nombre.value.trim();
    if (!nombre) return toast('Escribí el nombre del método.', 'error');
    try {
      const orden = Math.max(0, ...ctx.metodos.map((m) => m.orden)) + 1;
      await q(sb.from('metodos_pago').insert({ nombre, orden }).select('id').single());
      toast('Método agregado.');
      await cargarBase();
      notificarCambio();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Contraseña
  const fk = cont.querySelector('#form-clave');
  fk.addEventListener('submit', async (e) => {
    e.preventDefault();
    const caja = cont.querySelector('#error-clave');
    const { clave, clave2 } = { clave: fk.elements.clave.value, clave2: fk.elements.clave2.value };
    if (clave.length < 8) return mostrarError(caja, 'La contraseña debe tener al menos 8 caracteres.');
    if (clave !== clave2) return mostrarError(caja, 'Las contraseñas no coinciden.');
    mostrarError(caja, '');
    try {
      await conCarga(fk.querySelector('button'), async () => {
        const { error } = await sb.auth.updateUser({ password: clave });
        if (error) throw error;
      });
      fk.reset();
      toast('Contraseña actualizada.');
    } catch (err) { mostrarError(caja, err.message); }
  });
}

async function guardarNegocio(datos, boton, caja, mensaje) {
  try {
    await conCarga(boton, () => q(sb.from('negocio').update({ ...datos, actualizado: new Date().toISOString() }).eq('id', 1).select('id').single()));
    toast(mensaje);
    await cargarBase();
  } catch (err) {
    mostrarError(caja, /time zone/i.test(err.message) ? 'La zona horaria no es válida.' : err.message);
  }
}
