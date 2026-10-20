#!/usr/bin/env bash
# lag-watch.sh: records what is using the Mac's CPU while crash-test work runs, so "why is the laptop
# laggy?" is answered from data. Every N seconds it writes one line per sample: load average, total CPU of
# our project processes (anvil, node/tsx, forge), Hermes (app + its Python), and the top 3 other apps.
# Read-only: it changes nothing. Stop it with Ctrl-C or `pkill -f lag-watch.sh`.
#
#   bash ops/lag-watch.sh [seconds=20] [log=ops/logs/lag-<date>.log]
set -euo pipefail

interval="${1:-20}"
log="${2:-$(dirname "$0")/logs/lag-$(date +%Y%m%d-%H%M).log}"
mkdir -p "$(dirname "$log")"

sample() {
  local load ps_out ours hermes others speed
  load="$(sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}')"
  # Thermal throttling: macOS caps CPU speed when the Mac runs hot (100 = full speed).
  speed="$(pmset -g therm 2>/dev/null | awk '/CPU_Speed_Limit/ {print $3}' || true)"
  speed="${speed:-100}"
  ps_out="$(ps -Ao pcpu=,comm= -r)"
  ours="$(awk '$2 ~ /anvil|forge|solc/ || ($2 ~ /node$/) {s+=$1} END {printf "%.0f", s}' <<<"$ps_out")"
  hermes="$(awk '$0 ~ /Hermes|\.hermes\/tools\/python/ {s+=$1} END {printf "%.0f", s}' <<<"$ps_out")"
  others="$(grep -v -E 'anvil|forge|solc|node$|Hermes|\.hermes/tools/python' <<<"$ps_out" |
    awk 'NR <= 3 {n=$NF; if (match($0, /[^\/]+\.app\//)) n=substr($0, RSTART, RLENGTH-5); else sub(/.*\//, "", n); printf "%s %s%%, ", n, $1}' || true)"
  printf '%s  load %-5s  cpu-speed %3s%%  crash-test %4s%%  hermes %4s%%  others: %s\n' "$(date +%H:%M:%S)" "$load" "$speed" "$ours" "$hermes" "${others%, }" >>"$log"
}

# == steps ==
echo "== lag-watch: every ${interval}s -> $log (cores: $(sysctl -n hw.ncpu))"
while true; do
  sample
  sleep "$interval"
done
