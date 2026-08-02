// Fehler-Benachrichtigung an eine Webhook-URL (Railway-Variable NOTIFY_WEBHOOK_URL).
// Kompatibel mit Slack Incoming Webhooks, Discord (Slack-Modus) und Make.com-Webhooks:
// es wird ein JSON { text: "..." } gePOSTet.

async function notifyError(text) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[NOTIFY-FEHLER]", err.message);
  }
}

module.exports = { notifyError };
