// Füllt den Hochschwarzwald Quick Check-in aus.
//
// Strategie: Das Formular ist eine Knockout.js-App. Wir schreiben die Werte
// direkt in die Knockout-Observables des ViewModels (robust gegen Layout-
// Änderungen) und lösen anschließend die normalen UI-Aktionen aus
// (Checkbox + Speichern-Button), damit Validierung (Parsley) und Submit
// wie bei einem echten Nutzer laufen.

const { chromium } = require("playwright");

async function fillAndSubmit(data, { dryRun = false, formUrl, screenshotPath } = {}) {
  if (!formUrl) throw new Error("formUrl fehlt");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    locale: "de-DE",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  });

  try {
    await page.goto(formUrl, { waitUntil: "networkidle", timeout: 60000 });

    // Warten bis Knockout gebunden ist (Formular sichtbar)
    await page.waitForSelector("#quick-check-in__firstname0", { timeout: 30000 });

    // Mitreisende über den echten Button hinzufügen (legt KO-Personen an)
    for (let i = 0; i < data.companions.length; i++) {
      await page.click("#addPersonBtn");
    }
    await page.waitForTimeout(500);

    // Werte direkt in die Knockout-Observables schreiben
    const result = await page.evaluate((d) => {
      /* global ko */
      const vm = ko.dataFor(document.querySelector("#peak .content"));
      if (!vm) return { ok: false, error: "ViewModel nicht gefunden" };

      const persons = vm.persons();
      if (persons.length !== 1 + d.companions.length) {
        return { ok: false, error: `Personenzahl stimmt nicht: ${persons.length}` };
      }

      const setIf = (obs, val) => { if (typeof obs === "function" && val !== undefined && val !== "") obs(val); };

      // Hauptgast
      const m = persons[0];
      setIf(m.firstName, d.mainGuest.firstName);
      setIf(m.lastName, d.mainGuest.lastName);
      setIf(m.birthDate, d.mainGuest.birthDate);
      setIf(m.email, d.mainGuest.email);
      setIf(m.phoneNumber, d.mainGuest.phoneNumber);
      setIf(m.nationality, d.mainGuest.nationality);
      setIf(m.identificationType, d.mainGuest.identificationType);
      setIf(m.identificationNumber, d.mainGuest.identificationNumber);
      setIf(m.language, d.mainGuest.language);
      setIf(m.fromDate, d.stay.fromDate);
      setIf(m.toDate, d.stay.toDate);
      const addr = m.address();
      setIf(addr.street, d.mainGuest.address.street);
      setIf(addr.zipCode, d.mainGuest.address.zipCode);
      setIf(addr.town, d.mainGuest.address.town);
      setIf(addr.country, d.mainGuest.address.country);

      // Mitreisende (gleiche Reisedaten wie Hauptgast)
      d.companions.forEach((c, i) => {
        const p = persons[i + 1];
        setIf(p.firstName, c.firstName);
        setIf(p.lastName, c.lastName);
        setIf(p.birthDate, c.birthDate);
        setIf(p.nationality, c.nationality);
        setIf(p.identificationType, c.identificationType);
        setIf(p.identificationNumber, c.identificationNumber);
        setIf(p.language, c.language);
        if (typeof p.allowDiffDates === "function") p.allowDiffDates(false);
      });

      return { ok: true };
    }, data);

    if (!result.ok) throw new Error(result.error);

    // Bestätigungs-Checkbox (Richtigkeit der Daten – Zustimmung des Gastes
    // wurde bereits im Guest Guide eingeholt und dokumentiert)
    await page.check("#correctness-disclaimer");

    // Beleg-Screenshot des ausgefüllten Formulars (vor dem Absenden)
    if (screenshotPath) {
      await page.screenshot({ fullPage: true, path: screenshotPath });
    }

    if (dryRun) {
      return { submitted: false, dryRun: true, screenshot: screenshotPath || null };
    }

    // Absenden
    await page.click('form button[type="submit"]');

    // Erfolg: Erfolgsmeldung des ViewModels erscheint
    await page.waitForSelector(".quick-check-in-success-msg", { timeout: 30000 });
    return { submitted: true };
  } catch (err) {
    // Screenshot für Fehleranalyse
    try { await page.screenshot({ fullPage: true, path: `/tmp/error-${Date.now()}.png` }); } catch (_) {}
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { fillAndSubmit };
