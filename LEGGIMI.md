# Area Clienti Metodo Integrato

App installabile sul telefono (PWA): il cliente entra con un link via email e vede scheda, progressi e note.
Il coach (Matteo) gestisce clienti, schede, PDF, misure, note e appuntamenti.

## Cartelle
- `supabase/schema.sql` — database, regole di sicurezza (ogni cliente vede solo i suoi dati), archivio PDF.
- `app/` — l'app vera e propria (HTML, CSS, JavaScript, nessuna compilazione).

## Messa online (una volta sola)
1. **Supabase**: crea il progetto in regione *Central EU (Frankfurt)*.
2. SQL Editor → incolla tutto `supabase/schema.sql` → Run.
3. Authentication → URL Configuration: in *Site URL* metti l'indirizzo dell'app (es. `https://area.matteoscainelli.it`).
4. Authentication → Users → *Invite user* con la tua email. Apri il link che ti arriva, poi nello SQL Editor:
   `update profili set ruolo = 'coach' where id = (select id from auth.users where email = 'TUA-EMAIL');`
5. In `app/config.js` inserisci *Project URL* e *anon key* (Settings → API).
6. Pubblica la cartella `app/` su Netlify o Vercel (gratis) e collega il sottodominio `area.matteoscainelli.it`.
7. Sul sito WordPress aggiungi al menu il link "Area clienti".

## Aggiungere un cliente
Supabase → Authentication → Users → *Invite user* con la sua email. Al primo accesso il cliente dà il consenso
al trattamento dei dati sulla salute (GDPR art. 9); poi tu completi nome e sport dalla vista coach.

## Da sapere
- Le note cliniche dell'osteopatia restano fuori dall'app.
- Serve un'informativa privacy specifica per l'area clienti (da aggiungere al sito).
