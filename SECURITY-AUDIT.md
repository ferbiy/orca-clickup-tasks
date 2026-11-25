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
`notifications:show` (each explained in the README). Residual risks: task text still reaches the
agent and the model provider (fenced, scoped); a ClickUp token has no scopes (OAuth tokens act as
the user in the Workspaces they authorized); ClickUp offers no token-revoke API.
