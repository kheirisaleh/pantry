# Security

Pantry is built for a private home network. People have no passwords by design; anyone who can reach the app
can pick a person and change data. Do not expose the app itself to the internet. If you need Alexa, expose only
`/alexa` behind a reverse proxy with HTTPS.

Protected parts:

* The automation and export endpoints (`/api/export/nutrition…`, `/api/automation/…`) need an API key. Keys are
  shown once and stored only as a SHA-256 hash.
* Webhooks are signed with HMAC-SHA256 over the timestamp and the body; receivers should check the signature and
  reject old timestamps (see `docs/INTEGRATIONS.md`).
* Alexa requests are accepted only with a valid Amazon signature, a fresh timestamp and the configured skill id.
* Dish photos are downloaded only over HTTPS, only as JPEG, PNG or WebP and at most 8 MB.
* The container runs as user 1000, not as root.

Secrets such as the Gemini key live in `.env` or in the database; neither belongs in git or in screenshots.

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button instead of a public issue.
