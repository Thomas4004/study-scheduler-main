# External Calendar Integration

Puoi importare calendari esterni (Google Calendar, Outlook, Apple Calendar, ecc.) per visualizzarli insieme al tuo calendario di studio.

## Caratteristiche

- ✅ **Supporto per iCalendar (ICS)** - Importa qualsiasi calendario che supporti il formato standard iCal
- ✅ **Sincronizzazione automatica** - Gli eventi vengono sincronizzati automaticamente
- ✅ **Codici colore personalizzati** - Assegna colori diversi a calendari diversi
- ✅ **Gestione semplice** - Aggiungi, sincronizza o rimuovi calendari in pochi click

## Come importare un calendario

### Da Google Calendar

1. Apri **Google Calendar**
2. Seleziona il calendario che vuoi condividere
3. Clicca su **Impostazioni** (icona ingranaggio)
4. Vai a **Calendari** → seleziona il calendario
5. Nella sezione "Integrations" o "Link", trova **"URL privata in formato iCal"**
6. Copia il link (inizia con `webcal://` o `https://`)
7. Nella sezione **External Calendars** (in Impostazioni), clicca **"Add Calendar"**
8. Incolla il link e dai un nome al calendario
9. Clicca **"Import"**

### Da Outlook/Microsoft 365

1. Apri **Outlook**
2. Seleziona il calendario
3. Clicca sul **menu (⋮)** → **Sharing**
4. Scegli **"Share as ICS"** o similare
5. Copia il link (di solito contiene `.ics`)
6. Segui i step 7-9 di sopra

### Da Apple Calendar

1. Apri **Apple Calendar**
2. Clicca con tasto destro sul calendario
3. Seleziona **"Preferences"** → **"Sharing"**
4. Copia il link pubblico
5. Segui i step 7-9 di sopra

## API disponibili

### Importare un calendario

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

## Limitazioni

- Massimo 100 eventi per calendario
- Solo lettura (i calendari sono sincronizzati dal sorgente)
- Aggiornamenti fino a ogni 30 minuti

## Troubleshooting

### "URL does not contain valid iCalendar data"

Assicurati che il link sia in formato iCal (`.ics` o risponda con `BEGIN:VCALENDAR`).

### "Failed to validate calendar URL"

Il link potrebbe essere inaccessibile. Verifica che:
- L'URL sia pubblicamente condivisibile
- Riprava a copiare di nuovo il link dal source calendar

### Gli eventi non vengono visualizzati

Gli eventi potrebbero non essere nel range di date visualizzato. Il calendario mostra gli ultimi 2-3 mesi. Clicca "Sync" per forzare l'aggiornamento.
