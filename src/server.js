// Webhook-Server: nimmt Guest-Guide-Daten von Elev8 entgegen
// und stößt das Ausfüllen des Hochschwarzwald Quick Check-ins an.

const express = require("express");
const { mapGuestGuideToMeldeschein } = require("./mapping");
const { fillAndSubmit } = require("./fill-form");
const fs = require("fs");
const { getFormUrl, appendLog, getTenantName, isSubmitted, markSubmitted, screenshotPath, getResultCallbackUrl } = require("./store");
const { notifyError } = require("./notify");
const adminRouter = require("./admin");

const app = express();
app.use(express.json({ limit: "10mb" })); // Unterschrift-Bilder (Base64) brauchen Platz

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // in Railway als Variable setzen
const PORT = process.env.PORT || 3000;
// Wartezeiten zwischen internen Wiederholungsversuchen (Fehler bei Playwright/HTG-Seite)
const RETRY_DELAYS_MS = (process.env.RETRY_DELAYS_MS || "120000,600000,1800000").split(",").map(Number);

// Einfache In-Memory-Queue, damit Webhook sofort antwortet
// und Playwright im Hintergrund läuft (nacheinander, nicht parallel).
const queue = [];
let working = false;

async function processQueue() {
  if (working) return;
  working = true;
  while (queue.length > 0) {
    const job = queue.shift();
    const who = `${job.data.mainGuest.firstName} ${job.data.mainGuest.lastName}`;
    const baseName = `${String(job.reservationId).replace(/[^A-Za-z0-9._-]/g, "_")}-${Date.now()}${job.dryRun ? "-testlauf" : ""}`;
    const shotName = `${baseName}.png`;
    const errShotName = `${baseName}-fehler.png`;
    try {
      const result = await fillAndSubmit(job.data, {
        dryRun: job.dryRun,
        formUrl: job.formUrl,
        screenshotPath: screenshotPath(shotName),
        errorScreenshotPath: screenshotPath(errShotName),
      });
      if (!job.dryRun) markSubmitted(job.dedupeKey);
      console.log(`[OK] Meldeschein eingereicht für ${who} (Reservierung ${job.reservationId})`, result);
      // Ergebnis + Beleg-Screenshot zurück an Elev8 (falls Callback-URL hinterlegt)
      if (!job.dryRun) {
        sendResultCallback(job, shotName).catch((e) => console.error("[CALLBACK-FEHLER]", e.message));
      }
      appendLog({ status: "ok", dryRun: job.dryRun, reservationId: job.reservationId, tenant: job.tenantName, guest: who, screenshot: shotName, attempt: job.attempt + 1 });
    } catch (err) {
      job.attempt = (job.attempt || 0) + 1;
      if (job.attempt <= RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[job.attempt - 1];
        console.warn(`[RETRY] Reservierung ${job.reservationId}, Versuch ${job.attempt} fehlgeschlagen (${err.message}) – nächster Versuch in ${Math.round(delay / 60000)} min`);
        setTimeout(() => { queue.push(job); processQueue(); }, delay);
      } else {
        console.error(`[FEHLER] Reservierung ${job.reservationId} endgültig fehlgeschlagen:`, err.message);
        appendLog({ status: "error", dryRun: job.dryRun, reservationId: job.reservationId, tenant: job.tenantName, guest: who, error: err.message, attempt: job.attempt, screenshot: fs.existsSync(screenshotPath(errShotName)) ? errShotName : undefined });
        notifyError(`⚠️ Meldeschein FEHLGESCHLAGEN (nach ${job.attempt} Versuchen)\nGast: ${who}\nReservierung: ${job.reservationId}\nTenant: ${job.tenantName}\nFehler: ${err.message}\n→ Bitte manuell im Meldewesen nachtragen.`);
      }
    }
  }
  working = false;
}

async function sendResultCallback(job, shotName) {
  const url = getResultCallbackUrl();
  if (!url) return;
  let screenshotBase64 = null;
  try {
    screenshotBase64 = "data:image/png;base64," + fs.readFileSync(screenshotPath(shotName)).toString("base64");
  } catch (_) {}
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
    body: JSON.stringify({
      event: "meldeschein.submitted",
      reservationId: job.reservationId,
      tenantId: job.tenantId,
      status: "submitted",
      submittedAt: new Date().toISOString(),
      screenshot: screenshotBase64,
    }),
  });
  if (!r.ok) throw new Error(`Callback-Status ${r.status}`);
  console.log(`[CALLBACK] Ergebnis für ${job.reservationId} an Elev8 gesendet`);
}

app.post("/webhook/guest-guide-completed", (req, res) => {
  // Secret-Prüfung: Elev8-Webhook muss Header "x-webhook-secret" mitsenden
  if (!WEBHOOK_SECRET || req.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  let mapped, formUrl;
  try {
    mapped = mapGuestGuideToMeldeschein(req.body);
    formUrl = getFormUrl(req.body.tenantId);
  } catch (err) {
    console.error("[MAPPING-FEHLER]", err.message, JSON.stringify(req.body));
    return res.status(400).json({ error: "invalid payload", detail: err.message });
  }

  // Duplikat-Schutz: gleiche Reservierung + Revision nicht zweimal einreichen
  const dryRun = req.query.dryRun === "1";
  const dedupeKey = `${req.body.reservationId || "unbekannt"}:${req.body.revision || 1}`;
  if (!dryRun && isSubmitted(dedupeKey)) {
    console.log(`[DUPLIKAT] ${dedupeKey} bereits eingereicht – übersprungen`);
    return res.status(200).json({ status: "duplicate", detail: "already submitted" });
  }

  queue.push({
    data: mapped,
    formUrl,
    dedupeKey,
    attempt: 0,
    tenantId: req.body.tenantId,
    tenantName: getTenantName(req.body.tenantId),
    reservationId: req.body.reservationId || "unbekannt",
    dryRun,
  });
  processQueue();

  // Sofort antworten – das Ausfüllen läuft asynchron
  res.status(202).json({ status: "queued" });
});

app.use("/admin", adminRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Meldeschein-Service läuft auf Port ${PORT}`));
