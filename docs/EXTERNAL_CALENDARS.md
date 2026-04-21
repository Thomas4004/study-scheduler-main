# External Calendar Integration

Puoi importare calendari esterni (Google Calendar, Outlook, Apple Calendar, ecc.) per visualizzarli insieme al tuo calendario di studio.

## Caratteristiche

- ✅ **Supporto per iCalendar (ICS)** - Importa qualsiasi calendario che supporti il formato standard iCal
- ✅ **Importazione da URL** - Collega calendari online tramite URL pubblici
- ✅ **Importazione da file** - Carica file .ics dal tuo computer
- ✅ **Sincronizzazione automatica** - Gli eventi vengono sincronizzati automaticamente
- ✅ **Codici colore personalizzati** - Assegna colori diversi a calendari diversi
- ✅ **Gestione semplice** - Aggiungi, sincronizza o rimuovi calendari in pochi click

## Come importare un calendario

### Da URL (Online)

#### Da Google Calendar

1. Apri **Google Calendar**
2. Seleziona il calendario che vuoi condividere
3. Clicca su **Impostazioni** (icona ingranaggio)
4. Vai a **Calendari** → seleziona il calendario
5. Nella sezione "Integrations" o "Link", trova **"URL privata in formato iCal"**
6. Copia il link (inizia con `webcal://` o `https://`)
7. Nella sezione **External Calendars** (in Impostazioni), clicca **"Add Calendar"**
8. Seleziona la scheda **"From URL"**
9. Incolla il link e dai un nome al calendario
10. Clicca **"Import"**

#### Da Outlook/Microsoft 365

1. Apri **Outlook**
2. Seleziona il calendario
3. Clicca sul **menu (⋮)** → **Sharing**
4. Scegli **"Share as ICS"** o similare
5. Copia il link (di solito contiene `.ics`)
6. Segui i step 7-10 di sopra

#### Da Apple Calendar

1. Apri **Apple Calendar**
2. Clicca con tasto destro sul calendario
3. Seleziona **"Preferences"** → **"Sharing"**
4. Copia il link pubblico
5. Segui i step 7-10 di sopra

### Da file locale

Se hai un file `.ics` sul tuo computer (esportato da un calendario):

1. Nella sezione **External Calendars** (in Impostazioni), clicca **"Add Calendar"**
2. Seleziona la scheda **"From File"**
3. Dai un nome al calendario
4. Clicca **"Choose File"** e seleziona il file `.ics`
5. Clicca **"Import"**

**Come ottenere un file .ics:**

- **Google Calendar**: Impostazioni → Calendari → menu (⋮) → Scarica → formato .ics
- **Outlook**: Seleziona il calendario → click destro → Esporta → Salva come .ics
- **Apple Calendar**: File → Esporta oppure seleziona il calendario e trascina in Finder
- **Altre applicazioni**: Solitamente nel menu Esporta/Download/Share

## API disponibili

### Importare un calendario da URL

```http
POST /api/calendar/import
Content-Type: application/json
X-Secret-Key: <your-secret-key>

{
  "name": "Universitá Timeline",
  "url": "https://calendar.google.com/calendar/ics/..."
}
```

**Risposta:**
```json
{
  "id": "cuid",
  "name": "Universitá Timeline",
  "url": "https://...",
  "color_code": "#8B5CF6"
}
```

### Importare un calendario da file

```http
POST /api/calendar/import-file
Content-Type: multipart/form-data
X-Secret-Key: <your-secret-key>

file: <binary ics file>
name: "My Calendar"
```

**Risposta:**
```json
{
  "id": "cuid",
  "name": "My Calendar",
  "url": "file://My Calendar",
  "color_code": "#8B5CF6",
  "events": [
    {
      "id": "event-id",
      "title": "Esame di Calcolo",
      "startDate": "2026-05-15T10:00:00Z",
      "endDate": "2026-05-15T12:00:00Z",
      "allDay": false
    }
  ]
}
```

### Sincronizzare un calendario

```http
GET /api/calendar/sync/<calendarId>
X-Secret-Key: <your-secret-key>
```

**Risposta:**
```json
{
  "id": "cuid",
  "name": "Universitá Timeline",
  "color_code": "#8B5CF6",
  "events": [
    {
      "id": "event-id",
      "title": "Esame di Calcolo",
      "startDate": "2026-05-15T10:00:00Z",
      "endDate": "2026-05-15T12:00:00Z",
      "allDay": false
    }
  ],
  "syncedAt": "2026-04-21T10:30:00Z"
}
```

### Ottenere lista calendari

```http
GET /api/calendar/external
X-Secret-Key: <your-secret-key>
```

**Risposta:**
```json
{
  "calendars": [
    {
      "id": "cuid",
      "name": "Universitá Timeline",
      "url": "https://...",
      "color_code": "#8B5CF6",
      "isEnabled": true,
      "syncedAt": "2026-04-21T10:30:00Z",
      "lastError": null
    }
  ],
  "count": 1
}
```

### Rimuovere un calendario

```http
DELETE /api/calendar/sync/<calendarId>
X-Secret-Key: <your-secret-key>
```

## Formato supportato

I calendari devono essere in formato **iCalendar (RFC 5545)**, che include:
- ✅ Google Calendar (ICS export)
- ✅ Outlook/Microsoft 365
- ✅ Apple Calendar
- ✅ Nextcloud Calendar
- ✅ Qualsiasi altro calendario che supporta iCal

## Caratteristiche tecniche

- **Parser ICS robusto** - Supporta date, orari, timezone, eventi tutto il giorno
- **Caching intelligente** - Gli eventi vengono sincronizzati ogni 30 minuti
- **Gestione errori** - Se un calendario non è disponibile, gli altri continuano a funzionare
- **Privacy** - I calendari sono associati all'utente e visibili solo a lui
- **Supporto file locali** - Importa file .ics dal tuo computer senza condivisione online

## Limitazioni

- Massimo 100 eventi per calendario
- File locali: massimo 10MB per file
- Solo lettura (i calendari sono sincronizzati dal sorgente)
- Aggiornamenti fino a ogni 30 minuti
- File locali non vengono sincronizzati (rimangono statici)

## Troubleshooting

### "URL does not contain valid iCalendar data"

Assicurati che il link sia in formato iCal (`.ics` o risponda con `BEGIN:VCALENDAR`).

### "File must be an .ics file"

Il file caricato non è un file iCalendar valido. Assicurati che:
- L'estensione sia `.ics`
- Il file contenga `BEGIN:VCALENDAR` nel testo

### "Failed to validate calendar URL"

Il link potrebbe essere inaccessibile. Verifica che:
- L'URL sia pubblicamente condivisibile
- Riprava a copiare di nuovo il link dal source calendar

### Gli eventi non vengono visualizzati

Gli eventi potrebbero non essere nel range di date visualizzato. Il calendario mostra gli ultimi 2-3 mesi. Clicca "Sync" per forzare l'aggiornamento.

### Il file non viene importato

Per i file locali:
- Verifica che il file sia un `.ics` valido (provalo ad aprire con Google Calendar per verificare)
- Massimo 10MB per file
- Se il file è troppo grande, prova a esportare un intervallo di date più ristretto
