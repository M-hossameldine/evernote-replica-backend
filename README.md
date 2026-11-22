# Evernote Replica API

REST API for [Evernote Replica](../frontend). Built with Node.js, TypeScript, Express 5, MongoDB (Mongoose) and Zod.

- **Auth:** email/password and Google sign-in. Uses short-lived JWT access tokens and rotating refresh tokens in httpOnly cookies, plus password reset by email.
- **Notes:** CRUD, trash with restore and permanent delete, tags, and text search.
- **Docs:** OpenAPI 3.1, generated from the same Zod schemas that validate requests. Served at `/docs` (Swagger UI) and `/openapi.json`.
- **Quality:** a unified error envelope, structured JSON logs (pino) with request ids, rate limits on auth routes, and Vitest + Supertest tests against an in-memory MongoDB.

## Getting started

Requires Node.js 22.12+ (see `.nvmrc`) and a MongoDB Atlas cluster (the free tier is fine).

```bash
npm install
cp .env.example .env   # fill in MONGODB_URI, JWT_ACCESS_SECRET, SEED_DEMO_PASSWORD
npm run db:check       # verify the Atlas connection and create indexes
npm run db:seed        # optional: demo user + sample notes
npm run dev            # http://localhost:4000, docs at http://localhost:4000/docs
```

`MONGODB_URI` is the Atlas string exactly as Atlas gives it. The database name comes from `MONGODB_DB_NAME` (`evernote-replica-dev` locally).

| Script                        | What it does                                       |
| ----------------------------- | -------------------------------------------------- |
| `npm run dev`                 | Start with reload (tsx watch, pretty logs)         |
| `npm run db:check`            | Test the DB connection, build indexes, print stats |
| `npm run db:seed`             | Reset the demo user and sample notes (dev only)    |
| `npm run build` / `npm start` | Compile to `dist/` and run it                      |
| `npm test`                    | Run the tests (in-memory MongoDB, no Atlas needed) |
| `npm run lint` / `typecheck`  | ESLint / tsc                                       |
| `npm run format`              | Prettier                                           |

The first test run downloads a MongoDB binary for `mongodb-memory-server` (about 100 MB, cached afterwards).

## Project layout

```
src/
  app.ts                 Express app (middleware order, routes, docs)
  server.ts              Entry point: connect DB, listen, graceful shutdown
  config/env.ts          Env vars validated with Zod (the app fails fast if one is invalid)
  lib/api-router.ts      Route builder: Zod validation + OpenAPI registration in one definition
  errors/                AppError, error codes, unified error handler
  middleware/            authenticate, rate limits, request logger, origin check
  modules/
    auth/                register, login, google, refresh, logout, password reset
    users/               user model, GET/PATCH /users/me
    notes/               note model, service, routes
tests/                   Vitest + Supertest suites
```

Routes are declared once with `api.route({...})`. The same definition validates `body`, `query` and `params`, types the handler, and documents the endpoint. Docs can't drift from the code.

## API overview

Base path: `/api/v1`. Every endpoint except the auth ones requires `Authorization: Bearer <accessToken>`.

| Method | Path                    | Description                                                 |
| ------ | ----------------------- | ----------------------------------------------------------- |
| POST   | `/auth/register`        | `{ name, email, password }` → 201 `AuthResponse` + cookie   |
| POST   | `/auth/login`           | `{ email, password }` → `AuthResponse` + cookie             |
| POST   | `/auth/google`          | `{ idToken }` → `AuthResponse` + cookie                     |
| POST   | `/auth/refresh`         | Uses the cookie → new `AuthResponse`, rotates the cookie    |
| POST   | `/auth/logout`          | Revokes the session, clears the cookie → 204                |
| POST   | `/auth/forgot-password` | `{ email }` → 202 (always)                                  |
| POST   | `/auth/reset-password`  | `{ token, password }` → 204, signs out all sessions         |
| GET    | `/users/me`             | Current user                                                |
| PATCH  | `/users/me`             | `{ name }`                                                  |
| GET    | `/notes`                | `?status=active\|trash&tag=work&q=milk` (no pagination yet) |
| POST   | `/notes`                | `{ title?, text?, tags? }` → 201                            |
| GET    | `/notes/:id`            | One note                                                    |
| PATCH  | `/notes/:id`            | `{ title?, text?, tags? }` (active notes only)              |
| POST   | `/notes/:id/trash`      | Move to trash (sets `deletedAt`)                            |
| POST   | `/notes/:id/restore`    | Restore from trash                                          |
| DELETE | `/notes/:id`            | Permanently delete (trashed notes only) → 204               |
| DELETE | `/notes/trash`          | Empty the trash → `{ deletedCount }`                        |
| GET    | `/health`               | Liveness + DB status (outside `/api/v1`)                    |

### Response format

Success responses are `{ "data": ... }`, or `204 No Content` when there's nothing to return.

Errors always have this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "location": "body",
        "path": "email",
        "message": "Invalid email address"
      }
    ],
    "requestId": "2b0c5c1e-..."
  }
}
```

Branch on `code`, not on `message`. All codes are in [src/errors/error-codes.ts](src/errors/error-codes.ts). The `requestId` matches the `x-request-id` response header and the server logs.

### Note shape

```json
{
  "id": "665f...",
  "title": "Groceries",
  "text": "milk, eggs",
  "tags": ["home"],
  "status": "active",
  "createdAt": "2026-11-16T10:00:00.000Z",
  "updatedAt": "2026-11-16T10:05:00.000Z",
  "deletedAt": null
}
```

Tags are trimmed, lowercased and de-duplicated. Search is a case-insensitive substring match on title and text. For large datasets, move it to Atlas Search later.

## Authentication flow (for the frontend)

1. Call `login`, `register` or `google`. The response body holds `accessToken` (15 min) and `user`. The response also sets the `refresh_token` cookie (httpOnly, path `/api/v1/auth`, 30 days). Keep the access token **in memory only**.
2. Send `Authorization: Bearer <accessToken>` on API calls.
3. On `401` with code `TOKEN_EXPIRED`, call `POST /auth/refresh` with `credentials: 'include'`, then retry the request once. On app start, call `refresh` to restore the session (it replaces `onAuthStateChanged`).
4. Refresh tokens rotate on every refresh. If an old token is presented again, the server treats it as stolen and revokes the whole session. So **only one refresh may be in flight at a time**: use a shared promise in the base query, and `navigator.locks` / `BroadcastChannel` across tabs.
5. Every request that relies on the cookie (`refresh`, `logout`) must send `credentials: 'include'`. Its `Origin` header must be listed in `CORS_ORIGINS`.

**Google sign-in:** use Google Identity Services on the frontend. Send the returned `credential` (an ID token) to `POST /auth/google`. Accounts are matched by Google id first, then linked to an existing account with the same verified email.

**Password reset:** the email links to `${APP_URL}/auth/reset-password?token=...`. The frontend page posts `{ token, password }` to `/auth/reset-password`.

## Deploying to Railway

1. Create a Railway service from this repo. [railway.json](railway.json) sets the build, the start command and the `/health` health check.
2. Set these variables:
   - `NODE_ENV=production`
   - `TRUST_PROXY=1`
   - `MONGODB_URI`
   - `JWT_ACCESS_SECRET`: a long random value.
   - `APP_URL`: your Vercel URL.
   - `CORS_ORIGINS`: your Vercel URL(s), including any custom domain.
   - `GOOGLE_CLIENT_ID`
   - The `SMTP_*` settings and `MAIL_FROM`.
   - Railway provides `PORT` itself.
3. In MongoDB Atlas → Network Access, allow Railway's egress. Railway has no fixed IPs on most plans, so this usually means `0.0.0.0/0` combined with a strong database password.
4. In Google Cloud Console, add your Vercel URL (and `http://localhost:5173`) to the OAuth client's **Authorized JavaScript origins**.

In production the refresh cookie is `Secure; SameSite=None`, because the SPA on Vercel and the API on Railway are different sites. Some browsers block third-party cookies. If that becomes a problem, serve the API from a subdomain of the frontend's domain (e.g. `api.yourdomain.com`) and set `COOKIE_SAMESITE=lax`.

Rate limits use an in-memory store. That's correct for a single instance. If you scale to several replicas, switch to a shared store (e.g. Redis).
