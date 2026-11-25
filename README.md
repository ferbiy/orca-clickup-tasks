# ClickUp Tasks for Orca (Overhedge fork)

Your ClickUp tasks, from the Lists you choose, in Orca's right sidebar and (with the Overhedge Orca
build) as a ClickUp tab on Orca's Tasks page. Sign in with OAuth, start a task in its own worktree
with your coding agent, and let the task's status follow the List's own workflow.

Fork of [gthjnk/orca-clickup-tasks](https://github.com/gthjnk/orca-clickup-tasks) (MIT), based on its
`feature/start-task` branch after a full audit: see [SECURITY-AUDIT.md](SECURITY-AUDIT.md).

## What it does

- **Sign in with ClickUp (OAuth)**, using your own ClickUp OAuth app. A personal API token still works
  as a fallback.
- **Choose which Spaces, Folders or Lists Orca may see** (Settings › Lists). Only tasks in those Lists
  are fetched, shown, or ever put into an agent prompt. Nothing is fetched until you choose.
- **My tasks** (assigned to you, in the chosen Lists) and **Browse** (the chosen Lists only), with
  search, filters and the full task view and editing from the upstream plugin.
- **Start in worktree**: Orca creates a worktree and branch named after the task (the Custom Task ID
  when the Workspace uses them, e.g. `OVH-142-fix-login`, else `CU-<id>-<title>`) on this computer or
  on a paired Orca server, and starts your agent there with the task as its first prompt.
- **Status follows the List**: on start the task moves to the List's in-progress status. Moving it to
  the List's review status when the agent first finishes is a setting, **off by default** since 0.3.0
  (agents set their own review status); turn it on in Settings if you want it. Defaults come from
  ClickUp's status types; each List can override them or say "don't change". When no status fits,
  nothing changes and the run card says why. A comment with the branch and agent is posted on start
  (and on finish when that move is on); it can be turned off.
- **Tasks page tab** (Overhedge Orca build only): the same tasks, search, filters, status menu and
  Start, on Orca's own Tasks page. See [Orca's Tasks page](#orcas-tasks-page-overhedge-build).

## Install (Orca desktop app)

Install only a pinned commit of this fork, never the community catalog listing:

```sh
orca plugin install https://github.com/ferbiy/orca-clickup-tasks@<commit-sha> --json
# exits with approval_required and prints a fingerprint; review the permissions below, then:
orca plugin install https://github.com/ferbiy/orca-clickup-tasks@<commit-sha> --approve <fingerprint> --json
```

The plugin installs as `ferbiy.clickup-tasks`. A commit-pinned install never updates by itself:
`orca plugin update` reports it as `pinned`, and Orca's automatic updater only touches catalog
installs. To move to a newer version, install the newer commit the same way. We also recommend
turning off **Settings › Plugins › Update plugins automatically** (`pluginUpdatePolicy: "manual"`)
so no catalog plugin updates silently. A plugin cannot change that setting itself.

**From 0.2.0:** "Move to review when the agent first finishes" is now off by default. 0.2.0 saved
every setting whenever any one changed, so a saved "on" that was only the old default reads as off
after the update; an explicit "off" stays off. Turn it on again in Settings if you want it.

If the upstream `gthjnk.clickup-tasks` is installed, uninstall it first (`orca plugin uninstall
gthjnk.clickup-tasks`) so there is one ClickUp panel.

**Where it runs.** Plugins run in the Orca desktop app (the worker is a process of the desktop's main
process). With the desktop paired to a remote Orca server, the worker, the browser and the OAuth
loopback listener are all on your computer, and a project on the server is started on the server.
A headless `orca serve` has no plugin service, so this plugin cannot run there, and Orca's web
client in a browser cannot use it.

Requires Orca `>=1.4.260` and an OS keychain (macOS Keychain; on Linux GNOME Keyring or KWallet).

## Connect: create your ClickUp OAuth app (once)

ClickUp has no PKCE and no public clients, so the token exchange needs the app's client secret. The
app is yours; its secret is stored only in your OS keychain through Orca, never in this repository
or in any file.

1. In ClickUp (Workspace owner or admin): avatar (top right) › **Settings** › **Apps** ›
   **Create new app**.
2. **App name**: `Orca (Overhedge)`.
3. **Redirect URL**: `http://127.0.0.1:47386/callback` (ClickUp may show only the host part,
   `127.0.0.1`; that is fine). If ClickUp refuses `127.0.0.1`, use `http://localhost:47386/callback`
   and enter the same URL in the plugin.
4. Copy the **Client ID** and **Client secret**.
5. In Orca, open the **ClickUp Tasks** panel, paste the client id, the secret and (only if you
   changed it) the redirect URL, and press **Save app**.
6. Press **Sign in with ClickUp**, then **Open ClickUp to allow access**. Pick the Workspace(s) and
   allow. The browser comes back to `127.0.0.1:47386`, the panel signs in by itself, and the tab says
   you can close it.
7. Open **Settings › Lists** and choose what Orca may see.

If the browser cannot reach the listener (port 47386 in use, or a non-loopback redirect URL), copy the
address the browser ended on (it may show an error page) into **Address your browser ended on** and
press **Finish sign-in**.

**Sign out** deletes the token from Orca; the app stays saved for the next sign-in (**Forget app**
removes it). ClickUp has no API to revoke a token: to cut access everywhere, regenerate the app's
secret or delete the app in ClickUp › Settings › Apps. OAuth tokens do not expire today; if ClickUp
refuses the token later, the panel returns to the sign-in screen.

Fallback: **Use a personal API token instead** (ClickUp › Settings › Apps › API Token). It acts as
you in every Workspace and never expires; use it for development only.

## Permissions

| Capability | Why |
|---|---|
| `secrets:own` | Keep the ClickUp token and the OAuth app's client secret in the OS keychain. |
| `storage:own` | Cache tasks, statuses and the Workspace hierarchy; remember the chosen Lists, status choices, settings and task ↔ worktree links. |
| `workspace:read` | List your projects (all hosts) for the Start form, read back the branch Orca created, and drop a link when its worktree is removed. |
| `workspace:create` | Create one worktree per task you start, on the project's host. |
| `agent:launch` | Start your agent in that worktree with the task prompt (part of `workspace.create`). |
| `agent:read` | Know when the agent is working, needs input or has finished (status move, notification), and check runs that never started. |
| `notifications:show` | "Claude finished …" / "needs input" notifications. |

Not requested (the upstream branch asked for them): `terminal:read`, `terminal:send`,
`workspace:write`. The plugin never reads or types into a terminal and never switches your focus.
It has no hooks and no settings capability. Only its worker talks to the network: to
`api.clickup.com`, plus a listener on `127.0.0.1:47386` while a sign-in waits.

## Privacy and safety

- Only the chosen Lists are queried (`list_ids[]`), and any task outside them is refused before it
  is cached, shown or put into a prompt.
- Task text is untrusted. In the agent prompt only the task id and its ClickUp link sit outside a
  random per-prompt fence; the title, description, checklists, fields, attachments and comments are
  inside it, marked as data, not instructions. Task text still goes to your model provider with the
  prompt, as for Jira or Linear in Orca.
- ClickUp changes only through what you start or edit (in the panel or on the Tasks page): a status
  move and comment at start, and (setting, off by default) a status move and comment the first time
  the agent finishes, only while the task still shows the status the start set.
- ClickUp allows 100 requests a minute per token on Free, Unlimited and Business plans. The worker
  keeps itself under 80 a minute for the panel and the Tasks page together, caches lists, statuses
  and the hierarchy, and stops after a 429 until ClickUp's reset time. The plugin itself polls
  nothing; the Tasks page asks for its list every two minutes while it is open (see below).

## Orca's Tasks page (Overhedge build)

Needs the Overhedge Orca build that contains plugin task sources (fork branch
`overhedge/task-sources`, from 97de206 on; `OVERHEDGE.md` › "Plugin task sources"). The plugin
declares three worker commands, `taskSource.clickup.list`, `.get` and `.action`; that build turns
them into a **ClickUp** tab on the Tasks page next to GitHub, GitLab, Linear and Jira. On stock Orca
they are ordinary command palette entries ("ClickUp tasks", "ClickUp tasks: task details / task
action (used by the Tasks page)"): running one from the palette sends no ClickUp request and does
nothing useful, and the panel works as before. No new permission is needed.

- **List**: only tasks of the Lists chosen in Settings › Lists (nothing before you choose; a notice
  says so, or asks you to sign in in the panel first). Filters: **List** (all chosen Lists or one,
  shown as `Folder › List`), **Assignee** (me, the default, or anyone), **Status** (the chosen
  List's real statuses; with all Lists, the statuses already cached), **Closed** (hidden by
  default). Search matches the title, Custom Task ID, task id and List name. **Load more** pages on.
- **Detail**: title with the Custom Task ID, status, priority, assignees, tags, and a body with the
  location, due date, the description (ClickUp's markdown, untrusted: shown through Orca's sanitizing
  markdown view, as in the panel), checklists, subtasks and the Orca runs started for the task.
- **Actions**: **Status ▾** (the List's statuses; moves the task and refreshes the panel's row),
  **Start <agent> ▾** (your git projects on every host, the one last used for that List first). Start
  is the panel's Start flow with your Settings defaults (agent, base branch, move to in progress,
  task context): a worktree and branch named after the Custom Task ID as the team writes it
  (`OVH-142-<slug>`, else `CU-<id>-<slug>`), the agent with the fenced task prompt, the status move
  and comment; the run then shows on the panel's card as usual. **Open in browser** is the Tasks
  page's own button for the task's ClickUp link.
- **Requests**: "mine, not closed" views (the default) come from the panel's My tasks cache, fetched
  again only when older than a minute; other views ask ClickUp for one page of 100 at a time and
  reuse it for a minute (ClickUp has no text search, so a search there reads up to five pages per
  answer). The page asks again every two minutes while open, so an open Tasks page costs about one
  My tasks fetch (one request per 100 tasks per 40 Lists) every two minutes. Opening a task costs one
  request; a status move two.

## Limitations

- The Tasks page tab needs the Overhedge Orca build (above); stock Orca has no plugin task-source
  extension point yet (upstream PR #26282 is open).
- If Orca loses the agent's first prompt, the run card shows it for you to paste; the plugin no longer
  retries by typing into the terminal.
- Not included: creating top-level tasks, time tracking, several accounts at once. The Tasks page
  has no comments, editing or per-start choices (agent, base branch): use the panel for those.

## Development

No build step and no npm dependencies. Tests use Orca's own runner:

```sh
orca plugin test .
orca plugin types . && npx -y -p typescript@5.9.3 tsc -p . --noEmit
orca plugin check . --json
orca plugin dev watch .
```

Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (upstream design; see "Overhedge fork changes"
at its top). Task context: [docs/TASK-CONTEXT.md](docs/TASK-CONTEXT.md).

## License

MIT (upstream copyright kept in [LICENSE](LICENSE)).
