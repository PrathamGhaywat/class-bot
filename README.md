# WhatsApp Class AI Bot

This project is a class assistant that:
- listens to WhatsApp messages via **Baileys**
- triggers when it sees a configured mention alias (default: `@prgh`)
- answers with class context (homework, timetable, appointments, tests, uploaded knowledge)
- extracts text from uploaded PDFs and runs OCR on uploaded images/documents
- provides a password-protected admin panel for managing data and uploads

## Stack

- Node.js + TypeScript
- Baileys (`@whiskeysockets/baileys`)
- Vercel AI SDK (`ai`) + OpenAI provider (`@ai-sdk/openai`)
- Express + Multer
- SQLite (`better-sqlite3`)
- OCR + file parsing (`tesseract.js`, `pdf-parse`)
- Simple HTML/CSS/JS admin frontend

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template and fill values:
   ```bash
   copy .env.example .env
   ```
3. Set at least:
   - `ADMIN_PASSWORD`
   - `OPENAI_API_KEY` (or use a custom compatible endpoint with `OPENAI_BASE_URL`)
   - `MENTION_ALIASES` (comma-separated aliases without `@`, e.g. `prgh,classbot`)
   - Group access is managed in the admin panel (`Groups` section)

## Environment variables

```env
PORT=3000
ADMIN_PASSWORD=change-me
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_PROVIDER_NAME=openai
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_MODE=chat
MENTION_ALIASES=prgh
WHATSAPP_AUTH_DIR=.baileys-auth
WHATSAPP_ALLOWED_GROUP_JID=
WHATSAPP_ALLOWED_GROUP_JIDS=
WHATSAPP_PAIRING_PHONE=
KNOWLEDGE_DIR=uploads
OCR_LANGUAGES=eng+deu
ENABLE_WHATSAPP_BOT=true
```

## Run

Development:
```bash
npm run dev
```

Production build:
```bash
npm run build
npm start
```

Admin panel:
- Open `http://localhost:3000/admin`
- Login using `ADMIN_PASSWORD`
- Add/edit/delete class records
- Upload files and optional context notes

## Deploy on Debian VPS with systemd

1. Install prerequisites:
   ```bash
   sudo apt update
   sudo apt install -y curl git build-essential
   ```
2. Install Node.js LTS (example using NodeSource):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
3. Clone the app and install dependencies:
   ```bash
   git clone <your-repo-url> /opt/class-bot
   cd /opt/class-bot
   npm install
   ```
4. Create your environment file:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Set at least:
   - `ADMIN_PASSWORD`
   - `OPENAI_API_KEY` and/or `OPENAI_BASE_URL`
   - `MENTION_ALIASES`
   - any allowed WhatsApp group JIDs you want pre-seeded
5. Build the app:
   ```bash
   npm run build
   ```
6. Create a systemd service file:
   ```bash
   sudo nano /etc/systemd/system/class-bot.service
   ```

   Example service:
   ```ini
   [Unit]
   Description=WhatsApp Class AI Bot
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/class-bot
   EnvironmentFile=/opt/class-bot/.env
   ExecStart=/usr/bin/node /opt/class-bot/dist/index.js
   Restart=always
   RestartSec=5
   User=www-data
   Group=www-data

   [Install]
   WantedBy=multi-user.target
   ```

   If you prefer, replace `www-data` with a dedicated user like `classbot`.
7. Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now class-bot
   ```
8. Check status and logs:
   ```bash
   sudo systemctl status class-bot
   sudo journalctl -u class-bot -f
   ```

### Deployment notes

- The bot will run from `dist/index.js` after `npm run build`.
- Keep the WhatsApp auth directory and `class-agent.db` on the server so the login session persists.
- If you change `.env` or code, rebuild and restart:
  ```bash
  npm run build
  sudo systemctl restart class-bot
  ```
- The admin panel stays on the configured `PORT` (default `3000`).

## WhatsApp behavior

- Bot checks incoming message text/caption and can extract text from attached images/documents.
- Bot only processes messages from group chats that are allowed in the admin panel.
- If a configured alias is mentioned (e.g. `@prgh`), the trailing text becomes the prompt.
- If an image/document is attached, extracted text is appended to the prompt automatically.
- Bot replies in the same chat, quoted to the original message.
- On first link, it prints a scannable terminal QR.
- Optional: set `WHATSAPP_PAIRING_PHONE` (E.164 number, digits only) to print a pairing code as an alternative login flow.

## Data model

- `homework`
- `timetable`
- `appointments`
- `tests`
- `knowledge_documents`

All data is stored in local `class-agent.db`.

## Notes

- If `OPENAI_API_KEY` is not set, the bot uses a local retrieval fallback instead of LLM calls.
- For OpenAI-compatible providers, set `OPENAI_BASE_URL` and optionally `OPENAI_PROVIDER_NAME`.
- Uploaded PDFs are auto-parsed for text; scanned/image-only PDFs automatically fall back to Tesseract OCR.
- Images are OCR-processed automatically.
- For low-quality scans, adding a manual context note still improves answer quality.
- First WhatsApp run shows a QR in terminal; scan it to link the session.
