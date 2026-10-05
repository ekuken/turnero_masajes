# Turnero de masajes

Sistema web de turnos para un servicio de masajes: sitio público con reserva online en cinco pasos y panel privado para gestionar agenda, clientes, servicios, horarios, bloqueos, pagos y avisos.

Funciona con dos servicios que tienen plan gratuito: **Supabase** (base de datos, seguridad y login) y **Netlify** (publicación del sitio). No hace falta instalar nada en tu computadora.

---

## Estructura

```
turnero/
├── netlify.toml                  Configuración de Netlify (carpeta a publicar + cabeceras de seguridad)
├── public/                       El sitio que se publica
│   ├── index.html                Página principal + reserva
│   ├── mis-turnos.html           El cliente consulta, ve su historial o cancela
│   ├── admin.html                Panel de administración (requiere login)
│   ├── css/                      Estilos
│   └── js/
│       ├── config.js             ← ACÁ van los datos de tu proyecto de Supabase
│       ├── api.js, utils.js, ui.js
│       ├── publico.js, mis-turnos.js
│       └── admin/                Módulos del panel (inicio, calendario, turnos, clientes, …)
└── supabase/
    ├── schema.sql                Tablas, reglas, validaciones y permisos
    ├── datos_iniciales.sql       Servicios y horarios de ejemplo (opcional)
    └── functions/enviar-notificaciones/index.ts   Envío automático de emails (opcional)
```

---

## Instalación paso a paso

### 1. Crear la base de datos (Supabase)

1. Entrá a [supabase.com](https://supabase.com), creá una cuenta y un proyecto nuevo. Elegí la región más cercana (São Paulo, para Argentina).
2. Abrí **SQL Editor → New query**, pegá todo el contenido de `supabase/schema.sql` y tocá **Run**.
3. (Opcional) En otra consulta, pegá `supabase/datos_iniciales.sql` y ejecutalo para cargar los 4 servicios de ejemplo y el horario lunes a viernes 9–13 y 15–20, sábados 9–13. Todo se puede cambiar después desde el panel.

> `schema.sql` se puede volver a ejecutar sin perder datos (por ejemplo, al actualizar el sistema). Está pensado para un proyecto de Supabase dedicado a este turnero.

### 2. Crear tu usuario de administración

1. En Supabase: **Authentication → Users → Add user → Create new user**. Poné tu email y una contraseña (marcá "Auto Confirm User").
2. En **SQL Editor**, ejecutá (cambiando nombre y email):

   ```sql
   insert into public.usuarios (id, nombre, email)
   select id, 'Tu nombre', email from auth.users where email = 'tu@email.com';
   ```

3. Recomendado: **Authentication → Sign In / Providers → desactivá "Allow new users to sign up"**. Aunque alguien lograra crear una cuenta, no podría entrar al panel: solo acceden los usuarios cargados en la tabla `usuarios`.

### 3. Conectar el sitio con la base

En Supabase: **Project Settings → API** (o **Data API**). Copiá la **Project URL** y la **anon public key** y pegalas en `public/js/config.js`:

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

La anon key es pública por diseño: toda la seguridad está en la base de datos. **Nunca** uses la `service_role key` en estos archivos.

### 4. Publicar (Netlify)

1. Entrá a [app.netlify.com](https://app.netlify.com) → **Add new site → Deploy manually**.
2. Arrastrá la carpeta **`turnero` completa** (la que contiene `netlify.toml`). Netlify publica la carpeta `public`.
3. Listo: tu sitio queda en `https://nombre.netlify.app`. El panel está en `/admin.html`.

Para probarlo en tu computadora antes de publicar, no abras los archivos con doble clic (los navegadores bloquean los módulos JavaScript desde `file://`). Usá un servidor local, por ejemplo: `npx serve public`.

### 5. Completar los datos del negocio

Entrá al panel → **Ajustes** y cargá nombre, descripción, WhatsApp, ubicación pública (solo el barrio), **dirección exacta** (privada: solo se envía al confirmar el turno), foto, reglas de reserva y métodos de pago.

---

## Cómo funciona

### Reserva (cliente)
Servicio → Fecha → Hora → Datos → Confirmación. El calendario solo habilita días con lugar y solo se muestran horarios libres. No hace falta crear una cuenta: al reservar, el cliente recibe un **código de turno**; con ese código y su teléfono puede ver sus próximos turnos, el historial y cancelar desde **Mis turnos**. Si falta menos que el mínimo configurado (24 h por defecto), en lugar de cancelar envía una **solicitud de cancelación** que aparece en el panel.

### Cálculo de horarios
Los horarios se generan en la base de datos teniendo en cuenta: horario semanal (varias franjas por día), horarios especiales de una fecha, bloqueos de días completos o de franjas (feriados, vacaciones), duración del servicio, turnos existentes, **descanso entre turnos**, anticipación mínima y máxima. Un turno nunca puede terminar después del cierre de la franja. Además de la grilla regular (cada 30 min por defecto) se ofrecen los huecos justo al terminar otro turno, para no desperdiciar tiempo.

### Protección contra reservas duplicadas
Tres capas: el botón se bloquea mientras se envía; la función `crear_reserva` vuelve a validar todo en el servidor (servicio activo, fecha, horario laboral, bloqueos, superposición, duración) y serializa las reservas del mismo día; y la tabla tiene una **restricción de exclusión** que hace imposible guardar dos turnos superpuestos, incluso si dos personas confirman en el mismo instante o si se carga un turno a mano desde el panel.

### Seguridad
- Todas las tablas tienen *Row Level Security*: el público solo puede leer servicios activos y el horario de atención. Todo lo demás pasa por funciones del servidor que devuelven únicamente lo necesario (por ejemplo, la dirección exacta nunca se expone en la web).
- Un cliente solo ve sus turnos si coinciden el código **y** el teléfono. No puede modificar datos de otros ni sus propios datos de cliente (si ya existe, la reserva no pisa su ficha).
- El panel exige login y además verifica el rol de administración en la base de datos en cada consulta.
- Límite de turnos activos por teléfono (3 por defecto) para evitar abusos.

### Zona horaria
Todas las fechas se calculan en la zona del negocio (Buenos Aires por defecto, configurable en Ajustes), sin importar dónde esté el servidor o el visitante.

### Seña
En **Ajustes → Reglas de reserva** se define el porcentaje de seña (50% por defecto; 0 = sin seña) y los datos para transferir (alias, CBU, titular). Con seña activa, las reservas web quedan **pendientes**: al reservar, la clienta ve el monto y los datos de transferencia, y recibe el mismo detalle en el aviso por WhatsApp. Cuando registrás en el turno un pago que cubre la seña, el turno se **confirma solo** y se genera el aviso de confirmación.

### Pagos
Cada turno puede tener varios pagos (seña + saldo, por ejemplo). El estado (pendiente, parcial, pagado, cancelado/reembolsado) se recalcula solo al registrar, anular o reembolsar un pago, o si cambia el precio; también se puede cambiar a mano. Los pagos nunca se borran: se anulan o se marcan como reembolsados, y quedan en el historial.

---

## Avisos a clientes (notificaciones)

El sistema ya genera y guarda en una cola (`notificaciones`) cada aviso de **confirmación, cancelación y cambio de horario**, con el texto listo. Todos los avisos van por WhatsApp al teléfono que dejó el cliente.

**Sin configurar nada**: en el panel, sección **Avisos a clientes**, cada aviso tiene un botón que abre WhatsApp (o tu correo) con el mensaje ya escrito. Un toque y se envía gratis desde tu teléfono.

**Recordatorios del día anterior** (opcional): en Supabase, **Database → Extensions** activá `pg_cron` y ejecutá:

```sql
select cron.schedule('recordatorios-turnos', '0 * * * *', $$select public.encolar_recordatorios()$$);
```

Cada hora revisa los turnos del día siguiente y genera el recordatorio (una sola vez por turno).

**Envío automático de emails** (opcional):
1. Creá una cuenta en [resend.com](https://resend.com) y verificá tu dominio.
2. Instalá la [CLI de Supabase](https://supabase.com/docs/guides/cli) y desde la carpeta `turnero` ejecutá:
   ```
   supabase functions deploy enviar-notificaciones --no-verify-jwt
   supabase secrets set RESEND_API_KEY=... REMITENTE="Tu negocio <turnos@tudominio.com>" CRON_SECRET=un-texto-secreto
   ```
3. Activá la extensión `pg_net` y programá la ejecución cada 10 minutos:
   ```sql
   select cron.schedule('enviar-emails', '*/10 * * * *', $$
     select net.http_post(
       url := 'https://TU-PROYECTO.supabase.co/functions/v1/enviar-notificaciones',
       headers := '{"x-cron-secret": "un-texto-secreto"}'::jsonb)
   $$);
   ```

**WhatsApp o SMS automáticos** (pendiente de conectar): requieren un proveedor pago (WhatsApp Cloud API de Meta con plantillas aprobadas, Twilio, etc.). La cola ya tiene todo lo necesario (`canal`, `destinatario`, `mensaje`, `estado`, `intentos`, `error`); solo falta agregar en `enviar-notificaciones/index.ts` una rama para `canal = 'whatsapp'` o `'sms'` que llame a la API elegida, igual que la de email.

---

## Qué queda para una etapa futura

- **Pagos online** (cobrar la seña con Mercado Pago al reservar): hoy los pagos se registran a mano en el panel. La tabla `pagos` ya soporta el método "Mercado Pago"; faltaría una Edge Function que cree la preferencia de pago y reciba la notificación (webhook) para registrar el pago automáticamente.
- **WhatsApp/SMS automáticos**: ver sección anterior.
- **Protección anti-bots en la reserva** (por ejemplo, Cloudflare Turnstile) si el sitio empieza a recibir reservas falsas. Mientras tanto, el límite de turnos por teléfono y la confirmación manual (desactivando "Confirmar automáticamente" en Ajustes) cubren el caso.
- **Varios profesionales o salas**: el sistema está pensado para una sola persona que atiende de a un cliente. Para varios, habría que agregar una columna de profesional a turnos y horarios e incluirla en la restricción de superposición.

---

## Pruebas realizadas

- Base de datos (PostgreSQL 16): el esquema se ejecutó dos veces seguidas sin errores; se probaron generación de horarios, descanso entre turnos, cierre de franja, días cerrados, bloqueos parciales, reservas simultáneas, superposición manual, permisos de visitantes / usuarios sin rol / administración, recálculo de pagos, cola de avisos, estadísticas y validación de zona horaria.
- Interfaz, de punta a punta contra la base real: reserva completa (incluido el caso de que otra persona tome el horario mientras se completa el formulario), consulta y cancelación en Mis turnos, login (cuenta sin permiso y contraseña incorrecta), todas las secciones del panel, creación de turnos, bloqueo de superposición desde el panel, pagos parciales / completos / anulados, calendario día-semana-mes, clientes, servicios (incluido que no se pueda borrar uno con historial), horarios, bloqueos con aviso de turnos afectados, avisos, ajustes y búsqueda global.
