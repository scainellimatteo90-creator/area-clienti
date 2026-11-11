-- Area Clienti Metodo Integrato: schema database (Supabase, regione UE - Francoforte)
-- Ogni cliente vede solo i propri dati; il coach vede e modifica tutto.

create table public.profili (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  sport text,
  ruolo text not null default 'cliente' check (ruolo in ('cliente','coach')),
  consenso_dati_salute_at timestamptz,          -- GDPR art. 9: consenso esplicito
  creato_at timestamptz not null default now()
);

create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profili where id = auth.uid() and ruolo = 'coach');
$$;

create table public.blocchi (                    -- un blocco di allenamento (es. "Blocco 2 · Forza e potenza")
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profili(id) on delete cascade,
  titolo text not null,
  settimane int not null default 6,
  inizio date not null default current_date,
  pdf_path text,                                 -- PDF scheda nello storage "schede"
  attivo boolean not null default true,
  creato_at timestamptz not null default now()
);

create table public.esercizi (
  id uuid primary key default gen_random_uuid(),
  blocco_id uuid not null references public.blocchi(id) on delete cascade,
  giorno text not null,                          -- 'A','B','C'...
  titolo_giorno text,
  ordine int not null default 0,
  nome text not null,
  serie int, ripetizioni text, carico text, recupero text, note_tecniche text
);

create table public.esercizi_fatti (
  esercizio_id uuid references public.esercizi(id) on delete cascade,
  cliente_id uuid references public.profili(id) on delete cascade,
  data date not null default current_date,
  primary key (esercizio_id, cliente_id, data)
);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profili(id) on delete cascade,
  blocco_id uuid references public.blocchi(id) on delete set null,
  giorno text, rpe int check (rpe between 1 and 10), testo text,
  creato_at timestamptz not null default now()
);

create table public.misure (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profili(id) on delete cascade,
  data date not null default current_date,
  peso numeric(5,1), massa_grassa numeric(4,1), cmj numeric(4,1), squat_1rm numeric(5,1),
  altre jsonb                                    -- misure extra senza cambiare lo schema
);

create table public.note (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profili(id) on delete cascade,
  autore text not null check (autore in ('coach','cliente')),
  testo text not null,
  creato_at timestamptz not null default now()
);

create table public.appuntamenti (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profili(id) on delete cascade,
  quando timestamptz not null, descrizione text
);

-- Sicurezza: Row Level Security su tutte le tabelle
alter table public.profili enable row level security;
alter table public.blocchi enable row level security;
alter table public.esercizi enable row level security;
alter table public.esercizi_fatti enable row level security;
alter table public.feedback enable row level security;
alter table public.misure enable row level security;
alter table public.note enable row level security;
alter table public.appuntamenti enable row level security;

create policy "profilo: se stesso o coach" on public.profili for select using (id = auth.uid() or is_coach());
create policy "profilo: coach gestisce" on public.profili for all using (is_coach()) with check (is_coach());
create policy "profilo: consenso" on public.profili for update using (id = auth.uid()) with check (id = auth.uid() and ruolo = 'cliente');

create policy "blocchi: lettura" on public.blocchi for select using (cliente_id = auth.uid() or is_coach());
create policy "blocchi: coach" on public.blocchi for all using (is_coach()) with check (is_coach());

create policy "esercizi: lettura" on public.esercizi for select using (
  is_coach() or exists (select 1 from blocchi b where b.id = blocco_id and b.cliente_id = auth.uid()));
create policy "esercizi: coach" on public.esercizi for all using (is_coach()) with check (is_coach());

create policy "fatti: cliente" on public.esercizi_fatti for all using (cliente_id = auth.uid() or is_coach()) with check (cliente_id = auth.uid());
create policy "feedback: lettura" on public.feedback for select using (cliente_id = auth.uid() or is_coach());
create policy "feedback: cliente scrive" on public.feedback for insert with check (cliente_id = auth.uid());

create policy "misure: lettura" on public.misure for select using (cliente_id = auth.uid() or is_coach());
create policy "misure: coach" on public.misure for all using (is_coach()) with check (is_coach());

create policy "note: lettura" on public.note for select using (cliente_id = auth.uid() or is_coach());
create policy "note: cliente scrive" on public.note for insert with check (cliente_id = auth.uid() and autore = 'cliente');
create policy "note: coach scrive" on public.note for all using (is_coach()) with check (is_coach());

create policy "appuntamenti: lettura" on public.appuntamenti for select using (cliente_id = auth.uid() or is_coach());
create policy "appuntamenti: coach" on public.appuntamenti for all using (is_coach()) with check (is_coach());

-- Storage privato per i PDF delle schede: cartella = id cliente
insert into storage.buckets (id, name, public) values ('schede','schede', false) on conflict do nothing;
create policy "schede: lettura" on storage.objects for select using (
  bucket_id = 'schede' and (is_coach() or (storage.foldername(name))[1] = auth.uid()::text));
create policy "schede: coach carica" on storage.objects for all using (bucket_id = 'schede' and is_coach()) with check (bucket_id = 'schede' and is_coach());

-- Quando inviti un cliente da Supabase (Authentication → Users → Invite), il profilo si crea da solo
create or replace function public.nuovo_utente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profili (id, nome) values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.nuovo_utente();
