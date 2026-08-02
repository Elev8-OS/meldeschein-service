// Persistente Tenant-Konfiguration als JSON-Datei.
// Auf Railway: Volume auf /data mounten (DATA_DIR=/data), sonst ./data lokal.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "tenants.json");

const SEED = {
  "2cb840b1-cb15-4648-a175-e0c8b96bc53a": {
    name: "BlackHome",
    formUrl:
      "https://shop.hochschwarzwald.de/de/registration/guestcard/genericquickcheckin/?serviceProvider%5B0%5D=0511301139&partner=1e03b1b4-58db-11f1-a427-cac49ee4ac52",
  },
};

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (_) {
    save(SEED);
    return { ...SEED };
  }
}

function save(tenants) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(tenants, null, 2));
}

function getTenants() { return load(); }

function upsertTenant(id, { name, formUrl }) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Ungültige Tenant-ID (nur Buchstaben, Zahlen, - und _).");
  let url;
  try { url = new URL(formUrl); } catch (_) { throw new Error("Ungültiger Link."); }
  if (url.hostname !== "shop.hochschwarzwald.de") throw new Error("Der Link muss auf shop.hochschwarzwald.de zeigen.");
  const tenants = load();
  tenants[id] = { name: String(name || id).slice(0, 120), formUrl };
  save(tenants);
  return tenants;
}

function deleteTenant(id) {
  const tenants = load();
  delete tenants[id];
  save(tenants);
  return tenants;
}

function getFormUrl(tenantId) {
  const t = load()[tenantId];
  if (!t) throw new Error(`Kein Tenant für tenantId "${tenantId}" konfiguriert (im Admin-Bereich anlegen)`);
  return t.formUrl;
}

// ---- Aktivitätsprotokoll (letzte 100 Vorgänge) ----
const LOGFILE = path.join(DATA_DIR, "log.json");

function getLog() {
  try { return JSON.parse(fs.readFileSync(LOGFILE, "utf8")); } catch (_) { return []; }
}

function appendLog(entry) {
  const log = getLog();
  log.unshift({ at: new Date().toISOString(), ...entry });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOGFILE, JSON.stringify(log.slice(0, 100), null, 2));
}

function getTenantName(tenantId) {
  const t = load()[tenantId];
  return t ? t.name : tenantId;
}

// ---- Duplikat-Schutz: bereits eingereichte Meldescheine ----
const SUBMITTEDFILE = path.join(DATA_DIR, "submitted.json");

function isSubmitted(key) {
  try { return JSON.parse(fs.readFileSync(SUBMITTEDFILE, "utf8")).includes(key); } catch (_) { return false; }
}

function markSubmitted(key) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(SUBMITTEDFILE, "utf8")); } catch (_) {}
  if (!list.includes(key)) list.push(key);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SUBMITTEDFILE, JSON.stringify(list.slice(-5000), null, 2));
}

// ---- Screenshot-Archiv ----
const SCREENSHOT_DIR = path.join(DATA_DIR, "screenshots");

function screenshotPath(name) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return path.join(SCREENSHOT_DIR, name);
}

// ---- Einstellungen (z.B. Benachrichtigungs-Webhook) ----
const SETTINGSFILE = path.join(DATA_DIR, "settings.json");

function getSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGSFILE, "utf8")); } catch (_) { return {}; }
}

function saveSettings(patch) {
  const cur = getSettings();
  const next = { ...cur, ...patch };
  if (next.notifyWebhookUrl) {
    let u;
    try { u = new URL(next.notifyWebhookUrl); } catch (_) { throw new Error("Ungültige Webhook-URL."); }
    if (u.protocol !== "https:") throw new Error("Die Webhook-URL muss mit https:// beginnen.");
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGSFILE, JSON.stringify(next, null, 2));
  return next;
}

function getNotifyUrl() {
  return getSettings().notifyWebhookUrl || process.env.NOTIFY_WEBHOOK_URL || "";
}

module.exports = { getTenants, upsertTenant, deleteTenant, getFormUrl, getLog, appendLog, getTenantName, isSubmitted, markSubmitted, screenshotPath, SCREENSHOT_DIR, getSettings, saveSettings, getNotifyUrl };
