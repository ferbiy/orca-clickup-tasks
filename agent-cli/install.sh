#!/bin/sh
# Install the `clickup` agent skill for Claude Code on this host (macOS or Linux).
#
#   sh agent-cli/install.sh --dry-run     # show what would change, change nothing
#   sh agent-cli/install.sh               # install / update
#
# What it does (same layout as the other shared skills such as orca-cli / orchestration):
#   1. copies SKILL.md and the `clickup` tool as real files into ~/.agents/skills/clickup/
#   2. in each existing Claude config dir (~/.claude, ~/.claude-team, ~/.claude-personal,
#      $CLAUDE_CONFIG_DIR, and any --config-dir) adds skills/clickup -> ../../.agents/skills/clickup
#   3. checks Orca-managed Claude profiles (<orca data>/claude-profiles/*/home): Orca links their
#      skills/ folder to ~/.claude/skills, so they are covered by step 2; a profile with its own
#      real skills/ folder gets its own link
#   4. links ~/.local/bin/clickup -> ~/.agents/skills/clickup/clickup when ~/.local/bin exists
# It never reads the token file (only checks it exists and its permissions) and never writes
# the allow-list config: create ~/.config/clickup-agent/config.json yourself (see README.md).
set -eu

DRY=0
EXTRA_DIRS=""
BIN_DIR="$HOME/.local/bin"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --config-dir) shift; EXTRA_DIRS="$EXTRA_DIRS $1" ;;
    --bin-dir) shift; BIN_DIR="$1" ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

SRC_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/skill
NAME=clickup
DEST="$HOME/.agents/skills/$NAME"

run() {
  if [ "$DRY" = 1 ]; then echo "would: $*"; else echo "+ $*"; "$@"; fi
}

[ -f "$SRC_DIR/SKILL.md" ] && [ -f "$SRC_DIR/clickup" ] || { echo "missing $SRC_DIR/SKILL.md or clickup" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || echo "warning: python3 not found on PATH; the tool needs Python 3.8+" >&2

# 1. real files in ~/.agents/skills/clickup
echo "== skill files -> $DEST"
run mkdir -p "$DEST"
for f in SKILL.md clickup; do
  if [ -f "$DEST/$f" ] && cmp -s "$SRC_DIR/$f" "$DEST/$f"; then
    echo "unchanged: $DEST/$f"
  else
    run cp "$SRC_DIR/$f" "$DEST/$f"
  fi
done
run chmod 755 "$DEST/clickup"
run chmod 644 "$DEST/SKILL.md"

# 2. links in each Claude config dir
link_into() { # $1 = config dir
  cfg=$1
  [ -d "$cfg" ] || { echo "skip (absent): $cfg"; return; }
  skills="$cfg/skills"
  if [ -L "$skills" ]; then
    echo "covered: $skills is a link to $(readlink "$skills")"
    return
  fi
  case "$cfg" in
    "$HOME"/.[!/]*) target="../../.agents/skills/$NAME"
      case "${cfg#"$HOME"/}" in */*) target="$DEST" ;; esac ;;
    *) target="$DEST" ;;
  esac
  link="$skills/$NAME"
  if [ -L "$link" ]; then
    if [ "$(readlink "$link")" = "$target" ] || [ "$(cd "$link" 2>/dev/null && pwd -P)" = "$(cd "$DEST" 2>/dev/null && pwd -P)" ]; then
      echo "unchanged: $link"
    else
      echo "skip: $link already points to $(readlink "$link") (remove it to relink)"
    fi
    return
  fi
  if [ -e "$link" ]; then
    echo "skip: $link exists and is not a link (left alone)"
    return
  fi
  [ -d "$skills" ] || run mkdir -p "$skills"
  run ln -s "$target" "$link"
}

echo "== Claude config dirs"
seen=""
for cfg in "$HOME/.claude" "$HOME/.claude-team" "$HOME/.claude-personal" ${CLAUDE_CONFIG_DIR:-} $EXTRA_DIRS; do
  case " $seen " in *" $cfg "*) continue ;; esac
  seen="$seen $cfg"
  link_into "$cfg"
done

# 3. Orca-managed Claude profiles
echo "== Orca Claude profiles"
found=0
for root in "$HOME/.config/orca" "$HOME/Library/Application Support/orca"; do
  for home in "$root"/claude-profiles/*/home; do
    [ -d "$home" ] || continue
    found=1
    link_into "$home"
  done
done
[ "$found" = 1 ] || echo "none found"

# 4. command on PATH
echo "== command"
if [ -d "$BIN_DIR" ]; then
  if [ -L "$BIN_DIR/$NAME" ] && [ "$(readlink "$BIN_DIR/$NAME")" = "$DEST/clickup" ]; then
    echo "unchanged: $BIN_DIR/$NAME"
  elif [ -e "$BIN_DIR/$NAME" ] || [ -L "$BIN_DIR/$NAME" ]; then
    echo "skip: $BIN_DIR/$NAME exists (left alone)"
  else
    run ln -s "$DEST/clickup" "$BIN_DIR/$NAME"
  fi
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "note: $BIN_DIR is not on PATH here; agents can run $DEST/clickup" ;; esac
else
  echo "skip: $BIN_DIR does not exist; agents run $DEST/clickup"
fi

# 5. token and config checks (the token is never read)
echo "== checks"
tok=${CLICKUP_TOKEN_FILE:-$HOME/.clickup-token}
if [ -f "$tok" ]; then
  perms=$(ls -ln "$tok" | cut -c1-10)
  case "$perms" in -rw-------|-r--------) echo "token file: $tok ($perms)" ;; *) echo "warning: token file $tok has mode $perms; run: chmod 600 $tok" ;; esac
else
  echo "warning: no token file at $tok (one line, the ClickUp token, chmod 600)"
fi
conf=${CLICKUP_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/clickup-agent/config.json}
if [ -f "$conf" ]; then echo "config: $conf"; else
  echo "note: no allow-list config at $conf yet; until it exists every task read/write is refused."
  echo "      Copy $(dirname "$SRC_DIR")/config.example.json there and fill in ids (\`$DEST/clickup config discover\`)."
fi
[ "$DRY" = 1 ] && echo "(dry run: nothing changed)"
exit 0
