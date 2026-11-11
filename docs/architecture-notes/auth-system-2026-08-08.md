# Deep Dive: Authentication System (student + agency signup, sessions, dashboard gating)

**Generated**: 2026-08-08
**Files**: `apps/api/src/auth/{auth.service.ts, auth.controller.ts, password.util.ts, token.util.ts, cookie.util.ts, mail.service.ts, auth.module.ts}`, `packages/database/prisma/schema.prisma` (Account/AgencyProfile/Session), `apps/dashboard/features/auth/{components/auth-modal.tsx, api/auth.api.ts, lib/countries.ts, lib/password-policy.ts}`, `apps/dashboard/app/{verify-email/page.tsx, dashboard/layout.tsx}`

---

## Overview

This is a from-scratch auth system bolted onto a monorepo that had none: a NestJS API module for signup/login/session/email-verification, and a Next.js popup that drives it. It exists because `/dashboard` was public and there was no concept of a login identity — `Student` in the schema is applicant CRM data, not an account. The system deliberately avoids new runtime dependencies for the security-sensitive parts (password hashing, session tokens) by leaning on Node's built-in `crypto` module, and its trickiest design constraint — session cookies working identically in local dev and production — comes from exploiting a detail of how Next.js's `rewrites()` proxy forwards `Set-Cookie` headers.

---

## Key Components

- `AuthService.signup/login/verifyEmail/logout/getAccountBySessionToken` — all the business logic; controllers are thin pass-throughs.
- `AuthController` — REST endpoints (`/auth/signup|login|verify-email|logout|me`), owns cookie set/clear via Express's `res.cookie()`.
- `password.util.ts` — `hashPassword`/`verifyPassword` via `node:crypto` `scryptSync` + `timingSafeEqual`; `DUMMY_PASSWORD_HASH` for timing-safe login.
- `token.util.ts` — opaque token generation (`randomBytes`) + hashing (`sha256`), reused for both session and verification tokens.
- `cookie.util.ts` — a 15-line hand-rolled `Cookie` header parser instead of the `cookie-parser` package.
- `mail.service.ts` — calls Resend's HTTP API with plain `fetch`, no `resend` npm package; falls back to `console.log`-ing the link if unconfigured.
- `AuthModal` (dashboard) — one component, one state machine: `mode` (login/signup) × `role` (student/agency) × `step` (1/2, agency only) × `phase` (form/submitting/check-email).
- `auth.api.ts` — a *second*, dedicated axios instance, deliberately not the app's shared API client.
- `app/dashboard/layout.tsx` — server-side gate: reads the request's cookies, calls the API's `/auth/me` directly, redirects if unauthorized.

*(5 more files in scope, one line each: `token.util.ts`/`countries.ts`/`password-policy.ts` are straightforward and match their names; `verify-email/page.tsx` is a thin client wrapper that POSTs a token and redirects; the Prisma schema just adds three plain relational models with no unusual mechanics.)*

---

## Concepts & Decisions

### Scrypt instead of bcrypt/argon2

- **What**: Passwords are hashed with Node's built-in `crypto.scryptSync`, storing `"{salt}:{hash}"` as one string, rather than pulling in `bcrypt`/`argon2`.
- **Why used here**: It's cryptographically sound and it's stdlib — no new dependency for a security-critical but conceptually simple operation. The cost is that you don't get bcrypt's battle-tested tuning knobs or argon2's memory-hardness out of the box; if this app ever needs to tune hashing cost independently of Node defaults, that's the moment to reconsider.

### Timing-safe login

- **What**: `login()` always runs `verifyPassword` — against a fixed `DUMMY_PASSWORD_HASH` if no account was found — before deciding to reject, and returns the identical generic message either way ("Invalid email or password").
- **Why used here**: Without this, an unknown-email request returns instantly (skip the hash) while a known-email/wrong-password request takes the full scrypt cost — a measurable timing difference an attacker can use to enumerate registered emails.

### Opaque, DB-backed session tokens (not JWT)

- **What**: `createSession` generates a random token, stores only its SHA-256 hash in a `Session` row, and hands the raw token to the browser as an httpOnly cookie.
- **Why used here**: Revocability. A JWT can't be un-issued without a blocklist; deleting a `Session` row is an immediate, real logout/revoke. The trade-off is a DB read on every authenticated request instead of a stateless signature check — a non-issue at this scale.

### Cookies that work identically in dev and prod, via the Next.js rewrite

- **What**: The Nest API sets the session cookie with **no `Domain` attribute**. The browser only ever talks to the dashboard's own origin (`/api/...`), which Next.js's `rewrites()` proxies server-to-server to the real API — so the `Set-Cookie` header rides back through that proxy and lands scoped to the dashboard's own origin, not the API's.
- **Why used here**: It sidesteps cross-origin cookie rules (`SameSite=None`+`Secure`, CORS `credentials: true`) entirely — this was verified empirically (`curl` through the proxy, inspecting the returned `Set-Cookie`) rather than assumed, because it's the one architectural bet everything else depends on.

### A second, dedicated API client just for auth

- **What**: `auth.api.ts` creates its own `axios.create({ baseURL: "/api" })` instead of importing the app's existing shared `apiClient`.
- **Why used here**: The shared client's dev-mode config points straight at the Nest API's real port (`http://localhost:3000`), bypassing the rewrite entirely — fine for cookie-less endpoints, but it would make auth's cookie cross-origin and fragile in dev specifically. Auth needs the rewrite path unconditionally, so it gets its own client rather than changing shared behavior for every other feature.

### Atomic, single-use verification tokens

- **What**: `verifyEmail` doesn't do a plain "look up, then clear" — the actual invalidation is a `updateMany({ where: { id, verificationTokenHash } , data: {...} })` and only trusts the result if `count === 1`.
- **Why used here**: A naive look-then-clear races under a double-click or React StrictMode's intentional double-invoke — two concurrent requests could both pass the initial lookup and both "succeed". Conditioning the *update* itself on the still-matching hash means only the first of two racing requests can ever win.

### A feature flag that's a `const`, not an env var

- **What**: `REQUIRE_EMAIL_VERIFICATION = false` is a hardcoded boolean with a comment, not a Railway environment variable.
- **Why used here**: Toggling it is a one-line code change with a clear paper trail (a commit), and it avoids adding yet another piece of deploy-time configuration for something that's a temporary, code-owner-level decision (no verified email-sending domain yet) rather than a per-environment setting.

### Server Component as the access gate, not middleware

- **What**: `/dashboard`'s auth check lives in `app/dashboard/layout.tsx`, a Server Component that does a plain server-to-server `fetch` to the API — not a `middleware.ts` at the Edge.
- **Why used here**: Edge middleware runs in a restricted runtime and would need its own way to reach the API; a Server Component already runs in full Node, already has `next/headers` for the incoming cookie, and needs zero new infrastructure. The trade-off, made explicitly rather than by accident: only `/dashboard` is gated this way in this pass — `/students/*` and per-account data ownership on existing endpoints are still open, flagged as follow-up work rather than silently left broken.

---

*Generated by AntiVibe · `/antivibe full` for the extended version with resources and line-by-line walkthrough.*
