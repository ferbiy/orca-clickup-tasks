# ClickUp Tasks for Orca: architecture

## Overhedge fork changes (read first)

The sections below are the upstream design of `feature/start-task`. This fork changes:

- **Auth**: `worker/services/oauth-service.ts` (OAuth app in secrets, state, loopback
  `worker/loopback.ts`, paste fallback, `clickup/oauth.ts` exchange); `AuthService` stores the
  method (`auth.method`) and sends OAuth tokens as `Bearer`. Personal token stays as a fallback.
- **Scope**: `worker/services/scope-service.ts` resolves the chosen Spaces/Folders/Lists
  (`prefs.scope:<teamId>`) to List ids; `TaskService` limits `listMyTasks` (`list_ids[]`) and refuses
  tasks and Lists outside (`out_of_scope`). Browse shows chosen Lists only.
- **Statuses**: `shared/status-pick.ts` resolves start/done per List from status types
  (`open`/`unstarted`/`custom`/`done`/`closed`) and overrides (`prefs.statusMap`);
  `worker/services/transition-service.ts` applies them on start and on the first finish and records
  a `StatusChange` on the link (`onStart`, `onDone`).
- **Start**: any visible git project on any host (`hostId` passed to `workspace.create`); comments on
  start/finish; the task title moved inside the prompt fence.
- **Removed**: `terminal:read`, `terminal:send`, `workspace:write`; retry by `agent.launch`, prompt
  typing (`prompt-delivery.ts`), terminal diagnosis (`run-diagnosis.ts`), the `CU-CTX` self-report and
  the "auto" task-context mode. `RunWatcher.check` uses `agents.list` only; 'failed' is gone
  ('stalled' with `no_agent` / `agent_idle`).
- **Rate limit**: `createRateGate` in `clickup/http.ts` (80 requests/minute, blocks after a 429).
- **Tasks page (0.3.0)**: `worker/task-source/` registers `taskSource.clickup.list|get|action` worker
  commands (the Overhedge Orca build's plugin task-source contract, `OVERHEDGE.md` there).
  `TaskSourceService` sits on `TaskService` (My tasks cache, scope checks, one rate gate),
  `ScopeService.lists()` (names for the List filter), `StartService.run` and `projects()`;
  `TaskService.queryTasks` / `TaskTracker.queryTasks` add the Workspace task query for views other
  than "mine, not closed" (one page per call, memoized a minute). `items.ts` maps to the contract's
  shapes and clamps to its limits.
- **Send to chat (0.4.0)**: `shared/send-template.ts` (templates, placeholder rendering, message
  check), `worker/services/send-service.ts` over a `ChatGateway` port (`chat.list` / `chat.send`, the
  Overhedge build's `chat:send`), `worker/stores/send-store.ts` (`prefs.sendTemplates`,
  `prefs.sendLast`), `worker/send-handlers.ts` (`send.*` requests), the Tasks page's `send-to-chat`
  menu, and the panel's `send.ts`, `SendToChat.tsx`, `TemplatesSection.tsx`.
- **Status colours (0.4.1)**: `shared/status-color.ts` checks ClickUp's colour (`parseHexColor`:
  `#rgb`/`#rrggbb` only, normalized to lower-case `#rrggbb`), gives a pinned fallback otherwise
  (`fallbackStatusColor`: FNV-1a of the trimmed, lower-cased name into a fixed 12-colour palette, every
  entry at least 3:1 against `#fff` and `#0a0a0a`; only append to it), and maps a colour to the
  nearest circle character (`colorDot`, `statusLabel`). `clickup/mapper.ts` puts `color` on
  `StatusOption`, `TaskSummary.status` and `SubtaskRef.status` (null when absent or invalid);
  `TransitionService` records it on `StatusChange.color` for the run card. `CacheStore` always writes
  the `color` key and treats entries without it (0.4.0 caches) as absent, so real colours load at
  once; it also now accepts the `unstarted` type (Lists with such statuses were never cached). The
  panel draws circles (group titles, header badge in the neutral tone, status Selects, subtasks,
  Start checkbox, run card); 0.4.2 swaps some of them for coloured Badges, below. The Tasks page source (`worker/task-source/items.ts`) sends
  `status.color` on items and `color` on status options, and writes the circle into labels unless
  the command's `features` argument contains `status-color` (`register.ts` `parseStyle`). `clamp` now
  counts UTF-16 units, as the renderer's zod limits do.
- **Host colours (0.4.2)**: the Overhedge build (`overhedge/patch-273`, OVERHEDGE.md "Plugin status
  colours") draws a task source's `status.color` and option `color` (Linear's tinted pill and dots)
  and sends `features: ['status-color']` with every command, so `items.ts` sends plain labels there;
  it also takes `color` on components `Badge` (`ui.has('Badge', 'color')`). `panel/views/StatusBadge.tsx`
  checks that once per render and draws the header status, subtask statuses (a Badge beside the
  checkbox, the label keeps only the name) and run card moves as coloured Badges with the checked
  hex from `statusColor`; on stock Orca, and in group titles, Selects and the Start checkbox (plain
  strings in the kit), the circle stays.
- **Settings**: `prefs.settings` stores only fields the person set plus `version: 2`; `moveOnDone`
  defaults to false and a pre-version `true` (the old default, saved by 0.2.0's whole-object writes)
  reads as unset.

Orca 1.4.266, host API 1.10, `engines.orca >=1.4.259`.

## 1. Goal and scope

A sidebar panel in Orca that lists the ClickUp tasks assigned to me, and lets me browse any List
of the Workspace (Space › Folder › List). The detail view shows the whole task: properties,
description, checklist, subtasks, attachments and comments. **Start** turns one into its
own git worktree with a coding agent briefed on the task. When the agent finishes, the panel offers
to move the task's status and post a comment.

Not in v0.1: OAuth (deferred 2026-11-20: ClickUp has no PKCE, so it needs a token-exchange server), subfolders, comment replies, creating tasks, time tracking, a status bar counter, multi-account, and
appearing on Orca's Tasks page. `contributes.taskSources` is reserved upstream
(stablyai/orca#26281); section 9 covers how this design gets there later.

Design reference: `docs/design/*.dc.html` (Claude Design canvas: 5 panel screens + 3 desktop
frames). The panel is built only from Orca's components kit, so the mockup's colors map to Badge
tones.

## 2. Facts this design rests on (verified, not assumed)

| Fact | How verified |
|---|---|
| A worker can `fetch` the internet; panels cannot | Spike: worker got HTTP 400 from api.clickup.com |
| ClickUp without a token returns **400** `ECODE: OAUTH_017` (not 401) | Same spike. Classify auth errors by `ECODE`, not status |
| `workspace.create({ projectId, name, agent, prompt })` returns `workspaceId = "identity:wt2:…"` | Spike in a sandbox repo |
| The branch comes from `name`: spaces → `-`, punctuation dropped, case kept (`"CU-86c1x2a Migrate … v2!"` → `CU-86c1x2a-Migrate-…-v2`) | Spike, `git branch` |
| `agent.status.changed.workspaceListId` equals that `workspaceId`; the event's own `workspaceId` is a different `projectId::path` form | Spike event log |
| Orca emits a **`done` blip right at launch**, before the prompt runs (`done → working → done`) | Spike event log |
| When the agent's CLI is **not installed**, `workspace.create` still succeeds: Orca types the command into a shell, which answers `command not found` and stays open. **No agent event ever comes**, and the workspace lists no agent | Real run with Gemini, 2026-11-20 (`orca terminal list`, `orca agent list`) |
| `terminal.read` needs `terminal:read`; `terminal.list` needs `workspace:read`; `agents.list` needs `agent:read`; `terminal.close` needs `terminal:send` | Orca 1.4.266 host method table |
| A plugin's `agent.launch` sends the prompt **without waiting** for the agent to be ready, so the prompt can be lost (stablyai/orca#41107, still in 1.4.266). `workspace.create` with `agent` delivered it in T9 | Issue + the 1.4.266 bundle |
| A worker that lists `contributes.events` was kept running for 10+ min with no requests | Spike, `orca plugin list` |
| Handler answers are capped at 1 MiB, posts at 256 KiB / 200 per 10 s | Orca recipes reference |
| A handler error whose `code` is not a host error code reaches the panel as `action_failed`, so every request answers a `Result<T>` envelope (`shared/errors.ts`) and `panel/api.ts` unwraps it | `PanelsApi.handle` typings (.orca/types/orca-worker) |

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
│   ├─ services/start-service.ts       ▲                   │
│   └─ services/run-watcher.ts ◄── agent.status.changed    │
│ worker/stores/* ──► KeyValueStore (orca.storage)         │
│ worker/orca-adapters.ts ──► orca.host / storage / secrets│
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
    model.ts               domain types (TaskSummary, TaskDetail, TaskLink, …)
    errors.ts              ErrorCode, PluginError, errorCodeOf
    workspace-name.ts      CU-<id>-<slug> name (= branch)
    status-pick.ts         which status means "in progress" / "review"
    display.ts             tones, labels, due text, done-comment template
  tracker/tracker.ts       TaskTracker port
  clickup/                 ClickUp API v2 adapter (worker-only)
    http.ts                fetch, auth header, timeouts, error classification, rate limit
    dto.ts                 raw ClickUp JSON shapes
    mapper.ts              DTO → shared/model
    clickup-tracker.ts     TaskTracker over ClickUpHttp
  worker.ts                manifest `main`: activate() = composition root
  worker/
    ports.ts               KeyValueStore, SecretStore, OrcaGateway, PanelPoster, Clock
    orca-adapters.ts       ports over OrcaWorkerApi
    handlers.ts            protocol requests → services; maps errors
    prompt.ts              agent prompt with an untrusted-data fence
    stores/                link-store, cache-store, prefs-store (over KeyValueStore)
    services/              auth, task, start, run-watcher
  panel.tsx                manifest panel entry: setup() + router by screen
  panel/
    state.ts               atoms (screen, auth, tasks, links, filters, drafts)
    api.ts                 typed wrappers over plugin.request + error → message
    views/                 ConnectView, TaskListView, TaskDetailView, RunCard, UpdateTaskForm
  **/*.test.ts(x)          beside the code they test; run by `orca plugin test`
docs/
  ARCHITECTURE.md  TASK-CONTEXT.md  CATALOG.md  design/*.dc.html  samples/
```

## 5. Data and state

**Where state lives**

| Data | Owner | Store | Key |
|---|---|---|---|
| ClickUp token | AuthService | secrets (OS keyring) | `clickup.token` |
| User id, selected Workspace | PrefsStore | storage | `prefs.userId`, `prefs.teamId` |
| Project per ClickUp List, last agent | PrefsStore | storage | `prefs.projectByList`, `prefs.agent` |
| My tasks (slim) | CacheStore | storage | `cache.tasks` `{teamId, fetchedAt, tasks}` |
| List statuses | CacheStore | storage | `cache.statuses` `{[listId]: {fetchedAt, statuses}}` |
| Spaces of the Workspace | CacheStore | storage | `cache.spaces` `{teamId, fetchedAt, spaces}` (1 h) |
| Folders + Lists of a Space | CacheStore | storage | `cache.children` `{[spaceId]: {fetchedAt, children}}` (1 h) |
| Task ↔ workspace links + run state | LinkStore | storage | `links` (≤200) |
| UI screen, filters, drafts | panel | atoms | keyed atoms, `persist: 'plugin'` for filters |

The worker restarts on save and when idle, so it keeps nothing important in memory. The panel never
reads storage keys directly: it asks the worker, which keeps one owner per key.

**Caching and rate limits.** ClickUp allows about 100 requests a minute. The list is served from
`cache.tasks`. It is `stale` after 5 minutes, and the panel then asks for `refresh: true` once when
it opens. The ↻ button refreshes too. Nothing polls. A list fetch walks pages of 100 up to 5 pages.
Statuses, Spaces and Space children are cached for 1 hour, and `clear()` drops all of them
on a Workspace or user change. `tasks.get` always goes to ClickUp, but `start.options` reuses a
fetch at most 30 s old (`get(id, {reuse:true})`), so opening a task costs one `getTask`. Browse
task pages and comments are never cached. Every read is deduped while in flight, keyed by its
arguments. A `rate_limited` error carries
`retryAfterMs`, and the panel disables refresh until then.

**Size.** `TaskSummary` is slim on purpose: no description, checklists or custom fields. At 500
tasks the list answer stays far under 1 MiB. Detail comes from `tasks.get`.

## 6. Flows

**Revoked token.** When any request other than `auth.connect` gets `auth_invalid`, `handlers.respond` calls `AuthService.invalidate()`. That forgets the token and the profile and posts `auth.changed`, so the panel goes back to Connect instead of failing every request.

**Connect.** The panel calls `auth.connect({token})`. AuthService first checks
`secrets.protection()` (`unavailable` → `secrets_unavailable`). It then runs `tracker.verify()` and
`listTeams()`, saves the token, stores the userId, and selects the team if there is exactly one. It
posts `auth.changed`. A bad token never reaches secrets.

**List.** The panel runs `tasks.list({})`. If the answer is `stale`, it runs
`tasks.list({refresh:true})`. TaskService reads the team and user from prefs, calls
`tracker.listMyTasks`, writes the cache and posts `tasks.changed`.

**Browse.** The Browse tab loads `browse.spaces` once, then `browse.children({spaceId})` lazily
when a Space is expanded in the Tree. Selecting a List runs `browse.tasks({listId, page: 0,
includeClosed})`. **Load more** asks for the next page (100 tasks a page) until `lastPage`.

**Detail.** `tasks.get` and `start.options` run in parallel, followed by `tasks.statuses`.
`tasks.comments({taskId})` loads alongside and never blocks the render. **Load older** passes the
`next` cursor (`start` + `start_id` of the oldest comment shown). An attachment opens with
`shell.openExternal`, only from a press, and only when its https URL belongs to the loaded task.
Long text is capped below the 16 KiB-per-text render limit.

**Start.** `start.options({taskId})` returns the local git projects (folders, hidden and non-local
projects are excluded in v0.1), the project remembered for the task's List, the agents, the workspace
name and the in-progress status. `start.run(req)` then:
1. gets the task detail;
2. builds the prompt with a random fence;
3. calls `gateway.createWorkspace`;
4. reads Orca's real branch back from `listWorkspaces()`;
5. calls `watcher.adopt(link)`, which **stores the link and replays any agent events that came in
   early, in one queued step**. RunWatcher is the only writer of a link after that, so no update is
   lost;
6. remembers the project and agent;
7. moves the status when that was asked (failure is logged, not fatal);
8. posts `link.changed`.

Once step 3 has succeeded, a later failure never undoes the workspace.

**Agent status → done.** RunWatcher handles `agent.status.changed`:
1. Key: `workspaceListId`. Ignore the event if it is missing or not linked.
2. State: `mainAgent?.state ?? state`.
3. Update `run`. `sawWorking ||= state === 'working'`.
4. Notify and post only on a transition **into** `done` from a non-done state **after `sawWorking`**.
   This drops the launch blip. Repeated `done` events don't notify again. A later
   `working → done` cycle (the person kept chatting) notifies again, at most once per cycle.
5. `blocked`/`waiting` post `link.changed` (the card turns amber) without a notification.

`workspace.removed` deletes the link and posts `link.removed`.

The launch blip (`done` before any `working`) now keeps the run `starting` instead of showing
"finished".

**Runs Orca says nothing about (stalled / failed).** Orca sends no event when the agent never starts,
so `RunWatcher.check(workspaceId)` looks for itself. It runs 8 s, 25 s, 65 s, 3 min and 10 min after a
start or retry (while the run is still `starting`/`stalled`), for every run not done when the worker
starts, on the panel's Refresh and when a task with a run is opened. One check:
1. `agents.list({workspaceId})`. An agent is there → its state wins and is replayed as an event (this
   also repairs missed events). An agent that is open but has never worked for `STALL_MS` (60 s) →
   `stalled` / `agent_idle` (its prompt may be lost, #41107).
2. No agent → find the agent's terminal (`link.terminalId`, or the workspace's only terminal for
   older links) and `terminal.read` its last 60 lines.
3. Before any work, shell output such as `command not found` → `failed` / `agent_missing` at once. The
   agent is remembered as missing (`prefs.missingAgents`) and a notification is shown.
4. Otherwise, after `STALL_MS` → `stalled` / `no_agent`, or `no_terminal` when the terminal is gone.
   This is a guess (setup scripts run first), so it never says "failed".

Any later agent event moves the run on and clears the problem. Without `terminal:read` the timing
rules still apply; only the terminal lines and `failed` are lost.

**Recovery.** Every state that is not done has a way out on the run card (open for `stalled`/`failed`,
under "Agent not starting?" otherwise):
- `runs.retry({workspaceId, agent})` starts an agent again **in the same worktree** with
  `agent.launch` and a freshly built prompt. The launch runs inside RunWatcher's queue, so the new
  agent's first events cannot be overwritten by the reset. `agent.launch` loses its prompt (#41107,
  confirmed live 2026-11-21), so the plugin launches without one, waits for `agents.list` to show the
  agent in that terminal, opens (focuses) the workspace — `terminal.sendText` only reaches the focused
  worktree — and types the prompt as a bracketed paste, then Enter (`prompt-delivery.ts`). If that
  fails, the run turns `agent_idle`: the card offers **Send the task prompt** (`runs.sendPrompt`) and
  the prompt to paste by hand (`runs.prompt`).
- **Check again** (`runs.check`) and **Stop tracking** (`runs.forget`: the link goes, the worktree
  stays, the Start form comes back).
- The Start form marks agents whose CLI was not found last time; a later `working` clears the mark.

**Task context (Phase 8).** How the agent learns the task (link first, snapshot fallback, learned per-agent ClickUp access): see `docs/TASK-CONTEXT.md`.

**Update task.** The Done screen prefills `pickReviewStatus` and `doneCommentTemplate`.
`tasks.update` sets the status and/or posts the comment, then refreshes that one task into the
cache. Nothing is sent before the person presses **Update task**.

## 7. Security

- The token lives only in `secrets`. It is never logged, never in storage, and never in a panel
  atom after submit.
- Task text is **untrusted**. The prompt fences it with a per-run random marker, strips any
  occurrence of the marker from task text, says that the text is data and not instructions, and
  caps the description at 8 000 characters.
- External links open only from a press (`shell.openExternal` needs a gesture). The panel shows
  ClickUp URLs from the API and never builds them from user text.
- Least privilege: see the table below. `terminal:send` is used only by `prompt-delivery.ts`, only on
  the terminal the plugin's own `agent.launch` opened (or a run's recorded agent terminal), and only
  after `agents.list` shows an agent in it. The prompt goes as one bracketed paste with every control
  character stripped or replaced, so task text cannot end the paste or send keys. No `settings:own`,
  no hooks. Terminal lines shown on the run card are untrusted
  text and render as plain `Code`.

## 8. Capabilities

| Capability | Needed for | Required |
|---|---|---|
| `secrets:own` | ClickUp token | yes |
| `storage:own` | cache, links, prefs | yes |
| `workspace:read` | `project.list`, `workspace.list` (branch read-back), `workspace.removed` | yes |
| `workspace:create` | worktree per task | yes |
| `agent:launch` | the agent on create (`agent` param), **Retry in this worktree** (`agent.launch`) | yes |
| `agent:read` | `agent.status.changed` → done notification; `agents.list` in run checks | yes |
| `notifications:show` | "Claude finished …" | yes |
| `workspace:write` | the **Open workspace** button (`workspace.open`) | yes |
| `terminal:send` | typing the task prompt into a retried or idle agent (`terminal.sendText`), because a plugin's `agent.launch` loses its prompt (#41107) | yes |
| `terminal:read` | reading the agent's terminal to tell "CLI not found" (`failed`) and to show its last lines | yes |

## 9. Extension points

- **Another tracker** (Linear-like or self-hosted): add `src/<tracker>/` implementing `TaskTracker`
  and swap the factory in `worker.ts`. Services, stores, panel and prompt stay as they are. There is
  no multi-tracker registry until a second tracker exists.
- **Orca task sources**: done for the Overhedge build's command-based contract
  (`worker/task-source/`). When upstream ships `contributes.taskSources` (#26281/#26282, same data
  shapes), only the registration changes.
- **Settings**: a branch prefix, a description cap and a refresh window would go in
  `contributes.settings` (+`settings:own`), read by the services through a new `SettingsPort`.
- **Status bar / time tracking**: new services beside the existing ones, fed by the same stores.

## 10. Testing

- `orca plugin test .` runs every `*.test.ts(x)` under `src/` with `orca/testing`.
- Pure modules (`shared/`, `worker/prompt.ts`, `clickup/mapper.ts`): plain input → output tests.
- `clickup/http.ts` and `clickup-tracker.ts`: a fake `FetchLike` that records requests and returns
  canned responses (fixtures in `clickup/fixtures.ts`). Cover each error class and pagination.
- Stores: an in-memory `KeyValueStore` (`worker/testing/memory-kv.ts`).
- Services: fakes for `TaskTracker`, `OrcaGateway`, `PanelPoster`, `Clock`. RunWatcher is fed the
  event sequence the spike recorded (launch blip included).
- Worker wiring: `mountWorker` + `mockHost` for one happy path per request.
- Panel: `mount` + `mockHost({ requests })` per screen, plus `src/panel.check.ts` scenarios
  (disconnected, list, detail, running, done, error) for `orca plugin check` screenshots.
- Type-check: `npx -y -p typescript@5.9.3 tsc -p . --noEmit`.

## 11. Conventions

- TypeScript strict, ES modules, relative imports with no extension (`./model`), no npm runtime
  dependencies.
- Files hold one concept, are named in kebab-case, and stay ≤ 250 lines.
- Services throw `PluginError` with an `ErrorCode`, never a bare `Error`. `handlers.ts` turns every outcome into `Result<T>`; nothing throws across `plugin.request`.
- No `any`. Narrow unknown JSON in `clickup/mapper.ts` only.
- Comments say why, not what. Each module starts with a one-line header naming its role.
