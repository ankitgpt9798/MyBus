# MyBus

A bus ticket booking platform inspired by RedBus. It is built on the MEAN stack with TypeScript:

- MongoDB
- Express.js
- Angular
- Node.js

```
backend/    REST API (Express 5 + TypeScript + Mongoose), served under /api
frontend/   Angular app (standalone components, SCSS)
```

## Prerequisites

- Node.js 22.22+ or 24.15+ (npm 10+)
- MongoDB 7+ running locally (default `mongodb://127.0.0.1:27017`)
- Git

## Setup

```bash
git clone https://github.com/ankitgpt9798/MyBus.git
cd MyBus

# Backend
cd backend
npm ci
cp .env.example .env        # then edit .env: at least set JWT_SECRET to a long random string

# Frontend
cd ../frontend
npm ci
```

### Environment (`backend/.env`)

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `4000`) |
| `MONGODB_URI` | MongoDB connection string (database `mybus`) |
| `FRONTEND_URL` | Public app URL used in email links, shared community links and their preview images (default `http://localhost:4200`) |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Signing secret (required, a long random string) and lifetime for login tokens |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API (default `http://localhost:4200`). An entry may use `*` for one host label, e.g. `https://deploy-preview-*--mybus.netlify.app` |
| `TRUST_PROXY` | How many proxies sit in front of the API, so rate limits see the real client IP (default `1` with `NODE_ENV=production`, otherwise off) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Admin account created by the seed script |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Outgoing email, e.g. with Brevo: `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, your Brevo SMTP login and SMTP key, and a sender address verified in Brevo. Leave `SMTP_HOST` empty to print emails and verification links in the backend console instead |
| `SEAT_HOLD_MINUTES` | How long selected seats are held while paying |
| `UPLOADS_DIR` | Where community photos are stored and served from at `/uploads` when they are kept locally (default `backend/uploads`, git-ignored) |
| `PHOTO_STORAGE` | `cloudinary` or `local`. Default: `cloudinary` when the three `CLOUDINARY_*` credentials below are set, otherwise `local` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary account for community photos (see below). Stay on the server |
| `CLOUDINARY_FOLDER` | Cloudinary folder for MyBus images (default `mybus/community`); nothing outside it is ever touched |
| `CLOUDINARY_API_BASE`, `CLOUDINARY_TIMEOUT_MS` | Tests only: point uploads at a mock server (default `https://api.cloudinary.com`) and change the upload timeout (default 15000 ms) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push keys. Leave empty to generate a pair automatically the first time push is used (saved to the git-ignored `backend/.vapid-keys.json` and reused after restarts) |
| `NOTIFY_RETRY_DELAYS_MS`, `NOTIFY_RETRY_INTERVAL_MS`, `NOTIFY_STREAM_HEARTBEAT_MS` | Tests only: shorten the email/push retry backoff (default 1, 5, 15 min), the retry check (30 s) and the live-stream heartbeat (15 s) |
| `REMINDER_LEADS_MS`, `REMINDER_INTERVAL_MS` | Tests only: shorten the journey reminder lead times (default 24 h and 2 h before departure) and how often they are checked (1 min) |
| `TOMTOM_API_KEY` | Route planner key with the TomTom Search, Routing, Traffic and Map Display products (see below). Stays on the server; leave empty to use the fallback |
| `TOMTOM_BASE_URL`, `OSRM_BASE_URL`, `PLANNER_TIMEOUT_MS` | Tests only: point the planner at a mock server (defaults `https://api.tomtom.com` and `https://router.project-osrm.org`) and shorten the upstream timeout (default 8000 ms) |
| `PLANNER_REFRESH_MS`, `PLANNER_ROUTE_CACHE_MS`, `PLANNER_ROUTES_PER_MIN` | Tests only: how often an open plan refreshes its live traffic (default 60000 ms), how long identical route requests share one TomTom answer (default 30000 ms, `0` turns it off) and route requests allowed per visitor per minute (default 20) |

### Route planner (TomTom)

The route planner uses a [TomTom](https://developer.tomtom.com/) key with these products enabled: **Search** (place typeahead), **Routing** (routes with live traffic and alternatives), **Traffic** (traffic data in routes) and **Map Display** (map tiles). The browser never sees the key: everything goes through the API.

| Endpoint | What it does |
| --- | --- |
| `GET /api/planner/status` | Provider in use, whether live traffic is available, which map tiles to show |
| `GET /api/planner/search?q=&near=lat,lon` | Place suggestions (cached for 10 minutes) |
| `POST /api/planner/routes` | Suggested routes with alternatives, ETAs and traffic sections (`{ start, end, waypoints (up to 5), departAt? }`) |
| `GET /api/planner/tiles/{z}/{x}/{y}.png?style=main\|night` | Map tiles with the key added on the server |
| `GET /api/planner/traffic-tiles/{z}/{x}/{y}.png?style=relative0\|relative0-dark\|absolute` | Live traffic flow overlay tiles (cached for 2 minutes) |
| `GET/POST /api/planner/saved`, `PATCH/DELETE /api/planner/saved/:id`, `POST /api/planner/saved/:id/use` | The signed-in user's saved routes (up to 20, no duplicates; sorted by most used or `?sort=recent`) |

While a plan is open, the web app refreshes it every minute (paused while the tab is hidden or offline, stopped after an hour without activity), colours the selected route by live traffic, suggests a clearly faster alternative and tells the user when the travel time changes by 3 minutes or more.

Without a key, or when TomTom refuses it, times out or fails, the planner keeps working without live traffic: place search uses the MyBus cities and bus stops (no external geocoder), routes come from the public OSRM demo router, the map uses OpenStreetMap tiles, and the page shows a notice.

### Community photos (Cloudinary)

Photos are checked on the server first (real JPEG / PNG / WebP, at most 5 MB each and 4 per post) and their camera and GPS metadata is removed; only these cleaned bytes are uploaded. MyBus talks to Cloudinary's REST API directly (signed upload and destroy, no SDK) and stores each image as `<CLOUDINARY_FOLDER>/<random id>`, tagged `mybus` (`mybus-seed` for demo photos).

- Cards and thumbnails load a version limited to 800 px wide, the enlarged view 1600 px, and link previews (`og:image`) an absolute 1200 px JPEG, all with automatic format and quality (`f_auto,q_auto`).
- Deleting a post, or removing a photo while editing it, deletes the image from Cloudinary. A moderator removing a post keeps its images, so the post can be restored.
- The seed deletes only the images it created itself (recorded in the database), never anything else in the account.
- With `PHOTO_STORAGE=local` (or no Cloudinary credentials) photos are kept in `UPLOADS_DIR` as before. Photos stored locally before Cloudinary was enabled keep working.

To copy existing local photos to Cloudinary (it uses `MONGODB_URI`, `UPLOADS_DIR` and the `CLOUDINARY_*` settings from `backend/.env` or the environment):

```bash
cd backend
npm run migrate:photos -- --dry-run   # counts only: local photos found, files present or missing, already on Cloudinary
npm run migrate:photos                # upload and point those photo entries at Cloudinary
```

The migration only changes photo entries that are not on Cloudinary yet, never deletes the local files (they stay as a backup) or any other data, and is safe to run again after an interruption.

## Seed the database

```bash
cd backend
npm run seed
```

This resets the catalogue, bookings, reviews and community content (posts, photos, comments, reports, shares and the likes timeline) in the database from `MONGODB_URI`, then creates or updates these accounts (saved routes are kept):

| Account | Email | Password |
| --- | --- | --- |
| Admin | `ADMIN_EMAIL` from `.env` (default `admin@mybus.local`) | `ADMIN_PASSWORD` (default `Admin@12345`) |
| Verified traveller | `traveler@mybus.local` | `Traveler@123` |
| Unverified traveller | `unverified@mybus.local` | `Traveler@123` |
| Demo reviewers (sample route reviews and community posts) | `priya.reviews@mybus.local`, `rahul.reviews@…`, `sneha.reviews@…`, `ananya.reviews@…`, `kiran.reviews@…`, `vikram.reviews@…`, `meena.reviews@…` | `Traveler@123` |

It also creates:

- operators, buses and routes between 10 Indian cities
- trips for the past 6 days and the next 14 days

## Run (development)

Use two terminals:

```bash
# 1. API: http://localhost:4000/api
cd backend
npm run dev

# 2. Web app: http://localhost:4200
cd frontend
npm start
```

The Angular dev server forwards `/api`, `/uploads` (community photos) and `/share` (link previews for shared posts) to the backend (`frontend/proxy.conf.json`); a production web server needs the same three routes. To check that both are up, open `http://localhost:4200/api/health`.

## Production build

```bash
cd backend && npm run build && npm start   # compiles to backend/dist and starts the API (reads backend/.env)
cd frontend && npm run build               # outputs the web app to frontend/dist/frontend/browser
```

The web app reads the API location from `config.js` at startup. In development it is empty (same origin, `/api` through the dev proxy). For a deployment, `frontend/scripts/deploy-config.mjs` writes `config.js` with `API_BASE_URL` and a Netlify `_redirects` file into the build output (see below). With `NODE_ENV=production` the API prints warnings at startup for settings that break on a hosted server (local photo storage, missing VAPID keys, localhost URLs, a weak `JWT_SECRET`).

## Deploy (Render + Netlify)

The API runs on [Render](https://render.com) (`render.yaml`) and the web app on [Netlify](https://www.netlify.com) (`netlify.toml`). The web app calls the API directly (cross-origin). Netlify only proxies share links (`/share/*`) and locally stored photos (`/uploads/*`), so shared links stay on the web app's domain.

1. **MongoDB Atlas:** under Network Access allow `0.0.0.0/0` (Render has no fixed outgoing IP on the free plan), and copy the connection string.
2. **Render:** New > Blueprint, pick this repository. Fill in the variables it asks for (table below). `FRONTEND_URL` and `CORS_ORIGINS` are not known yet: enter a placeholder such as `https://example.com` for now. Wait for the deploy, then note the service URL (e.g. `https://mybus-api.onrender.com`); `/api/health` should answer `{"status":"ok"}`.
3. **Netlify:** Add new site > Import from Git, pick this repository (the settings come from `netlify.toml`). Add the environment variable `API_BASE_URL` = the Render URL, then deploy. The build stops with a clear message if it is missing.
4. **Back on Render:** set `FRONTEND_URL` to the Netlify URL (e.g. `https://mybus.netlify.app`) and `CORS_ORIGINS` to the same origin (comma-separated if there are more, e.g. a custom domain), then redeploy.

| Variable (Render) | What it must contain |
| --- | --- |
| `NODE_ENV`, `NODE_VERSION`, `TRUST_PROXY`, `PHOTO_STORAGE`, `CLOUDINARY_FOLDER` | Set by `render.yaml` (`production`, `24`, `1`, `cloudinary`, `mybus/community`) |
| `MONGODB_URI` | Atlas connection string for the MyBus database |
| `JWT_SECRET` | A long random string (32+ characters) |
| `FRONTEND_URL` | The Netlify site URL (email links, shared posts) |
| `CORS_ORIGINS` | The Netlify site origin(s), comma-separated |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Brevo SMTP relay (`smtp-relay.brevo.com`, `587`), SMTP login and key, a verified sender |
| `TOMTOM_API_KEY` | TomTom key (Search, Routing, Traffic, Map Display) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary account for community photos |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Fixed web push keys (e.g. the pair in your local `backend/.vapid-keys.json`); without them new keys are made on every deploy and existing push subscriptions stop working |
| `VAPID_SUBJECT` | Contact for push services: the site URL (`https://mybus.netlify.app`) or `mailto:` a real address |

| Variable (Netlify) | What it must contain |
| --- | --- |
| `API_BASE_URL` | The Render service URL, e.g. `https://mybus-api.onrender.com` (origin only, no `/api`) |

Free-plan notes:

- Render puts the API to sleep after about 15 minutes without requests. The first request after that takes up to a minute, and background jobs (journey reminders, notification retries, hold expiry) pause while it sleeps and catch up when it wakes.
- Never run `npm run seed` against the production database: it replaces trips, bookings, reviews and community posts. It refuses to run with `NODE_ENV=production`.
- Photos must be on Cloudinary in production: Render's disk is wiped on every deploy and restart.
