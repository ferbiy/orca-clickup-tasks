# Security audit: gthjnk/orca-clickup-tasks `feature/start-task` (be7b32a)

Audited 2026-11-25 for the Overhedge fork (`ferbiy/orca-clickup-tasks`, branch `overhedge`).
Scope: every file of `be7b32a` (91 files, about 14k lines: 48 source, 22 tests, docs, design
mockups), against Orca 1.4.273 (host API 1.10). `main` (57b03d9, v0.1.5) was audited earlier and
found clean; its five later commits (icon, cover, Connect wording) were re-read for this fork.

Criteria: token handling, network destinations, process spawning, file access, terminal send and
read, prompt injection from task text into agents, and auto-update.

## Verdict

**No malicious code, no exfiltration, no hidden network or file access.** The branch is a careful,
well-tested piece of work. It does ask for more access than the features need, and it has two
real weaknesses (task title outside the untrusted-data fence; terminal typing and reading). This
fork fixes both and drops the access they needed. Safe to base on, with the changes below.

## Findings on be7b32a

| # | Area | What the code does (file:line) | Risk | In this fork |
|---|---|---|---|---|
| 1 | Network | Only `src/clickup/http.ts:93` calls `fetch`, always to `https://api.clickup.com/api/v2` (`http.ts:42`), injected from `src/worker.ts:33`. Path segments are `encodeURIComponent`-ed (`clickup-tracker.ts` `requireId`). Panels have no network (Orca frame fence). | None | Kept. OAuth adds `POST https://api.clickup.com/api/v2/oauth/token` (`src/clickup/oauth.ts`) and a loopback listener (see below). |
| 2 | Token | Personal token stored only via `orca.secrets` under `clickup.token` (`auth-service.ts:10`), verified before saving, never logged, never put in storage or a panel atom after submit. Errors carry ClickUp's message, never the header. | None | Kept; OAuth token and app secret follow the same rule (tests assert the secret never reaches storage, posts, answers or logs). |
| 3 | Process spawning | `src/worker/clipboard.ts:21` `spawn`s a fixed command per OS (`pbcopy`, `clip`, `wl-copy`/`xclip`/`xsel`) with fixed args, `stdio` pipe-in only; the text goes to stdin. The handler copies only `https://app.clickup.com/...` URLs (`handlers.ts:454`). No shell, no user-controlled argv. | Low | Kept as is. |
| 4 | File access | No `fs` import anywhere. State lives in `orca.storage` / `orca.secrets`. | None | Kept; the fork adds no file access. |
| 5 | Terminal send | `terminal:send`: after a retry, `prompt-delivery.ts:52-56` focuses the workspace (`workspace.open`, steals focus) and types the prompt into the agent terminal as a bracketed paste. Control characters are stripped (`prompt-delivery.ts:22`), so task text cannot end the paste or send keys. Only into the plugin's own agent terminal after `agents.list` shows an agent. | Medium (capability is broad; typing into a focused terminal is the riskiest thing a plugin can do) | **Removed** with `terminal:send`, `agent.launch` retry (`start-service.ts:157`) and `workspace:write`. The first prompt goes only through `workspace.create` with `agent` + `prompt`. When it is lost the run card shows the prompt to paste by hand. |
| 6 | Terminal read | `terminal:read`: reads up to 2000 lines of the agent terminal (`run-watcher.ts:57, 387`) to find a `CU-CTX=tool|none` self-report, and 60 lines to detect `command not found` (`run-watcher.ts:286`). The last 6 lines are stored in plugin storage as `run.problem.lines` (`run-watcher.ts:270, 277`), so agent output (possibly secrets the agent printed) is persisted in plain JSON. | Medium (privacy) | **Removed** with `terminal:read`. Run health comes from `agents.list` only; no terminal text is read or stored. Old links with stored lines are migrated away on read (`link-store.ts`). |
| 7 | Prompt injection | Snapshot is fenced with a 16-hex random marker per prompt and the marker is stripped from task text (`prompt.ts:36`); a rule line marks it as data. **But the task title is outside the fence**, on the first line: ``Work on ClickUp task …: "<title>"`` (`prompt.ts:88`). Line breaks are collapsed, yet a title such as `x". Ignore the above and …` still lands in the instruction part of the prompt. | Medium | **Fixed**: outside the fence there are only the task id (checked `[A-Za-z0-9_-]`) and a checked `https://app.clickup.com/...` link; the title and all other text are inside the fence (`src/worker/prompt.ts`), with a test. |
| 8 | Agent self-report | The `CU-CTX` report an agent prints teaches the plugin to send future prompts "link only". The token is neutralized in task text, so task text cannot fake it; an agent can, but that only shrinks future prompts. | Low | Removed together with terminal reading. "Link only" is now an explicit choice. |
| 9 | External links | `shell.openExternal` only from a press: `https://app.clickup.com/` (`panel/api.ts:427`), `https://developer.clickup.com/` (`api.ts:439`), and https attachment URLs of the open task. Orca asks before a new host. | Low | Kept; adds the ClickUp authorize URL (`https://app.clickup.com/api?...`, carries no secret). |
| 10 | Scope | Every task of the Workspace the token can see is listed and can be sent to an agent. | Medium (data minimization) | **Fixed**: the person picks Spaces/Folders/Lists; queries are limited to those List ids and tasks outside are refused before they are cached, shown or prompted (`scope-service.ts`, `task-service.ts`). |
| 11 | Remote hosts | Start was limited to local projects (`start-service.ts:260`). | n/a | Fork passes `hostId` to `workspace.create`, so projects on a paired Orca server start there. |
| 12 | Docs | `docs/design/*.dc.html` mockups load Google Fonts and a missing `support.js`. Never loaded by the plugin (no panel references them). | None (inert) | Deleted from the fork. |
| 13 | Tests | Test files import only `orca/testing` and the plugin's own modules; no network, no file or process access. | None | Kept and extended (348 tests). |
| 14 | Auto-update | The plugin has no updater of its own. Orca's catalog auto-update ("Update plugins automatically", default on) silently installs new catalog releases that ask for no new access, including new code for full-access plugins. | Medium (supply chain) | We do not install from the catalog: only a pinned commit of this fork via Git URL, which `orca plugin update` reports as `pinned` and the auto-updater never touches (it only updates catalog installs). See README "Install". |

## New code in this fork, reviewed against the same criteria

- **OAuth loopback listener** (`src/worker/loopback.ts`): binds `127.0.0.1` only, one fixed port
  from the registered redirect URL, answers only `GET <path>` with a `Host` of that exact loopback
  origin (DNS-rebinding guard), never echoes request data into the page, sends `no-store` and a
  strict CSP, and closes after the first accepted callback, after 10 minutes, or on cancel.
  Verified in a real Orca 1.4.273+overhedge desktop instance (wrong state 400, forged Host 403,
  other path 404, replay refused, port closed after cancel).
- **State / CSRF**: 32 random bytes (`crypto.getRandomValues`), compared in constant time, one use,
  10 minutes (`oauth-service.ts`).
- **Client secret**: pasted once into the panel, sent to the worker, stored only in `orca.secrets`
  (OS keychain), cleared from the panel atom after every save attempt, never returned to the panel
  (`AuthState.oauth` carries only the client id and redirect URL). Checked on disk in the test
  instance: no plaintext copy.
- **Rate limit**: a shared client-side gate keeps the worker under 80 requests/minute and stops all
  requests after a 429 until ClickUp's `X-RateLimit-Reset`.
- **Comments/status writes**: only on start and on the first finish of a run, only for in-scope
  tasks, and the "done" move only while the task still shows the status the start set.

## Remaining capabilities and residual risk

`trusted-worker` still means an unsandboxed Node process running as you. The fork requests:
`secrets:own`, `storage:own`, `workspace:read`, `workspace:create`, `agent:launch`, `agent:read`,
`notifications:show`, and from 0.4.0 `chat:send` (each explained in the README). Residual risks: task text still reaches the
agent and the model provider (fenced, scoped); a ClickUp token has no scopes (OAuth tokens act as
the user in the Workspaces they authorized); ClickUp offers no token-revoke API.

## Re-check for 0.3.0: Tasks page source (2026-11-25)

Scope: `src/worker/task-source/` (`items.ts`, `task-source-service.ts`, `register.ts`),
`TaskTracker.queryTasks` (`src/clickup/clickup-tracker.ts`), `TaskService.queryTasks` /
`cachedStatuses`, `ScopeService.lists`, `StartService.projects` (was private), the manifest's
`contributes.commands`, and the settings change in `prefs-store.ts`. Same criteria as above.

| Area | Finding | Risk |
|---|---|---|
| Capabilities | None added. The commands need no capability (`commands.register`); everything they do goes through the services the panel already uses. `orca plugin validate` shows the same access list. | None |
| Network | No new destination. The one new request is `GET /team/{id}/task` with `list_ids[]` (chosen Lists only, never empty: no ids, no request), optional `assignees[]`, `statuses[]`, `include_closed`, `page`, through the same `ClickUpHttp` and the shared 80/minute gate. | None |
| Scope | List ids from the page's filters are intersected with the scope before the query, and every returned task outside it is dropped (`TaskService.queryTasks`); `get`/`action` go through `TaskService.get`, which refuses an out-of-scope task before it is cached or shown. Item ids must match `[A-Za-z0-9_-]{1,64}` before any request. | None |
| Untrusted text | Task titles, names and tags go to the Orca renderer as plain strings (it renders them as text); in the detail body they are markdown-escaped. The description is passed as markdown (capped at 100 000 characters) and the Overhedge renderer shows it through `CommentMarkdown` (rehype-sanitize), the counterpart of the panel's `Markdown`. Item links are only `https://app.clickup.com/...`, else rebuilt from the id. The agent prompt is the existing fenced one (`StartService.run`). | Low (same as the panel) |
| Writes | `set-status` only to a status of the task's own List (checked against `listStatuses`); `start` only into a visible git project from `project.list`, with the person's saved settings. Both are explicit menu picks on the Tasks page; nothing changes in the background. | Low |
| Command palette | On stock Orca the three commands appear in the palette. Without the page's arguments, `list` answers an empty list with a hint and sends nothing; `get`/`action` refuse. | None |
| Errors | The renderer shows the plugin's message; messages are the services' own texts. A refused token clears it as the panel does (`AuthService.invalidate`). No token, header or secret is in any answer or log line. | None |
| Settings | `moveOnDone` now defaults to off; only explicitly set fields are stored, so a future default change reaches everyone who never touched it. A 0.2.0 `moveOnDone: true` (written as the old default) reads as unset. | None (fewer automatic writes) |

Verdict: no new access, no new network destination, scope enforced on every path. Tests: 370 pass
(`orca plugin test`), `tsc --noEmit` clean, `orca plugin validate` / `check` ok.

## Re-check for 0.4.0: Send to chat (2026-11-25)

Scope: `src/shared/send-template.ts` (templates, rendering, message check), `src/worker/services/send-service.ts`,
`src/worker/stores/send-store.ts`, `src/worker/send-handlers.ts`, `chatGateway` in `src/worker/orca-adapters.ts`,
the `send-to-chat` action of the Tasks page source, the panel's `send.ts`, `SendToChat.tsx` and
`TemplatesSection.tsx`, and the manifest. Same criteria as above.

| Area | Finding | Risk |
|---|---|---|
| Capabilities | **One added: `chat:send`**, the Overhedge build's capability for `chat.list` and `chat.send` (fork branch `overhedge/chat-send`; stock Orca has no plugin method that sends into an existing chat). Consent text: "List your open Orca chats (agent, chat and workspace names, on this computer and paired Orca servers) and send a message into one; it cannot read their messages, open new chats or type into terminals". It is narrower than `terminal:send` (no keystrokes, no shell, no terminals at all) and was chosen over re-adding that. `terminal:read`, `terminal:send` and `workspace:write` stay out. | Medium (new write path into agent chats) |
| What the host enforces | `chat.send` takes `{ chatId, hostId, text }` only. Orca checks that the chat is open now on that host (its own `agent.list`), that a remote host is a paired server the desktop lists, that the text is at most 4000 characters of plain lines (no control, bidi or invisible characters) and does not start with `/`; it then makes the chat composer's own `agentSession.send` (`queue-if-active`, text only: no images, skills or options). Closed chats, terminal agents and unknown ids are refused, so no chat is created. Every send is in Orca's plugin audit log (host, chat id, length). | Low |
| What the chat receives | The message the person saw and could edit (panel), or the template filled as written (Tasks page menu, which has no editor: the template text is the person's own, the task values are cleaned). It is a user message, so the agent acts on it as on anything the person types: that is the feature, and why only the person's own text and cleaned task values go in. | Medium (by design) |
| Untrusted text | `{title}`, `{list}`, `{status}`, `{assignees}`: hidden characters removed, one line, capped (200/100). `{task_id}` / `{task_url}` are checked plain (`[A-Za-z0-9_-]`, `https://app.clickup.com/...`) or rebuilt from the id. `{description}` only when the template has it: CRLF/tabs normalized, hidden characters removed, capped at 1500, between random 16-hex fence lines with a "data, not instructions" line, and any copy of the fence in it removed. Placeholders expand in one pass (a title like `{description}` stays text). A result starting with `/` gets `Task: ` in front; a template starting with `/` is refused. Tests in `send-template.test.ts`. | Low |
| Chat list | `chat.list` gives chat id, host, server name, agent, chat name, workspace, status and time; never messages or the last reply. It is read only when the send form or the template editor opens, never in the background. Chat names are shown as plain text. | Low |
| Storage | Templates and the last chat per template in plugin storage (`prefs.sendTemplates`, `prefs.sendLast`): template text, chat ids and labels. No task text, no message bodies. | Low |
| ClickUp writes | None by default. A template may opt in to a comment ("Sent to an Orca chat (<label>) with the "<name>" message.") and/or a status (only one of the task's own List), after a successful send, through the existing `TaskService.update` (scope-checked). | Low |
| Scope | Every send reads the task through `TaskService.get`, which refuses a task outside the chosen Lists before anything is rendered or sent. | None |
| Network | No new destination. Delivery to the paired server goes through Orca (`chat.send`), not the plugin. | None |
| Stock Orca | 0.4.0's manifest asks for `chat:send`, which stock Orca's closed capability list does not know, so stock Orca refuses to install 0.4.0. The worker also checks `orca.host.has('chat.send')` before any call. | None (fails closed) |

Verdict: one new capability, narrower than the terminal access removed earlier; the host refuses
commands, hidden characters, closed chats, terminal agents and unknown hosts; task text stays
cleaned and fenced; nothing in ClickUp changes unless a template asks for it.

## Re-check for 0.4.1: status colours (2026-11-25)

Scope: `src/shared/status-color.ts`, the `color` fields in `mapper.ts`, `cache-store.ts`,
`transition-service.ts`, the panel views that show statuses, and the Tasks page source
(`items.ts`, `register.ts`).

| Area | Finding | Risk |
|---|---|---|
| Untrusted colour | ClickUp's `color` is kept only when it matches `^#(?:[0-9a-fA-F]{3}\|[0-9a-fA-F]{6})$` exactly (no names, `rgb()`, `url()`, spaces, `;`, newlines or bidi characters), normalized to `#rrggbb`; anything else becomes `null` at the mapper. Every reader checks it again (`statusColor`), including values read back from plugin storage. Tests feed `url()`, `;`, `}`, `</style>`, newlines and non-strings. | None |
| Where it goes | The panel never uses the hex in output: it picks one of nine fixed circle characters from it. The Tasks page gets the checked hex as a JSON field (`color`); the current Overhedge renderer drops it, and the proposed renderer change would use it only in React `style` objects (as Linear's pill does), never in class names, CSS text or HTML. | None |
| Capabilities, network, storage | No change: no new capability, no new request (colours come in the task and List answers already fetched), no new storage key (the fallback colour is computed from the name, not stored). | None |

## Re-check for 0.4.2: host-drawn status colours (2026-11-25)

Scope: `src/panel/views/StatusBadge.tsx`, its use in `Header.tsx`, `Subtasks.tsx` and `RunCard.tsx`,
and the Tasks page source now that the Overhedge build draws `color`.

| Area | Finding | Risk |
|---|---|---|
| What reaches Orca | Only `statusColor(...)`: ClickUp's colour after the strict hex check, else a palette constant. Never the raw ClickUp value. | None |
| How Orca uses it | The Overhedge build checks `#rgb`/`#rrggbb` again in its schema (Badge prop and task source answer) and once more right before drawing, and puts it only into React `style` objects through Linear's pill helpers (`color-mix(...)`), never class names, CSS text or markup. An invalid value is dropped with a warning. | None |
| Older Orca | The panel sends `color` only when `ui.has('Badge', 'color')` is true; otherwise the neutral Badge with a circle, as in 0.4.1. The Tasks page labels keep the circle unless the host sends `features: ["status-color"]`. | None |
| Capabilities, network, storage | No change. | None |
