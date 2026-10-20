#!/usr/bin/env bash
# Push JMM main with Zain's SSH key, asking the passphrase in a macOS popup (hidden field).
# The passphrase goes from the popup straight to ssh-add: Claude never sees it, nothing is saved (no
# Keychain). The key is unlocked for 5 minutes and removed right after the push.
# (From bounty-hunter's ops/push.sh on old-bounty-hunter; tags and deploys dropped.)
#   bash crash-test/ops/push.sh
set -uo pipefail
KEY="$HOME/.ssh/personal"
OPS="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$OPS/../.." && pwd)"
mkdir -p "$OPS/logs"
LOG="$OPS/logs/$(date +%Y%m%d-%H%M%S)-push.log"
AHEAD="$(git -C "$REPO" rev-list --count origin/main..main 2>/dev/null || echo "?")"
what="push JMM main ($AHEAD commits)"

# the popup ssh-add calls for the passphrase (SSH_ASKPASS); "Cancel" = no push
ASK="$(mktemp "${TMPDIR:-/tmp}/askpass.XXXX")"; trap 'rm -f "$ASK"' EXIT
cat > "$ASK" <<EOF
#!/bin/sh
exec osascript -e 'text returned of (display dialog "Unlock ~/.ssh/personal for 5 minutes to: $what" with title "JMM push" default answer "" with hidden answer buttons {"Cancel", "Unlock"} default button "Unlock")'
EOF
chmod 700 "$ASK"

echo "== $what" | tee "$LOG"
if ! SSH_ASKPASS="$ASK" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}" ssh-add -t 300 "$KEY" </dev/null >>"$LOG" 2>&1; then
  echo "key not unlocked (cancelled or wrong passphrase): nothing pushed" | tee -a "$LOG"
  echo "exit code: 1" >> "$LOG"; exit 1
fi
git -C "$REPO" push origin main 2>&1 | tee -a "$LOG"
rc=${PIPESTATUS[0]}
ssh-add -d "$KEY" >/dev/null 2>&1
echo "exit code: $rc   key removed: $(ssh-add -l >/dev/null 2>&1 && echo NO || echo yes)" | tee -a "$LOG"
exit "$rc"
