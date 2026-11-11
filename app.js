// Area Clienti Metodo Integrato.
// 1) Il cliente entra con la sua email (link o codice via mail), senza account Claude.
// 2) Legge da Supabase i dati che Matteo pubblica dal MS - GESTIONALE.
// 3) Carica il codice dell'area cliente copiato dal gestionale (cartella gest/) e lo fa girare
//    con un "ponte" che gli passa i dati di Supabase: stessa grafica e stessi contenuti del gestionale.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const $app = document.getElementById('app');
const $bar = document.getElementById('mi-bar');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const head = (t, sub = 'Area cliente') => `<header class="p-head"><div class="p-head-in"><div class="brand" style="padding:0"><b style="font-family:var(--f-display);font-size:1.3rem;letter-spacing:.04em;text-transform:uppercase">Metodo Integrato</b></div><div><div class="eyebrow" style="color:var(--rail-muted)">${esc(sub)}</div><h1>${esc(t)}</h1></div></div></header>`;
const page = (t, body, sub) => { $app.innerHTML = head(t, sub) + `<div class="p-wrap stack-lg">${body}</div>`; };
const errBox = m => `<p class="small" style="color:var(--bad)">${esc(m)}</p>`;

/* ---------------- accesso ---------------- */
let emailInviata = '';
function viewLogin(msg = '') {
  page('Benvenuto', `<form class="card stack" id="f-mail" style="max-width:440px">
    <p>Scrivi l'email che hai dato a Matteo: ti mandiamo un link per entrare. Niente password da ricordare.</p>
    <label class="fld"><span>La tua email</span><input id="mail" type="email" autocomplete="email" inputmode="email" required value="${esc(emailInviata)}"></label>
    <button class="btn pri" type="submit">Inviami il link</button>${msg}
  </form>`);
  document.getElementById('f-mail').onsubmit = async e => {
    e.preventDefault();
    const email = document.getElementById('mail').value.trim().toLowerCase();
    const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Invio…';
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/accesso`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }, body: JSON.stringify({ email }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error === 'email' ? 'Controlla l\'email: sembra scritta male.' : 'Invio non riuscito, riprova tra qualche minuto.');
      emailInviata = email; viewCode(j.limite);
    } catch (err) { viewLogin(errBox(err.message)); }
  };
}
function viewCode(limite, msg = '') {
  page('Controlla la posta', `<form class="card stack" id="f-code" style="max-width:440px">
    <p>Se <b>${esc(emailInviata)}</b> è registrata da Matteo, ti è appena arrivata una mail: <b>tocca il link</b> che contiene e sei dentro. Se la mail contiene anche un codice, puoi scriverlo qui sotto.</p>
    ${limite ? '<p class="small muted">Hai già chiesto diverse mail: usa l\'ultima che ti è arrivata o riprova tra 15 minuti.</p>' : ''}
    <label class="fld"><span>Codice (se c'è)</span><input id="code" class="mi-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></label>
    <button class="btn pri" type="submit">Entra</button>${msg}
    <p class="small muted">Non arriva nulla? Guarda nello spam. Se ancora niente, scrivi a Matteo: forse ha un'altra tua email.</p>
    <button class="btn sm" type="button" id="b-back">Cambia email</button>
  </form>`);
  document.getElementById('b-back').onclick = () => viewLogin();
  document.getElementById('f-code').onsubmit = async e => {
    e.preventDefault();
    const token = document.getElementById('code').value.replace(/\D/g, '');
    const { error } = await sb.auth.verifyOtp({ email: emailInviata, token, type: 'email' });
    if (error) viewCode(false, errBox('Codice non valido o scaduto. Controlla l\'ultima mail ricevuta.'));
  };
}

/* ---------------- dopo l'accesso ---------------- */
let avviato = false, sessioneUtente = null;
sb.auth.onAuthStateChange((ev, session) => {
  if (session && !avviato) { avviato = true; sessioneUtente = session.user; setTimeout(entra, 0); }
  if (!session && ev === 'SIGNED_OUT') { location.replace(location.pathname); }
});
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session && !avviato) viewLogin();
})();

async function entra() {
  page('Un attimo…', '<div class="empty">Carico la tua area…</div>');
  const [{ data: righe, error }, { data: prof }] = await Promise.all([
    sb.from('portali').select('gest_id,nome,email,aggiornato_at').order('nome'),
    sb.from('profili').select('ruolo').eq('id', sessioneUtente.id).maybeSingle(),
  ]);
  if (error) return page('Errore', `<div class="card">Non riesco a leggere i tuoi dati. Controlla la connessione e riapri l'app.</div>`);
  const coach = prof?.ruolo === 'coach';
  const mie = righe;
  barra(coach);
  if (coach) return listaCoach(righe);
  if (!mie.length) return page('Quasi pronto', `<div class="card stack"><p>Hai fatto l'accesso con <b>${esc(sessioneUtente.email)}</b>, ma la tua area non è ancora attiva.</p><p>Scrivi a Matteo: appena la attiva, riapri l'app e trovi programma, alimentazione e progressi.</p></div>`);
  if (mie.length === 1) return apri(mie[0].gest_id, false);
  page('Chi sei?', `<div class="list">${mie.map(r => `<button class="li" style="width:100%;text-align:left;cursor:pointer" data-g="${esc(r.gest_id)}"><span class="main-t">${esc(r.nome)}</span></button>`).join('')}</div>`, 'Scegli il profilo');
  $app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => apri(b.dataset.g, false));
}

function listaCoach(righe) {
  const fmt = d => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  page('Clienti nell\'app', `<p class="muted">Sei entrato come coach. Tocca un cliente per vedere l'app come la vede lui (il diario lo può segnare solo il cliente).</p>
    <label class="fld"><span>Cerca</span><input id="q" placeholder="Nome…"></label>
    <div class="list" id="lst">${righe.map(r => `<button class="li" style="width:100%;text-align:left;cursor:pointer" data-g="${esc(r.gest_id)}" data-n="${esc(r.nome.toLowerCase())}"><span class="main-t">${esc(r.nome)}</span><span class="sub">aggiornato ${fmt(r.aggiornato_at)}</span></button>`).join('') || '<div class="empty">Nessun cliente pubblicato dal gestionale.</div>'}</div>`, 'Vista coach');
  document.getElementById('q').oninput = e => { const q = e.target.value.toLowerCase(); $app.querySelectorAll('[data-n]').forEach(b => b.hidden = !b.dataset.n.includes(q)); };
  const mia = String(sessioneUtente?.email || '').toLowerCase();
  // il coach può segnare davvero solo sul proprio profilo (le regole del database lo permettono solo lì)
  $app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { const r = righe.find(x => x.gest_id === b.dataset.g); apri(b.dataset.g, String(r?.email || '').toLowerCase() !== mia); });
}

function barra(coach) {
  $bar.innerHTML = `${coach ? '<button id="b-clienti">← Clienti</button>' : ''}<button id="b-esci">Esci</button>`;
  $bar.hidden = false;
  document.getElementById('b-esci').onclick = async () => { await sb.auth.signOut(); location.replace(location.pathname); };
  const bc = document.getElementById('b-clienti');
  if (bc) bc.onclick = () => { sessionStorage.removeItem('mi-g'); location.reload(); };
}

/* ---------------- ponte verso il codice del gestionale ---------------- */
let G = null, sola_lettura = false;
const ascoltatori = new Map(); // path -> [callback]
let ultimoAgg = 0;

async function leggi(path) {
  const p = path.split('/');
  if (p[0] === 'portal') {
    const { data } = await sb.from('portali').select('dati,aggiornato_at').eq('gest_id', G).maybeSingle();
    ultimoAgg = Date.now();
    return data ? { ...data.dati, updatedAt: data.dati.updatedAt || data.aggiornato_at } : null;
  }
  if (p[0] === 'brand' && p[1] === 'logo') return (await config('brand')) || null;
  if (p[0] === 'diario' && p[2] === 'giorni' && p[3]) {
    const { data } = await sb.from('diario').select('dati').eq('gest_id', G).eq('giorno', p[3]).maybeSingle();
    return data ? data.dati : null;
  }
  return null;
}
async function leggiLista(path) {
  if (path === 'bacheca') return (await config('bacheca')) || [];
  return [];
}
const cfgCache = {};
async function config(k) {
  if (!(k in cfgCache)) cfgCache[k] = sb.from('app_config').select('v').eq('k', k).maybeSingle().then(r => r.data?.v ?? null);
  return cfgCache[k];
}
async function scrivi(path, v) {
  const p = path.split('/');
  if (p[0] === 'diario' && p[2] === 'giorni' && p[3]) {
    if (sola_lettura) throw Object.assign(new Error('anteprima'), { code: 'not_granted' });
    const { error } = await sb.from('diario').upsert({ gest_id: G, giorno: p[3], dati: v, aggiornato_at: new Date().toISOString(), importato: false });
    if (error) throw error;
    return;
  }
  throw Object.assign(new Error('Non disponibile nell\'app'), { code: 'not_granted' });
}
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
const snap = (id, d) => ({ id, exists: d != null, data: () => clone(d ?? undefined) });
const qsnap = arr => ({ size: arr.length, empty: !arr.length, docs: arr.map((x, i) => snap(String(x.id ?? i), x)) });
function docRef(path) {
  const id = path.split('/').pop();
  return {
    id, path,
    get: async () => snap(id, await leggi(path)),
    onSnapshot(cb, err) {
      const f = async () => { try { cb(snap(id, await leggi(path))); } catch (e) { err && err(e); } };
      (ascoltatori.get(path) || ascoltatori.set(path, []).get(path)).push(f);
      f(); return () => {};
    },
    set: v => scrivi(path, v),
    update: async v => scrivi(path, { ...((await leggi(path)) || {}), ...v }),
    delete: async () => { throw Object.assign(new Error('Non disponibile'), { code: 'not_granted' }); },
  };
}
function colRef(path) {
  const q = {
    doc: id => docRef(path + '/' + (id || Math.random().toString(36).slice(2))),
    where: () => q, orderBy: () => q, limit: () => q,
    get: async () => qsnap(await leggiLista(path)),
    onSnapshot(cb, err) { leggiLista(path).then(a => cb(qsnap(a)), e => err && err(e)); return () => {}; },
  };
  return q;
}
// quando il cliente riapre l'app dopo un po', ricarico i dati freschi
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && G && Date.now() - ultimoAgg > 120000)
    for (const [p, fs] of ascoltatori) if (p.startsWith('portal/') || p.startsWith('diario/')) fs.forEach(f => f());
});

function scarica({ filename, data }) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
  const a = document.createElement('a'); a.href = url; a.download = filename || 'file'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

async function apri(gest_id, comeCoach) {
  G = gest_id; sola_lettura = comeCoach;
  const user = {
    id: async () => G, isOwner: async () => false, canEdit: () => false, can: () => false,
    me: async () => ({ id: G, name: '' }), profiles: async () => ({}), search: async () => [],
  };
  const db = { doc: docRef, collection: colRef };
  const caps = { db, user, downloads: { save: async o => scarica(o) } };
  window.claude = { use: async n => caps[n] ?? null };
  // Registro carichi: il cliente segna kg e note sulla programmazione
  window.MI_APP = {
    sola: sola_lettura,
    regLoad: async prog => {
      const { data, error } = await sb.from('registro').select('seduta,esercizio,settimana,kg,fatto,data').eq('gest_id', G).eq('prog', prog);
      if (error) throw error; return data || [];
    },
    regSave: async (prog, s, e, w, kg, fatto, data) => {
      if (sola_lettura) throw Object.assign(new Error('anteprima'), { code: 'not_granted' });
      const { error } = await sb.from('registro').upsert({ gest_id: G, prog, seduta: s, esercizio: e, settimana: w, kg: kg || '', fatto: fatto || '', data, aggiornato_at: new Date().toISOString(), importato: false });
      if (error) throw error;
    },
  };
  let blocchi;
  try { blocchi = await codice(); } catch (e) {
    console.error(e);
    return page('Errore', '<div class="card">Non riesco a caricare l\'area. Controlla la connessione e riapri l\'app.</div>');
  }
  if (!blocchi.length) return page('Quasi pronto', '<div class="card">L\'area clienti è in preparazione: riprova tra poco.</div>');
  $app.innerHTML = '';
  for (const b of blocchi) {
    const el = document.createElement(b.tipo === 'css' ? 'style' : 'script');
    el.textContent = b.testo;
    document.body.appendChild(el); // gli script inline girano subito, nell'ordine del gestionale
  }
}

// codice e stili dell'area cliente, pubblicati dal gestionale; tenuti in memoria sul telefono finché non cambia versione
async function codice() {
  const ver = await config('codice_versione');
  if (!ver) return [];
  const key = new Request(location.origin + location.pathname + '__codice/' + ver);
  try {
    const c = await caches.open('mi-codice'); const hit = await c.match(key);
    if (hit) return await hit.json();
  } catch (_) { /* senza cache si scarica */ }
  const righe = [];
  for (let da = 0; ; da += 20) {
    const { data, error } = await sb.from('app_codice').select('n,tipo,blocco,testo').eq('versione', ver).order('n').range(da, da + 19);
    if (error) throw error;
    righe.push(...data); if (data.length < 20) break;
  }
  const blocchi = [];
  for (const r of righe) {
    const u = blocchi[blocchi.length - 1];
    if (u && u.blocco === r.blocco) u.testo += r.testo; else blocchi.push({ tipo: r.tipo, blocco: r.blocco, testo: r.testo });
  }
  try {
    const c = await caches.open('mi-codice');
    for (const k of await c.keys()) await c.delete(k);
    await c.put(key, new Response(JSON.stringify(blocchi), { headers: { 'Content-Type': 'application/json' } }));
  } catch (_) { /* ok */ }
  return blocchi;
}
