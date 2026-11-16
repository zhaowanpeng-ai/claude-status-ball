#!/usr/bin/env bash
# Run this on the server that hosts Claude Code:
#   bash claude-status-ball/remote/install_remote.sh
# It installs the hook script and merges the hooks into ~/.claude/settings.json
# after making a timestamped backup.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.claude-ball"
PY="$(command -v python3 || command -v python || true)"

if [ -z "$PY" ]; then
  echo "Error: python3 was not found on this server."
  exit 1
fi

mkdir -p "$DEST"
cp "$HERE/hook_send.py" "$DEST/hook_send.py"
chmod +x "$DEST/hook_send.py"

"$PY" - "$DEST/hook_send.py" "$PY" <<'PYEOF'
import json
import os
import shutil
import sys
import time

hook_path = sys.argv[1]
python = sys.argv[2]
settings_path = os.path.expanduser("~/.claude/settings.json")
os.makedirs(os.path.dirname(settings_path), exist_ok=True)


def command(action):
    return '{} "{}" {}'.format(python, hook_path, action)


wanted = {
    "UserPromptSubmit": command("running"),
    "PostToolUse": command("tool"),
    "Stop": command("done"),
    "Notification": command("waiting"),
    "SessionEnd": command("end"),
}

if os.path.exists(settings_path):
    try:
        with open(settings_path, encoding="utf-8") as f:
            settings = json.load(f)
    except Exception as exc:
        print("Error: cannot parse {}: {}".format(settings_path, exc))
        sys.exit(1)
    backup = settings_path + ".bak." + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(settings_path, backup)
    print("Backed up to " + backup)
else:
    settings = {}

hooks = settings.setdefault("hooks", {})
added = []
for event, cmd in wanted.items():
    groups = hooks.setdefault(event, [])
    already = any(
        "claude-ball" in hook.get("command", "")
        for group in groups
        for hook in group.get("hooks", [])
    )
    if already:
        continue
    groups.append({"hooks": [{"type": "command", "command": cmd, "timeout": 5}]})
    added.append(event)

with open(settings_path, "w", encoding="utf-8") as f:
    json.dump(settings, f, indent=2, ensure_ascii=False)
    f.write("\n")

print("Updated hooks: " + (", ".join(added) if added else "no changes (already installed)"))
print("Hook script: " + hook_path)
PYEOF

echo
echo "Server-side install complete."
echo "Next, on Windows:"
echo "  1. Configure the SSH RemoteForward (see README or windows/ssh_config_example.txt)"
echo "  2. Start the status ball app (app/start_ball.vbs)"
echo "  3. Reopen Claude Code sessions so they load the new hooks"
