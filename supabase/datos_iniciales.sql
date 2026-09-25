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
