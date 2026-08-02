// Persistente Tenant-Konfiguration als JSON-Datei.
// Auf Railway: Volume auf /data mounten (DATA_DIR=/data), sonst ./data lokal.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "tenants.json");

const SEED = {
  "TEN-BLACKHOME": {
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

module.exports = { getTenants, upsertTenant, deleteTenant, getFormUrl };
