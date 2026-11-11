import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- utilità ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtD = d => new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const fmtDT = d => new Date(d).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtN = (v, dec) => v == null ? '–' : Number(v).toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const oggi = () => new Date().toISOString().slice(0, 10);
const lunedi = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const nome1 = n => esc(String(n || '').split(' ')[0]);
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2400); }
function check({ error }, msg) { if (error) { console.error(error); toast(msg || 'Qualcosa non ha funzionato. Riprova.'); throw error; } }

const METRICS = {
  peso: { l: 'Peso', u: 'kg', dec: 1, good: 'down' },
  massa_grassa: { l: 'Massa grassa', u: '%', dec: 1, good: 'down' },
  cmj: { l: 'Salto CMJ', u: 'cm', dec: 1, good: 'up' },
  squat_1rm: { l: 'Squat 1RM stimato', u: 'kg', dec: 0, good: 'up' },
};
const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  scheda: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/></svg>',
  prog: '<svg viewBox="0 0 24 24"><path d="M3 20h18M5 16l5-5 4 3 6-7"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4z"/></svg>',
};

/* ---------- stato ---------- */
const S = { me: null, vista: 'cliente', tab: 'oggi', giorno: null, metric: 'cmj', rpe: null, clienti: [], sel: null, D: null };

/* ---------- dati ---------- */
async function caricaCliente(id) {
  const [p, b, m, n, f, a] = await Promise.all([
    sb.from('profili').select('*').eq('id', id).single(),
    sb.from('blocchi').select('*').eq('cliente_id', id).eq('attivo', true).order('creato_at', { ascending: false }).limit(1),
    sb.from('misure').select('*').eq('cliente_id', id).order('data'),
    sb.from('note').select('*').eq('cliente_id', id).order('creato_at', { ascending: false }).limit(50),
    sb.from('feedback').select('*').eq('cliente_id', id).order('creato_at', { ascending: false }).limit(20),
    sb.from('appuntamenti').select('*').eq('cliente_id', id).gte('quando', new Date().toISOString()).order('quando').limit(1),
  ]);
  [p, b, m, n, f, a].forEach(r => check(r, 'Impossibile caricare i dati.'));
  const blocco = b.data[0] || null;
  let esercizi = [], fatti = [], pdfUrl = null;
  if (blocco) {
    const e = await sb.from('esercizi').select('*').eq('blocco_id', blocco.id).order('giorno').order('ordine');
    check(e); esercizi = e.data;
    const ids = esercizi.map(x => x.id);
    if (ids.length) {
      const ft = await sb.from('esercizi_fatti').select('esercizio_id').eq('cliente_id', id).gte('data', lunedi()).in('esercizio_id', ids);
      check(ft); fatti = ft.data.map(x => x.esercizio_id);
    }
    if (blocco.pdf_path) {
      const u = await sb.storage.from('schede').createSignedUrl(blocco.pdf_path, 3600);
      if (!u.error) pdfUrl = u.data.signedUrl;
    }
  }
  const giorni = {};
  esercizi.forEach(e => { (giorni[e.giorno] ||= { titolo: e.titolo_giorno || '', es: [] }).es.push(e); if (e.titolo_giorno) giorni[e.giorno].titolo = e.titolo_giorno; });
  if (!S.giorno || !giorni[S.giorno]) S.giorno = Object.keys(giorni).sort()[0] || 'A';
  S.D = { profilo: p.data, blocco, giorni, fatti, pdfUrl, misure: m.data, note: n.data, feedback: f.data, prossimo: a.data[0] || null };
}
async function caricaClienti() {
  const r = await sb.from('profili').select('*').eq('ruolo', 'cliente').order('nome');
  check(r); S.clienti = r.data;
  if (!S.sel && S.clienti.length) S.sel = S.clienti[0].id;
}
function settimana(b) {
  if (!b) return '';
  const w = Math.floor((Date.now() - new Date(b.inizio + 'T00:00:00')) / 6048e5) + 1;
  return `Settimana ${Math.min(Math.max(w, 1), b.settimane)} di ${b.settimane}`;
}

/* ---------- grafico ---------- */
function chartSVG(misure, m) {
  const pts = misure.filter(x => x[m] != null);
  if (pts.length < 2) return '<p class="muted">Il grafico compare dalla seconda misurazione.</p>';
  const W = 340, H = 170, L = 38, R = 14, T = 14, B = 26;
  const vals = pts.map(p => +p[m]); let mn = Math.min(...vals), mx = Math.max(...vals);
  const pad = (mx - mn) * .2 || 1; mn -= pad; mx += pad;
  const x = i => L + i * (W - L - R) / (pts.length - 1), y = v => T + (mx - v) * (H - T - B) / (mx - mn);
  const dec = METRICS[m].dec;
  let g = ''; for (let k = 0; k <= 3; k++) { const v = mn + (mx - mn) * k / 3; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--mut)">${fmtN(v, dec)}</text>`; }
  const line = pts.map((p, i) => `${x(i)},${y(+p[m])}`).join(' ');
  const last = pts.length - 1;
  const step = Math.ceil(pts.length / 6);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${METRICS[m].l} nel tempo">${g}
    <polygon points="${x(0)},${H - B} ${line} ${x(last)},${H - B}" fill="var(--acc)" fill-opacity=".28"/>
    <polyline points="${line}" fill="none" stroke="var(--ink)" stroke-width="2.2"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(+p[m])}" r="${i === last ? 5.5 : 3}" fill="${i === last ? 'var(--acc)' : 'var(--ink)'}" stroke="var(--ink)" stroke-width="${i === last ? 2 : 0}"/>`).join('')}
    ${pts.map((p, i) => (i % step === 0 || i === last) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--mut)">${fmtD(p.data)}</text>` : '').join('')}</svg>`;
}
function deltaTxt(misure, m) {
  const p = misure.filter(x => x[m] != null); if (p.length < 2) return '';
  const d = p.at(-1)[m] - p[0][m], M = METRICS[m], good = (M.good === 'up') === (d > 0);
  return `<span class="${good ? 'up' : ''}">${d > 0 ? '+' : ''}${fmtN(d, M.dec)} ${M.u}</span>`;
}

/* ---------- schermate di accesso ---------- */
function vLogin(msg = '') {
  $('#seg').hidden = true;
  $('#app').innerHTML = `<div class="phone"><form class="login" id="f-login">
    <div class="mark" style="width:52px;height:52px;font-size:26px">MI</div>
    <h2>Area clienti</h2><p>Scrivi l'email che hai dato a Matteo: ti mandiamo un link per entrare, senza password.</p>
    <label class="f">Email<input id="l-email" type="email" required autocomplete="email"></label>
    <button class="btn acc">Mandami il link</button>${msg ? `<p class="muted">${msg}</p>` : ''}</form></div>`;
  $('#f-login').onsubmit = async e => {
    e.preventDefault();
    const email = $('#l-email').value.trim();
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
    vLogin(error ? 'Questa email non risulta tra i clienti. Controlla di averla scritta bene o scrivi a Matteo.' : `Fatto. Apri l'email che ti abbiamo mandato a ${esc(email)} e tocca il link.`);
  };
}
function vConsenso() {
  $('#app').innerHTML = `<div class="phone"><div class="login">
    <h2>Prima di iniziare</h2>
    <p>In quest'area salviamo misure corporee, test e note sul tuo allenamento. Sono dati sulla salute: li vediamo solo tu e Matteo, sono conservati su server in Unione Europea e puoi chiederne la cancellazione in qualsiasi momento.</p>
    <label class="row" style="align-items:flex-start;gap:10px"><input type="checkbox" id="cons" style="width:22px;height:22px;accent-color:var(--acc)"><span>Acconsento al trattamento dei miei dati relativi alla salute per seguire il mio percorso di allenamento (art. 9 GDPR).</span></label>
    <button class="btn acc" id="cons-go">Continua</button>
    <button class="btn ghost" id="logout">Esci</button></div></div>`;
  $('#cons-go').onclick = async () => {
    if (!$('#cons').checked) return toast('Serve il consenso per usare l\'area clienti');
    check(await sb.from('profili').update({ consenso_dati_salute_at: new Date().toISOString() }).eq('id', S.me.id));
    S.me.consenso_dati_salute_at = new Date().toISOString(); start();
  };
}

/* ---------- vista cliente ---------- */
function vCliente() {
  const D = S.D, c = D.profilo, anteprima = S.me.ruolo === 'coach';
  const tabs = [['oggi', 'Oggi', 'home'], ['scheda', 'Scheda', 'scheda'], ['prog', 'Progressi', 'prog'], ['note', 'Note', 'note']];
  const body = { oggi: cOggi, scheda: cScheda, prog: cProg, note: cNote }[S.tab](D);
  $('#app').innerHTML = `<div class="phone">
    <div class="p-head"><div><div class="sub">${esc(c.sport || 'Metodo Integrato')}${anteprima ? ' · anteprima coach' : ''}</div><h2>Ciao ${nome1(c.nome)}</h2></div>${anteprima ? '' : '<button class="out" id="logout">Esci</button>'}</div>
    <div class="p-body">${body}</div>
    <nav class="tabs" role="tablist">${tabs.map(t => `<button role="tab" data-tab="${t[0]}" aria-selected="${S.tab === t[0]}">${ICONS[t[2]]}${t[1]}</button>`).join('')}</nav></div>`;
}
function cOggi(D) {
  const G = D.giorni[S.giorno], ult = D.misure.at(-1), nota = D.note.find(n => n.autore === 'coach');
  const done = G ? G.es.filter(e => D.fatti.includes(e.id)).length : 0, tot = G ? G.es.length : 0;
  return `${G ? `<div class="box hero"><span class="eyebrow">${settimana(D.blocco)} · Giorno ${esc(S.giorno)}</span><h3>${esc(G.titolo || D.blocco.titolo)}</h3>
      <div class="bar"><i style="width:${tot ? done / tot * 100 : 0}%"></i></div><span class="num">${done} di ${tot} esercizi fatti questa settimana</span>
      <button class="btn" data-go="scheda">${done ? 'Continua' : 'Inizia'} l'allenamento</button></div>`
      : '<div class="box"><span class="eyebrow">Scheda</span><b>Matteo sta preparando la tua scheda. La trovi qui appena è pronta.</b></div>'}
    ${ult ? `<div class="stats">
      <div class="stat"><span>Salto CMJ</span><b class="num">${fmtN(ult.cmj, 1)}</b><span>cm ${deltaTxt(D.misure, 'cmj') ? '· ' + deltaTxt(D.misure, 'cmj') : ''}</span></div>
      <div class="stat"><span>Squat 1RM stimato</span><b class="num">${fmtN(ult.squat_1rm, 0)}</b><span>kg ${deltaTxt(D.misure, 'squat_1rm') ? '· ' + deltaTxt(D.misure, 'squat_1rm') : ''}</span></div></div>` : ''}
    ${D.prossimo ? `<div class="box"><span class="eyebrow">Prossimo appuntamento</span><b>${esc(D.prossimo.descrizione || 'Appuntamento')} · ${fmtDT(D.prossimo.quando)}</b></div>` : ''}
    ${nota ? `<div class="box"><span class="eyebrow">Ultima nota di Matteo · ${fmtD(nota.creato_at)}</span><div class="note"><span>${esc(nota.testo)}</span></div><button class="btn ghost" data-go="note" style="align-self:flex-start">Rispondi</button></div>` : ''}`;
}
function cScheda(D) {
  if (!D.blocco) return '<p class="muted">Ancora nessuna scheda.</p>';
  const G = D.giorni[S.giorno];
  return `<div><span class="eyebrow">${esc(D.blocco.titolo)} · ${settimana(D.blocco)}</span>${G ? `<h3 style="font-size:26px;margin-top:4px">${esc(G.titolo)}</h3>` : ''}</div>
    ${Object.keys(D.giorni).length ? `<div class="days">${Object.keys(D.giorni).sort().map(k => `<button data-day="${esc(k)}" aria-pressed="${k === S.giorno}">Giorno ${esc(k)}</button>`).join('')}</div>` : ''}
    ${D.pdfUrl ? `<div class="pdf"><span class="ic">PDF</span><div><a href="${esc(D.pdfUrl)}" target="_blank" rel="noopener">Apri la scheda completa</a><div class="muted">${esc(D.blocco.titolo)}</div></div></div>` : ''}
    ${G ? G.es.map(e => { const ok = D.fatti.includes(e.id); return `<label class="ex ${ok ? 'done' : ''}"><input type="checkbox" data-ex="${e.id}" ${ok ? 'checked' : ''}>
      <h4>${esc(e.nome)}</h4><div class="det"><span class="pres num">${e.serie ?? ''} × ${esc(e.ripetizioni)}${e.carico ? ' · ' + esc(e.carico) : ''}</span><span class="tip">${e.recupero ? 'Recupero ' + esc(e.recupero) : ''}${e.note_tecniche ? ' · ' + esc(e.note_tecniche) : ''}</span></div></label>`; }).join('') : ''}
    <div class="box"><span class="eyebrow">Com'è andata? Fatica percepita (RPE 1-10)</span>
      <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button data-rpe="${n}" aria-pressed="${S.rpe === n}">${n}</button>`).join('')}</div>
      <textarea id="fb-t" placeholder="Carichi, sensazioni, dolori: scrivi a Matteo"></textarea>
      <button class="btn acc" id="fb-go">Invia a Matteo</button></div>`;
}
function cProg(D) {
  const m = S.metric, M = METRICS[m];
  return `<div class="chips">${Object.entries(METRICS).map(([k, v]) => `<button data-m="${k}" aria-pressed="${k === m}">${v.l}</button>`).join('')}</div>
    <div class="box chart"><div class="row" style="justify-content:space-between"><span class="eyebrow">${M.l} (${M.u})</span><span class="num">${deltaTxt(D.misure, m)}</span></div>${chartSVG(D.misure, m)}</div>
    ${D.misure.length ? `<div class="tw"><table class="num"><thead><tr><th>Data</th><th>Peso</th><th>Grasso</th><th>CMJ</th><th>Squat</th></tr></thead>
    <tbody>${[...D.misure].reverse().map(r => `<tr><td>${fmtD(r.data)}</td><td>${fmtN(r.peso, 1)}</td><td>${fmtN(r.massa_grassa, 1)}</td><td>${fmtN(r.cmj, 1)}</td><td>${fmtN(r.squat_1rm, 0)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Le misure compaiono qui dopo il primo test con Matteo.</p>'}`;
}
function cNote(D) {
  return `<div class="box"><span class="eyebrow">Scrivi a Matteo</span><textarea id="cn-t" placeholder="Domande, cambi di programma, sensazioni"></textarea><button class="btn acc" id="cn-go" style="align-self:flex-start">Invia</button></div>
    ${D.note.length ? D.note.map(n => `<div class="note ${n.autore === 'cliente' ? 'me' : ''}"><span class="meta">${n.autore === 'coach' ? 'Matteo' : 'Tu'} · ${fmtD(n.creato_at)}</span><span>${esc(n.testo)}</span></div>`).join('') : '<p class="muted">Ancora nessuna nota.</p>'}`;
}

/* ---------- vista coach ---------- */
function stato(c) { return c.consenso_dati_salute_at ? ['ok', 'Attivo'] : ['warn', 'In attesa del primo accesso']; }
function vCoach() {
  const D = S.D;
  if (!D) { $('#app').innerHTML = `<div class="card" style="max-width:640px;margin:0 auto"><h3>Nessun cliente</h3><p class="muted">Invita il primo cliente da Supabase (Authentication → Users → Invite user). Comparirà qui appena accetta.</p></div>`; return; }
  const c = D.profilo, b = D.blocco, G = D.giorni[S.giorno] || { titolo: '', es: [] }, ult = D.misure.at(-1) || {};
  $('#app').innerHTML = `<div class="coach">
   <aside class="clist"><h2>Clienti</h2>${S.clienti.map(x => { const st = stato(x); return `<button class="citem" data-cl="${x.id}" aria-current="${x.id === c.id}"><b>${esc(x.nome)}</b><span>${esc(x.sport || '')}</span><span class="pill ${st[0]}">${st[1]}</span></button>`; }).join('')}</aside>
   <section class="cpanel">
    <div class="chead"><div><span>${esc(c.sport || 'Sport non indicato')}${b ? ' · ' + esc(b.titolo) : ''}</span><h2>${esc(c.nome)}</h2></div><button class="btn acc" id="preview">Vedi come lo vede ${nome1(c.nome)}</button></div>
    <div class="card"><h3>Dati cliente</h3><div class="form3">
      <label class="f">Nome e cognome<input type="text" id="p-nome" value="${esc(c.nome)}"></label>
      <label class="f">Sport / obiettivo<input type="text" id="p-sport" value="${esc(c.sport || '')}"></label>
      <button class="btn ghost" id="p-save" style="align-self:end">Salva</button></div></div>
    ${D.feedback.length ? `<div class="card"><h3>Feedback dagli allenamenti</h3>${D.feedback.slice(0, 5).map(f => `<div class="fb"><span class="meta">${fmtD(f.creato_at)} · Giorno ${esc(f.giorno || '-')} · RPE ${f.rpe ?? '-'}</span><span>${esc(f.testo) || '<i>Nessun commento</i>'}</span></div>`).join('')}</div>` : ''}
    <div class="card">
     ${b ? `<div class="row" style="justify-content:space-between"><h3>${esc(b.titolo)} · ${settimana(b)}</h3>
       <label class="btn ghost" style="cursor:pointer">${b.pdf_path ? 'Sostituisci PDF' : 'Carica PDF'}<input type="file" id="pdf" accept="application/pdf" hidden></label></div>
       ${D.pdfUrl ? `<div class="pdf"><span class="ic">PDF</span><a href="${esc(D.pdfUrl)}" target="_blank" rel="noopener">Scheda caricata</a></div>` : ''}
       <div class="days">${[...new Set([...Object.keys(D.giorni), 'A', 'B', 'C'])].sort().map(k => `<button data-day="${esc(k)}" aria-pressed="${k === S.giorno}">Giorno ${esc(k)}</button>`).join('')}</div>
       <label class="f">Titolo del giorno ${esc(S.giorno)}<input type="text" id="g-tit" value="${esc(G.titolo)}" placeholder="Es. Forza arti inferiori + salti"></label>
       <div class="tw"><table><thead><tr><th>Esercizio</th><th>Serie</th><th>Rip.</th><th>Carico</th><th>Rec.</th><th>Fatto</th><th></th></tr></thead>
       <tbody>${G.es.map(e => `<tr><td>${esc(e.nome)}</td><td class="num">${e.serie ?? ''}</td><td>${esc(e.ripetizioni)}</td><td>${esc(e.carico)}</td><td>${esc(e.recupero)}</td><td>${D.fatti.includes(e.id) ? '<span class="pill ok">Sì</span>' : '–'}</td><td><button class="del" data-delex="${e.id}" aria-label="Elimina ${esc(e.nome)}">×</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nessun esercizio per questo giorno.</td></tr>'}</tbody></table></div>
       <div class="form">
        <label class="f">Esercizio<input type="text" id="e-n" placeholder="Es. Hip thrust"></label>
        <label class="f">Serie<input type="number" id="e-s" value="3" min="1"></label>
        <label class="f">Rip.<input type="text" id="e-r" value="8"></label>
        <label class="f">Carico<input type="text" id="e-c" placeholder="60 kg"></label>
        <label class="f">Rec.<input type="text" id="e-rec" value="1'30&quot;"></label>
        <button class="btn" id="e-add">Aggiungi</button></div>
       <label class="f">Nota tecnica per il prossimo esercizio (facoltativa)<input type="text" id="e-t"></label>` : '<h3>Nessuna scheda attiva</h3>'}
     <details ${b ? '' : 'open'}><summary class="muted" style="cursor:pointer">${b ? 'Inizia un nuovo blocco (archivia quello attuale)' : 'Crea il primo blocco'}</summary>
      <div class="form3" style="margin-top:10px">
       <label class="f">Titolo<input type="text" id="b-tit" placeholder="Blocco 1 · Base"></label>
       <label class="f">Settimane<input type="number" id="b-sett" value="6" min="1"></label>
       <label class="f">Inizio<input type="date" id="b-ini" value="${oggi()}"></label></div>
      <button class="btn" id="b-add" style="margin-top:8px">Crea blocco</button></details>
    </div>
    <div class="grid2">
     <div class="card"><h3>Nuova misurazione</h3>
      <label class="f">Data<input type="date" id="m-d" value="${oggi()}"></label>
      <div class="form3" style="grid-template-columns:repeat(2,minmax(0,1fr))">
       <label class="f">Peso (kg)<input type="number" step="0.1" id="m-peso" value="${ult.peso ?? ''}"></label>
       <label class="f">Massa grassa (%)<input type="number" step="0.1" id="m-massa_grassa" value="${ult.massa_grassa ?? ''}"></label>
       <label class="f">Salto CMJ (cm)<input type="number" step="0.1" id="m-cmj" value="${ult.cmj ?? ''}"></label>
       <label class="f">Squat 1RM (kg)<input type="number" step="0.5" id="m-squat_1rm" value="${ult.squat_1rm ?? ''}"></label></div>
      <button class="btn" id="m-add" style="align-self:flex-start">Salva misurazione</button>
      <div class="chart">${chartSVG(D.misure, 'cmj')}</div></div>
     <div class="card"><h3>Note per ${nome1(c.nome)}</h3>
      <textarea id="n-t" placeholder="Indicazioni, cambi di programma, complimenti"></textarea>
      <button class="btn" id="n-add" style="align-self:flex-start">Pubblica nota</button>
      ${D.note.slice(0, 6).map(n => `<div class="note ${n.autore === 'cliente' ? 'me' : ''}"><span class="meta">${n.autore === 'coach' ? 'Tu' : nome1(c.nome)} · ${fmtD(n.creato_at)}</span><span>${esc(n.testo)}</span></div>`).join('')}
      <h3 style="margin-top:8px">Prossimo appuntamento</h3>
      ${D.prossimo ? `<p class="muted">${esc(D.prossimo.descrizione || '')} · ${fmtDT(D.prossimo.quando)}</p>` : ''}
      <div class="form3" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
       <label class="f">Quando<input type="datetime-local" id="a-q"></label>
       <label class="f">Cosa<input type="text" id="a-d" placeholder="Test di controllo · Arkè"></label></div>
      <button class="btn ghost" id="a-add" style="align-self:flex-start">Fissa appuntamento</button>
     </div>
    </div>
   </section></div>`;
}

/* ---------- render ---------- */
function render() {
  const coach = S.me.ruolo === 'coach';
  $('#seg').hidden = !coach;
  $('#v-cliente').setAttribute('aria-pressed', S.vista === 'cliente');
  $('#v-coach').setAttribute('aria-pressed', S.vista === 'coach');
  if (coach && S.vista === 'coach') vCoach();
  else if (S.D) vCliente();
  else $('#app').innerHTML = '<div class="center">Nessun cliente da mostrare.</div>';
}
async function ricarica() { await caricaCliente(coachOrMe()); render(); }
const coachOrMe = () => S.me.ruolo === 'coach' ? S.sel : S.me.id;

async function avvia() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return vLogin();
  const p = await sb.from('profili').select('*').eq('id', session.user.id).single();
  if (p.error || !p.data) { await sb.auth.signOut(); return vLogin('Account non ancora attivo. Scrivi a Matteo.'); }
  S.me = p.data;
  if (S.me.ruolo === 'coach') { S.vista = 'coach'; await caricaClienti(); if (S.sel) await caricaCliente(S.sel); else S.D = null; return render(); }
  if (!S.me.consenso_dati_salute_at) return vConsenso();
  S.vista = 'cliente'; await caricaCliente(S.me.id); render();
}

/* ---------- eventi ---------- */
$('#v-cliente').onclick = () => { S.vista = 'cliente'; S.tab = 'oggi'; render(); };
$('#v-coach').onclick = () => { S.vista = 'coach'; render(); };

document.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const cid = S.D?.profilo.id;
  try {
    if (t.id === 'logout') { await sb.auth.signOut(); S.me = null; S.D = null; return vLogin(); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; return render(); }
    if (t.dataset.go) { S.tab = t.dataset.go; return render(); }
    if (t.dataset.day) { S.giorno = t.dataset.day; return render(); }
    if (t.dataset.m) { S.metric = t.dataset.m; return render(); }
    if (t.dataset.rpe) { S.rpe = +t.dataset.rpe; return render(); }
    if (t.dataset.cl) { S.sel = t.dataset.cl; S.giorno = null; return ricarica(); }
    if (t.id === 'preview') { S.vista = 'cliente'; S.tab = 'oggi'; render(); return scrollTo(0, 0); }

    // cliente
    if (t.id === 'fb-go') {
      const testo = $('#fb-t').value.trim(); if (!testo && !S.rpe) return toast('Scegli la fatica o scrivi un commento');
      if (S.me.ruolo === 'coach') return toast('In anteprima non puoi inviare feedback');
      check(await sb.from('feedback').insert({ cliente_id: cid, blocco_id: S.D.blocco?.id, giorno: S.giorno, rpe: S.rpe, testo }));
      S.rpe = null; toast('Inviato a Matteo'); return ricarica();
    }
    if (t.id === 'cn-go') {
      const testo = $('#cn-t').value.trim(); if (!testo) return toast('Scrivi qualcosa prima di inviare');
      if (S.me.ruolo === 'coach') return toast('In anteprima scrivi dalla vista coach');
      check(await sb.from('note').insert({ cliente_id: cid, autore: 'cliente', testo })); toast('Messaggio inviato'); return ricarica();
    }

    // coach
    if (t.id === 'p-save') { check(await sb.from('profili').update({ nome: $('#p-nome').value.trim(), sport: $('#p-sport').value.trim() }).eq('id', cid)); await caricaClienti(); toast('Dati salvati'); return ricarica(); }
    if (t.id === 'n-add') {
      const testo = $('#n-t').value.trim(); if (!testo) return toast('Scrivi la nota prima di pubblicarla');
      check(await sb.from('note').insert({ cliente_id: cid, autore: 'coach', testo })); toast('Nota pubblicata'); return ricarica();
    }
    if (t.id === 'b-add') {
      const titolo = $('#b-tit').value.trim(); if (!titolo) return toast('Dai un titolo al blocco');
      if (S.D.blocco) check(await sb.from('blocchi').update({ attivo: false }).eq('id', S.D.blocco.id));
      check(await sb.from('blocchi').insert({ cliente_id: cid, titolo, settimane: +$('#b-sett').value || 6, inizio: $('#b-ini').value || oggi() }));
      S.giorno = 'A'; toast('Blocco creato'); return ricarica();
    }
    if (t.id === 'e-add') {
      const nome = $('#e-n').value.trim(); if (!nome) return toast('Scrivi il nome dell\'esercizio');
      const G = S.D.giorni[S.giorno];
      check(await sb.from('esercizi').insert({ blocco_id: S.D.blocco.id, giorno: S.giorno, titolo_giorno: $('#g-tit').value.trim() || null, ordine: G ? G.es.length : 0,
        nome, serie: +$('#e-s').value || null, ripetizioni: $('#e-r').value.trim(), carico: $('#e-c').value.trim(), recupero: $('#e-rec').value.trim(), note_tecniche: $('#e-t').value.trim() || null }));
      toast('Esercizio aggiunto al giorno ' + S.giorno); return ricarica();
    }
    if (t.dataset.delex) { check(await sb.from('esercizi').delete().eq('id', t.dataset.delex)); return ricarica(); }
    if (t.id === 'm-add') {
      const v = k => { const x = parseFloat($('#m-' + k).value); return isNaN(x) ? null : x; };
      check(await sb.from('misure').insert({ cliente_id: cid, data: $('#m-d').value || oggi(), peso: v('peso'), massa_grassa: v('massa_grassa'), cmj: v('cmj'), squat_1rm: v('squat_1rm') }));
      toast('Misurazione salvata'); return ricarica();
    }
    if (t.id === 'a-add') {
      const q = $('#a-q').value; if (!q) return toast('Scegli data e ora');
      check(await sb.from('appuntamenti').insert({ cliente_id: cid, quando: new Date(q).toISOString(), descrizione: $('#a-d').value.trim() }));
      toast('Appuntamento fissato'); return ricarica();
    }
  } catch (_) { /* messaggio già mostrato */ }
});

document.addEventListener('change', async e => {
  const t = e.target, cid = S.D?.profilo.id;
  try {
    if (t.dataset.ex) {
      if (S.me.ruolo === 'coach') { t.checked = !t.checked; return toast('In anteprima non puoi spuntare'); }
      if (t.checked) check(await sb.from('esercizi_fatti').upsert({ esercizio_id: t.dataset.ex, cliente_id: cid, data: oggi() }));
      else check(await sb.from('esercizi_fatti').delete().eq('esercizio_id', t.dataset.ex).eq('cliente_id', cid).gte('data', lunedi()));
      return ricarica();
    }
    if (t.id === 'pdf' && t.files[0]) {
      const path = `${cid}/${S.D.blocco.id}-${Date.now()}.pdf`;
      check(await sb.storage.from('schede').upload(path, t.files[0], { contentType: 'application/pdf' }), 'Caricamento del PDF non riuscito');
      check(await sb.from('blocchi').update({ pdf_path: path }).eq('id', S.D.blocco.id));
      toast('PDF caricato'); return ricarica();
    }
    if (t.id === 'g-tit' && S.D.blocco) {
      check(await sb.from('esercizi').update({ titolo_giorno: t.value.trim() || null }).eq('blocco_id', S.D.blocco.id).eq('giorno', S.giorno));
      toast('Titolo del giorno salvato'); return ricarica();
    }
  } catch (_) { }
});

let _av = null;
const start = () => _av ||= avvia().catch(console.error).finally(() => { _av = null; });
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' && !S.me) start(); });
start();
