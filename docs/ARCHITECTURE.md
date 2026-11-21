# ClickUp Tasks for Orca: architecture

Orca 1.4.266, host API 1.10, `engines.orca >=1.4.259`.

## 1. Goal and scope

A sidebar panel in Orca that lists the ClickUp tasks assigned to me, and lets me browse any List
of the Workspace (Space › Folder › List). The detail view shows the whole task and edits it in
place: properties, description, checklists, subtasks, attachments and comments.

Not in v0.1: OAuth (ClickUp has no PKCE, so it needs a token-exchange server), creating top-level
tasks, time tracking, a status bar counter, multiple accounts, and appearing on Orca's Tasks page.
`contributes.taskSources` is reserved upstream (stablyai/orca#26281); section 8 covers how this
design gets there later.

## 2. Facts this design rests on (verified, not assumed)

| Fact | How verified |
|---|---|
| A worker can `fetch` the internet; panels cannot | Worker got an HTTP answer from api.clickup.com |
| ClickUp without a token returns **400** `ECODE: OAUTH_017` (not 401) | Same probe. Auth errors are classified by `ECODE`, not status |
| Handler answers are capped at 1 MiB, posts at 256 KiB / 200 per 10 s | Orca recipes reference |
| A handler error whose `code` is not a host error code reaches the panel as `action_failed`, so every request answers a `Result<T>` envelope (`shared/errors.ts`) and `panel/api.ts` unwraps it | `PanelsApi.handle` typings |

## 3. Shape

```
┌───────────── Panel (sandboxed, no network) ─────────────┐
│ panel.tsx (router) → panel/views/*  ← panel/state.ts     │
│                      panel/api.ts ── plugin.request ─────┼──┐
└──────────────────────────────────────────────────────────┘  │ JSON, typed by protocol.ts
┌───────────── Worker (Node, trusted-worker) ──────────────┐  │
│ worker.ts (composition root)                             │  │
│ worker/handlers.ts  ◄────────────────────────────────────┼──┘
│   ├─ services/auth-service.ts                            │
│   ├─ services/task-service.ts ──► tracker/tracker.ts (port)
│   └─ services/edit-service.ts        ▲                   │
│ worker/stores/* ──► KeyValueStore (orca.storage)         │
│ worker/orca-adapters.ts ──► orca.storage / secrets       │
│ clickup/http.ts + clickup-tracker.ts ──► api.clickup.com │
└──────────────────────────────────────────────────────────┘
```

**Dependency rule.** Arrows point inward. `shared/` depends on nothing. `tracker/` depends on
`shared/`. `clickup/` implements `tracker/`. `worker/services` depend on the ports
(`tracker/tracker.ts`, `worker/ports.ts`) and never on `clickup/` or `orca` directly. Only `worker.ts`
and `worker/orca-adapters.ts` touch the `orca` worker API. Only `clickup/http.ts` calls `fetch`.

## 4. Folder layout

```
orca-plugin.json
src/
  protocol.ts              panel <-> worker contract (requests + panel events)
  shared/                  PURE, imported by panel and worker: no Orca runtime, no Node, no fetch
    model.ts               domain types (TaskSummary, TaskDetail, TaskPatch, …)
    errors.ts              ErrorCode, PluginError, Result envelope
    edit.ts                date / duration / task-ref parsing for inline edits
    task-filter.ts         My tasks and Browse filters, presets, sort
    status-pick.ts         which status a subtask checkbox ticks to / back
    display.ts             tones, labels, due text, markdown preview
  tracker/tracker.ts       TaskTracker port
  clickup/                 ClickUp API v2 adapter (worker-only)
    http.ts                fetch, auth header, timeouts, error classification, rate limit
    dto.ts                 raw ClickUp JSON shapes
    mapper.ts              DTO → shared/model
    clickup-tracker.ts     TaskTracker over ClickUpHttp
  worker.ts                manifest `main`: activate() = composition root
  worker/
    ports.ts               KeyValueStore, SecretStore, PanelPoster, Clock
    orca-adapters.ts       ports over OrcaWorkerApi
    handlers.ts            protocol requests → services; validates input; maps errors
    stores/                cache-store, prefs-store (over KeyValueStore)
    services/              auth, task (cache + stale), edit (writes)
  panel.tsx                manifest panel entry: setup() + router by screen
  panel/
    state.ts               atoms (screen, auth, tasks, filters, browse, drafts)
    api.ts                 typed wrappers over plugin.request + error → message
    edit.ts                inline edit actions
    settings.ts            Settings tab actions
    views/                 ConnectView, TaskListView, BrowseView, TaskDetailView, SettingsView, detail/*
  **/*.test.ts(x)          beside the code they test; run by `orca plugin test`
```

## 5. Data and state

| Data | Owner | Store | Key |
|---|---|---|---|
| ClickUp token | AuthService | secrets (OS keyring) | `clickup.token` |
| User id, selected Workspace | PrefsStore | storage | `prefs.userId`, `prefs.teamId` |
| My tasks (slim) | CacheStore | storage | `cache.tasks` `{teamId, fetchedAt, tasks}` |
| List statuses | CacheStore | storage | `cache.statuses` `{[listId]: {fetchedAt, statuses}}` |
| Spaces of the Workspace | CacheStore | storage | `cache.spaces` (1 h) |
| Folders + Lists of a Space | CacheStore | storage | `cache.children` (1 h) |
| UI screen, filters, drafts | panel | atoms | keyed atoms, `persist: 'plugin'` for filters |

The worker restarts on save and when idle, so it keeps nothing important in memory. The panel never
reads storage keys directly: it asks the worker, which keeps one owner per key.

**Caching and rate limits.** ClickUp allows about 100 requests a minute. The list is served from
`cache.tasks`. It is `stale` after 5 minutes, and the panel then asks for `refresh: true` once when
it opens. The ↻ button refreshes too. Nothing polls. A list fetch walks pages of 100 up to 5 pages.
Statuses, Spaces and Space children are cached for 1 hour, and `clear()` drops all of them on a
Workspace or user change. `tasks.get`, Browse task pages and comments always go to ClickUp. Every
read is deduped while in flight, keyed by its arguments. A `rate_limited` error carries
`retryAfterMs`, and the panel disables refresh until then.

**Size.** `TaskSummary` is slim on purpose: no description, checklists or custom fields. At 500
tasks the list answer stays far under 1 MiB. Detail comes from `tasks.get`.

## 6. Flows

**Connect.** The panel calls `auth.connect({token})`. AuthService first checks
`secrets.protection()` (`unavailable` → `secrets_unavailable`). It then runs `tracker.verify()` and
`listTeams()`, saves the token, stores the userId, and selects the team if there is exactly one. It
posts `auth.changed`. A bad token never reaches secrets.

**Revoked token.** When any request other than `auth.connect` gets `auth_invalid`,
`handlers.respond` calls `AuthService.invalidate()`. That forgets the token and the profile and
posts `auth.changed`, so the panel goes back to Connect instead of failing every request.

**List.** The panel runs `tasks.list({})`. If the answer is `stale`, it runs
`tasks.list({refresh:true})`. TaskService reads the team and user from prefs, calls
`tracker.listMyTasks`, writes the cache and posts `tasks.changed`.

**Browse.** The Browse tab loads `browse.spaces` once, then `browse.children({spaceId})` lazily
when a Space is expanded in the Tree. Selecting a List runs `browse.tasks({listId, page: 0,
includeClosed})`. **Load more** asks for the next page (100 tasks a page) until `lastPage`.

**Detail.** `tasks.get`, then `tasks.statuses`. `tasks.comments({taskId})` loads alongside and
never blocks the render. **Load older** passes the `next` cursor. An attachment opens with
`shell.openExternal`, only from a press, and only when its https URL belongs to the loaded task.

**Edit.** Each control writes one field (`tasks.patch`, `tasks.tag`, `tasks.checklist`,
`tasks.createSubtask`, `comments.*`) and answers the fresh `TaskDetail`. Text fields send
`expectedUpdatedAt`: the worker re-fetches first and writes nothing when the task changed
(`conflict`), and the panel keeps the draft. A `forbidden` answer locks that field read-only.

## 7. Security

- The token lives only in `secrets`. It is never logged, never in storage, and never in a panel
  atom after submit.
- Task text from ClickUp is untrusted and renders as plain text or the components kit's Markdown.
- External links open only from a press (`shell.openExternal` needs a gesture). The panel shows
  ClickUp URLs from the API and never builds them from user text.
- Least privilege: `secrets:own` (token) and `storage:own` (cache, prefs). No workspace, agent or
  terminal access, no hooks.

## 8. Extension points

- **Another tracker**: add `src/<tracker>/` implementing `TaskTracker` and swap the factory in
  `worker.ts`. Services, stores and panel stay as they are.
- **Orca task sources** (when #26281 ships): add a thin adapter that exposes `TaskService` through
  the new contribution point. The ClickUp code is already free of UI.

## 9. Testing

- `orca plugin test .` runs every `*.test.ts(x)` under `src/` with `orca/testing`.
- Pure modules (`shared/`, `clickup/mapper.ts`): plain input → output tests.
- `clickup/http.ts` and `clickup-tracker.ts`: a fake `FetchLike` that records requests and returns
  canned responses (fixtures in `clickup/fixtures.ts`).
- Stores: an in-memory `KeyValueStore` (`worker/testing/memory-kv.ts`).
- Worker wiring: `mountWorker` + `mockHost`.
- Panel: `mount` + `mockHost({ requests })` per screen, plus `src/panel.check.ts` scenarios for
  `orca plugin check`.
- Type-check: `npx -y -p typescript@5.9.3 tsc -p . --noEmit`.

## 10. Conventions

- TypeScript strict, ES modules, relative imports with no extension, no npm runtime dependencies.
- Services throw `PluginError` with an `ErrorCode`, never a bare `Error`. `handlers.ts` turns every
  outcome into `Result<T>`; nothing throws across `plugin.request`.
- No `any`. Narrow unknown JSON in `clickup/mapper.ts` only.
- Comments say why, not what. Each module starts with a one-line header naming its role.
