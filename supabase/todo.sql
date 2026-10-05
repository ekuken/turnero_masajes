-- =====================================================================
--  TURNERO DE MASAJES - SQL COMPLETO (schema + datos iniciales)
--  Pegar TODO en: Supabase > SQL Editor > New query > Run
-- =====================================================================

-- =====================================================================
--  TURNERO DE MASAJES · Esquema de base de datos (Supabase / PostgreSQL)
--  Ejecutar completo en: Supabase > SQL Editor > New query > Run
--  Es seguro volver a ejecutarlo: no borra datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. UTILIDADES
-- ---------------------------------------------------------------------

-- Normaliza teléfonos argentinos para poder compararlos:
-- "+54 9 11 5555-1234", "011 5555 1234" y "11 5555 1234" -> "1155551234"
create or replace function public.normalizar_telefono(p text)
returns text language sql immutable as $$
  select case
    when d like '549%' then substr(d, 4)
    when d like '54%'  then substr(d, 3)
    when d like '0%'   then substr(d, 2)
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- Código corto y aleatorio para que el cliente consulte o cancele su turno
create or replace function public.generar_codigo()
returns text language sql volatile as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

-- ---------------------------------------------------------------------
-- 2. TABLAS
-- ---------------------------------------------------------------------

-- Datos del negocio y reglas de reserva (una sola fila)
create table if not exists public.negocio (
  id                      int primary key default 1 check (id = 1),
  nombre                  text not null default 'Cuerpo & Alma',
  descripcion             text not null default 'Masajes terapéuticos y de relajación en un espacio tranquilo.',
  telefono                text,
  whatsapp                text,
  email                   text,
  instagram               text,
  ubicacion_publica       text default 'Buenos Aires',       -- se muestra en la web (ej: "Palermo, CABA")
  direccion               text,                               -- privada: solo se envía al confirmar el turno
  indicaciones_llegada    text,
  imagen_url              text,
  politica_cancelacion    text default 'Podés cancelar sin cargo hasta 24 horas antes del turno.',
  zona_horaria            text not null default 'America/Argentina/Buenos_Aires',
  moneda                  text not null default 'ARS',
  intervalo_min           int  not null default 30  check (intervalo_min between 5 and 240),
  descanso_min            int  not null default 15  check (descanso_min between 0 and 240),
  anticipacion_min_horas  int  not null default 2   check (anticipacion_min_horas between 0 and 720),
  anticipacion_max_dias   int  not null default 60  check (anticipacion_max_dias between 1 and 365),
  cancelacion_min_horas   int  not null default 24  check (cancelacion_min_horas between 0 and 720),
  confirmacion_automatica boolean not null default true,
  max_turnos_activos      int  not null default 3   check (max_turnos_activos between 1 and 50),
  sena_porcentaje         int  not null default 50  check (sena_porcentaje between 0 and 100),  -- 0 = sin seña
  datos_transferencia     text,                               -- alias / CBU / titular para pagar la seña
  actualizado             timestamptz not null default now()
);
-- Columnas agregadas después de la primera versión (para bases ya creadas)
alter table public.negocio add column if not exists sena_porcentaje int not null default 50 check (sena_porcentaje between 0 and 100);
alter table public.negocio add column if not exists datos_transferencia text;
insert into public.negocio (id) values (1) on conflict (id) do nothing;

-- Usuarios del panel (vinculados a Supabase Auth)
create table if not exists public.usuarios (
  id             uuid primary key references auth.users (id) on delete cascade,
  nombre         text not null,
  email          text not null,
  rol            text not null default 'admin' check (rol in ('admin')),
  fecha_creacion timestamptz not null default now()
);

create table if not exists public.clientes (
  id               bigint generated always as identity primary key,
  nombre           text not null check (length(btrim(nombre)) between 1 and 60),
  apellido         text not null default '' check (length(apellido) <= 60),
  telefono         text not null,
  telefono_norm    text generated always as (public.normalizar_telefono(telefono)) stored,
  email            text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  fecha_nacimiento date,
  notas            text,
  fecha_registro   timestamptz not null default now(),
  constraint clientes_telefono_valido check (length(public.normalizar_telefono(telefono)) between 6 and 15)
);
create unique index if not exists clientes_telefono_unico on public.clientes (telefono_norm);

create table if not exists public.servicios (
  id          bigint generated always as identity primary key,
  nombre      text not null check (length(btrim(nombre)) between 1 and 80),
  descripcion text not null default '',
  duracion    int  not null check (duracion between 5 and 600),     -- minutos
  precio      numeric(12,2) not null default 0 check (precio >= 0),
  activo      boolean not null default true,
  imagen_url  text,
  orden       int not null default 0,
  creado      timestamptz not null default now()
);

-- Horario semanal. dia_semana: 0 = domingo, 1 = lunes ... 6 = sábado.
-- Un día sin tramos activos se considera cerrado.
create table if not exists public.horarios (
  id          bigint generated always as identity primary key,
  dia_semana  smallint not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fin    time not null,
  activo      boolean not null default true,
  check (hora_fin > hora_inicio)
);

-- Excepciones: para una fecha puntual, reemplazan el horario semanal de ese día
create table if not exists public.excepciones_horario (
  id          bigint generated always as identity primary key,
  fecha       date not null,
  hora_inicio time not null,
  hora_fin    time not null,
  motivo      text,
  check (hora_fin > hora_inicio)
);

-- Bloqueos: días completos (sin horas) o franjas horarias, en una fecha o un rango de fechas
create table if not exists public.bloqueos (
  id          bigint generated always as identity primary key,
  tipo        text not null default 'bloqueo' check (tipo in ('bloqueo', 'feriado', 'vacaciones')),
  fecha       date not null,
  fecha_hasta date,
  hora_inicio time,
  hora_fin    time,
  motivo      text,
  creado      timestamptz not null default now(),
  check (fecha_hasta is null or fecha_hasta >= fecha),
  check ((hora_inicio is null) = (hora_fin is null)),
  check (hora_inicio is null or hora_fin > hora_inicio)
);

create table if not exists public.metodos_pago (
  id     bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true,
  orden  int not null default 0
);
insert into public.metodos_pago (nombre, orden) values
  ('Efectivo', 1), ('Transferencia', 2), ('Tarjeta', 3), ('Mercado Pago', 4), ('Otro', 5)
on conflict (nombre) do nothing;

create table if not exists public.turnos (
  id                    bigint generated always as identity primary key,
  codigo                text not null unique default public.generar_codigo(),
  cliente_id            bigint not null references public.clientes (id) on delete restrict,
  servicio_id           bigint not null references public.servicios (id) on delete restrict,
  fecha                 date not null,
  hora_inicio           time not null,
  hora_fin              time not null,
  descanso_min          int  not null check (descanso_min between 0 and 240),   -- si no se indica, toma el valor del negocio
  estado                text not null default 'pendiente'
                        check (estado in ('pendiente', 'confirmado', 'en_curso', 'realizado', 'cancelado', 'no_asistio')),
  precio                numeric(12,2) not null default 0 check (precio >= 0),
  estado_pago           text not null default 'pendiente'
                        check (estado_pago in ('pendiente', 'parcial', 'pagado', 'reembolsado')),
  observaciones         text check (length(observaciones) <= 1000),
  notas_internas        text,
  origen                text not null default 'admin' check (origen in ('web', 'admin')),
  solicitud_cancelacion boolean not null default false,
  cancelado_por         text check (cancelado_por in ('cliente', 'admin')),
  fecha_creacion        timestamptz not null default now(),
  actualizado           timestamptz not null default now(),
  -- Rango que ocupa el turno en la agenda (incluye el descanso posterior)
  rango tsrange generated always as (
    tsrange(fecha + hora_inicio, fecha + hora_fin + descanso_min * interval '1 minute', '[)')
  ) stored,
  check (hora_fin > hora_inicio),
  -- Garantía final contra superposiciones, incluso con reservas simultáneas
  constraint turnos_sin_superposicion exclude using gist (rango with &&) where (estado <> 'cancelado')
);
create index if not exists turnos_fecha_idx   on public.turnos (fecha);
create index if not exists turnos_cliente_idx on public.turnos (cliente_id);

create table if not exists public.pagos (
  id         bigint generated always as identity primary key,
  turno_id   bigint not null references public.turnos (id) on delete restrict,
  monto      numeric(12,2) not null check (monto > 0),
  metodo     text not null,
  estado     text not null default 'aprobado' check (estado in ('aprobado', 'reembolsado', 'anulado')),
  fecha_pago timestamptz not null default now(),
  nota       text,
  creado     timestamptz not null default now()
);
create index if not exists pagos_turno_idx on public.pagos (turno_id);
create index if not exists pagos_fecha_idx on public.pagos (fecha_pago);

-- Cola de notificaciones: el sistema las genera; un proceso externo (o el panel) las envía
create table if not exists public.notificaciones (
  id              bigint generated always as identity primary key,
  turno_id        bigint references public.turnos (id) on delete cascade,
  tipo            text not null check (tipo in ('confirmacion', 'recordatorio', 'cancelacion', 'cambio_horario')),
  canal           text not null check (canal in ('email', 'whatsapp', 'sms')),
  destinatario    text not null,
  asunto          text,
  mensaje         text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'enviada', 'error', 'omitida')),
  intentos        int not null default 0,
  error           text,
  programada_para timestamptz not null default now(),
  enviada_en      timestamptz,
  creada          timestamptz not null default now()
);
create index if not exists notificaciones_pendientes_idx on public.notificaciones (estado, programada_para);

-- ---------------------------------------------------------------------
-- 3. PERMISOS Y SEGURIDAD
-- ---------------------------------------------------------------------

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin');
$$;

do $$
declare t text;
begin
  foreach t in array array['negocio','usuarios','clientes','servicios','horarios','excepciones_horario',
                           'bloqueos','metodos_pago','turnos','pagos','notificaciones']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_todo on public.%I', t);
    execute format('create policy admin_todo on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- Lo único que el público puede leer directamente: servicios activos y horario de atención
drop policy if exists publico_servicios on public.servicios;
create policy publico_servicios on public.servicios for select to anon, authenticated using (activo);
drop policy if exists publico_horarios on public.horarios;
create policy publico_horarios on public.horarios for select to anon, authenticated using (activo);

-- ---------------------------------------------------------------------
-- 4. VISTAS PARA EL PANEL (respetan los permisos del usuario que consulta)
-- ---------------------------------------------------------------------

drop view if exists public.turnos_detalle;
create view public.turnos_detalle with (security_invoker = true) as
select t.id, t.codigo, t.cliente_id, t.servicio_id, t.fecha, t.hora_inicio, t.hora_fin, t.descanso_min,
       t.estado, t.precio, t.estado_pago, t.observaciones, t.notas_internas, t.origen,
       t.solicitud_cancelacion, t.cancelado_por, t.fecha_creacion, t.actualizado,
       (extract(epoch from (t.hora_fin - t.hora_inicio)) / 60)::int as duracion,
       c.nombre   as cliente_nombre,
       c.apellido as cliente_apellido,
       c.telefono as cliente_telefono,
       c.telefono_norm as cliente_telefono_norm,
       c.email    as cliente_email,
       s.nombre   as servicio_nombre,
       coalesce(p.pagado, 0) as monto_pagado,
       greatest(t.precio - coalesce(p.pagado, 0), 0) as saldo
from public.turnos t
join public.clientes  c on c.id = t.cliente_id
join public.servicios s on s.id = t.servicio_id
left join lateral (
  select sum(monto) as pagado from public.pagos where turno_id = t.id and estado = 'aprobado'
) p on true;

drop view if exists public.clientes_resumen;
create view public.clientes_resumen with (security_invoker = true) as
select c.id, c.nombre, c.apellido, c.telefono, c.telefono_norm, c.email, c.fecha_nacimiento, c.notas, c.fecha_registro,
       count(t.id)                                        as total_turnos,
       count(t.id) filter (where t.estado = 'realizado')  as turnos_realizados,
       count(t.id) filter (where t.estado = 'cancelado')  as cancelaciones,
       count(t.id) filter (where t.estado = 'no_asistio') as ausencias,
       coalesce((select sum(p.monto) from public.pagos p join public.turnos t2 on t2.id = p.turno_id
                 where t2.cliente_id = c.id and p.estado = 'aprobado'), 0) as total_gastado,
       max(t.fecha) filter (where t.estado <> 'cancelado') as ultimo_turno
from public.clientes c
left join public.turnos t on t.cliente_id = c.id
group by c.id;

grant select on public.turnos_detalle, public.clientes_resumen to authenticated;
revoke select on public.turnos_detalle, public.clientes_resumen from anon;

-- ---------------------------------------------------------------------
-- 5. TRIGGERS
-- ---------------------------------------------------------------------

-- Completa datos faltantes del turno y valida lo básico
create or replace function public.tg_turnos_antes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dur int;
begin
  if new.descanso_min is null then
    select descanso_min into new.descanso_min from public.negocio where id = 1;
  end if;
  if new.hora_fin is null then
    select duracion into v_dur from public.servicios where id = new.servicio_id;
    new.hora_fin := (new.fecha + new.hora_inicio + v_dur * interval '1 minute')::time;
  end if;
  if new.estado = 'cancelado' and (tg_op = 'INSERT' or old.estado <> 'cancelado') then
    new.solicitud_cancelacion := false;
    new.cancelado_por := coalesce(new.cancelado_por, 'admin');
  end if;
  if new.estado <> 'cancelado' then new.cancelado_por := null; end if;
  new.actualizado := now();
  return new;
end $$;
drop trigger if exists turnos_antes on public.turnos;
create trigger turnos_antes before insert or update on public.turnos
for each row execute function public.tg_turnos_antes();

-- Valida la zona horaria del negocio (una inválida rompería el cálculo de horarios)
create or replace function public.tg_negocio_validar()
returns trigger language plpgsql as $$
begin
  perform now() at time zone new.zona_horaria;
  new.actualizado := now();
  return new;
exception when others then
  raise exception 'La zona horaria "%" no es válida.', new.zona_horaria using errcode = 'P0001';
end $$;
drop trigger if exists negocio_validar on public.negocio;
create trigger negocio_validar before insert or update on public.negocio
for each row execute function public.tg_negocio_validar();

-- Seña que pide el negocio para un precio dado (null si no se pide seña)
create or replace function public.monto_sena(p_precio numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select round(p_precio * n.sena_porcentaje / 100.0)
    from public.negocio n where n.id = 1 and n.sena_porcentaje > 0 and p_precio > 0;
$$;

-- Importe para mostrar en mensajes: $ 12.500
create or replace function public.formato_dinero(p numeric)
returns text language sql immutable as $$
  select '$ ' || replace(to_char(round(p), 'FM999,999,999,990'), ',', '.');
$$;

-- Recalcula el estado de pago del turno según los pagos registrados
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

create or replace function public.tg_pagos_despues()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.recalcular_estado_pago(old.turno_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform public.recalcular_estado_pago(new.turno_id); end if;
  return null;
end $$;
drop trigger if exists pagos_despues on public.pagos;
create trigger pagos_despues after insert or update or delete on public.pagos
for each row execute function public.tg_pagos_despues();

create or replace function public.tg_turnos_precio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.pagos where turno_id = new.id) then
    perform public.recalcular_estado_pago(new.id);
  end if;
  return null;
end $$;
drop trigger if exists turnos_precio on public.turnos;
create trigger turnos_precio after update of precio on public.turnos
for each row when (old.precio is distinct from new.precio) execute function public.tg_turnos_precio();

-- Genera el texto de una notificación y la deja en cola
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

create or replace function public.tg_turnos_notificar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.estado in ('pendiente', 'confirmado') then
      perform public.encolar_notificacion(new.id, 'confirmacion');
    end if;
  elsif new.estado = 'cancelado' and old.estado <> 'cancelado' then
    perform public.encolar_notificacion(new.id, 'cancelacion');
  elsif new.estado in ('pendiente', 'confirmado')
        and (new.fecha <> old.fecha or new.hora_inicio <> old.hora_inicio) then
    perform public.encolar_notificacion(new.id, 'cambio_horario');
  elsif new.estado = 'confirmado' and old.estado = 'pendiente' then
    perform public.encolar_notificacion(new.id, 'confirmacion');
  end if;
  return null;
end $$;
drop trigger if exists turnos_notificar on public.turnos;
create trigger turnos_notificar after insert or update of estado, fecha, hora_inicio on public.turnos
for each row execute function public.tg_turnos_notificar();

-- Recordatorios del día siguiente. Programar con pg_cron (ver README).
create or replace function public.encolar_recordatorios()
returns int language plpgsql security definer set search_path = public as $$
declare v_tz text; v_manana date; r record; v_n int := 0;
begin
  select zona_horaria into v_tz from public.negocio where id = 1;
  v_manana := (now() at time zone v_tz)::date + 1;
  for r in
    select t.id from public.turnos t
     where t.fecha = v_manana and t.estado in ('pendiente', 'confirmado')
       and not exists (select 1 from public.notificaciones n where n.turno_id = t.id and n.tipo = 'recordatorio')
  loop
    perform public.encolar_notificacion(r.id, 'recordatorio');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 6. DISPONIBILIDAD
-- ---------------------------------------------------------------------

-- Devuelve los horarios libres para un servicio en una fecha.
-- Considera: horario de atención, excepciones, bloqueos, duración, turnos existentes,
-- descanso entre turnos y anticipación mínima/máxima.
create or replace function public._horarios_libres(p_servicio_id bigint, p_fecha date, p_excluir_turno bigint default null)
returns table (hora time) language plpgsql stable security definer set search_path = public as $$
declare
  n public.negocio; v_dur interval; v_desc interval; v_paso interval; v_ahora timestamp;
begin
  select * into n from public.negocio where id = 1;
  select s.duracion * interval '1 minute' into v_dur from public.servicios s where s.id = p_servicio_id and s.activo;
  if v_dur is null or p_fecha is null then return; end if;

  v_desc  := n.descanso_min * interval '1 minute';
  v_paso  := n.intervalo_min * interval '1 minute';
  v_ahora := now() at time zone n.zona_horaria;

  if p_fecha < v_ahora::date or p_fecha > v_ahora::date + n.anticipacion_max_dias then return; end if;

  -- Día bloqueado completo
  if exists (select 1 from public.bloqueos b
              where p_fecha between b.fecha and coalesce(b.fecha_hasta, b.fecha) and b.hora_inicio is null) then
    return;
  end if;

  return query
  with tramos as (
    select p_fecha + x.hora_inicio as ini, p_fecha + x.hora_fin as fin
      from public.excepciones_horario x where x.fecha = p_fecha
    union all
    select p_fecha + h.hora_inicio, p_fecha + h.hora_fin
      from public.horarios h
     where h.activo and h.dia_semana = extract(dow from p_fecha)::int
       and not exists (select 1 from public.excepciones_horario x2 where x2.fecha = p_fecha)
  ),
  ocupados as (
    select t.rango from public.turnos t
     where t.fecha between p_fecha - 1 and p_fecha + 1 and t.estado <> 'cancelado'
       and (p_excluir_turno is null or t.id <> p_excluir_turno)
  ),
  bloqueos_hora as (
    select tsrange(p_fecha + b.hora_inicio, p_fecha + b.hora_fin, '[)') as rango
      from public.bloqueos b
     where p_fecha between b.fecha and coalesce(b.fecha_hasta, b.fecha) and b.hora_inicio is not null
  ),
  candidatos as (
    -- Grilla regular dentro de cada tramo
    select tr.ini, tr.fin, g as inicio
      from tramos tr, generate_series(tr.ini, tr.fin - v_dur, v_paso) g
    union
    -- Justo después de un turno existente (aprovecha huecos fuera de la grilla)
    select tr.ini, tr.fin, upper(o.rango)
      from tramos tr, ocupados o
     where upper(o.rango) between tr.ini and tr.fin - v_dur
    union
    -- Justo después de un bloqueo horario
    select tr.ini, tr.fin, upper(b.rango)
      from tramos tr, bloqueos_hora b
     where upper(b.rango) between tr.ini and tr.fin - v_dur
  )
  select distinct c.inicio::time
    from candidatos c
   where c.inicio + v_dur <= c.fin
     and c.inicio >= v_ahora + n.anticipacion_min_horas * interval '1 hour'
     and not exists (select 1 from ocupados o where o.rango && tsrange(c.inicio, c.inicio + v_dur + v_desc, '[)'))
     and not exists (select 1 from bloqueos_hora b where b.rango && tsrange(c.inicio, c.inicio + v_dur, '[)'))
   order by 1;
end $$;

-- Pública: horarios libres de una fecha
create or replace function public.horarios_disponibles(p_servicio_id bigint, p_fecha date)
returns table (hora text) language sql stable security definer set search_path = public as $$
  select to_char(h.hora, 'HH24:MI') from public._horarios_libres(p_servicio_id, p_fecha) h;
$$;

-- Administración: horarios libres ignorando un turno (para reprogramarlo)
create or replace function public.horarios_disponibles_admin(p_servicio_id bigint, p_fecha date, p_excluir_turno bigint default null)
returns table (hora text) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Sin permiso.' using errcode = '42501'; end if;
  return query select to_char(h.hora, 'HH24:MI') from public._horarios_libres(p_servicio_id, p_fecha, p_excluir_turno) h;
end $$;

-- Pública: cantidad de horarios libres por día en un rango (para el calendario)
create or replace function public.dias_disponibles(p_servicio_id bigint, p_desde date, p_hasta date)
returns table (fecha date, libres int) language plpgsql stable security definer set search_path = public as $$
declare d date;
begin
  if p_desde is null or p_hasta is null or p_hasta < p_desde then return; end if;
  if p_hasta - p_desde > 62 then p_hasta := p_desde + 62; end if;
  d := p_desde;
  while d <= p_hasta loop
    fecha := d;
    select count(*)::int into libres from public._horarios_libres(p_servicio_id, d);
    return next;
    d := d + 1;
  end loop;
end $$;

-- Pública: datos del negocio para la web (sin la dirección exacta)
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

-- ---------------------------------------------------------------------
-- 7. RESERVAS PÚBLICAS
-- ---------------------------------------------------------------------

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

-- Busca un turno por código + teléfono (ambos deben coincidir)
create or replace function public._turno_de_cliente(p_codigo text, p_telefono text)
returns public.turnos language plpgsql stable security definer set search_path = public as $$
declare t public.turnos;
begin
  select tu.* into t from public.turnos tu join public.clientes c on c.id = tu.cliente_id
   where tu.codigo = upper(btrim(coalesce(p_codigo, '')))
     and c.telefono_norm = public.normalizar_telefono(p_telefono)
     and length(public.normalizar_telefono(p_telefono)) >= 6;
  if not found then
    raise exception 'No encontramos un turno con ese código y teléfono.' using errcode = 'P0001';
  end if;
  return t;
end $$;

-- Pública: el cliente ve sus turnos (próximos e historial)
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

-- Pública: cancelar (con anticipación suficiente) o solicitar cancelación (si es sobre la hora)
create or replace function public.cancelar_turno_cliente(p_codigo text, p_telefono text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare t public.turnos; n public.negocio; v_ahora timestamp; v_inicio timestamp;
begin
  t := public._turno_de_cliente(p_codigo, p_telefono);
  select * into n from public.negocio where id = 1;
  v_ahora := now() at time zone n.zona_horaria;
  v_inicio := t.fecha + t.hora_inicio;

  if t.estado not in ('pendiente', 'confirmado') or v_inicio <= v_ahora then
    raise exception 'Este turno ya no se puede cancelar.' using errcode = 'P0001';
  end if;

  if v_inicio >= v_ahora + n.cancelacion_min_horas * interval '1 hour' then
    update public.turnos set estado = 'cancelado', cancelado_por = 'cliente' where id = t.id;
    return json_build_object('resultado', 'cancelado');
  else
    update public.turnos set solicitud_cancelacion = true where id = t.id;
    return json_build_object('resultado', 'solicitud');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. ESTADÍSTICAS (solo administración)
-- ---------------------------------------------------------------------

create or replace function public.estadisticas(p_desde date, p_hasta date)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_hoy date; v_mes date;
begin
  if not public.es_admin() then raise exception 'Sin permiso.' using errcode = '42501'; end if;
  select zona_horaria into v_tz from public.negocio where id = 1;
  v_hoy := (now() at time zone v_tz)::date;
  v_mes := date_trunc('month', v_hoy)::date;

  return json_build_object(
    'hoy', v_hoy,
    'turnos_hoy', (select count(*) from public.turnos where fecha = v_hoy and estado not in ('cancelado')),
    'cobrado_hoy', (select coalesce(sum(monto), 0) from public.pagos
                     where estado = 'aprobado' and (fecha_pago at time zone v_tz)::date = v_hoy),
    'cobrado_mes', (select coalesce(sum(monto), 0) from public.pagos
                     where estado = 'aprobado' and (fecha_pago at time zone v_tz)::date >= v_mes),
    'solicitudes_cancelacion', (select count(*) from public.turnos where solicitud_cancelacion and estado in ('pendiente','confirmado')),
    'periodo', (select json_build_object(
        'pendientes',  count(*) filter (where estado = 'pendiente'),
        'confirmados', count(*) filter (where estado = 'confirmado'),
        'en_curso',    count(*) filter (where estado = 'en_curso'),
        'realizados',  count(*) filter (where estado = 'realizado'),
        'cancelados',  count(*) filter (where estado = 'cancelado'),
        'no_asistio',  count(*) filter (where estado = 'no_asistio'),
        'total',       count(*))
      from public.turnos where fecha between p_desde and p_hasta),
    'cobrado_periodo', (select coalesce(sum(monto), 0) from public.pagos
                         where estado = 'aprobado' and (fecha_pago at time zone v_tz)::date between p_desde and p_hasta),
    'pendiente_cobro', (select coalesce(sum(greatest(t.precio - coalesce(p.pagado, 0), 0)), 0)
                          from public.turnos t
                          left join lateral (select sum(monto) pagado from public.pagos
                                              where turno_id = t.id and estado = 'aprobado') p on true
                         where t.estado in ('pendiente', 'confirmado', 'en_curso', 'realizado')
                           and t.estado_pago in ('pendiente', 'parcial')
                           and t.fecha between p_desde and p_hasta),
    'servicios_top', coalesce((select json_agg(x) from (
        select s.nombre, count(*) as cantidad
          from public.turnos t join public.servicios s on s.id = t.servicio_id
         where t.fecha between p_desde and p_hasta and t.estado <> 'cancelado'
         group by s.nombre order by count(*) desc, s.nombre limit 6) x), '[]'::json),
    'ingresos_por_dia', coalesce((select json_agg(x order by x.dia) from (
        select (fecha_pago at time zone v_tz)::date as dia, sum(monto) as total
          from public.pagos
         where estado = 'aprobado' and (fecha_pago at time zone v_tz)::date between p_desde and p_hasta
         group by 1) x), '[]'::json),
    'ingresos_por_metodo', coalesce((select json_agg(x) from (
        select metodo, sum(monto) as total from public.pagos
         where estado = 'aprobado' and (fecha_pago at time zone v_tz)::date between p_desde and p_hasta
         group by metodo order by 2 desc) x), '[]'::json)
  );
end $$;

-- ---------------------------------------------------------------------
-- 9. QUIÉN PUEDE EJECUTAR CADA FUNCIÓN
-- ---------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.normalizar_telefono(text)                   to anon, authenticated;
grant execute on function public.generar_codigo()                            to authenticated;
grant execute on function public.es_admin()                                  to anon, authenticated;
grant execute on function public.info_publica()                              to anon, authenticated;
grant execute on function public.horarios_disponibles(bigint, date)          to anon, authenticated;
grant execute on function public.dias_disponibles(bigint, date, date)        to anon, authenticated;
grant execute on function public.crear_reserva(bigint, date, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.mis_turnos(text, text)                      to anon, authenticated;
grant execute on function public.cancelar_turno_cliente(text, text)          to anon, authenticated;
grant execute on function public.estadisticas(date, date)                    to authenticated;
grant execute on function public.horarios_disponibles_admin(bigint, date, bigint) to authenticated;


-- =====================================================================
--  Datos iniciales de ejemplo. Ejecutar UNA sola vez, después de schema.sql.
--  Todo se puede modificar o borrar luego desde el panel de administración.
-- =====================================================================

insert into public.servicios (nombre, descripcion, duracion, precio, orden)
select * from (values
  ('Masaje relajante', 'Movimientos lentos y envolventes para bajar el estrés y descansar.', 60, 25000, 1),
  ('Masaje descontracturante', 'Trabajo profundo sobre contracturas y zonas de tensión.', 60, 28000, 2),
  ('Espalda y cuello', 'Sesión corta enfocada en la zona que más carga el día a día.', 30, 16000, 3),
  ('Masaje corporal completo', 'Recorrido completo de pies a cabeza, a ritmo tranquilo.', 90, 36000, 4)
) v(nombre, descripcion, duracion, precio, orden)
where not exists (select 1 from public.servicios);

-- Lunes a viernes: 09:00–13:00 y 15:00–20:00. Sábados: 09:00–13:00. Domingo cerrado.
insert into public.horarios (dia_semana, hora_inicio, hora_fin)
select d, hi::time, hf::time
from generate_series(1, 5) d,
     (values ('09:00', '13:00'), ('15:00', '20:00')) t(hi, hf)
where not exists (select 1 from public.horarios)
union all
select 6, '09:00'::time, '13:00'::time
where not exists (select 1 from public.horarios);
