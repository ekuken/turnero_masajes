-- =====================================================================
--  Seña para reservar (por transferencia)
--  Pegar TODO en Supabase > SQL Editor > New query y tocar Run.
-- =====================================================================

alter table public.negocio add column if not exists sena_porcentaje int not null default 50 check (sena_porcentaje between 0 and 100);
alter table public.negocio add column if not exists datos_transferencia text;

create or replace function public.monto_sena(p_precio numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select round(p_precio * n.sena_porcentaje / 100.0)
    from public.negocio n where n.id = 1 and n.sena_porcentaje > 0 and p_precio > 0;
$$;

create or replace function public.formato_dinero(p numeric)
returns text language sql immutable as $$
  select '$ ' || replace(to_char(round(p), 'FM999,999,999,990'), ',', '.');
$$;

create or replace function public.recalcular_estado_pago(p_turno_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_precio numeric; v_pagado numeric; v_reemb int; v_estado text;
begin
  select precio into v_precio from public.turnos where id = p_turno_id;
  if not found then return; end if;
  select coalesce(sum(monto) filter (where estado = 'aprobado'), 0),
         count(*) filter (where estado = 'reembolsado')
    into v_pagado, v_reemb
    from public.pagos where turno_id = p_turno_id;
  v_estado := case
    when v_pagado <= 0 and v_reemb > 0 then 'reembolsado'
    when v_pagado <= 0 then 'pendiente'
    when v_pagado >= v_precio then 'pagado'
    else 'parcial' end;
  update public.turnos set estado_pago = v_estado where id = p_turno_id and estado_pago is distinct from v_estado;

  -- Si el turno esperaba la seña y ya está cubierta, se confirma solo (dispara el aviso de confirmación)
  if v_pagado > 0 and v_pagado >= public.monto_sena(v_precio) then
    update public.turnos set estado = 'confirmado' where id = p_turno_id and estado = 'pendiente';
  end if;
end $$;

create or replace function public.encolar_notificacion(p_turno_id bigint, p_tipo text, p_programada timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare
  v record; n public.negocio; v_canal text; v_dest text; v_asunto text; v_msg text; v_cuando text; v_sena numeric;
begin
  select t.*, c.nombre as c_nombre, c.email as c_email, c.telefono as c_tel, s.nombre as s_nombre
    into v
    from public.turnos t join public.clientes c on c.id = t.cliente_id join public.servicios s on s.id = t.servicio_id
   where t.id = p_turno_id;
  if not found then return; end if;
  select * into n from public.negocio where id = 1;

  -- Los avisos van siempre por WhatsApp (el teléfono es obligatorio al reservar)
  v_canal := 'whatsapp'; v_dest := v.c_tel;

  v_cuando := to_char(v.fecha, 'DD/MM/YYYY') || ' a las ' || to_char(v.hora_inicio, 'HH24:MI');

  if p_tipo = 'confirmacion' then
    v_asunto := 'Tu turno en ' || n.nombre;
    v_sena := case when v.estado = 'pendiente' and v.estado_pago = 'pendiente' then public.monto_sena(v.precio) end;
    v_msg := 'Hola ' || v.c_nombre || '. '
          || case when v.estado = 'pendiente' then 'Recibimos tu solicitud de turno: '
                  else 'Tu turno está confirmado: ' end
          || v.s_nombre || ', el ' || v_cuando || '.'
          || case when v_sena is not null then
               ' Para confirmarlo, transferí la seña de ' || public.formato_dinero(v_sena)
               || coalesce(' a: ' || n.datos_transferencia, '')
               || '. Envianos el comprobante por este medio.'
             else '' end
          || coalesce(' Dirección: ' || n.direccion || '.', '')
          || coalesce(' ' || n.indicaciones_llegada, '')
          || ' Código de turno: ' || v.codigo || '.'
          || coalesce(' ' || n.politica_cancelacion, '');
  elsif p_tipo = 'recordatorio' then
    v_asunto := 'Recordatorio: tu turno de mañana';
    v_msg := 'Hola ' || v.c_nombre || ', te recordamos tu turno de ' || v.s_nombre || ' el ' || v_cuando || '.'
          || coalesce(' Dirección: ' || n.direccion || '.', '')
          || ' Si no podés asistir, avisanos. Código: ' || v.codigo || '.';
  elsif p_tipo = 'cancelacion' then
    v_asunto := 'Turno cancelado';
    v_msg := 'Hola ' || v.c_nombre || ', tu turno de ' || v.s_nombre || ' del ' || v_cuando || ' fue cancelado.';
  elsif p_tipo = 'cambio_horario' then
    v_asunto := 'Cambio en tu turno';
    v_msg := 'Hola ' || v.c_nombre || ', tu turno de ' || v.s_nombre || ' ahora es el ' || v_cuando || '.'
          || ' Código: ' || v.codigo || '.';
  else
    return;
  end if;

  insert into public.notificaciones (turno_id, tipo, canal, destinatario, asunto, mensaje, programada_para)
  values (p_turno_id, p_tipo, v_canal, v_dest, v_asunto, v_msg, p_programada);
end $$;

create or replace function public.info_publica()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'negocio', (select json_build_object(
        'nombre', n.nombre, 'descripcion', n.descripcion, 'telefono', n.telefono, 'whatsapp', n.whatsapp,
        'email', n.email, 'instagram', n.instagram, 'ubicacion', n.ubicacion_publica, 'imagen_url', n.imagen_url,
        'politica_cancelacion', n.politica_cancelacion, 'zona_horaria', n.zona_horaria, 'moneda', n.moneda,
        'anticipacion_max_dias', n.anticipacion_max_dias, 'confirmacion_automatica', n.confirmacion_automatica,
        'sena_porcentaje', n.sena_porcentaje)
      from public.negocio n where n.id = 1),
    'servicios', coalesce((select json_agg(json_build_object(
        'id', s.id, 'nombre', s.nombre, 'descripcion', s.descripcion, 'duracion', s.duracion,
        'precio', s.precio, 'imagen_url', s.imagen_url) order by s.orden, s.nombre)
      from public.servicios s where s.activo), '[]'::json),
    'horarios', coalesce((select json_agg(json_build_object(
        'dia_semana', h.dia_semana, 'hora_inicio', to_char(h.hora_inicio, 'HH24:MI'),
        'hora_fin', to_char(h.hora_fin, 'HH24:MI')) order by h.dia_semana, h.hora_inicio)
      from public.horarios h where h.activo), '[]'::json)
  );
$$;

create or replace function public.crear_reserva(
  p_servicio_id bigint, p_fecha date, p_hora text,
  p_nombre text, p_apellido text, p_telefono text,
  p_email text default null, p_observaciones text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  n public.negocio; s public.servicios; c public.clientes; t public.turnos;
  v_hora time; v_tel text; v_email text; v_hoy date; v_activos int; v_sena numeric;
begin
  select * into n from public.negocio where id = 1;
  v_hoy := (now() at time zone n.zona_horaria)::date;

  -- Validación de datos
  p_nombre   := btrim(coalesce(p_nombre, ''));
  p_apellido := btrim(coalesce(p_apellido, ''));
  v_email    := nullif(lower(btrim(coalesce(p_email, ''))), '');
  p_observaciones := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_tel      := public.normalizar_telefono(p_telefono);

  if length(p_nombre) not between 1 and 60 then raise exception 'Ingresá tu nombre.' using errcode = 'P0001'; end if;
  if length(p_apellido) not between 1 and 60 then raise exception 'Ingresá tu apellido.' using errcode = 'P0001'; end if;
  if length(v_tel) not between 8 and 15 then raise exception 'Ingresá un teléfono válido, con código de área.' using errcode = 'P0001'; end if;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El email no es válido.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_observaciones, '')) > 500 then
    raise exception 'Las observaciones pueden tener hasta 500 caracteres.' using errcode = 'P0001';
  end if;
  if p_hora is null or p_hora !~ '^\d{2}:\d{2}$' then raise exception 'Elegí un horario.' using errcode = 'P0001'; end if;
  v_hora := p_hora::time;

  select * into s from public.servicios where id = p_servicio_id and activo;
  if not found then raise exception 'El servicio elegido no está disponible.' using errcode = 'P0001'; end if;
  if p_fecha is null then raise exception 'Elegí una fecha.' using errcode = 'P0001'; end if;

  -- Serializa las reservas del mismo día para que dos personas no tomen el mismo horario
  perform pg_advisory_xact_lock(hashtext('turnero-reserva'), (p_fecha - date '2000-01-01'));

  if not exists (select 1 from public._horarios_libres(p_servicio_id, p_fecha) h where h.hora = v_hora) then
    raise exception 'Ese horario ya no está disponible. Elegí otro, por favor.' using errcode = 'P0001';
  end if;

  -- Cliente: se busca por teléfono; si existe no se pisan sus datos (solo se completa el email si faltaba)
  select * into c from public.clientes where telefono_norm = v_tel;
  if not found then
    insert into public.clientes (nombre, apellido, telefono, email)
    values (p_nombre, p_apellido, btrim(p_telefono), v_email)
    returning * into c;
  elsif c.email is null and v_email is not null then
    update public.clientes set email = v_email where id = c.id returning * into c;
  end if;

  select count(*) into v_activos from public.turnos
   where cliente_id = c.id and estado in ('pendiente', 'confirmado') and fecha >= v_hoy;
  if v_activos >= n.max_turnos_activos then
    raise exception 'Ya tenés % turnos reservados. Para reservar otro, comunicate con nosotros.', v_activos
      using errcode = 'P0001';
  end if;

  -- Si se pide seña, el turno queda pendiente hasta que se registre el pago
  v_sena := public.monto_sena(s.precio);

  begin
    insert into public.turnos (cliente_id, servicio_id, fecha, hora_inicio, hora_fin, descanso_min,
                               estado, precio, observaciones, origen)
    values (c.id, s.id, p_fecha, v_hora, (p_fecha + v_hora + s.duracion * interval '1 minute')::time,
            n.descanso_min,
            case when v_sena is null and n.confirmacion_automatica then 'confirmado' else 'pendiente' end,
            s.precio, p_observaciones, 'web')
    returning * into t;
  exception when exclusion_violation then
    raise exception 'Ese horario ya no está disponible. Elegí otro, por favor.' using errcode = 'P0001';
  end;

  return json_build_object(
    'codigo', t.codigo, 'estado', t.estado,
    'servicio', s.nombre, 'duracion', s.duracion, 'precio', t.precio,
    'fecha', t.fecha, 'hora', to_char(t.hora_inicio, 'HH24:MI'), 'hora_fin', to_char(t.hora_fin, 'HH24:MI'),
    'cliente', json_build_object('nombre', p_nombre, 'apellido', p_apellido, 'telefono', btrim(p_telefono), 'email', v_email),
    'direccion', n.direccion, 'indicaciones', n.indicaciones_llegada,
    'politica_cancelacion', n.politica_cancelacion,
    'sena', v_sena, 'sena_porcentaje', n.sena_porcentaje, 'datos_transferencia', n.datos_transferencia);
end $$;

create or replace function public.mis_turnos(p_telefono text, p_codigo text)
returns json language plpgsql stable security definer set search_path = public as $$
declare t public.turnos; n public.negocio; v_ahora timestamp;
begin
  t := public._turno_de_cliente(p_codigo, p_telefono);
  select * into n from public.negocio where id = 1;
  v_ahora := now() at time zone n.zona_horaria;
  return json_build_object(
    'cliente', (select json_build_object('nombre', c.nombre, 'apellido', c.apellido) from public.clientes c where c.id = t.cliente_id),
    'cancelacion_min_horas', n.cancelacion_min_horas,
    'politica_cancelacion', n.politica_cancelacion,
    'datos_transferencia', n.datos_transferencia,
    'turnos', coalesce((select json_agg(json_build_object(
        'codigo', tu.codigo, 'servicio', s.nombre, 'fecha', tu.fecha,
        'hora', to_char(tu.hora_inicio, 'HH24:MI'), 'hora_fin', to_char(tu.hora_fin, 'HH24:MI'),
        'precio', tu.precio, 'estado', tu.estado, 'estado_pago', tu.estado_pago,
        'solicitud_cancelacion', tu.solicitud_cancelacion,
        'sena', case when tu.estado = 'pendiente' and tu.estado_pago = 'pendiente' then public.monto_sena(tu.precio) end,
        'futuro', (tu.fecha + tu.hora_inicio) > v_ahora,
        'cancelable', tu.estado in ('pendiente', 'confirmado') and (tu.fecha + tu.hora_inicio) > v_ahora,
        'cancelacion_directa', (tu.fecha + tu.hora_inicio) >= v_ahora + n.cancelacion_min_horas * interval '1 hour'
      ) order by tu.fecha desc, tu.hora_inicio desc)
      from public.turnos tu join public.servicios s on s.id = tu.servicio_id
      where tu.cliente_id = t.cliente_id), '[]'::json)
  );
end $$;

-- Funciones internas: no se llaman desde la web
revoke execute on function public.monto_sena(numeric), public.formato_dinero(numeric) from public, anon, authenticated;
