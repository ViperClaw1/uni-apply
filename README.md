# LotsApply

LotsApply — end-to-end university application automation platform for international students applying to world-wide universities. Students submit their data and documents via Google Form. The system parses uploaded documents (passport, transcripts, etc.) using Gemini OCR, stores structured profiles, and auto-generates motivation letters.

Монорепо для автоматизации подачи заявок в китайские университеты. Агентство собирает профиль студента, документы и мотивационные письма, затем подаёт заявки через порталы вузов.

## Структура монорепо

| Пакет / приложение | Путь | Назначение |
|---|---|---|
| API | `apps/api` | NestJS REST + WebSocket |
| Dashboard | `apps/dashboard` | Next.js UI для агентства и студентов |
| Extension | `apps/extension` | Chrome Extension для полуавтоматической подачи |
| Worker | `apps/worker` | Playwright worker (legacy, см. ниже) |
| Database | `packages/database` | Prisma-схема и клиент |
| Shared | `packages/shared` | Общие типы (`StudentProfile`, `UniversitySchema`, очереди) |

**Стек:** pnpm + Turbo, PostgreSQL (Prisma 7), Redis (BullMQ), Playwright.

---

## 1. Схема базы данных

**Источник истины:** `packages/database/prisma/schema.prisma`  
**Миграции:** `packages/database/prisma/migrations/`  
**Клиент:** `@uni-apply/database` — используется в `apps/api` и `apps/worker`.

### Enum

| Значение | Описание |
|---|---|
| `AccountRole.student` | Студент |
| `AccountRole.agency` | Агентство |

### Модели (19 таблиц)

#### Аутентификация

| Модель | Ключевые поля | Связи |
|---|---|---|
| `Account` | `email`, `passwordHash`, `role`, `emailVerifiedAt`, `verificationToken*` | 1:1 → `AgencyProfile`, `Student`; 1:N → `Session` |
| `AgencyProfile` | `legalName`, `country`, `taxId` | N:1 → `Account` (unique `accountId`) |
| `Session` | `tokenHash`, `expiresAt` | N:1 → `Account` |

#### Профиль студента

| Модель | Ключевые поля | Связи |
|---|---|---|
| `Student` | `surname`, `givenName`, `email`, `passportNo`, `nationality`, `onboardingStep`, `accountId?` | N:1 → `Account`; 1:N → `Education`, `WorkExperience`, `LanguageSkill`, `FamilyMember`, `StudentDocument`, `ApplicationTarget`, `ApplicationBatch`; 1:1 → `Guarantor`, `EmergencyContact` |
| `Education` | `level` (`school` \| `higher`), `degree`, `institution`, `major`, `periodStart/End` | N:1 → `Student` |
| `WorkExperience` | `company`, `position`, `periodStart/End` | N:1 → `Student` |
| `LanguageSkill` | `language`, `certificate`, `level`, `score` | N:1 → `Student` |
| `FamilyMember` | `fullName`, `relationship`, `phone`, `email` | N:1 → `Student` |
| `Guarantor` | `name`, `relationship`, `homeAddress`, `phone` | 1:1 → `Student` |
| `EmergencyContact` | `name`, `relationship`, `phone`, `email` | 1:1 → `Student` |
| `StudentDocument` | `type`, `fileUrl`, `parsedData`, `parseStatus`, `sortOrder` | N:1 → `Student` |

#### Университеты и схемы форм

| Модель | Ключевые поля | Связи |
|---|---|---|
| `UniversitySchema` | `id` (slug), `displayName`, `formUrl`, `fields` (JSON), `requiredDocuments` (JSON), `requiresEssay` | Логические ссылки из других таблиц |
| `UniversityAlias` | `alias` (PK), `universityId` | Логическая ссылка на `UniversitySchema.id` |
| `BrowserSession` | `universityId`, `status` (`unknown`/`fresh`/`stale`/`expired`), `consecutiveFailures` | Логическая ссылка на `UniversitySchema.id` |
| `ApplicationTarget` | `universityRaw`, `universityId?`, `degree`, `major` | N:1 → `Student` |

JSON-схемы вузов также хранятся в файлах: `data/university-schemas/*.json`.

#### Заявки

| Модель | Ключевые поля | Связи |
|---|---|---|
| `ApplicationBatch` | `status`, `total`, `submitted`, `blocked`, `failed` | N:1 → `Student`; 1:N → `Application` |
| `Application` | `universityId`, `status`, `motivationLetterId?`, `screenshotBefore/After`, `errorMessage` | N:1 → `ApplicationBatch`; 1:N → `ApplicationStep` |
| `ApplicationStep` | `stepName`, `status`, `errorMessage`, `startedAt`, `completedAt` | N:1 → `Application` |
| `GeneratedDocument` | `studentId`, `universityId`, `type`, `content`, `approvedByConsultant` | Без FK (логические ссылки) |

### Диаграмма связей

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

**Легенда:** `──<` — FK one-to-many; `(1:1)` — unique FK; `?` — логическая ссылка без FK в PostgreSQL.

### Важные замечания

- `universityId`, `motivationLetterId`, `GeneratedDocument.studentId` — целостность на уровне приложения, не enforced в БД.
- `UniversityAlias` и `BrowserSession` намеренно без FK на `UniversitySchema` — схема может существовать только в JSON-файлах.
- Redis (`REDIS_URL`) используется для BullMQ-очередей, не является частью схемы БД.

---

## 2. API: роуты и контракты

**Сервер:** NestJS в `apps/api` (порт 3000 по умолчанию).  
**Dashboard** проксирует `/api/*` → Nest через `apps/dashboard/next.config.ts`.  
**Worker** HTTP не экспонирует — только BullMQ consumer.

### Аутентификация

| Механизм | Где | Описание |
|---|---|---|
| Session cookie | `session` (httpOnly, 30 дней) | `SessionAuthGuard` — signup/login/verify-email; эндпоинты `/students/me*` |
| `X-API-Key` | Header | `ApiKeyGuard` — extension-эндпоинты (`EXTENSION_API_KEY`) |
| WS ticket | Одноразовый, TTL 60 сек | `POST /universities/relogin-viewer-ticket` → `WS /ws/relogin-viewer?ticket=...` |

Большинство agency-facing CRUD (students, documents, applications) **не защищены** guards — только extension-маршруты и `/students/me*`.

### Auth

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/auth/signup` | — | `{ email, password, confirmPassword, role?, agency? }` | `{ account }` + Set-Cookie |
| POST | `/auth/login` | — | `{ email, password }` | `{ account }` + Set-Cookie |
| POST | `/auth/verify-email` | — | `{ token }` | `{ account }` + Set-Cookie |
| POST | `/auth/logout` | Cookie | — | `{ ok: true }` |
| GET | `/auth/me` | Cookie | — | `{ account: PublicAccount }` |

### Students

| Method | Path | Auth | Описание |
|---|---|---|---|
| GET | `/students/me` | Session | Профиль текущего студента |
| PUT | `/students/me` | Session | Личные данные |
| PUT | `/students/me/education` | Session | Образование |
| PUT | `/students/me/guarantor` | Session | Поручитель |
| PUT | `/students/me/emergency-contact` | Session | Экстренный контакт |
| PUT | `/students/me/family` | Session | Семья |
| GET | `/students` | — | Список студентов (agency) |
| POST | `/students` | — | Создать студента → `{ id }` |
| GET | `/students/:id` | — | Студент по ID |
| DELETE | `/students/:id` | — | Удалить (204) |
| GET | `/students/:id/profile` | — | Полный `StudentProfile` |
| PUT | `/students/:id/profile` | — | Обновить профиль |
| PUT | `/students/:id/education` | — | Образование |
| PUT | `/students/:id/guarantor` | — | Поручитель |
| PUT | `/students/:id/emergency-contact` | — | Экстренный контакт |
| PUT | `/students/:id/family` | — | Семья |
| PUT | `/students/:id/application-targets` | — | `{ formUrls?: string[] }` |
| POST | `/students/:id/application-targets/resolve` | — | `{ universityRaw, universityId }` |

**Тип:** `StudentProfile` — `packages/shared/src/student.types.ts`

### Applications

| Method | Path | Auth | Описание |
|---|---|---|---|
| POST | `/applications/batches` | — | Создать batch → `{ studentId }` |
| GET | `/applications` | — | Все заявки (agency) |
| POST | `/students/:studentId/applications/batches` | — | Batch для студента |
| GET | `/students/:studentId/applications/batches` | — | Batches студента |
| GET | `/students/:studentId/applications/readiness` | — | Готовность к подаче |
| GET | `/applications/batches/:id` | — | Batch по ID |
| GET | `/applications/active` | **ApiKey** | Активная заявка для extension (query: `url`, `studentId`) |
| GET | `/applications/:id` | — | Заявка по ID |
| PATCH | `/applications/:id/ready` | — | Пометить ready |
| POST | `/applications/:id/submit` | **ApiKey** | Submit (extension) |
| POST | `/applications/:id/consultant-submit` | — | Submit (dashboard) |
| PATCH | `/applications/:id` | — | Обновить статус/метаданные |
| POST | `/applications/:id/steps` | — | Добавить шаг |

**Статусы заявки** (`ApplicationStatus`):

```
queued | ready_for_submission | blocked | submitted | failed
       | waiting_for_login    | attention_required
```

**Ключевые типы** — `apps/api/src/applications/types/application-api.types.ts`:

```ts
// Активная заявка для extension
ActiveApplicationResponse = {
  applicationId, studentId,
  university: { id, displayName, formUrl },
  profile: StudentProfile,
  schema: UniversitySchema,
  motivationLetter?: string
}

// Job payload для worker
ApplicationProcessJobData = {
  applicationId, batchId, studentId, universityId
}
```

### Documents

| Method | Path | Описание |
|---|---|---|
| GET | `/students/:studentId/documents` | Список документов |
| POST | `/students/:studentId/documents` | Создать (URL) |
| POST | `/students/:studentId/documents/upload` | Upload multipart (`file`, `type`) |
| GET | `/documents/:id` | Документ по ID |
| PATCH | `/documents/:id` | Обновить |
| POST | `/documents/:id/parse` | Запустить парсинг |
| PATCH | `/students/:studentId/documents/reorder` | `{ type, orderedIds[] }` |
| DELETE | `/documents/:id` | Удалить |

**Parse status:** `pending | processing | parsed | uploaded | failed`

### Letters

| Method | Path | Описание |
|---|---|---|
| POST | `/letters/generate` | AI-генерация `{ studentId, universityId, type?, prompt? }` |
| GET | `/letters/students/:studentId` | Письма студента |
| GET | `/letters/universities/:universityId` | Письма вуза |
| GET | `/letters/:id` | По ID |
| PATCH | `/letters/:id` | Редактировать |
| POST | `/letters/:id/approve` | Approve |
| POST | `/letters/:id/unapprove` | Unapprove |
| DELETE | `/letters/:id` | Удалить |

### Universities

| Method | Path | Auth | Описание |
|---|---|---|---|
| GET | `/universities` | — | Список вузов |
| GET | `/universities/resolve` | — | Fuzzy match (query: `name`) |
| GET | `/universities/by-form-url` | — | Resolve по URL формы |
| GET | `/universities/sessions` | — | Статусы browser-сессий |
| GET | `/universities/relogin-status/:jobId` | — | Статус relogin job |
| POST | `/universities/aliases` | — | Создать alias |
| POST | `/universities/schemas/seed` | — | Seed схем из файлов |
| POST | `/universities/schemas/generate-draft` | — | AI draft схемы |
| GET | `/universities/:id` | — | Детали вуза |
| GET | `/universities/:id/aliases` | — | Aliases вуза |
| PATCH | `/universities/:id/relogin` | — | Запустить relogin |
| POST | `/universities/relogin-viewer-ticket` | Session | Ticket для VNC viewer |

### Webhook

| Method | Path | Описание |
|---|---|---|
| POST | `/webhook/google-form` | Приём Google Form → создание студента |

### WebSocket

| Path | Auth | Описание |
|---|---|---|
| `WS /ws/relogin-viewer?ticket={ticket}` | Ticket + Origin check | Прокси VNC worker → браузер для ручного relogin |

### Файлы типов и клиентов

| Файл | Назначение |
|---|---|
| `apps/api/src/applications/types/application-api.types.ts` | Контракты заявок |
| `apps/api/src/documents/types/document-api.types.ts` | Контракты документов |
| `apps/api/src/letters/types/letter-api.types.ts` | Контракты писем |
| `apps/api/src/universities/types/university-api.types.ts` | Контракты вузов |
| `packages/shared/src/student.types.ts` | `StudentProfile` |
| `packages/shared/src/university.types.ts` | `UniversitySchema` |
| `apps/dashboard/lib/api-client.ts` | Axios → Nest API |
| `apps/extension/src/shared/api.ts` | Extension client + `X-API-Key` |

---

## 3. Playwright Worker: autofill и submit

> **Статус:** worker **deprecated для production** (ADR-004). Production flow использует Chrome Extension (`apps/extension`) — консультант вручную подтверждает submit. Worker остаётся для локальной разведки и legacy-тестов.

### Архитектура

```
API (applications.service)
  → BullMQ "application.process" (Redis)
    → Processor (apps/worker/src/processor.ts)
      → BrowserService.withPage() — Playwright Chromium + session
      → Pipeline steps
      → Prisma (application, applicationStep, batch counters)
      → Telegram notifications
```

**Три BullMQ consumer'а:**

| Очередь | Класс | Назначение |
|---|---|---|
| `application.process` | `Processor` | Основной pipeline: open → fill → attach → submit |
| `browser.relogin` | `ReloginProcessor` | Headed re-login + resume paused applications |
| `session.health-check` | `SessionHealthCheckProcessor` | Периодическая проверка сессий |

### Pipeline

**Простая форма (без wizard):**

```
open_form → fill_fields → attach_files → submit_form → log_result
```

**Wizard-форма (17gz, PKU и т.п.):**

```
open_form → fill_wizard → log_result
```

(fill + attach + submit внутри `fill_wizard`)

### Flow: autofill

#### 1. Постановка в очередь

1. API создаёт batch с applications в статусе `ready_for_submission`
2. `applications.service.ts` → `queueService.addJob(QUEUES.APPLICATION_PROCESS, payload)`
3. Дефолт: **2 attempts**, fixed backoff **30 сек**

#### 2. Processor

1. `Processor.onModuleInit()` — Worker на `application.process`, `concurrency: 1`
2. Timeout job: **25 мин** (`APPLICATION_JOB_TIMEOUT_MS`)
3. Загружает student profile + university schema из DB
4. `browserService.withPage(universityId, handler)` — один Playwright page на job

#### 3. Step `open_form`

`OpenFormStep`:
1. `NavigationRegistry.resolve(formUrl)` → university-specific navigator
2. `navigator.navigate()` — переход к форме (pre-wizard, program selection)
3. `assertSessionValid()` — при login/CAPTCHA/CSRF:
   - `SessionExpiredError` → `waiting_for_login`
   - `AttentionRequiredError` → `attention_required`

#### 4. Step `fill_fields` (простая форма)

`FillFieldsStep` → `FormFiller.fillFields()` → `fillFieldBatch()`:

Для каждого `FieldConfig` из university schema:

1. **Значение:** `FieldMapper.getValue(profile, field, motivationLetter)` — `mapsTo` path в profile
2. **Локатор:** `resolveFieldLocator(page, field)` — CSS selector → fallback `getByLabel`/`getByPlaceholder` → в `hybrid` mode: `SemanticFieldMapper` (Gemini)
3. **Заполнение** по типу поля:
   - `text/textarea/essay/number` → `fillTextControl()` (Playwright fill + jQuery trigger)
   - `select` → `fillSelectControl()` + valueMap
   - `radio` → `fillRadioControl()` (группа по name, алиасы Yes/No)
   - `checkbox` → check/click
   - `file` → пропуск (отдельный step)
4. **Overlays:** dismiss dialogs, close date pickers (My97/WdatePicker, EasyUI)
5. **AJAX wait:** `wizardNavigator.waitForProcessingDone()`

#### 5. Step `attach_files`

`AttachFilesStep` → `FileAttacher.attachFiles()`:
- Скачивает документы студента, `setInputFiles()` на file inputs
- OCR passport upload для некоторых порталов

#### 6. Step `fill_wizard` (wizard-университеты)

`FillWizardStep` → `FormFiller.processWizard()`:

**Deterministic path:**
1. `detectCurrentWizardStep()` — resume с текущего шага при retry
2. `WizardNavigator.forEachStep()` — цикл по шагам:
   - `WizardFieldGroups.fieldsForStep()` → `fillFieldBatch()`
   - University-specific gap fillers (PKU step 1–5)
   - `FileAttacher` для file fields
   - `WizardNavigator.clickNext()` — DOM signature diff
3. `WizardNavigator.clickSubmit()` — финальный submit

**Agent path** (`fillMode === 'agent'`):
- `FormAgent.runWizard()` — per-step: `PageObserver` → `AgentPlanner` (Gemini) → `ActionExecutor`

**Agent fallback** (deterministic fail):
- Если `AGENT_FALLBACK=1` или `university.agent.fallbackEnabled`
- Resume с `detectCurrentWizardStep()`

### Flow: submit

#### Простая форма — `submit_form`

`SubmitFormStep` → `FormFiller.submit()`:
- Ищет `button[type='submit']`, `input[type='submit']`, `button:has-text("Submit")`
- Click + `waitForLoadState('networkidle')`

#### Wizard — внутри `fill_wizard`

`WizardNavigator.clickSubmit()`:
1. `waitForProcessingDone()` + dismiss dialogs
2. `resolveSubmitButton()` — schema selector или эвристики
3. Click → `confirmSubmitDialog()` ("Are you sure?")
4. `waitForFunction()` — success markers в body / DOM signature change

#### После submit

1. `log_result` — screenshot "after" → R2
2. `application.status → submitted`, `submittedAt`
3. `recalculateBatchCounters()` — batch → `completed` когда все submitted/blocked/failed
4. `notificationsService.notifySubmitted()`

### Режимы autofill

| Режим | Env | Описание |
|---|---|---|
| `schema` | `FORM_FILL_MODE=schema` | CSS-селекторы из university schema + `FieldMapper` |
| `hybrid` | `FORM_FILL_MODE=hybrid` | Schema first, semantic fallback через Gemini |
| `agent` | `FORM_FILL_MODE=agent` | Gemini loop: observe → plan → act |

### Error handling и retry

| Уровень | Механизм | Поведение |
|---|---|---|
| BullMQ job | `attempts: 2`, backoff 30s | Rethrow → retry; на финальной попытке → `notifyFailed()` |
| Step-level | `runStep()` | Orphan `processing` steps → `failed`; новый step record |
| Wizard resume | `detectCurrentWizardStep()` | Retry продолжает с текущего шага |
| Agent fallback | `AGENT_FALLBACK=1` | Deterministic fail → FormAgent takeover |
| Session pause | No rethrow | `SessionExpiredError` / `AttentionRequiredError` → pause, **без** BullMQ retry |

**Resume после re-login:** `ApplicationResumeService.resumePausedApplications(universityId)` — находит `waiting_for_login` / `attention_required`, re-enqueue в `application.process`. Триггеры: `ReloginProcessor`, `SessionHealthCheckProcessor`.

### Ключевые файлы

| Файл | Роль |
|---|---|
| `apps/worker/src/processor.ts` | BullMQ consumer, pipeline orchestration |
| `apps/worker/src/browser/browser.service.ts` | `withPage()` — Chromium, storageState, profiles |
| `apps/worker/src/filler/form.filler.ts` | Ядро autofill/submit |
| `apps/worker/src/filler/field.mapper.ts` | Profile → field value |
| `apps/worker/src/filler/field.locator.ts` | Selector/label → Locator |
| `apps/worker/src/filler/wizard.navigator.ts` | `forEachStep`, `clickNext`, `clickSubmit` |
| `apps/worker/src/filler/file.attacher.ts` | Document upload |
| `apps/worker/src/agent/form.agent.ts` | Gemini agent loop |
| `apps/worker/src/queue/application-resume.service.ts` | Re-enqueue paused applications |
| `apps/api/src/queue/queue.service.ts` | Job producer (attempts/backoff) |
| `apps/api/src/applications/applications.service.ts` | Enqueue на batch create |

### Env variables (worker)

| Variable | Default | Назначение |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL |
| `REDIS_URL` | — | BullMQ |
| `BROWSER_HEADED` | `0` | Headed mode |
| `BROWSER_PROFILES_DIR` | — | Persistent profiles per university |
| `FORM_FILL_MODE` | per-schema | `schema` / `hybrid` / `agent` |
| `GEMINI_API_KEY` | — | Agent + semantic mapper |
| `AGENT_FALLBACK` | per-schema | Deterministic → agent fallback |
| `AGENT_MAX_STEPS` | `40` | Max agent iterations |
| `BULLMQ_LOCK_DURATION_MS` | `900000` | Lock для длинных jobs (15 мин) |
| `APPLICATION_JOB_TIMEOUT_MS` | `1500000` | Hard timeout (25 мин) |
| `R2_*` | — | Cloudflare R2 screenshots |
| `TELEGRAM_BOT_TOKEN` | — | Уведомления |

Полный список: `apps/worker/.env.example`

---

## Быстрый старт

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

## Дополнительная документация

| Документ | Путь |
|---|---|
| Worker spec | `specs/Worker Spec.md` |
| University schema onboarding | `specs/University Schema Onboarding Spec.md` |
| ADR-004 (extension vs worker) | `adr/` |
| Per-app README | `apps/{api,dashboard,extension,worker}/README.md` |
