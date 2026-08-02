// Admin-Bereich: /admin — geschützt per Login (Basic Auth).
// Benutzer: admin · Passwort: Railway-Variable ADMIN_PASSWORD
const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { getTenants, upsertTenant, deleteTenant, getLog, SCREENSHOT_DIR } = require("./store");

const router = express.Router();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

router.use((req, res, next) => {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return res.status(503).send("ADMIN_PASSWORD ist nicht gesetzt (Railway-Variable).");
  const header = req.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
    if (safeEqual(user, "admin") && safeEqual(pass, pw)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Meldeschein Admin", charset="UTF-8"');
  res.status(401).send("Anmeldung erforderlich.");
});

router.get("/api/tenants", (_req, res) => res.json(getTenants()));

router.get("/api/log", (_req, res) => res.json(getLog()));

router.get("/screenshots/:file", (req, res) => {
  const file = req.params.file;
  if (!/^[A-Za-z0-9._-]+\.png$/.test(file)) return res.status(400).send("Ungültiger Dateiname.");
  res.sendFile(path.join(SCREENSHOT_DIR, file), (err) => {
    if (err) res.status(404).send("Screenshot nicht gefunden.");
  });
});

router.post("/api/tenants", (req, res) => {
  try {
    const { id, name, formUrl } = req.body || {};
    res.json(upsertTenant(id, { name, formUrl }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/tenants/:id", (req, res) => res.json(deleteTenant(req.params.id)));

router.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meldeschein · Betriebe</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Fraunces:opsz,wght@9..144,600&display=swap" rel="stylesheet">
<style>
  :root{--ink:#1c1a15;--muted:#7a7466;--line:#e8e4da;--paper:#faf9f6;--card:#ffffff;--accent:#EFB100;--accent-ink:#5c4700;--danger:#b3261e}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 Inter,system-ui,sans-serif}
  .wrap{max-width:720px;margin:0 auto;padding:48px 20px 80px}
  h1{font-family:Fraunces,serif;font-size:30px;font-weight:600;margin:0}
  .sub{color:var(--muted);margin:6px 0 36px}
  .tenant{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:12px;display:flex;gap:16px;align-items:flex-start}
  .tenant .dot{width:10px;height:10px;border-radius:50%;background:var(--accent);margin-top:7px;flex:none}
  .tenant .info{min-width:0;flex:1}
  .tenant .name{font-weight:600}
  .tenant .tid{color:var(--muted);font-size:13px}
  .tenant .url{font-size:12px;color:var(--muted);word-break:break-all;margin-top:6px}
  .tenant .betrieb{display:inline-block;background:#fdf3d3;color:var(--accent-ink);border-radius:6px;padding:1px 8px;font-size:12px;font-weight:500;margin-top:6px}
  button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:#fff;padding:8px 14px}
  button.primary{background:var(--accent);border-color:var(--accent);color:var(--ink);font-weight:600}
  button.del{color:var(--danger);border:none;background:none;padding:4px;font-size:13px}
  form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:32px}
  form h2{font-size:16px;margin:0 0 14px}
  label{display:block;font-size:13px;color:var(--muted);margin:12px 0 4px}
  input{width:100%;font:inherit;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper)}
  input:focus{outline:2px solid var(--accent);outline-offset:0;border-color:var(--accent)}
  .hint{font-size:12px;color:var(--muted);margin-top:4px}
  .msg{margin-top:12px;font-size:13px}
  .msg.err{color:var(--danger)} .msg.ok{color:#1a7a3a}
  .empty{color:var(--muted);border:1px dashed var(--line);border-radius:12px;padding:24px;text-align:center}
  .section-h{font-size:16px;margin:36px 0 12px}
  .logrow{display:flex;gap:10px;align-items:baseline;padding:9px 4px;border-bottom:1px solid var(--line);font-size:13px}
  .logrow .st{flex:none;font-weight:600}
  .logrow .st.ok{color:#1a7a3a} .logrow .st.error{color:var(--danger)}
  .logrow .t{color:var(--muted);flex:none;white-space:nowrap}
  .logrow .detail{min-width:0}
  .logrow .errtext{color:var(--danger)}
  .badge-dry{background:#eee;border-radius:5px;padding:0 6px;font-size:11px;color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <h1>Meldeschein-Betriebe</h1>
  <p class="sub">Jeder Tenant mit seinem Quick-Check-in-Link. Der Webhook wird anhand der Tenant-ID zugeordnet.</p>
  <div id="list"></div>

  <h2 class="section-h">Letzte Vorgänge</h2>
  <div id="log"></div>

  <form id="form">
    <h2>Tenant anlegen oder ändern</h2>
    <label for="id">Tenant-ID (aus Elev8)</label>
    <input id="id" required placeholder="z.B. 07fb916d-f901-4aa0-9c6e-a11d8d38d155">
    <label for="name">Name</label>
    <input id="name" placeholder="z.B. SF Living">
    <label for="formUrl">Quick-Check-in-Link</label>
    <input id="formUrl" required placeholder="https://shop.hochschwarzwald.de/de/registration/guestcard/genericquickcheckin/?serviceProvider...">
    <p class="hint">Im Meldewesen der Unterkunft unter „Link erzeugen“ kopieren. Enthält Betriebsnummer und Partner-Kennung.</p>
    <p class="msg" id="msg"></p>
    <button class="primary" type="submit">Speichern</button>
  </form>
</div>
<script>
const msg = document.getElementById('msg');
function betriebsnummer(u){ try { return new URL(u).searchParams.get('serviceProvider[0]') } catch(e){ return null } }
function baseUrl(){ return location.href.endsWith('/') ? location.href.split('?')[0] : location.href.split('?')[0] + '/' }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }
async function loadTenants(){
  const t = await (await fetch(new URL('api/tenants', baseUrl()))).json();
  render(t);
}
function render(tenants){
  const list = document.getElementById('list');
  const ids = Object.keys(tenants);
  if(!ids.length){ list.innerHTML = '<div class="empty">Noch keine Tenants angelegt. Unten den ersten hinzufügen.</div>'; return }
  list.innerHTML = ids.map(id => {
    const t = tenants[id], bn = betriebsnummer(t.formUrl);
    return '<div class="tenant"><span class="dot"></span><div class="info">'
      + '<div class="name">' + esc(t.name) + '</div>'
      + '<div class="tid">' + esc(id) + '</div>'
      + (bn ? '<span class="betrieb">Betriebsnr. ' + esc(bn) + '</span>' : '')
      + '<div class="url">' + esc(t.formUrl) + '</div>'
      + '</div><button class="del" data-id="' + esc(id) + '">Löschen</button></div>';
  }).join('');
  list.querySelectorAll('button.del').forEach(b => b.addEventListener('click', () => removeTenant(b.dataset.id)));
}
async function removeTenant(id){
  if(!confirm('Tenant „' + id + '“ wirklich löschen?')) return;
  const t = await (await fetch(new URL('api/tenants/' + encodeURIComponent(id), baseUrl()), {method:'DELETE'})).json();
  render(t);
}
document.getElementById('form').addEventListener('submit', async e => {
  e.preventDefault();
  msg.textContent=''; msg.className='msg';
  const body = { id: document.getElementById('id').value.trim(), name: document.getElementById('name').value.trim(), formUrl: document.getElementById('formUrl').value.trim() };
  const r = await fetch(new URL('api/tenants', baseUrl()), {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const data = await r.json();
  if(!r.ok){ msg.textContent = data.error || 'Speichern fehlgeschlagen.'; msg.className='msg err'; return }
  msg.textContent = 'Gespeichert.'; msg.className='msg ok';
  e.target.reset(); render(data);
});
async function loadLog(){
  const log = await (await fetch(new URL('api/log', baseUrl()))).json();
  const el = document.getElementById('log');
  if(!log.length){ el.innerHTML = '<div class="empty">Noch keine Vorgänge.</div>'; return }
  el.innerHTML = log.slice(0, 30).map(e => {
    const d = new Date(e.at);
    const when = d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit'});
    return '<div class="logrow">'
      + '<span class="st ' + (e.status==='ok'?'ok':'error') + '">' + (e.status==='ok'?'OK':'Fehler') + '</span>'
      + '<span class="t">' + when + '</span>'
      + '<span class="detail">' + esc(e.guest || '') + ' · ' + esc(e.tenant || '') + ' · ' + esc(e.reservationId || '')
      + (e.dryRun ? ' <span class="badge-dry">Testlauf</span>' : '')
      + (e.screenshot ? ' · <a href="' + new URL('screenshots/' + encodeURIComponent(e.screenshot), baseUrl()).pathname + '" target="_blank">Screenshot</a>' : '')
      + (e.error ? '<br><span class="errtext">' + esc(e.error) + '</span>' : '')
      + '</span></div>';
  }).join('');
}
loadTenants();
loadLog();
</script>
</body>
</html>`);
});

module.exports = router;
