# Deep Dive: `apps/worker/src/processor.ts`

**Mode:** compact · **Level:** mid · **Date:** 2026-08-10

## Overview

`Processor` is the BullMQ consumer that drives a single application through
its submission pipeline: load the student + university data from Postgres,
open a Playwright page, run a sequence of steps (open form → fill fields →
attach files → submit → log result, or a wizard variant), and reconcile the
`Application`/`ApplicationStep`/`ApplicationBatch` rows in the DB as it goes.
It's the orchestration layer — the actual browser automation lives in the
`steps/*.step.ts` files this class calls into.

The file earns its size (700 lines) not from business logic complexity but
from **failure-path bookkeeping**: a Playwright job can die in a dozen ways
(timeout, crash, redeploy, stalled lock, page error), and roughly half this
file exists to make sure the DB status always reflects reality no matter
which way it dies.

## Key Components

- `onModuleInit` — wires the BullMQ `Worker`, sets `lockDuration` to 15 min (not the 30s default) because these jobs run long; registers `stalled`/`failed` listeners.
- `process` / `withTimeout` — wraps the whole job in a manual `Promise.race` timeout (25 min default), since BullMQ has no built-in per-job timeout.
- `processApplication` — the main pipeline: fetch application → build `StudentProfile` → resolve `UniversitySchema` → run steps → mark submitted, with nested try/catch to screenshot on failure before the page closes.
- `runStep` — executes one pipeline step, closes any orphaned `processing` step rows from a prior crashed attempt first, records start/complete/fail status per step.
- `markApplicationFailedFromJob` — a *second*, independent failure handler triggered from the worker's `failed` event (not from `processApplication`'s own catch), for the case where the process itself never gets to run its catch block (stalled lock, killed pod).
- `recalculateBatchCounters` — recomputes a batch's submitted/blocked/failed counts and rolls up a `completed`/`processing` status.
- `getUniversitySchema` / `findFileSchema` / `findSchemasDirectory` — resolves university form config by merging a DB row with an on-disk JSON override, walking up parent directories to find `data/university-schemas/`.
- `toStudentProfile` — hand-written mapper from Prisma's relational student record to the flat `StudentProfile` shape the steps consume.
- `toDateOnly` (module-level function) — normalizes `Date | string | null` into `yyyy-MM-dd` for a specific university's date picker widget.

## Concepts

**BullMQ worker lifecycle & failure semantics**
*What:* A `Worker` polls a Redis-backed queue, and jobs can fail via a thrown error (goes to the `process` catch) or via a "stall" (lock expires because the process died/froze, so BullMQ marks it stalled without ever running your code).
*Why it matters here:* Because a stall never runs `processApplication`'s catch block, the code needs *two* separate failure handlers (`processApplication`'s own catch, and `markApplicationFailedFromJob` on the `worker.on('failed')` event) so the DB doesn't get stuck showing "processing" forever after a redeploy kills the pod mid-job. This is the single biggest reason the file looks more complex than "run some steps."

**Manual timeout via `Promise.race`**
*What:* `withTimeout` races the real work against a `setTimeout`-backed rejection.
*Why:* BullMQ doesn't enforce a per-job wall-clock timeout on its own (only stall detection, which is about lock renewal, not elapsed time) — so a hung Playwright page could run forever without this.

**Idempotent recovery / self-healing state**
*What:* `runStep` closes out any `ApplicationStep` still marked `processing` for the same application before starting a new one ("superseded by new attempt").
*Why:* On retry after a crash, the old row would otherwise sit in `processing` forever alongside a new row for the same step, corrupting the UI's view of what actually happened.

**Pipeline / strategy pattern via array of steps**
*What:* `steps: ApplicationPipelineStep[]` is a fixed sequence of objects with a common `execute(context)` shape; `getSteps()` swaps in a different sequence for wizard-style forms.
*Why chosen:* Keeps `processApplication` from branching on university type — new step types or reordering only touches the array, not the orchestration loop.

**Config merge with file-system override**
*What:* `getUniversitySchema` treats the on-disk JSON schema as authoritative over the DB row for whichever fields it defines, falling back to DB otherwise.
*Why:* Comment in code says the DB seed "lags / proxy dies" — this is a deliberate escape hatch so a university's form config can be hot-fixed via a JSON file without a DB migration/redeploy of the seed data.

**BullMQ `attemptsStarted` vs `attemptsMade`**
*What:* Two different retry counters BullMQ exposes — `attemptsMade` increments *after* a failure completes, `attemptsStarted` increments when a job moves to active, so they diverge depending on when you read them.
*Why it matters here:* The code needs `attemptNumber` to correctly detect "is this the last retry" (to decide whether to send a failure notification) — using the wrong counter would either double-notify or never notify on the true final attempt.

## Related Code (brief)

- `steps/*.step.ts` — the actual per-step Playwright logic this file orchestrates.
- `errors/session-expired.error.ts` — a typed error this file special-cases for a different notification.
- `@uni-apply/shared` — houses `UniversitySchema`, `StudentProfile`, `FieldConfig` types and `groupDocumentUrls`.

---
*Compact mode — 1 file. Ask for `full` mode for line-by-line walkthrough and curated resources.*
