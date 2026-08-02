// Webhook-Server: nimmt Guest-Guide-Daten von Elev8 entgegen
// und stößt das Ausfüllen des Hochschwarzwald Quick Check-ins an.

const express = require("express");
const { mapGuestGuideToMeldeschein } = require("./mapping");
const { fillAndSubmit } = require("./fill-form");
const { getFormUrl } = require("./store");
const adminRouter = require("./admin");

const app = express();
app.use(express.json({ limit: "1mb" }));

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // in Railway als Variable setzen
const PORT = process.env.PORT || 3000;

// Einfache In-Memory-Queue, damit Webhook sofort antwortet
// und Playwright im Hintergrund läuft (nacheinander, nicht parallel).
const queue = [];
let working = false;

async function processQueue() {
  if (working) return;
  working = true;
  while (queue.length > 0) {
    const job = queue.shift();
    try {
      const result = await fillAndSubmit(job.data, { dryRun: job.dryRun, formUrl: job.formUrl });
      console.log(`[OK] Meldeschein eingereicht für ${job.data.mainGuest.lastName} (Reservierung ${job.reservationId})`, result);
    } catch (err) {
      console.error(`[FEHLER] Reservierung ${job.reservationId}:`, err.message);
      // TODO: Benachrichtigung (E-Mail/Slack), damit manuell nachgefasst werden kann
    }
  }
  working = false;
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

  queue.push({
    data: mapped,
    formUrl,
    reservationId: req.body.reservationId || "unbekannt",
    dryRun: req.query.dryRun === "1",
  });
  processQueue();

  // Sofort antworten – das Ausfüllen läuft asynchron
  res.status(202).json({ status: "queued" });
});

app.use("/admin", adminRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Meldeschein-Service läuft auf Port ${PORT}`));
