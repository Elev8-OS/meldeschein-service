// Webhook-Server: nimmt Guest-Guide-Daten von Elev8 entgegen
// und stößt das Ausfüllen des Hochschwarzwald Quick Check-ins an.

const express = require("express");
const { mapGuestGuideToMeldeschein } = require("./mapping");
const { fillAndSubmit } = require("./fill-form");
const fs = require("fs");
const { getTenant, appendLog, getTenantName, isSubmitted, markSubmitted, screenshotPath, getResultCallbackUrl } = require("./store");
const { submitHswPass } = require("./hswpass");
const { renderHswReceipt } = require("./receipt");
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
    const baseName = `${String(job.reservationId).replace(/[^A-Za-z0-9._-]/g, "_")}-${job.channel}-${Date.now()}${job.dryRun ? "-testlauf" : ""}`;
    const shotName = `${baseName}.png`;
    const errShotName = `${baseName}-fehler.png`;
    try {
      let result;
      if (job.channel === "hsw") {
        result = await submitHswPass(job.data, {
          hswUrl: job.hswUrl,
          dryRun: job.dryRun,
          signatureImage: job.data.signatureImage,
        });
      } else {
        result = await fillAndSubmit(job.data, {
          dryRun: job.dryRun,
          formUrl: job.formUrl,
          screenshotPath: screenshotPath(shotName),
          errorScreenshotPath: screenshotPath(errShotName),
        });
      }
      if (!job.dryRun) markSubmitted(job.dedupeKey);
      // HSW: Beleg-PNG mit Self-Checkin-Nr., Gästedaten und Unterschrift rendern
      if (!job.dryRun && job.channel === "hsw" && result.checkinNr) {
        try {
          await renderHswReceipt(job.data, {
            checkinNr: result.checkinNr,
            tenantName: job.tenantName,
            signatureImage: job.data.signatureImage,
            outPath: screenshotPath(shotName),
          });
          console.log(`[HSW-BELEG] PNG erstellt: ${shotName}`);
        } catch (e) {
          console.warn("[HSW-BELEG] Rendering fehlgeschlagen (Einreichung bleibt gültig):", e.message);
        }
      }
      console.log(`[OK] [${job.channel}] Meldeschein eingereicht für ${who} (Reservierung ${job.reservationId})`, result);
      // Ergebnis zurück an Elev8 (falls Callback-URL hinterlegt):
      // beide Kanäle mit Beleg-PNG, HSW zusätzlich mit Self-Checkin-Nummer
      if (!job.dryRun) {
        sendResultCallback(job, { shotName, checkinNr: result.checkinNr }).catch((e) => console.error("[CALLBACK-FEHLER]", e.message));
      }
      appendLog({ status: "ok", channel: job.channel, dryRun: job.dryRun, reservationId: job.reservationId, tenant: job.tenantName, guest: who, screenshot: fs.existsSync(screenshotPath(shotName)) ? shotName : undefined, checkinNr: result.checkinNr, attempt: job.attempt + 1 });
    } catch (err) {
      job.attempt = (job.attempt || 0) + 1;
      if (job.attempt <= RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[job.attempt - 1];
        console.warn(`[RETRY] Reservierung ${job.reservationId}, Versuch ${job.attempt} fehlgeschlagen (${err.message}) – nächster Versuch in ${Math.round(delay / 60000)} min`);
        setTimeout(() => { queue.push(job); processQueue(); }, delay);
      } else {
        console.error(`[FEHLER] [${job.channel}] Reservierung ${job.reservationId} endgültig fehlgeschlagen:`, err.message);
        appendLog({ status: "error", channel: job.channel, dryRun: job.dryRun, reservationId: job.reservationId, tenant: job.tenantName, guest: who, error: err.message, attempt: job.attempt, screenshot: fs.existsSync(screenshotPath(errShotName)) ? errShotName : undefined });
        notifyError(`⚠️ ${job.channel === "hsw" ? "HSW Pass" : "HTG Meldeschein"} FAILED (after ${job.attempt} attempts)\nGuest: ${who}\nReservation: ${job.reservationId}\nTenant: ${job.tenantName}\nError: ${err.message}\n→ Please submit manually.`);
      }
    }
  }
  working = false;
}

async function sendResultCallback(job, { shotName, checkinNr } = {}) {
  const url = getResultCallbackUrl();
  if (!url) return;
  const payload = {
    event: "meldeschein.submitted",
    channel: job.channel, // "htg" | "hsw"
    reservationId: job.reservationId,
    tenantId: job.tenantId,
    status: "submitted",
    submittedAt: new Date().toISOString(),
  };
  try {
    payload.screenshot = "data:image/png;base64," + fs.readFileSync(screenshotPath(shotName)).toString("base64");
  } catch (_) {
    payload.screenshot = null;
  }
  if (job.channel === "hsw") {
    payload.checkinNr = checkinNr || null;
  }
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Callback-Status ${r.status}`);
  console.log(`[CALLBACK] [${job.channel}] Ergebnis für ${job.reservationId} an Elev8 gesendet`);
}

app.post("/webhook/guest-guide-completed", (req, res) => {
  // Secret-Prüfung: Elev8-Webhook muss Header "x-webhook-secret" mitsenden
  if (!WEBHOOK_SECRET || req.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  let mapped, tenant;
  try {
    mapped = mapGuestGuideToMeldeschein(req.body);
    tenant = getTenant(req.body.tenantId);
  } catch (err) {
    console.error("[MAPPING-FEHLER]", err.message, JSON.stringify(req.body));
    return res.status(400).json({ error: "invalid payload", detail: err.message });
  }

  const dryRun = req.query.dryRun === "1";
  const baseKey = `${req.body.reservationId || "unbekannt"}:${req.body.revision || 1}`;
  const jobBase = {
    data: mapped,
    attempt: 0,
    tenantId: req.body.tenantId,
    tenantName: getTenantName(req.body.tenantId),
    reservationId: req.body.reservationId || "unbekannt",
    dryRun,
  };

  // Kanal 1: HTG-Formular (shop.hochschwarzwald.de) – Duplikate pro Kanal prüfen
  const queued = [];
  if (dryRun || !isSubmitted(`${baseKey}:htg`)) {
    queue.push({ ...jobBase, channel: "htg", formUrl: tenant.formUrl, dedupeKey: `${baseKey}:htg` });
    queued.push("htg");
  }
  // Kanal 2: HSW Pass (Tramino) – nur wenn beim Tenant ein Link hinterlegt ist
  if (tenant.hswPassUrl && (dryRun || !isSubmitted(`${baseKey}:hsw`))) {
    queue.push({ ...jobBase, channel: "hsw", hswUrl: tenant.hswPassUrl, dedupeKey: `${baseKey}:hsw` });
    queued.push("hsw");
  }
  if (queued.length === 0) {
    console.log(`[DUPLIKAT] ${baseKey} bereits auf allen Kanälen eingereicht – übersprungen`);
    return res.status(200).json({ status: "duplicate", detail: "already submitted" });
  }
  processQueue();

  // Sofort antworten – das Ausfüllen läuft asynchron
  res.status(202).json({ status: "queued", channels: queued });
});

app.use("/admin", adminRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Meldeschein-Service läuft auf Port ${PORT}`));
