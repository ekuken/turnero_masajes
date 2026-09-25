// =====================================================================
//  Edge Function OPCIONAL: envía por email los avisos en cola.
//  Usa Resend (https://resend.com, plan gratuito disponible).
//
//  Variables necesarias (Supabase > Edge Functions > Secrets):
//    RESEND_API_KEY   clave de Resend
//    REMITENTE        ej: "Espacio Calma <turnos@tudominio.com>" (dominio verificado en Resend)
//    CRON_SECRET      texto secreto cualquiera; se envía en el header x-cron-secret
//  SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya están disponibles automáticamente.
//
//  Los avisos por WhatsApp y SMS quedan en la cola para enviarlos desde el panel
//  (sección "Avisos a clientes"). Ver README para conectar un proveedor automático.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_POR_EJECUCION = 25;
const MAX_INTENTOS = 3;

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('No autorizado', { status: 401 });
  }
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const remitente = Deno.env.get('REMITENTE');
  if (!apiKey || !remitente) return new Response('Faltan RESEND_API_KEY o REMITENTE', { status: 500 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: pendientes, error } = await sb.from('notificaciones')
    .select('*')
    .eq('estado', 'pendiente')
    .eq('canal', 'email')
    .lt('intentos', MAX_INTENTOS)
    .lte('programada_para', new Date().toISOString())
    .order('programada_para')
    .limit(MAX_POR_EJECUCION);
  if (error) return new Response(error.message, { status: 500 });

  let enviados = 0;
  for (const n of pendientes ?? []) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: remitente, to: [n.destinatario], subject: n.asunto ?? 'Tu turno', text: n.mensaje }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
      await sb.from('notificaciones')
        .update({ estado: 'enviada', enviada_en: new Date().toISOString(), intentos: n.intentos + 1, error: null })
        .eq('id', n.id);
      enviados++;
    } catch (e) {
      const intentos = n.intentos + 1;
      await sb.from('notificaciones')
        .update({ intentos, error: String(e).slice(0, 500), estado: intentos >= MAX_INTENTOS ? 'error' : 'pendiente' })
        .eq('id', n.id);
    }
  }
  return Response.json({ procesados: pendientes?.length ?? 0, enviados });
});
