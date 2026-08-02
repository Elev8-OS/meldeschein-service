# Meldeschein-Service

Automatischer Hochschwarzwald Quick Check-in, sobald ein Gast den Elev8 Guest Guide abgeschlossen hat.

## Ablauf

1. Gast füllt Guest Guide aus → Elev8 sendet Webhook an `POST /webhook/guest-guide-completed`
2. Service mappt die Daten aufs Meldeschein-Format (`src/mapping.js`)
3. Playwright öffnet den Quick-Check-in-Link, füllt aus und reicht ein (`src/fill-form.js`)
4. Bei Fehlern: Log-Eintrag → manuell nachfassen

## Deploy auf Railway

1. Variablen: `WEBHOOK_SECRET`, `ADMIN_PASSWORD` (Benutzer: `admin`), `DATA_DIR=/data`
2. **Volume** auf `/data` mounten (dort liegt `tenants.json`)
3. Build läuft über das Dockerfile (Playwright-Image, Chromium inklusive)

## Admin-Interface

`https://<domain>/admin` – Login mit Benutzer `admin` und `ADMIN_PASSWORD`.
Dort werden die Tenants verwaltet: Tenant-ID (aus Elev8), Name und der Quick-Check-in-Link
der Unterkunft (enthält Betriebsnummer + Partner-Kennung). Nur Links auf
shop.hochschwarzwald.de werden akzeptiert.

## Testen ohne Absenden

`POST /webhook/guest-guide-completed?dryRun=1` – füllt aus, macht Screenshot, sendet nicht ab.

## Webhook-Payload

```json
{
  "reservationId": "RES-1234",
  "tenantId": "TEN-BLACKHOME",
  "guest": {
    "firstName": "Max", "lastName": "Mustermann",
    "email": "max@example.com", "phone": "+49 170 1234567", "birthDate": "1985-04-12",
    "street": "Hauptstr. 1", "zip": "79822", "city": "Titisee-Neustadt",
    "country": "DE", "nationality": "DE", "idType": "identityCard", "idNumber": ""
  },
  "stay": { "checkIn": "2026-08-10", "checkOut": "2026-08-15" },
  "companions": [
    { "firstName": "Erika", "lastName": "Mustermann", "birthDate": "1987-09-01", "nationality": "DE" }
  ]
}
```

Vollständige Payload-Definition: `webhook-spec-guest-guide.md` (v1.3, bei Juli).

## Offene Punkte

- [ ] Fehler-Benachrichtigung (E-Mail/Slack) statt nur Log
- [ ] Duplikat-Schutz (gleiche Reservierung nicht zweimal einreichen)
