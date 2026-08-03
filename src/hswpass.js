// HSW Pass (Tramino) – zweiter Meldekanal.
// Direkter HTTP-Ablauf (kein Browser nötig), rekonstruiert aus dem echten
// Formular-Ablauf: Session initialisieren -> check -> create -> meldeschein-save.
// Der "check"-Schritt erstellt noch nichts und dient als Dry-Run.

const crypto = require("crypto");

const API_BASE = "https://hochschwarzwald.tramino.de";
const COMMON_HEADERS = {
  Origin: "https://www.hswpass.de",
  Referer: "https://www.hswpass.de/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

function newSessionId() {
  // Gleiches Format wie die Web-App: 19 alphanumerische Zeichen
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const bytes = crypto.randomBytes(19);
  for (let i = 0; i < 19; i++) s += chars[bytes[i] % chars.length];
  return s;
}

function extractSetPass(hswUrl) {
  const u = new URL(hswUrl);
  const token = u.searchParams.get("set_pass");
  if (!token) throw new Error("HSW Pass: set_pass token missing in the configured link");
  return token;
}

// "12.04.1985" für das visible-Feld
function toVisibleDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// "Hauptstr. 1" -> { strasse: "Hauptstr.", hausnr: "1" }
function splitStreet(street) {
  const m = String(street).trim().match(/^(.*?)[\s,]+(\d+\s*[a-zA-Z\-\/]*)$/);
  if (m) return { strasse: m[1].trim(), hausnr: m[2].trim() };
  return { strasse: String(street).trim(), hausnr: "" };
}

async function postSave(fields) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.append(k, v == null ? "" : String(v));
  const r = await fetch(`${API_BASE}/api/dashboard/save/`, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HSW Pass: HTTP ${r.status} on save (${fields.button_action})`);
  return text;
}

async function initSession(setPass) {
  const session = newSessionId();
  const url = `${API_BASE}/api/app/?dashboard=&set_pass=${encodeURIComponent(setPass)}&set_pass_done=1&session=${session}`;
  const r = await fetch(url, { headers: COMMON_HEADERS });
  const text = await r.text();
  if (!r.ok) throw new Error(`HSW Pass: HTTP ${r.status} on session init`);
  const dm = text.match(/data-load-dashboard=\\?"?(\d+)/);
  const bm = text.match(/data-gs-id=\\?"?(\d+)/);
  if (!dm || !bm) throw new Error("HSW Pass: dashboard/block id not found — page layout may have changed");
  return { session, dashboard: dm[1], block: bm[1] };
}

function personFields(p, i, { main = false, mainEmail = "" } = {}) {
  const f = {
    [`user_${i}`]: "",
    [`user_edit_${i}`]: "",
    [`vorname_${i}`]: p.firstName,
    [`nachname_${i}`]: p.lastName,
    [`geburt_${i}`]: p.birthDate,
    [`geburt_${i}_visible`]: toVisibleDate(p.birthDate),
    [`nationalitaet_${i}`]: p.nationality.toLowerCase(),
    [`reisepass_${i}`]: p.identificationNumber || "",
    [`email_${i}`]: main ? mainEmail : "",
  };
  if (main) {
    const { strasse, hausnr } = splitStreet(p.address.street);
    f[`strasse_${i}`] = strasse;
    f[`hausnr_${i}`] = hausnr;
    f[`plz_${i}`] = p.address.zipCode;
    f[`ort_${i}`] = p.address.town;
    f[`land_${i}`] = p.address.country.toLowerCase();
  }
  return f;
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function submitHswPass(data, { hswUrl, dryRun = false, signatureImage } = {}) {
  if (!hswUrl) throw new Error("HSW Pass: no link configured for this tenant");
  if (!dryRun && !signatureImage) {
    throw new Error("HSW Pass: guest signature (signatureImage) is missing in the webhook payload");
  }

  const setPass = extractSetPass(hswUrl);
  const { session, dashboard, block } = await initSession(setPass);
  const common = { appsession: session, dashboard, block };

  const m = data.mainGuest;
  const personen = 1 + data.companions.length;
  const basics = {
    von: data.stay.fromDate,
    bis: data.stay.toDate,
    personen,
    vorname_1: m.firstName,
    nachname_1: m.lastName,
    geburt_1: m.birthDate,
    geburt_1_visible: toVisibleDate(m.birthDate),
    nation_1: m.nationality.toLowerCase(),
    email_1: m.email,
    lat: "",
    lng: "",
  };

  // 1) check – prüft die Angaben, erstellt noch nichts
  const checkResp = await postSave({ ...common, button_action: "check", ...basics });
  if (!/wrap_headline/.test(checkResp)) {
    throw new Error("HSW Pass: check step returned an unexpected response");
  }
  const checkError = checkResp.match(/class=\\?"notification[^>]*>\\?n?([^<]{5,200})</);
  if (/alert|error/i.test(checkResp.slice(0, 2000)) && checkError) {
    throw new Error(`HSW Pass check rejected: ${checkError[1].trim()}`);
  }

  if (dryRun) {
    return { submitted: false, dryRun: true, detail: "HSW Pass check passed (nothing created)" };
  }

  // 2) create – erstellt den Self-Checkin (Zeitraum/Personenzahl danach fix!)
  const createResp = await postSave({
    ...common,
    button_action: "create",
    ...basics,
    personen_1: personen,
    nation_1_1: m.nationality.toLowerCase(),
  });
  const nrMatch = createResp.match(/Self-Checkin Nr\.?\s*(\d+)/i);
  if (!nrMatch) {
    throw new Error("HSW Pass: Self-Checkin was not created (no number in response)");
  }
  const checkinNr = nrMatch[1];

  // 3) meldeschein-save – alle Details + Datenschutz + Unterschrift
  const detailFields = { ...common, button_action: "meldeschein-save" };
  Object.assign(detailFields, personFields(m, 1, { main: true, mainEmail: m.email }));
  data.companions.forEach((c, idx) => {
    Object.assign(detailFields, personFields(c, idx + 2));
  });
  detailFields.datenschutz = 3;
  detailFields.data_loaded = nowStamp();
  detailFields.signature = signatureImage;
  detailFields.lat = "";
  detailFields.lng = "";

  const finalResp = await postSave(detailFields);
  if (!finalResp.includes("loadDashboard")) {
    throw new Error(`HSW Pass: final save for Self-Checkin ${checkinNr} was not confirmed`);
  }
  return { submitted: true, checkinNr };
}

module.exports = { submitHswPass };
