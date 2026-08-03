// Admin-Bereich: /admin — geschützt per Login (Basic Auth).
// Benutzer: admin · Passwort: Railway-Variable ADMIN_PASSWORD
const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { getTenants, upsertTenant, deleteTenant, getLog, SCREENSHOT_DIR, getSettings, saveSettings, getNotifyUrl, verifyAdminPassword, setAdminPassword } = require("./store");

const router = express.Router();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

router.use((req, res, next) => {
  const header = req.get("authorization") || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString();
    const idx = decoded.indexOf(":");
    const user = decoded.slice(0, idx), pass = decoded.slice(idx + 1);
    if (safeEqual(user, "admin") && verifyAdminPassword(pass)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Meldeschein Admin", charset="UTF-8"');
  res.status(401).send("Authentication required.");
});

// Passwort ändern (aktuelles Passwort erforderlich)
router.post("/api/change-password", (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!verifyAdminPassword(String(currentPassword || ""))) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
    setAdminPassword(String(newPassword || ""));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/api/tenants", (_req, res) => res.json(getTenants()));

router.get("/api/log", (_req, res) => res.json(getLog()));

router.get("/api/settings", (_req, res) => {
  const st = getSettings();
  res.json({ notifyWebhookUrl: st.notifyWebhookUrl || "", resultCallbackUrl: st.resultCallbackUrl || "", envFallback: !!process.env.NOTIFY_WEBHOOK_URL });
});

router.post("/api/settings", (req, res) => {
  try {
    const { notifyWebhookUrl, resultCallbackUrl } = req.body || {};
    saveSettings({ notifyWebhookUrl: String(notifyWebhookUrl || "").trim(), resultCallbackUrl: String(resultCallbackUrl || "").trim() });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/api/settings/test-notify", async (_req, res) => {
  const url = getNotifyUrl();
  if (!url) return res.status(400).json({ error: "No webhook URL configured." });
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "✅ Test message from the registration service – notifications are working." }),
    });
    res.json({ ok: r.ok, status: r.status });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get("/screenshots/:file", (req, res) => {
  const file = req.params.file;
  if (!/^[A-Za-z0-9._-]+\.png$/.test(file)) return res.status(400).send("Invalid file name.");
  res.sendFile(path.join(SCREENSHOT_DIR, file), (err) => {
    if (err) res.status(404).send("Screenshot not found.");
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Registration Service · Properties</title>
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
  <h1>Registration Tenants</h1>
  <p class="sub">Each tenant with its quick check-in link. Incoming webhooks are routed by tenant ID.</p>
  <div id="list"></div>

  <h2 class="section-h">Recent activity</h2>
  <div id="log"></div>

  <form id="settingsForm">
    <h2>Error notification &amp; callback</h2>
    <label for="notifyUrl">Make webhook URL (called on failed registrations)</label>
    <input id="notifyUrl" placeholder="https://hook.eu1.make.com/...">
    <p class="hint">Called for every registration that has permanently failed (POST, JSON: { "text": "..." }). Also works with Slack or Discord webhooks. Leave empty to disable notifications.</p>
    <label for="callbackUrl">Elev8 callback URL (result + screenshot back to Elev8)</label>
    <input id="callbackUrl" placeholder="https://api.elev8-suite.com/...">
    <p class="hint">After every successfully submitted registration, the service sends a POST with reservationId, tenantId, status and the proof screenshot (base64 PNG) to this URL. Authenticated with the same x-webhook-secret. Leave empty to disable.</p>
    <p class="msg" id="settingsMsg"></p>
    <button class="primary" type="submit">Save</button>
    <button type="button" id="testNotify">Send test message</button>
  </form>

  <form id="pwForm">
    <h2>Change admin password</h2>
    <label for="pwCurrent">Current password</label>
    <input id="pwCurrent" type="password" required autocomplete="current-password">
    <label for="pwNew">New password (min. 12 characters)</label>
    <input id="pwNew" type="password" required minlength="12" autocomplete="new-password">
    <label for="pwNew2">Repeat new password</label>
    <input id="pwNew2" type="password" required autocomplete="new-password">
    <p class="hint">Emergency reset: delete settings.json on the Railway volume, then the Railway password applies again.</p>
    <p class="msg" id="pwMsg"></p>
    <button class="primary" type="submit">Change password</button>
  </form>

  <form id="form">
    <h2>Add or update tenant</h2>
    <label for="id">Tenant ID (from Elev8)</label>
    <input id="id" required placeholder="e.g. 07fb916d-f901-4aa0-9c6e-a11d8d38d155">
    <label for="name">Name</label>
    <input id="name" placeholder="e.g. SF Living">
    <label for="formUrl">Quick check-in link</label>
    <input id="formUrl" required placeholder="https://shop.hochschwarzwald.de/de/registration/guestcard/genericquickcheckin/?serviceProvider...">
    <p class="hint">Copy it from the property\u2019s Meldewesen account (\u201cLink erzeugen\u201d). It contains the registration number and partner key.</p>
    <p class="msg" id="msg"></p>
    <button class="primary" type="submit">Save</button>
  </form>
</div>
<script>
const msg = document.getElementById('msg');
function betriebsnummer(u){ try { return new URL(u).searchParams.get('serviceProvider[0]') } catch(e){ return null } }
function baseUrl(){ return location.href.endsWith('/') ? location.href : location.href + '/' }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }
async function loadTenants(){
  const t = await (await fetch(new URL('api/tenants', baseUrl()))).json();
  render(t);
}
function render(tenants){
  const list = document.getElementById('list');
  const ids = Object.keys(tenants);
  if(!ids.length){ list.innerHTML = '<div class="empty">No tenants yet. Add the first one below.</div>'; return }
  list.innerHTML = ids.map(id => {
    const t = tenants[id], bn = betriebsnummer(t.formUrl);
    return '<div class="tenant"><span class="dot"></span><div class="info">'
      + '<div class="name">' + esc(t.name) + '</div>'
      + '<div class="tid">' + esc(id) + '</div>'
      + (bn ? '<span class="betrieb">Reg. no. ' + esc(bn) + '</span>' : '')
      + '<div class="url">' + esc(t.formUrl) + '</div>'
      + '</div><button class="del" data-id="' + esc(id) + '">Delete</button></div>';
  }).join('');
  list.querySelectorAll('button.del').forEach(b => b.addEventListener('click', () => removeTenant(b.dataset.id)));
}
async function removeTenant(id){
  if(!confirm('Really delete tenant \u201c' + id + '\u201d?')) return;
  const t = await (await fetch(new URL('api/tenants/' + encodeURIComponent(id), baseUrl()), {method:'DELETE'})).json();
  render(t);
}
document.getElementById('form').addEventListener('submit', async e => {
  e.preventDefault();
  msg.textContent=''; msg.className='msg';
  const body = { id: document.getElementById('id').value.trim(), name: document.getElementById('name').value.trim(), formUrl: document.getElementById('formUrl').value.trim() };
  const r = await fetch(new URL('api/tenants', baseUrl()), {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const data = await r.json();
  if(!r.ok){ msg.textContent = data.error || 'Saving failed.'; msg.className='msg err'; return }
  msg.textContent = 'Saved.'; msg.className='msg ok';
  e.target.reset(); render(data);
});
async function loadLog(){
  const log = await (await fetch(new URL('api/log', baseUrl()))).json();
  const el = document.getElementById('log');
  if(!log.length){ el.innerHTML = '<div class="empty">No activity yet.</div>'; return }
  el.innerHTML = log.slice(0, 30).map(e => {
    const d = new Date(e.at);
    const when = d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
    return '<div class="logrow">'
      + '<span class="st ' + (e.status==='ok'?'ok':'error') + '">' + (e.status==='ok'?'OK':'Error') + '</span>'
      + '<span class="t">' + when + '</span>'
      + '<span class="detail">' + esc(e.guest || '') + ' · ' + esc(e.tenant || '') + ' · ' + esc(e.reservationId || '')
      + (e.dryRun ? ' <span class="badge-dry">Test run</span>' : '')
      + (e.screenshot ? ' · <a href="' + new URL('screenshots/' + encodeURIComponent(e.screenshot), baseUrl()).pathname + '" target="_blank">Screenshot</a>' : '')
      + (e.error ? '<br><span class="errtext">' + esc(e.error) + '</span>' : '')
      + '</span></div>';
  }).join('');
}
const settingsMsg = document.getElementById('settingsMsg');
async function loadSettings(){
  const s = await (await fetch(new URL('api/settings', baseUrl()))).json();
  document.getElementById('notifyUrl').value = s.notifyWebhookUrl || '';
  document.getElementById('callbackUrl').value = s.resultCallbackUrl || '';
  if(!s.notifyWebhookUrl && s.envFallback){ settingsMsg.textContent = 'Currently active: URL from Railway variable. A value saved here takes precedence.'; settingsMsg.className='msg'; }
}
document.getElementById('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  settingsMsg.textContent=''; settingsMsg.className='msg';
  const r = await fetch(new URL('api/settings', baseUrl()), {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ notifyWebhookUrl: document.getElementById('notifyUrl').value.trim(), resultCallbackUrl: document.getElementById('callbackUrl').value.trim() })});
  const data = await r.json();
  if(!r.ok){ settingsMsg.textContent = data.error || 'Saving failed.'; settingsMsg.className='msg err'; return }
  settingsMsg.textContent = 'Saved.'; settingsMsg.className='msg ok';
});
document.getElementById('testNotify').addEventListener('click', async () => {
  settingsMsg.textContent='Sending test message\u2026'; settingsMsg.className='msg';
  const r = await fetch(new URL('api/settings/test-notify', baseUrl()), {method:'POST'});
  const data = await r.json();
  if(!r.ok || !data.ok){ settingsMsg.textContent = 'Test failed: ' + (data.error || 'Status ' + data.status); settingsMsg.className='msg err'; return }
  settingsMsg.textContent = 'Test message sent (status ' + data.status + ') \u2013 check your Make scenario.'; settingsMsg.className='msg ok';
});
const pwMsg = document.getElementById('pwMsg');
document.getElementById('pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  pwMsg.textContent=''; pwMsg.className='msg';
  const cur = document.getElementById('pwCurrent').value;
  const n1 = document.getElementById('pwNew').value, n2 = document.getElementById('pwNew2').value;
  if(n1 !== n2){ pwMsg.textContent = 'The new passwords do not match.'; pwMsg.className='msg err'; return }
  const r = await fetch(new URL('api/change-password', baseUrl()), {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ currentPassword: cur, newPassword: n1 })});
  const data = await r.json();
  if(!r.ok){ pwMsg.textContent = data.error || 'Change failed.'; pwMsg.className='msg err'; return }
  pwMsg.textContent = 'Password changed. Sign in with the new password on the next page load.'; pwMsg.className='msg ok';
  e.target.reset();
});
loadTenants();
loadLog();
loadSettings();
</script>
</body>
</html>`);
});

module.exports = router;
