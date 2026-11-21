# ClickUp Tasks for Orca

Your ClickUp tasks in Orca's sidebar: browse, read and edit them, and start any task in its own worktree with your coding agent.

## Features

- A sidebar panel listing the ClickUp tasks assigned to you, grouped by status, with priority and due date.
- Filters and presets (search, List, priority, due, created today, no time estimate) and sorting by due date, priority or last update.
- **Browse** any Space › Folder › List of your Workspace, with "Show closed" and paging.
- A full task view: properties, description, checklists, subtasks, attachments and comments.
- Edit the task in place: title, status, priority, assignees, watchers, start/due date, time estimate, tags, parent, and the description (Markdown with preview). Each change saves to ClickUp right away.
- Checklists, subtasks and comments: add, check off, rename, delete, reply, @mention, assign and resolve.
- **Start** a task: Orca creates a worktree named `CU-<id>-<slug>` and launches your coding agent with a prompt built from the task. Optionally move the task to its "in progress" status.
- A notification when the agent finishes, an **Open workspace** button, and an **Update task** form (new status + prefilled comment, sent only when you press it).
- Runs that never start (agent CLI missing, prompt lost) are detected; **Retry**, **Send the task prompt** or **Stop tracking** from the run card.
- Copy a task's link from its detail view.
- Cached list, refreshed on demand (nothing polls ClickUp in the background).

## Install

```sh
orca plugin install gthjnk/orca-clickup-tasks --json
# or pin a version tag
orca plugin install gthjnk/orca-clickup-tasks@v0.1.0 --json
```

The plugin runs code, so the first install exits with `approval_required` and prints an `--approve` fingerprint. Review the [permissions](#permissions) below, then re-run the same command with `--approve <fingerprint>`.

Update with `orca plugin update --all` and remove with `orca plugin uninstall <plugin-key>`.

Requires Orca `>=1.4.259`.

## Connect

1. In ClickUp: avatar → **Settings** → **Apps** → **API Token**, then copy your Personal API token.
2. Open the **ClickUp Tasks** panel in Orca, paste the token and press **Connect**.
3. If you belong to more than one ClickUp Workspace, pick one.

## Permissions

Orca shows these when you approve the plugin. Nothing beyond this list is requested.

| Capability | Why |
|---|---|
| `secrets:own` | Store your ClickUp token in the OS keychain. |
| `storage:own` | Cache your task list and the Workspace hierarchy, remember links between tasks and worktrees, and your settings. |
| `workspace:read` | List your projects and worktrees, read back the branch name, and notice when a worktree is removed. |
| `workspace:create` | Create one worktree per task you start. |
| `workspace:write` | Power the **Open workspace** button. |
| `agent:launch` | Launch your coding agent in that worktree with the task prompt. |
| `agent:read` | Learn when the agent has finished. |
| `terminal:read` | Read the agent's terminal to tell when its CLI could not start. |
| `terminal:send` | Type the task prompt into a retried or idle agent (Orca can drop a plugin's launch prompt). |
| `notifications:show` | Tell you "Claude finished …". |

The plugin has no hooks. Only its background worker talks to the network, and only to `api.clickup.com`.

## Privacy & security

- Your token is kept in the OS keychain via Orca's secrets store. It is never logged, never written to storage, and never kept in the panel after you submit it.
- Task text is treated as untrusted data. The agent prompt fences it with a random per-run marker, tells the agent it is data and not instructions, and caps the description at 8,000 characters.
- ClickUp changes only when you change something: each edit in the task view saves that one field, the post-run form sends nothing until you press **Update task**, and starting a task only changes its status if you opt in. Text edits check that the task has not changed in ClickUp first, so you never overwrite someone else's edit.
- No telemetry. The plugin talks only to the ClickUp API.

## Limitations (v0.1)

- Personal API token, not OAuth.
- Not on Orca's Tasks page yet; waiting on upstream support ([stablyai/orca#26281](https://github.com/stablyai/orca/issues/26281)).
- Start supports local git projects only (no folders, hidden projects or remote hosts).
- Not included yet: creating top-level tasks, time tracking, multiple accounts.
- ClickUp allows about 100 requests a minute; refresh is disabled briefly if you hit the limit.

## Development

```sh
orca plugin test .
npx -y -p typescript@5.9.3 tsc -p . --noEmit
orca plugin check . --json
orca plugin dev watch .
```

Design and structure: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Task context: [docs/TASK-CONTEXT.md](docs/TASK-CONTEXT.md).

## License

MIT
