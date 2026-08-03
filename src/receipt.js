// Beleg-PNG für den HSW-Pass-Kanal.
// Der Kanal läuft ohne Browser, daher rendern wir selbst eine Quittung
// (Self-Checkin-Nummer, Gäste, Aufenthalt, Unterschrift) über Playwright.

const { chromium } = require("playwright");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function germanDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${d}.${m}.${y}`;
}

function buildHtml(data, { checkinNr, tenantName, signatureImage, submittedAt }) {
  const persons = [
    { ...data.mainGuest, role: "Hauptanmelder" },
    ...data.companions.map((c, i) => ({ ...c, role: `Mitreisende/r ${i + 1}` })),
  ];
  const rows = persons
    .map(
      (p) => `<tr>
        <td>${esc(p.role)}</td>
        <td><strong>${esc(p.firstName)} ${esc(p.lastName)}</strong></td>
        <td>${esc(germanDate(p.birthDate))}</td>
        <td>${esc((p.nationality || "").toUpperCase())}</td>
        <td>${esc(p.identificationNumber || "–")}</td>
      </tr>`
    )
    .join("");
  const a = data.mainGuest.address || {};
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#1c1a15;background:#fff;padding:0}
  #beleg{width:680px;padding:32px 36px;background:#fff}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #EFB100;padding-bottom:14px;margin-bottom:18px}
  .head h1{font-size:19px;font-weight:700}
  .head .sub{color:#7a7466;font-size:12.5px;margin-top:2px}
  .nr{text-align:right}
  .nr .label{font-size:11px;color:#7a7466;text-transform:uppercase;letter-spacing:.06em}
  .nr .value{font-size:30px;font-weight:800;color:#1c1a15}
  .meta{display:flex;gap:28px;margin-bottom:16px;flex-wrap:wrap}
  .meta div .k{font-size:11px;color:#7a7466;text-transform:uppercase;letter-spacing:.05em}
  .meta div .v{font-weight:600}
  table{width:100%;border-collapse:collapse;margin:6px 0 16px}
  th{font-size:11px;color:#7a7466;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:6px 8px;border-bottom:1.5px solid #e8e4da}
  td{padding:7px 8px;border-bottom:1px solid #f0ede5;font-size:13.5px}
  .sig{display:flex;align-items:flex-end;gap:18px;margin-top:8px}
  .sig .box{border:1px solid #e8e4da;border-radius:8px;padding:8px 14px;background:#faf9f6}
  .sig img{display:block;max-height:80px;max-width:260px}
  .sig .cap{font-size:11px;color:#7a7466;margin-top:4px;border-top:1px solid #d9d4c8;padding-top:3px}
  .note{margin-top:16px;font-size:12px;color:#7a7466;background:#fdf6df;border:1px solid #f3e3ac;border-radius:8px;padding:9px 12px}
  .foot{margin-top:14px;font-size:11px;color:#a29a89;display:flex;justify-content:space-between}
</style></head>
<body><div id="beleg">
  <div class="head">
    <div>
      <h1>HSW Pass · Digitaler Meldeschein</h1>
      <div class="sub">Self-Checkin über hswpass.de (Hochschwarzwald Tourismus / Tramino)</div>
    </div>
    <div class="nr"><div class="label">Self-Checkin Nr.</div><div class="value">#${esc(checkinNr)}</div></div>
  </div>
  <div class="meta">
    <div><div class="k">Unterkunft</div><div class="v">${esc(tenantName || "–")}</div></div>
    <div><div class="k">Aufenthalt</div><div class="v">${esc(germanDate(data.stay.fromDate))} – ${esc(germanDate(data.stay.toDate))}</div></div>
    <div><div class="k">Anschrift Hauptanmelder</div><div class="v">${esc(a.street || "")}, ${esc(a.zipCode || "")} ${esc(a.town || "")} (${esc((a.country || "").toUpperCase())})</div></div>
  </div>
  <table>
    <thead><tr><th></th><th>Name</th><th>Geburtsdatum</th><th>Nat.</th><th>Ausweis-Nr.</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sig">
    <div class="box">
      ${signatureImage ? `<img src="${esc(signatureImage)}" alt="Unterschrift">` : `<div style="height:60px;width:220px"></div>`}
      <div class="cap">Unterschrift des Hauptanmelders (digital erfasst im Elev8 Guest Guide)</div>
    </div>
  </div>
  <div class="note">Der Meldeschein wurde inkl. Datenschutz-Zustimmung und Unterschrift übermittelt. Der Gastgeber muss den Self-Checkin im HSW-System bestätigen, bevor der Gast seinen Pass erhält.</div>
  <div class="foot">
    <span>Automatisch übermittelt durch den Elev8 Meldeschein-Service</span>
    <span>${esc(submittedAt)}</span>
  </div>
</div></body></html>`;
}

async function renderHswReceipt(data, { checkinNr, tenantName, signatureImage, outPath }) {
  const submittedAt = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }) + " Uhr";
  const html = buildHtml(data, { checkinNr, tenantName, signatureImage, submittedAt });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 1000 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    const card = await page.$("#beleg");
    await card.screenshot({ path: outPath });
  } finally {
    await browser.close();
  }
  return outPath;
}

module.exports = { renderHswReceipt, buildHtml };
