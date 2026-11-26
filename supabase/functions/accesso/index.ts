// Accesso clienti: manda il codice di accesso SOLO alle email presenti nel gestionale (tabella portali)
// o a chi ha appena compilato il questionario di benvenuto (tabella iscrizioni, arriva con nuovo: true dal link unico).
// Risponde sempre allo stesso modo, così non si può scoprire chi è cliente.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const APP_URL = 'https://scainellimatteo90-creator.github.io/area-clienti/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const risposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return risposta({ error: 'metodo' }, 405);
  let email = '', nuovo = false;
  try { const b = await req.json(); email = String(b.email || '').trim().toLowerCase(); nuovo = b.nuovo === true; } catch (_) { /* vuoto */ }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return risposta({ error: 'email' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // limiti: max 3 richieste per email ogni 15 minuti, max 40 in totale all'ora
  const t15 = new Date(Date.now() - 15 * 60e3).toISOString();
  const t60 = new Date(Date.now() - 60 * 60e3).toISOString();
  const [{ count: perEmail }, { count: totali }] = await Promise.all([
    admin.from('accessi').select('id', { count: 'exact', head: true }).eq('email', email).gte('at', t15),
    admin.from('accessi').select('id', { count: 'exact', head: true }).gte('at', t60),
  ]);
  if ((perEmail ?? 0) >= 3 || (totali ?? 0) >= 40) return risposta({ ok: true, limite: true });

  // nuovo cliente dal questionario: lo segno (max 20 nuovi all'ora), così può entrare subito.
  // Vede la sua area quando Matteo importa il questionario nel gestionale e la pubblica.
  if (nuovo) {
    const { count: nuoviOra } = await admin.from('iscrizioni').select('email', { count: 'exact', head: true }).gte('creato_at', t60);
    if ((nuoviOra ?? 0) < 20) await admin.from('iscrizioni').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
  }
  const t60g = new Date(Date.now() - 60 * 864e5).toISOString();
  const { data: iscr } = await admin.from('iscrizioni').select('email').eq('email', email).gte('creato_at', t60g).limit(1);
  const { data: righe } = await admin.from('portali').select('gest_id').ilike('email', email).eq('attivo', true).limit(1);
  const { data: coach } = await admin.rpc('email_coach', { e: email });
  const abilitata = (righe && righe.length > 0) || coach === true || (iscr && iscr.length > 0);
  await admin.from('accessi').insert({ email, ok: abilitata });
  if (!abilitata) return risposta({ ok: true });

  // crea l'utente se non esiste ancora (le iscrizioni libere sono chiuse), poi manda il codice
  const { error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (ce && !/already|registered|exists/i.test(ce.message)) return risposta({ error: 'utente' }, 500);
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { error } = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: APP_URL } });
  if (error) return risposta({ error: 'invio', dettaglio: error.message }, 502);
  return risposta({ ok: true });
});
