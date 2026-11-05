# Lockstep

Real-time collaborative project management for delivery teams. Express + PostgreSQL API, Next.js frontend. See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions.

## Prerequisites

Node.js 22+, PostgreSQL 14+.

## Setup

```bash
createdb -U postgres lockstep

cd api
npm install --workspaces=false
cp .env.example .env        # set DATABASE_URL and JWT_SECRET
npm run db:migrate
npm run db:seed             # WARNING: wipes all Lockstep tables first

cd ../web
npm install --workspaces=false
cp .env.example .env.local
```

## Run

Two terminals:

```bash
cd api && npm run dev       # http://localhost:4000
```

```bash
cd web && npm run dev       # http://localhost:3000
```

## Environment variables

| File | Variable | Purpose |
|---|---|---|
| `api/.env` | `DATABASE_URL` | PostgreSQL connection string |
| `api/.env` | `JWT_SECRET` | Session signing key, 16+ characters |
| `api/.env` | `WEB_ORIGIN` | Frontend origin for CORS and sockets |
| `api/.env` | `PORT` | API port |
| `web/.env.local` | `NEXT_PUBLIC_API_URL` | API base URL |

## Sample logins

Password for all: `lockstep123`

| Role | Email |
|---|---|
| Admin | admin@lockstep.test |
| Project Manager | priya@lockstep.test |
| Team Member | dana@lockstep.test, marcus@lockstep.test, leo@lockstep.test |
| Viewer | vera@lockstep.test |

## Tests

The suite reseeds its database, so point it at a disposable one:

```bash
cd api && DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/lockstep_test npm test
```

Covers API permission rejections, 409 conflicts (including 8 simultaneous writers), socket delivery and room isolation, and mentions.

## Demo

1. Open a normal window as Priya and an incognito window as Dana, both on Atlas Migration.
2. Move a task as Priya: Dana's board and team score update with no refresh.
3. Open the same task in both windows, edit and save in one, then save in the other to get the conflict review.
4. As Dana, call `POST /api/v1/projects/:id/tasks` directly: the API returns 403.
