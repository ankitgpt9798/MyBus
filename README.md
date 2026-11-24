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
npm install
cp .env.example .env        # then edit .env (at least set JWT_SECRET)

# Frontend
cd ../frontend
npm install
```

### Environment (`backend/.env`)

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `4000`) |
| `MONGODB_URI` | MongoDB connection string (database `mybus`) |
| `FRONTEND_URL` | App URL used in email links (default `http://localhost:4200`) |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Signing secret and lifetime for login tokens |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Admin account created by the seed script |
| `SMTP_*`, `MAIL_FROM` | Outgoing email. Leave `SMTP_HOST` empty to print emails and verification links in the backend console instead |
| `SEAT_HOLD_MINUTES` | How long selected seats are held while paying |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push keys. Leave empty to generate a pair on first start (saved to the git-ignored `backend/.vapid-keys.json`) |
| `NOTIFY_RETRY_DELAYS_MS`, `NOTIFY_RETRY_INTERVAL_MS`, `NOTIFY_STREAM_HEARTBEAT_MS` | Tests only: shorten the email/push retry backoff (default 1, 5, 15 min), the retry check (30 s) and the live-stream heartbeat (15 s) |
| `REMINDER_LEADS_MS`, `REMINDER_INTERVAL_MS` | Tests only: shorten the journey reminder lead times (default 24 h and 2 h before departure) and how often they are checked (1 min) |

## Seed the database

```bash
cd backend
npm run seed
```

This resets the catalogue, bookings and reviews in the `mybus` database, then creates or updates these accounts:

| Account | Email | Password |
| --- | --- | --- |
| Admin | `ADMIN_EMAIL` from `.env` (default `admin@mybus.local`) | `ADMIN_PASSWORD` (default `Admin@12345`) |
| Verified traveller | `traveler@mybus.local` | `Traveler@123` |
| Unverified traveller | `unverified@mybus.local` | `Traveler@123` |
| Demo reviewers (sample route reviews) | `priya.reviews@mybus.local`, `rahul.reviews@…`, `sneha.reviews@…`, `ananya.reviews@…`, `kiran.reviews@…`, `vikram.reviews@…`, `meena.reviews@…` | `Traveler@123` |

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

The Angular dev server forwards `/api` requests to the backend (`frontend/proxy.conf.json`). To check that both are up, open `http://localhost:4200/api/health`.

## Production build

```bash
cd backend && npm run build && npm start   # compiles to backend/dist
cd frontend && npm run build               # outputs to frontend/dist/frontend
```
