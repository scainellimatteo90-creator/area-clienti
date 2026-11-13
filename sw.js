// Rende l'app installabile e apribile anche con rete scarsa. Prima prova la rete (dati e codice sempre aggiornati), poi la copia salvata.
// Notifiche: il promemoria del venerdì per il check-in arriva qui e, toccandolo, apre l'app.
const C='mi-v2';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r}).catch(()=>caches.match(e.request)));});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.title||'Metodo Integrato',{body:d.body||'',icon:'icon.svg',tag:d.tag||'mi',data:{url:d.url||'./'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if(c.url.startsWith(self.registration.scope)&&'focus' in c){return c.focus().then(w=>w&&w.navigate?w.navigate(u):w);}}return self.clients.openWindow(u);}));});
