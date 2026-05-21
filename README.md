# AiKlao — Real-Time Group Trip-Tracking Platform

AiKlao is a real-time location-tracking platform that helps groups travelling together stay
aware of one another. It runs in production across three clients — a **LINE chat bot**, a
**LIFF web app** with a live map, and a **React Native mobile app** — on a shared
**Node.js / Express + PostgreSQL** backend, deployed on a self-managed Linux server.

> Built and operated end to end by a solo developer: API design, authentication, database,
> Linux infrastructure, TLS, process management, CI/CD, and production debugging.

---

## Features

- **Real-time group location tracking** with a live map for everyone on a trip
- **Three clients, one backend** — a LINE chat bot, a LIFF web app, and a React Native mobile app
- **Trip lifecycle** — create and name a trip, set a destination, live ETA, arrival detection
- **Safety alerts** — stale-location, arrival, inactivity, and SOS checks run on a schedule
- **Public share links** — privacy-controlled, read-only "watch" view for people outside the trip
- **Multi-client authentication** — LINE access-token verification for the web app; OAuth 2.0 +
  PKCE with stateless JWT sessions for the mobile app
- **Production-grade API hardening** — security headers, per-IP rate limiting, webhook
  signature verification, structured JSON logging with per-request trace IDs
- **CI/CD pipeline** with an automated test suite gating every release

---

## Architecture

A single nginx reverse proxy fronts the platform over HTTPS and routes requests to two
Node.js services that share one PostgreSQL database. A scheduled job runs periodic safety
checks.

```
   LINE platform ─┐
   Web browser  ──┼──▶  nginx  (HTTPS / TLS, reverse proxy)
   Mobile app   ─┘            │
                              │  /api/mobile/*          everything else
                       ┌──────▼───────┐          ┌───────▼────────────────┐
                       │ Mobile API   │          │ Core backend           │
                       │ service      │          │ LINE webhook, LIFF API,│
                       │ (auth, OAuth │          │ share view, scheduler  │
                       │  callback)   │          │                        │
                       └──────┬───────┘          └───────────┬────────────┘
                              └────────────┬─────────────────┘
                                    ┌──────▼──────┐
                                    │ PostgreSQL  │
                                    └─────────────┘
```

- The **core backend** handles the LINE webhook, the LIFF REST API, the public share view, and
  the scheduled safety jobs.
- The **mobile API service** is a separate service dedicated to the mobile app's
  authentication and (in progress) trip endpoints, isolating mobile changes from the bot.
- Both services are managed by **PM2** and run behind **nginx** with **Let's Encrypt** TLS.

---

## Tech Stack

| Area | Technology |
|------|------------|
| Runtime | Node.js, Express |
| Database | PostgreSQL (file-based SQL migrations) |
| Web client | LIFF (LINE Front-end Framework), Leaflet.js |
| Mobile client | React Native, Expo, TypeScript |
| Messaging & auth | LINE Messaging API, LINE Login, OAuth 2.0 + PKCE, JWT |
| Infrastructure | Linux (Ubuntu), nginx, PM2, Let's Encrypt TLS |
| CI/CD | GitHub Actions (SSH-based deploy) |
| Testing | Jest |
| Observability | pino structured logging, per-request trace IDs |

---

## Repositories

The platform spans several repositories:

| Repository | Role |
|------------|------|
| `demo_app_ai_klao_be` | Core backend — LINE webhook, LIFF API, share view, scheduler |
| `demo_app_ai_klao_mb` | Mobile API service — authentication and OAuth callback |
| `demo_app_ai_klao_fe` | Front-end service |
| `aiklao-mobile` | React Native (Expo) mobile app |

---

## API Overview

All HTTP endpoints are served behind nginx over HTTPS.

| Group | Path prefix | Auth | Purpose |
|-------|-------------|------|---------|
| Health | `/healthz` | None | Liveness check (verifies DB connectivity) |
| Webhook | `/webhook` | LINE signature | Receives LINE Messaging API events |
| LIFF API | `/api/*` | LIFF access token | Trip, member, location, and geocoding endpoints for the web app |
| Mobile API | `/api/mobile/*` | JWT (Bearer) | Mobile authentication and trip endpoints |
| Share view | `/share/:token`, `/watch/:token` | Share token | Public, privacy-filtered read-only trip view |

---

## Authentication

AiKlao authenticates two kinds of client differently:

- **Web app (LIFF):** the LIFF client obtains a LINE access token; the backend verifies it on
  every protected `/api/*` request.
- **Mobile app:** an OAuth 2.0 Authorization Code flow with **PKCE**. After LINE login, the
  backend verifies the LINE `id_token`, upserts the user, and issues a **stateless JWT**
  (HS256, scoped issuer/audience claims). The app sends it as `Authorization: Bearer <token>`.

Because LINE rejects custom URI schemes as OAuth redirect URIs, the mobile flow uses an
HTTPS callback endpoint on the backend that bridges the OAuth redirect to the app's custom
`aiklao://` scheme.

---

## Getting Started (Local Development)

### Prerequisites

- Node.js 22+
- PostgreSQL
- A LINE Developers account with a Messaging API channel and a LINE Login channel
- For the mobile app: Expo tooling and a development build

### Setup

```bash
# Core backend
git clone <core-backend-repo-url>
cd demo_app_ai_klao_be
npm install
cp .env.example .env      # then fill in the values (see below)
npm start                 # runs SQL migrations on startup, then listens
```

The mobile API service follows the same steps in its own repository. The mobile app is run
with Expo (`npm start`) against a development build.

### Environment Variables

Each service uses its own `.env` file. **Never commit `.env`.** The variable *names* are:

```
# Core backend
CHANNEL_SECRET            # LINE Messaging API
CHANNEL_ACCESS_TOKEN
LIFF_ID                   # LINE Login / LIFF channel
LINE_LOGIN_CHANNEL_ID
DATABASE_URL              # PostgreSQL connection string
PORT
NODE_ENV
LOG_LEVEL
TIMEZONE
SCHEDULER_TICK            # cron expression for the safety scheduler
MONTHLY_PUSH_LIMIT

# Mobile API service
PORT
DATABASE_URL
MOBILE_LINE_CHANNEL_ID    # LINE Login channel used by the mobile app
MOBILE_JWT_SECRET         # signing secret for app JWTs
```

---

## Deployment

The platform runs on a self-managed Linux (Ubuntu) VPS:

- **nginx** terminates TLS (Let's Encrypt) and reverse-proxies to the Node.js services.
- **PM2** supervises the services and restarts them on failure or reboot.
- **GitHub Actions** runs the test suite on each release, then deploys over SSH — the
  deploy step pulls the latest code, installs dependencies, and reloads the PM2 process.

---

## Testing

The core backend has an automated **Jest** test suite (138 tests) covering route handlers,
safety logic, and service modules. The CI pipeline runs the full suite on every release and
blocks deployment if any test fails.

```bash
npm test
```

---

## Project Status

- **Core backend, LIFF web app, share view, and CI/CD** — stable in production.
- **React Native mobile app** — in active development; LINE Login authentication is complete
  and verified end to end, with foreground location tracking and the live map next.

---

## Notes

`AiKlao` is a Thai phonetic name; the platform does not use AI/ML. It is a personal project,
designed and operated by a single developer as a hands-on exercise in full-lifecycle backend
engineering — from API design through to production operations.
