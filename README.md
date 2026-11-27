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
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API (default `http://localhost:4200`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Admin account created by the seed script |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Outgoing email, e.g. with Brevo: `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, your Brevo SMTP login and SMTP key, and a sender address verified in Brevo. Leave `SMTP_HOST` empty to print emails and verification links in the backend console instead |
| `SEAT_HOLD_MINUTES` | How long selected seats are held while paying |
| `UPLOADS_DIR` | Where community photos are stored and served from at `/uploads` (default `backend/uploads`, git-ignored) |
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

Serve `frontend/dist/frontend/browser` as static files with a fallback to `index.html` for app routes, and forward `/api`, `/uploads` and `/share` to the API. Set `FRONTEND_URL` and `CORS_ORIGINS` to the public address of the web app.
