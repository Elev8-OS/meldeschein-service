// Füllt den Hochschwarzwald Quick Check-in aus.
//
// Strategie: Das Formular ist eine Knockout.js-App. Wir schreiben die Werte
// direkt in die Knockout-Observables des ViewModels (robust gegen Layout-
// Änderungen) und lösen anschließend die normalen UI-Aktionen aus
// (Checkbox + Speichern-Button), damit Validierung (Parsley) und Submit
// wie bei einem echten Nutzer laufen.

const { chromium } = require("playwright");

async function fillAndSubmit(data, { dryRun = false, formUrl, screenshotPath, errorScreenshotPath } = {}) {
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

    // Geburtsdatum: eigene KO-Komponente, reagiert nicht aufs Observable.
    // Deshalb die sichtbaren Felder direkt befüllen (Einzelfeld oder Tag/Monat/Jahr).
    const birthResult = await page.evaluate((d) => {
      function setNative(el, val) {
        if (el.tagName === "SELECT") {
          const want = [String(val), String(val).padStart(2, "0")];
          const opt = Array.from(el.options).find(
            (o) => want.includes(o.value) || want.includes(o.text.trim())
          );
          if (!opt) return false;
          el.value = opt.value;
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      function fillBirthdate(i, iso) {
        const [y, mo, day] = iso.split("-");
        const label = document.getElementById("quick-check-in__birthdate" + i);
        if (!label) return { i, mode: "label fehlt" };
        const row = label.closest(".row");
        const fields = row ? Array.from(row.querySelectorAll("input, select")) : [];
        if (fields.length === 1) {
          return { i, mode: "einzelfeld", ok: setNative(fields[0], `${day}.${mo}.${y}`) };
        }
        if (fields.length >= 3) {
          const okD = setNative(fields[0], String(parseInt(day, 10)));
          const okM = setNative(fields[1], String(parseInt(mo, 10)));
          const okY = setNative(fields[2], y);
          return { i, mode: "tag/monat/jahr", ok: okD && okM && okY };
        }
        return { i, mode: "unbekannt", felder: fields.map((f) => f.tagName + ":" + (f.type || "")) };
      }
      const results = [fillBirthdate(0, d.mainGuest.birthDate)];
      d.companions.forEach((c, i) => results.push(fillBirthdate(i + 1, c.birthDate)));
      return results;
    }, data);

    console.log("[GEBURTSDATUM]", JSON.stringify(birthResult));
    const birthFailed = birthResult.find((r) => r.ok === false || r.mode === "label fehlt" || r.mode === "unbekannt");
    if (birthFailed) {
      throw new Error(`Geburtsdatum konnte nicht gesetzt werden: ${JSON.stringify(birthFailed)}`);
    }
    await page.waitForTimeout(300);

    // Reisedaten: ebenfalls eigene Datepicker-Komponente – sichtbare Felder direkt setzen.
    // Alle Zeilen mit "Ankunft/Abreise"-Label (Hauptgast + Mitreisende, gleiche Daten).
    const dateResult = await page.evaluate((d) => {
      function setNative(el, val) {
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      function german(iso) { const [y, m, day] = iso.split("-"); return `${day}.${m}.${y}`; }
      const rows = [];
      document.querySelectorAll("label").forEach((l) => {
        if (!/Ankunft/i.test(l.textContent || "")) return;
        const row = l.closest(".row") || l.parentElement;
        if (!row) return;
        const inputs = Array.from(row.querySelectorAll("input")).filter((i) => i.type !== "checkbox" && i.type !== "hidden");
        if (inputs.length >= 2) {
          setNative(inputs[0], german(d.stay.fromDate));
          setNative(inputs[1], german(d.stay.toDate));
          rows.push(inputs.length);
        }
      });
      return { rows: rows.length };
    }, data);
    console.log("[REISEDATEN]", JSON.stringify(dateResult));
    if (!dateResult.rows) {
      throw new Error("Reisedaten-Felder (Ankunft/Abreise) nicht gefunden – Formular-Aufbau geändert?");
    }
    await page.waitForTimeout(300);

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

    // Zustand prüfen: Checkbox gesetzt? Speichern-Button aktiv?
    const submitState = await page.evaluate(() => {
      const cb = document.getElementById("correctness-disclaimer");
      const form = cb ? cb.closest("form") : null;
      const btn = form ? form.querySelector('button[type="submit"]') : null;
      return { checkboxChecked: !!(cb && cb.checked), buttonDisabled: !!(btn && btn.disabled), buttonFound: !!btn };
    });
    console.log("[SUBMIT-STATE]", JSON.stringify(submitState));
    if (!submitState.checkboxChecked) {
      await page.check("#correctness-disclaimer");
    }
    if (submitState.buttonDisabled) {
      // Button per Label-Klick freischalten (falls Styling-Checkbox das native Event braucht)
      await page.click('label[for="correctness-disclaimer"]').catch(() => {});
      await page.waitForTimeout(300);
    }

    // Absenden – gezielt der Speichern-Button im Quick-Check-in-Formular
    await page.click('form:has(#correctness-disclaimer) button[type="submit"]');

    // Erfolg ODER Fehlermeldung der Seite abwarten
    const outcome = await Promise.race([
      page.waitForSelector(".quick-check-in-success-msg", { timeout: 30000 }).then(() => ({ ok: true })),
      page.waitForSelector(".alert-danger", { timeout: 30000 }).then(async (el) => ({ ok: false, serverMsg: ((await el.textContent()) || "").trim() })),
    ]).catch(() => null);

    if (outcome && outcome.ok) return { submitted: true };

    // Validierungsfehler der Seite einsammeln (Parsley)
    const validationErrors = await page.evaluate(() => {
      const msgs = new Set();
      document.querySelectorAll(".parsley-errors-list li").forEach((li) => {
        const t = (li.textContent || "").trim();
        if (t) msgs.add(t);
      });
      const alert = document.querySelector(".alert-danger");
      if (alert) msgs.add((alert.textContent || "").trim());
      return Array.from(msgs);
    }).catch(() => []);

    let pageSnippet = "";
    try {
      pageSnippet = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300));
    } catch (_) {}
    const detail = outcome && outcome.serverMsg
      ? `Server-Meldung: ${outcome.serverMsg}`
      : validationErrors.length
        ? `Validierung blockiert: ${validationErrors.join(" | ")}`
        : `Keine Erfolgsmeldung erschienen. Seiteninhalt: ${pageSnippet}`;
    throw new Error(detail);
  } catch (err) {
    // Screenshot für Fehleranalyse (im Archiv, im Admin-Protokoll verlinkt)
    if (errorScreenshotPath) {
      try { await page.screenshot({ fullPage: true, path: errorScreenshotPath }); } catch (_) {}
    }
    throw err;
  } finally {
    await browser.close();
  }
}

module.exports = { fillAndSubmit };
