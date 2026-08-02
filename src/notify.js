// Fehler-Benachrichtigung an eine Webhook-URL.
// Quelle: Admin-Einstellungen (settings.json), Fallback Railway-Variable NOTIFY_WEBHOOK_URL.
// Kompatibel mit Make.com-Webhooks, Slack Incoming Webhooks und Discord (Slack-Modus):
// es wird ein JSON { text: "..." } gePOSTet.

const { getNotifyUrl } = require("./store");

async function notifyError(text) {
  const url = getNotifyUrl();
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
