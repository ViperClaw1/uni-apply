# LotsApply — Technical Reference

Detailed reference: database schema, API routes and contracts, legacy Playwright worker. For the overview see the [README](../README.md).

## Monorepo structure

| Package / app | Path | Purpose |
|---|---|---|
| API | `apps/api` | NestJS REST + WebSocket |
| Dashboard | `apps/dashboard` | Next.js UI for agency and students |
| Extension | `apps/extension` | Chrome Extension for semi-automatic submission |
| Worker | `apps/worker` | Playwright worker (legacy, see below) |
| Database | `packages/database` | Prisma schema and client |
| Shared | `packages/shared` | Shared types (`StudentProfile`, `UniversitySchema`, queues) |

**Stack:** pnpm + Turbo, PostgreSQL (Prisma 7), Redis (BullMQ), Playwright.

---

## 1. Database schema

**Source of truth:** `packages/database/prisma/schema.prisma`  
**Migrations:** `packages/database/prisma/migrations/`  
**Client:** `@uni-apply/database` — used in `apps/api` and `apps/worker`.

### Enum

| Value | Description |
|---|---|
| `AccountRole.student` | Student |
| `AccountRole.agency` | Agency |

### Models (19 tables)

#### Authentication

| Model | Key fields | Relations |
|---|---|---|
| `Account` | `email`, `passwordHash`, `role`, `emailVerifiedAt`, `verificationToken*` | 1:1 → `AgencyProfile`, `Student`; 1:N → `Session` |
| `AgencyProfile` | `legalName`, `country`, `taxId` | N:1 → `Account` (unique `accountId`) |
| `Session` | `tokenHash`, `expiresAt` | N:1 → `Account` |

#### Student profile

| Model | Key fields | Relations |
|---|---|---|
| `Student` | `surname`, `givenName`, `email`, `passportNo`, `nationality`, `onboardingStep`, `accountId?` | N:1 → `Account`; 1:N → `Education`, `WorkExperience`, `LanguageSkill`, `FamilyMember`, `StudentDocument`, `ApplicationTarget`, `ApplicationBatch`; 1:1 → `Guarantor`, `EmergencyContact` |
| `Education` | `level` (`school` \| `higher`), `degree`, `institution`, `major`, `periodStart/End` | N:1 → `Student` |
| `WorkExperience` | `company`, `position`, `periodStart/End` | N:1 → `Student` |
| `LanguageSkill` | `language`, `certificate`, `level`, `score` | N:1 → `Student` |
| `FamilyMember` | `fullName`, `relationship`, `phone`, `email` | N:1 → `Student` |
| `Guarantor` | `name`, `relationship`, `homeAddress`, `phone` | 1:1 → `Student` |
| `EmergencyContact` | `name`, `relationship`, `phone`, `email` | 1:1 → `Student` |
| `StudentDocument` | `type`, `fileUrl`, `parsedData`, `parseStatus`, `sortOrder` | N:1 → `Student` |

#### Universities and form schemas

| Model | Key fields | Relations |
|---|---|---|
| `UniversitySchema` | `id` (slug), `displayName`, `formUrl`, `fields` (JSON), `requiredDocuments` (JSON), `requiresEssay` | Logical references from other tables |
| `UniversityAlias` | `alias` (PK), `universityId` | Logical reference to `UniversitySchema.id` |
| `BrowserSession` | `universityId`, `status` (`unknown`/`fresh`/`stale`/`expired`), `consecutiveFailures` | Logical reference to `UniversitySchema.id` |
| `ApplicationTarget` | `universityRaw`, `universityId?`, `degree`, `major` | N:1 → `Student` |

University JSON schemas are also stored as files: `data/university-schemas/*.json`.

#### Applications

| Model | Key fields | Relations |
|---|---|---|
| `ApplicationBatch` | `status`, `total`, `submitted`, `blocked`, `failed` | N:1 → `Student`; 1:N → `Application` |
| `Application` | `universityId`, `status`, `motivationLetterId?`, `screenshotBefore/After`, `errorMessage` | N:1 → `ApplicationBatch`; 1:N → `ApplicationStep` |
| `ApplicationStep` | `stepName`, `status`, `errorMessage`, `startedAt`, `completedAt` | N:1 → `Application` |
| `GeneratedDocument` | `studentId`, `universityId`, `type`, `content`, `approvedByConsultant` | No FK (logical references) |

### Relationship diagram

```
Account ──< Session
   │
   ├──(1:1)── AgencyProfile
   │
   └──(1:1?)── Student ──< Education, WorkExperience, LanguageSkill,
                            FamilyMember, StudentDocument, ApplicationTarget,
                            ApplicationBatch ──< Application ──< ApplicationStep
                    │
                    ├──(1:1)── Guarantor
                    └──(1:1)── EmergencyContact

UniversitySchema.id ←──?── UniversityAlias, BrowserSession,
                         ApplicationTarget, Application, GeneratedDocument
```

**Legend:** `──<` — one-to-many FK; `(1:1)` — unique FK; `?` — logical reference without a PostgreSQL FK.

### Notes

- `universityId`, `motivationLetterId`, `GeneratedDocument.studentId` — integrity is enforced in application code, not in the DB.
- `UniversityAlias` and `BrowserSession` intentionally have no FK to `UniversitySchema` — a schema may exist only as a JSON file.
- Redis (`REDIS_URL`) is used for BullMQ queues and is not part of the DB schema.

---

## 2. API: routes and contracts

**Server:** NestJS in `apps/api` (port 3000 by default).  
**Dashboard** proxies `/api/*` → Nest via `apps/dashboard/next.config.ts`.  
**Worker** exposes no HTTP — BullMQ consumer only.

### Authentication

| Mechanism | Where | Description |
|---|---|---|
| Session cookie | `session` (httpOnly, 30 days) | `SessionAuthGuard` — signup/login/verify-email; `/students/me*` endpoints |
| `X-API-Key` | Header | `ApiKeyGuard` — extension endpoints (`EXTENSION_API_KEY`) |
| WS ticket | Single-use, 60 s TTL | `POST /universities/relogin-viewer-ticket` → `WS /ws/relogin-viewer?ticket=...` |

Most agency-facing CRUD endpoints (students, documents, applications) are **not protected** by guards — only the extension routes and `/students/me*` are.

### Auth

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/auth/signup` | — | `{ email, password, confirmPassword, role?, agency? }` | `{ account }` + Set-Cookie |
| POST | `/auth/login` | — | `{ email, password }` | `{ account }` + Set-Cookie |
| POST | `/auth/verify-email` | — | `{ token }` | `{ account }` + Set-Cookie |
| POST | `/auth/logout` | Cookie | — | `{ ok: true }` |
| GET | `/auth/me` | Cookie | — | `{ account: PublicAccount }` |

### Students

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/students/me` | Session | Current student's profile |
| PUT | `/students/me` | Session | Personal data |
| PUT | `/students/me/education` | Session | Education |
| PUT | `/students/me/guarantor` | Session | Guarantor |
| PUT | `/students/me/emergency-contact` | Session | Emergency contact |
| PUT | `/students/me/family` | Session | Family |
| GET | `/students` | — | List students (agency) |
| POST | `/students` | — | Create student → `{ id }` |
| GET | `/students/:id` | — | Student by ID |
| DELETE | `/students/:id` | — | Delete (204) |
| GET | `/students/:id/profile` | — | Full `StudentProfile` |
| PUT | `/students/:id/profile` | — | Update profile |
| PUT | `/students/:id/education` | — | Education |
| PUT | `/students/:id/guarantor` | — | Guarantor |
| PUT | `/students/:id/emergency-contact` | — | Emergency contact |
| PUT | `/students/:id/family` | — | Family |
| PUT | `/students/:id/application-targets` | — | `{ formUrls?: string[] }` |
| POST | `/students/:id/application-targets/resolve` | — | `{ universityRaw, universityId }` |

**Type:** `StudentProfile` — `packages/shared/src/student.types.ts`

### Applications

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/applications/batches` | — | Create batch → `{ studentId }` |
| GET | `/applications` | — | All applications (agency) |
| POST | `/students/:studentId/applications/batches` | — | Batch for a student |
| GET | `/students/:studentId/applications/batches` | — | Student's batches |
| GET | `/students/:studentId/applications/readiness` | — | Submission readiness |
| GET | `/applications/batches/:id` | — | Batch by ID |
| GET | `/applications/active` | **ApiKey** | Active application for the extension (query: `url`, `studentId`) |
| GET | `/applications/:id` | — | Application by ID |
| PATCH | `/applications/:id/ready` | — | Mark ready |
| POST | `/applications/:id/submit` | **ApiKey** | Submit (extension) |
| POST | `/applications/:id/consultant-submit` | — | Submit (dashboard) |
| PATCH | `/applications/:id` | — | Update status/metadata |
| POST | `/applications/:id/steps` | — | Add a step |

**Application statuses** (`ApplicationStatus`):

```
queued | ready_for_submission | blocked | submitted | failed
       | waiting_for_login    | attention_required
```

**Key types** — `apps/api/src/applications/types/application-api.types.ts`:

```ts
// Active application for the extension
ActiveApplicationResponse = {
  applicationId, studentId,
  university: { id, displayName, formUrl },
  profile: StudentProfile,
  schema: UniversitySchema,
  motivationLetter?: string
}

// Worker job payload
ApplicationProcessJobData = {
  applicationId, batchId, studentId, universityId
}
```

### Documents

| Method | Path | Description |
|---|---|---|
| GET | `/students/:studentId/documents` | List documents |
| POST | `/students/:studentId/documents` | Create (by URL) |
| POST | `/students/:studentId/documents/upload` | Multipart upload (`file`, `type`) |
| GET | `/documents/:id` | Document by ID |
| PATCH | `/documents/:id` | Update |
| POST | `/documents/:id/parse` | Start parsing |
| PATCH | `/students/:studentId/documents/reorder` | `{ type, orderedIds[] }` |
| DELETE | `/documents/:id` | Delete |

**Parse status:** `pending | processing | parsed | uploaded | failed`

### Letters

| Method | Path | Description |
|---|---|---|
| POST | `/letters/generate` | AI generation `{ studentId, universityId, type?, prompt? }` |
| GET | `/letters/students/:studentId` | Student's letters |
| GET | `/letters/universities/:universityId` | University's letters |
| GET | `/letters/:id` | By ID |
| PATCH | `/letters/:id` | Edit |
| POST | `/letters/:id/approve` | Approve |
| POST | `/letters/:id/unapprove` | Unapprove |
| DELETE | `/letters/:id` | Delete |

### Universities

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/universities` | — | List universities |
| GET | `/universities/resolve` | — | Fuzzy match (query: `name`) |
| GET | `/universities/by-form-url` | — | Resolve by form URL |
| GET | `/universities/sessions` | — | Browser session statuses |
| GET | `/universities/relogin-status/:jobId` | — | Relogin job status |
| POST | `/universities/aliases` | — | Create alias |
| POST | `/universities/schemas/seed` | — | Seed schemas from files |
| POST | `/universities/schemas/generate-draft` | — | AI schema draft |
| GET | `/universities/:id` | — | University details |
| GET | `/universities/:id/aliases` | — | University aliases |
| PATCH | `/universities/:id/relogin` | — | Start relogin |
| POST | `/universities/relogin-viewer-ticket` | Session | Ticket for the VNC viewer |

### Webhook

| Method | Path | Description |
|---|---|---|
| POST | `/webhook/google-form` | Receives a Google Form submission → creates a student |

### WebSocket

| Path | Auth | Description |
|---|---|---|
| `WS /ws/relogin-viewer?ticket={ticket}` | Ticket + Origin check | Proxies worker VNC → browser for manual relogin |

### Type and client files

| File | Purpose |
|---|---|
| `apps/api/src/applications/types/application-api.types.ts` | Application contracts |
| `apps/api/src/documents/types/document-api.types.ts` | Document contracts |
| `apps/api/src/letters/types/letter-api.types.ts` | Letter contracts |
| `apps/api/src/universities/types/university-api.types.ts` | University contracts |
| `packages/shared/src/student.types.ts` | `StudentProfile` |
| `packages/shared/src/university.types.ts` | `UniversitySchema` |
| `apps/dashboard/lib/api-client.ts` | Axios → Nest API |
| `apps/extension/src/shared/api.ts` | Extension client + `X-API-Key` |

---

## 3. Playwright worker: autofill and submit

> **Status:** the worker is **deprecated for production** (ADR-004). The production flow uses the Chrome Extension (`apps/extension`) — a consultant confirms the submit manually. The worker remains for local recon and legacy tests.

### Architecture

```
API (applications.service)
  → BullMQ "application.process" (Redis)
    → Processor (apps/worker/src/processor.ts)
      → BrowserService.withPage() — Playwright Chromium + session
      → Pipeline steps
      → Prisma (application, applicationStep, batch counters)
      → Telegram notifications
```

**Three BullMQ consumers:**

| Queue | Class | Purpose |
|---|---|---|
| `application.process` | `Processor` | Main pipeline: open → fill → attach → submit |
| `browser.relogin` | `ReloginProcessor` | Headed re-login + resume paused applications |
| `session.health-check` | `SessionHealthCheckProcessor` | Periodic session checks |

### Pipeline

**Simple form (no wizard):**

```
open_form → fill_fields → attach_files → submit_form → log_result
```

**Wizard form (17gz, PKU, etc.):**

```
open_form → fill_wizard → log_result
```

(fill + attach + submit happen inside `fill_wizard`)

### Flow: autofill

#### 1. Enqueueing

1. The API creates a batch with applications in `ready_for_submission` status
2. `applications.service.ts` → `queueService.addJob(QUEUES.APPLICATION_PROCESS, payload)`
3. Default: **2 attempts**, fixed backoff **30 s**

#### 2. Processor

1. `Processor.onModuleInit()` — Worker on `application.process`, `concurrency: 1`
2. Job timeout: **25 min** (`APPLICATION_JOB_TIMEOUT_MS`)
3. Loads the student profile + university schema from the DB
4. `browserService.withPage(universityId, handler)` — one Playwright page per job

#### 3. Step `open_form`

`OpenFormStep`:
1. `NavigationRegistry.resolve(formUrl)` → university-specific navigator
2. `navigator.navigate()` — navigates to the form (pre-wizard, program selection)
3. `assertSessionValid()` — on login/CAPTCHA/CSRF:
   - `SessionExpiredError` → `waiting_for_login`
   - `AttentionRequiredError` → `attention_required`

#### 4. Step `fill_fields` (simple form)

`FillFieldsStep` → `FormFiller.fillFields()` → `fillFieldBatch()`:

For each `FieldConfig` in the university schema:

1. **Value:** `FieldMapper.getValue(profile, field, motivationLetter)` — `mapsTo` path in the profile
2. **Locator:** `resolveFieldLocator(page, field)` — CSS selector → fallback `getByLabel`/`getByPlaceholder` → in `hybrid` mode: `SemanticFieldMapper` (Gemini)
3. **Filling** by field type:
   - `text/textarea/essay/number` → `fillTextControl()` (Playwright fill + jQuery trigger)
   - `select` → `fillSelectControl()` + valueMap
   - `radio` → `fillRadioControl()` (grouped by name, Yes/No aliases)
   - `checkbox` → check/click
   - `file` → skipped (separate step)
4. **Overlays:** dismiss dialogs, close date pickers (My97/WdatePicker, EasyUI)
5. **AJAX wait:** `wizardNavigator.waitForProcessingDone()`

#### 5. Step `attach_files`

`AttachFilesStep` → `FileAttacher.attachFiles()`:
- Downloads the student's documents, `setInputFiles()` on file inputs
- OCR passport upload for some portals

#### 6. Step `fill_wizard` (wizard universities)

`FillWizardStep` → `FormFiller.processWizard()`:

**Deterministic path:**
1. `detectCurrentWizardStep()` — resume from the current step on retry
2. `WizardNavigator.forEachStep()` — loop over steps:
   - `WizardFieldGroups.fieldsForStep()` → `fillFieldBatch()`
   - University-specific gap fillers (PKU steps 1–5)
   - `FileAttacher` for file fields
   - `WizardNavigator.clickNext()` — DOM signature diff
3. `WizardNavigator.clickSubmit()` — final submit

**Agent path** (`fillMode === 'agent'`):
- `FormAgent.runWizard()` — per step: `PageObserver` → `AgentPlanner` (Gemini) → `ActionExecutor`

**Agent fallback** (deterministic failure):
- If `AGENT_FALLBACK=1` or `university.agent.fallbackEnabled`
- Resumes from `detectCurrentWizardStep()`

### Flow: submit

#### Simple form — `submit_form`

`SubmitFormStep` → `FormFiller.submit()`:
- Looks for `button[type='submit']`, `input[type='submit']`, `button:has-text("Submit")`
- Click + `waitForLoadState('networkidle')`

#### Wizard — inside `fill_wizard`

`WizardNavigator.clickSubmit()`:
1. `waitForProcessingDone()` + dismiss dialogs
2. `resolveSubmitButton()` — schema selector or heuristics
3. Click → `confirmSubmitDialog()` ("Are you sure?")
4. `waitForFunction()` — success markers in body / DOM signature change

#### After submit

1. `log_result` — "after" screenshot → R2
2. `application.status → submitted`, `submittedAt`
3. `recalculateBatchCounters()` — batch → `completed` once all are submitted/blocked/failed
4. `notificationsService.notifySubmitted()`

### Autofill modes

| Mode | Env | Description |
|---|---|---|
| `schema` | `FORM_FILL_MODE=schema` | CSS selectors from the university schema + `FieldMapper` |
| `hybrid` | `FORM_FILL_MODE=hybrid` | Schema first, semantic fallback via Gemini |
| `agent` | `FORM_FILL_MODE=agent` | Gemini loop: observe → plan → act |

### Error handling and retry

| Level | Mechanism | Behavior |
|---|---|---|
| BullMQ job | `attempts: 2`, 30 s backoff | Rethrow → retry; on the final attempt → `notifyFailed()` |
| Step level | `runStep()` | Orphaned `processing` steps → `failed`; new step record |
| Wizard resume | `detectCurrentWizardStep()` | Retry continues from the current step |
| Agent fallback | `AGENT_FALLBACK=1` | Deterministic failure → FormAgent takeover |
| Session pause | No rethrow | `SessionExpiredError` / `AttentionRequiredError` → pause, **no** BullMQ retry |

**Resume after re-login:** `ApplicationResumeService.resumePausedApplications(universityId)` — finds `waiting_for_login` / `attention_required` applications and re-enqueues them into `application.process`. Triggered by `ReloginProcessor` and `SessionHealthCheckProcessor`.

### Key files

| File | Role |
|---|---|
| `apps/worker/src/processor.ts` | BullMQ consumer, pipeline orchestration |
| `apps/worker/src/browser/browser.service.ts` | `withPage()` — Chromium, storageState, profiles |
| `apps/worker/src/filler/form.filler.ts` | Autofill/submit core |
| `apps/worker/src/filler/field.mapper.ts` | Profile → field value |
| `apps/worker/src/filler/field.locator.ts` | Selector/label → Locator |
| `apps/worker/src/filler/wizard.navigator.ts` | `forEachStep`, `clickNext`, `clickSubmit` |
| `apps/worker/src/filler/file.attacher.ts` | Document upload |
| `apps/worker/src/agent/form.agent.ts` | Gemini agent loop |
| `apps/worker/src/queue/application-resume.service.ts` | Re-enqueue paused applications |
| `apps/api/src/queue/queue.service.ts` | Job producer (attempts/backoff) |
| `apps/api/src/applications/applications.service.ts` | Enqueue on batch create |

### Env variables (worker)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL |
| `REDIS_URL` | — | BullMQ |
| `BROWSER_HEADED` | `0` | Headed mode |
| `BROWSER_PROFILES_DIR` | — | Persistent profiles per university |
| `FORM_FILL_MODE` | per schema | `schema` / `hybrid` / `agent` |
| `GEMINI_API_KEY` | — | Agent + semantic mapper |
| `AGENT_FALLBACK` | per schema | Deterministic → agent fallback |
| `AGENT_MAX_STEPS` | `40` | Max agent iterations |
| `BULLMQ_LOCK_DURATION_MS` | `900000` | Lock for long jobs (15 min) |
| `APPLICATION_JOB_TIMEOUT_MS` | `1500000` | Hard timeout (25 min) |
| `R2_*` | — | Cloudflare R2 screenshots |
| `TELEGRAM_BOT_TOKEN` | — | Notifications |

Full list: `apps/worker/.env.example`

---

## Development setup

```bash
pnpm install
pnpm run build

# API
cd apps/api && pnpm run start:dev

# Dashboard
cd apps/dashboard && pnpm run dev

# Worker (legacy)
cd apps/worker && pnpm run start:dev
```

## Further documentation

| Document | Path |
|---|---|
| Worker spec | `specs/Worker Spec.md` |
| University schema onboarding | `specs/University Schema Onboarding Spec.md` |
| ADR-004 (extension vs worker) | `../adr/` |
| Per-app README | `apps/{api,dashboard,extension,worker}/README.md` |
