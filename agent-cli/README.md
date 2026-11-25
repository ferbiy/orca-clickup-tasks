# clickup agent CLI and skill (phase 1b)

A small `clickup` command plus a Claude Code skill so agents in terminals (on the `orca-ide` server
and on the Mac) can read and update ClickUp tasks. Independent of the Orca plugin in this repo:
no Node, no build, Python 3 standard library only (macOS and Ubuntu 24.04 ship it).

```
agent-cli/
  skill/clickup        the tool (single Python file, executable)
  skill/SKILL.md       what agents read: commands, status aliases, allow-list, safety rules
  config.example.json  allow-list config template
  install.sh           installs the skill for every Claude config dir on this host
  tests/               unit tests, HTTP mocked
```

## Setup on a host

1. **Token**: `~/.clickup-token`, one line, `chmod 600` (already there on the Mac and on `orca-ide`).
   Another path: `CLICKUP_TOKEN_FILE=/path`. A personal token (`pk_…`) is sent as is; anything else is
   sent as `Bearer <token>` (an OAuth access token).
2. **Install**: from a checkout of this repo,
   ```sh
   sh agent-cli/install.sh --dry-run   # look first
   sh agent-cli/install.sh
   ```
   It copies `SKILL.md` and `clickup` into `~/.agents/skills/clickup/` (real files), adds
   `skills/clickup -> ../../.agents/skills/clickup` in `~/.claude`, `~/.claude-team`,
   `~/.claude-personal` (and `$CLAUDE_CONFIG_DIR`, `--config-dir DIR`) when they exist, and links
   `~/.local/bin/clickup`. Re-running it updates the files; existing foreign links are left alone.
3. **Allow-list**: create `~/.config/clickup-agent/config.json` (or `$CLICKUP_CONFIG`) from
   `config.example.json`. Find ids with `clickup config discover` and `clickup config discover --space ID`.
   Until the file lists at least one Space/Folder/List, every task read and write is refused.
4. Check: `clickup me`, `clickup lists --statuses`.

### Server (`orca-ide`) notes

- Config dirs present: `~/.claude`, `~/.claude-team`, `~/.claude-personal`; all get the link.
- Orca-managed Claude accounts live in `~/.config/orca/claude-profiles/<id>/home`. Orca's profile
  setup (`provisionClaudeProfile` in `src/main/claude-accounts/profiles/setup/`) links each profile's
  `skills/` to `~/.claude/skills`, so the skill reaches them through `~/.claude`. Both existing
  profiles were checked: their `skills` is such a link. The installer reports this ("covered"), and
  links into a profile only if it has its own real `skills/` folder.
- `~/.local/bin` is not on PATH for non-login shells there; the skill tells agents to run
  `~/.agents/skills/clickup/clickup`, which always works.
- To update after a pull: run `install.sh` again.

## Config

```json
{
  "team_id": "9012345678",
  "allow": { "spaces": [], "folders": ["…"], "lists": ["…"] },
  "status_overrides": { "<list id>": { "review": "ready for qa", "done": "deployed" } },
  "comments": 5,
  "max_rate_limit_wait_seconds": 65
}
```

- `team_id` (Workspace) can be left out when the token sees exactly one Workspace.
- A Space or Folder entry covers every List in it, including Lists added later (same model as the
  plugin's `Scope`). A task is allowed when its home List, Folder or Space is listed.
- `status_overrides` pins what an alias (`in-progress`, `review`, `done`, `closed`, `open`) means for one List.

## Tests

```sh
python3 -m unittest discover -s agent-cli/tests -v
```
