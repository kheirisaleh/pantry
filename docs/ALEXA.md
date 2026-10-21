# Alexa skill

Talk to the pantry from the kitchen: fill the shopping list with wet hands, ask what is planned, or tell it a
dish is cooked.

| Language | Invocation | Example |
| --- | --- | --- |
| English (US, GB) | `pantry home` | "Alexa, open pantry home." |
| German | `meine speisekammer` | „Alexa, öffne meine Speisekammer." |

## What you can say

| Intent | English example | German example | What happens |
| --- | --- | --- | --- |
| Add to the list | "add rice to the shopping list" | „Setze Milch auf die Einkaufsliste" | asks for the amount (and the unit if needed), then adds it |
| Read the list | "what is on the shopping list" | „Lies die Einkaufsliste vor" | reads up to 20 open items |
| Plan a dish | "plan ghormeh sabzi for Friday" | „Plane Ghormeh Sabzi für Freitag" | asks for the day if missing; past days are refused |
| What is planned | "what is planned for tomorrow", "what is for dinner" | „Was essen wir heute" | reads the dishes of that day |
| Tomorrow check | "is anything missing for tomorrow" | „Was fehlt für morgen" | lists what is short and offers to put it on the list |
| Do we have | "do we have eggs" | „Haben wir noch Eier" | says roughly how much is at home |
| Our dishes | "which dishes do we have" | „Welche Gerichte haben wir" | names up to 25 dishes |
| Cooked | "we cooked adas polo" | „Wir haben Adas Polo gekocht" | cooks today's planned meal of that dish (or a new one) and takes the ingredients from stock |
| Ran out | "we ran out of milk" | „Milch ist leer" | marks the item as used up |

Names are matched loosely, so Persian dish names in Latin letters and small mispronunciations still work. Items
added by Alexa carry an "Alexa" chip on the shopping list. The full list of sample sentences lives in
`UTTERANCES` in `app/alexa.py`.

## Setup

1. **Make the server reachable over HTTPS.** Alexa only calls public HTTPS endpoints with a valid certificate,
   for example through a reverse proxy (Caddy, Nginx Proxy Manager) or a Cloudflare Tunnel. Only the path
   `/alexa` needs to be exposed. Set `PUBLIC_URL` to that public address so the settings page shows the right
   endpoint.
2. **Create a custom skill** in the [Alexa developer console](https://developer.amazon.com/alexa/console/ask)
   with "Provision your own" as backend.
3. **Import the interaction model.** In Pantry open Settings, Alexa, and download `en-US`, `en-GB` or `de-DE`
   under "Language models". Paste each file into the JSON editor of the matching skill language and build the
   model. These files are generated from your own dishes and items, so download them again after adding many
   new dishes. The files in [`alexa/interactionModels/custom`](../alexa/interactionModels/custom) are a starting
   point with the same intents.
4. **Endpoint:** HTTPS, `https://<your-domain>/alexa`, with the certificate type that fits your domain.
5. **Tell Pantry the skill id:** Settings, Alexa, paste the `amzn1.ask.skill…` id and press Save (or set
   `ALEXA_SKILL_ID`; a value saved in the settings wins). Until an id is set, every Alexa request is refused.
6. Enable the skill for testing on your Amazon account.

## Security

Every request is checked the way Amazon requires: the signing certificate URL must point to
`https://s3.amazonaws.com/echo.api/`, the certificate chain must be valid for `echo-api.amazon.com`, the
`Signature-256` header must match the body, requests whose timestamp is more than 150 seconds off are refused,
and the application id must equal the saved skill id. Rejected requests get a `400` and a line in the log.

Unlike the read only Home Gym skill, this skill can change data: it adds shopping items, plans dishes, marks
meals as cooked and items as used up. Anyone who can talk to your Echo can do the same.
