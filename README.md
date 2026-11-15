# Chat X

A complete chat app: real accounts, one-to-one and group chats, voice messages, status, voice/video calls,
a Team support room, private problem reports and an Admin portal.

```
chatx-backend/
├── server.js          Backend: REST API + realtime (Server-Sent Events) + SQLite. No npm packages needed.
├── public/
│   ├── index.html     Page shell
│   ├── style.css      All styles (colours are CSS variables, so themes work live)
│   └── script.js      Front end: UI + API client + WebRTC calls
├── test/
│   ├── api.test.js    API tests (no browser)      -> npm test
│   └── e2e.js         Real-browser tests (Playwright)
├── package.json  Dockerfile  .env.example
```

## Run it on your computer

Needs **Node.js 22.13 or newer** (it uses the built-in `node:sqlite`).

```bash
cd chatx-backend
npm start            # opens on http://localhost:3000
```

Open http://localhost:3000, sign up, and you are in. **The first account you create becomes the admin**
(or set `ADMIN_EMAIL` and sign up with that email/phone). Admin tools appear in **You → Admin portal**.

To try it with two people on one computer, open a normal window and a private/incognito window.

## Put it online (so anyone can use it)

Any host that runs Node 22+ works. You need two things: **HTTPS** and a **persistent disk** for the database file.

**Render / Railway / Fly.io (easiest)**
1. Upload this folder to a GitHub repository.
2. Create a new *Web Service* from it. Build command: none. Start command: `node server.js`.
3. Add a persistent disk and mount it at `/data`.
4. Set environment variables: `DATA_DIR=/data`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`, `ADMIN_EMAIL=you@example.com`.

**Docker / VPS**
```bash
docker build -t chatx .
docker run -d -p 3000:3000 -v chatx-data:/data -e COOKIE_SECURE=1 -e ADMIN_EMAIL=you@example.com chatx
```
Put Nginx/Caddy in front for HTTPS (browsers only allow camera/microphone on HTTPS) and set `TRUST_PROXY=1`.
For Nginx, disable response buffering for `/api/events` (the server already sends `X-Accel-Buffering: no`).

## Environment variables

| Name | Meaning |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Folder for the SQLite database (default `./data`). **Back this folder up.** |
| `ADMIN_EMAIL` | The account with this email/phone becomes admin. Empty = first user becomes admin |
| `COOKIE_SECURE` | `1` when served over HTTPS |
| `TRUST_PROXY` | `1` only behind a trusted reverse proxy (so rate limits see real client IPs) |

## What is included

- **Accounts:** sign up / log in with email or phone + password (scrypt-hashed), 30-day sessions in HttpOnly cookies,
  change password, change email/phone, delete account, rate limiting.
- **Chats:** one-to-one and groups, live delivery, unread counts, read receipts (blue ticks), voice messages,
  disappearing-message timer, pin / mute / archive / favourite / lists / lock, clear chat, block.
- **Privacy settings enforced by the server:** who can see your photo, about, last seen/online; who can add you to groups; who can call you; read receipts.
- **Status:** 24-hour text statuses shown to your contacts.
- **Calls:** real WebRTC voice/video calls between people who have chatted; the server only relays the signalling. Call history.
- **Team room + problem reports:** everyone can chat in the shared Team room; problems are private between the user and the admin.
- **Admin portal:** stats, reply to / resolve / delete reports, announcements and banner, close the Team room,
  block users, delete room messages, export reports to CSV.
- **Security:** CSP (no inline scripts), CSRF header + SameSite cookies, input validation, only 3 public files are served.

## Honest limits (read before launching to many users)

- One server process + SQLite is great for thousands of users, but it is **a single machine**. To scale beyond that you would move to PostgreSQL and a message broker (Redis) for realtime.
- Calls use Google's free **STUN** server. Some strict networks (corporate/mobile) need a **TURN** server too; add one in `ICE` inside `script.js`.
- Not included yet: email/SMS verification and "forgot password", push notifications when the app is closed, photo/video/file messages, end-to-end encryption, an installable mobile app wrapper.
- Voice messages and photos are stored inside the database (small size limits are enforced). For lots of media, use object storage (S3).

## Tests

```bash
npm test                                   # 30+ API checks, no browser needed
PLAYWRIGHT_PATH=/path/to/playwright node test/e2e.js   # real browser: chat, groups, calls, admin
```
