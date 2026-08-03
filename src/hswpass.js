// HSW Pass (Tramino) – zweiter Meldekanal.
// Direkter HTTP-Ablauf (kein Browser nötig), rekonstruiert aus dem echten
// Formular-Ablauf: Session initialisieren -> check -> create -> meldeschein-save.
// Der "check"-Schritt erstellt noch nichts und dient als Dry-Run.

const crypto = require("crypto");

const API_BASE = "https://hochschwarzwald.tramino.de";
// Geräte-UUID: Tramino verlangt eine Geräte-Kennung ("keine Geräte-UUID"-Fehler sonst).
// Die Web-App sendet den Header x-tramino-app; der Server erlaubt zusätzlich x-tramino-uuid.
// Eine stabile UUID pro Service-Instanz verhält sich wie ein wiederkehrendes Gerät.
const DEVICE_UUID = crypto.randomUUID();

const COMMON_HEADERS = {
  Origin: "https://www.hswpass.de",
  Referer: "https://www.hswpass.de/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "x-tramino-app": "Capacitor",
  "x-tramino-uuid": DEVICE_UUID,
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
  // Der echte Browser sendet multipart/form-data – FormData übernimmt Boundary & Header
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v == null ? "" : String(v));
  const r = await fetch(`${API_BASE}/api/dashboard/save/`, {
    method: "POST",
    headers: COMMON_HEADERS,
    body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HSW Pass: HTTP ${r.status} on save (${fields.button_action})`);
  // Antwort ist JSON { content: "<html...>" }
  try {
    const j = JSON.parse(text);
    if (typeof j.content === "string") return j.content;
    return JSON.stringify(j.content || j);
  } catch (_) {
    return text;
  }
}

async function fetchApp(query) {
  const r = await fetch(`${API_BASE}/api/app/${query}`, { headers: COMMON_HEADERS });
  const text = await r.text();
  if (!r.ok) throw new Error(`HSW Pass: HTTP ${r.status} on session init`);
  let j = {};
  try { j = JSON.parse(text); } catch (_) {}
  const html = typeof j.content === "string" ? j.content : text;
  return { j, html, text };
}

function extractIds(j, html) {
  const dashboard =
    j.start_dashboard_id ||
    (html.match(/data-dashboard=\\?"?(\d+)/) || [])[1] ||
    (html.match(/data-load-dashboard=\\?"?(\d+)/) || [])[1] ||
    (html.match(/app_reload=(\d+)/) || [])[1];
  const block =
    (html.match(/data-gs-id=\\?"?(\d+)/) || [])[1] ||
    (html.match(/grid-stack-item-(\d+)/) || [])[1] ||
    (html.match(/elements_(\d+)/) || [])[1];
  return { dashboard, block };
}

async function initSession(setPass) {
  // Wie die Web-App: erster Aufruf etabliert Session + set_pass,
  // zweiter Aufruf (set_pass_done=1) lädt das eigentliche Dashboard.
  const clientSession = newSessionId();
  const tok = encodeURIComponent(setPass);

  const r1 = await fetchApp(`?dashboard=&set_pass=${tok}&session=${clientSession}&app_version=browser`);
  let session = r1.j.session || clientSession;
  let ids = extractIds(r1.j, r1.html);

  if (!ids.dashboard || !ids.block) {
    const r2 = await fetchApp(`?dashboard=&set_pass=${tok}&set_pass_done=1&session=${session}&app_version=browser`);
    session = r2.j.session || session;
    const ids2 = extractIds(r2.j, r2.html);
    ids = { dashboard: ids.dashboard || ids2.dashboard, block: ids.block || ids2.block };
    if (!ids.dashboard || !ids.block) {
      const snippet = (r2.text || "").replace(/\s+/g, " ").slice(0, 300);
      throw new Error(`HSW Pass: dashboard/block id not found (dashboard=${ids.dashboard || "-"}, block=${ids.block || "-"}). Response starts: ${snippet}`);
    }
  }
  console.log(`[HSW] Session ok (dashboard=${ids.dashboard}, block=${ids.block})`);
  return { session, dashboard: String(ids.dashboard), block: String(ids.block) };
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

// Tramino läuft auf deutscher Zeit – Container-UTC wäre 2h in der Vergangenheit
// und löst den Konflikt-Schutz aus ("zwischenzeitlich gespeichert").
function nowStampBerlin() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).replace("T", " ").slice(0, 19);
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
  const checkText = checkResp.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (!/check|prüf/i.test(checkText)) {
    throw new Error(`HSW Pass: check step returned an unexpected response: ${checkText.slice(0, 200)}`);
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

  // Der Server bettet seinen eigenen Zeitstempel als data_loaded ins Formular ein –
  // genau dieser Wert muss beim Speichern zurückgesendet werden (Konflikt-Schutz).
  const dlMatch = createResp.match(/name=\\?"?data_loaded\\?"?[^>]*value=\\?"?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  const dataLoaded = dlMatch ? dlMatch[1] : nowStampBerlin();
  console.log(`[HSW] Self-Checkin ${checkinNr} angelegt (data_loaded=${dataLoaded}${dlMatch ? "" : " – Fallback Berlin-Zeit"})`);

  // 3) meldeschein-save – ALLES in einem einzigen Speichervorgang
  // (Personendaten + Datenschutz + Unterschrift). Zwei getrennte Saves in
  // derselben Sekunde lösen Traminos Konflikt-Schutz aus ("zwischenzeitlich
  // gespeichert" / "Bitte ergänze die fehlenden Angaben") und verwerfen Daten.
  // Kurze Pause nach dem Anlegen, damit data_loaded sicher NACH dem create liegt.
  await new Promise((r) => setTimeout(r, 1500));
  const finalFields = { ...common, button_action: "meldeschein-save" };
  Object.assign(finalFields, personFields(m, 1, { main: true, mainEmail: m.email }));
  data.companions.forEach((c, idx) => {
    Object.assign(finalFields, personFields(c, idx + 2));
  });
  finalFields.datenschutz = 3;
  finalFields.data_loaded = dataLoaded;
  finalFields.signature = signatureImage;
  finalFields.lat = "";
  finalFields.lng = "";
  const finalResp = await postSave(finalFields);
  const finalText = finalResp
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ");
  // Erfolg: entweder Dashboard-Reload (wie im Browser-Mitschnitt) oder die
  // neu gerenderte Meldeschein-Seite mit Speicher-Bestätigung ("... gespeichert").
  const saved = finalResp.includes("loadDashboard") || (/gespeichert/i.test(finalText) && !/nicht gespeichert/i.test(finalText));
  const problem = /Es ist ein Problem|ergänze die fehlenden/i.test(finalText);
  if (!saved || problem) {
    throw new Error(`HSW Pass: final save for Self-Checkin ${checkinNr} was not confirmed. Response: ${finalText.slice(0, 300)}`);
  }
  return { submitted: true, checkinNr };
}

module.exports = { submitHswPass };
