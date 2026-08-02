// Mapping: Elev8-Webhook-Payload -> Meldeschein-Datenstruktur
// Datumsformat durchgehend ISO (YYYY-MM-DD), da wir direkt ins
// Knockout-ViewModel des Formulars schreiben.

function required(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Pflichtfeld fehlt: ${fieldName}`);
  }
  return value;
}

function isoDate(value, fieldName) {
  const s = String(required(value, fieldName)).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Ungültiges Datum in ${fieldName}: ${value}`);
  return s;
}

// Formular erwartet: 'passport' | 'identityCard'
function mapIdType(t) {
  if (!t) return "passport";
  const v = String(t).toLowerCase();
  if (v.includes("identity") || v.includes("personal") || v.includes("id card") || v === "id") return "identityCard";
  return "passport";
}

function mapPerson(p, prefix, { main = false } = {}) {
  const person = {
    firstName: required(p.firstName, `${prefix}.firstName`),
    lastName: required(p.lastName, `${prefix}.lastName`),
    birthDate: isoDate(p.birthDate, `${prefix}.birthDate`),
    nationality: required(p.nationality, `${prefix}.nationality`).toUpperCase(), // ISO-2, z.B. DE
    identificationType: mapIdType(p.idType),
    identificationNumber: p.idNumber || "",
    language: p.language || "de",
  };
  // Ausweisnummer ist Pflicht für alle Nationalitäten AUSSER DE
  if (person.nationality !== "DE" && !person.identificationNumber) {
    throw new Error(`${prefix}: Ausweisnummer ist Pflicht bei Nationalität ${person.nationality}`);
  }
  if (main) {
    person.email = required(p.email, `${prefix}.email`);
    person.phoneNumber = p.phone || "";
    person.address = {
      street: required(p.street, `${prefix}.street`),
      zipCode: required(p.zip, `${prefix}.zip`),
      town: required(p.city, `${prefix}.city`),
      country: required(p.country, `${prefix}.country`).toUpperCase(),
    };
  }
  return person;
}

function mapGuestGuideToMeldeschein(payload) {
  return {
    stay: {
      fromDate: isoDate(payload.stay && payload.stay.checkIn, "stay.checkIn"),
      toDate: isoDate(payload.stay && payload.stay.checkOut, "stay.checkOut"),
    },
    mainGuest: mapPerson(payload.guest || {}, "guest", { main: true }),
    companions: (payload.companions || []).map((c, i) => mapPerson(c, `companions[${i}]`)),
  };
}

module.exports = { mapGuestGuideToMeldeschein };
