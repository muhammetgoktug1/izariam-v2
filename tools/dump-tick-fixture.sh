#!/usr/bin/env bash
# Dump the tick golden fixture, one HTTP request per scenario.
#
# Load_Player never clears its $this->towns array, so batching scenarios into a
# single PHP process lets town keys leak between them and inflates the colony
# count that drives corruption. One request per scenario gives every case a
# fresh CodeIgniter instance.
#
# Scenario names travel as a URI segment, not a query string: CI 1.7 empties
# $_GET whenever enable_query_strings is off.
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
OUT="${OUT:-fixtures/tick.json}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

NAMES=$(curl -fsS "$BASE/dump/tick/list" \
  | python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin)))')

count=$(printf '%s\n' "$NAMES" | wc -l | tr -d ' ')
echo "scenarios: $count"

while IFS= read -r name; do
  [ -n "$name" ] || continue
  printf '  %-26s' "$name"
  curl -fsS "$BASE/dump/tick/$name" -o "$TMP/$name.json"
  python3 - "$TMP/$name.json" "$name" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))["scenarios"].get(sys.argv[2])
if s is None or "error" in s:
    print("FAILED", s)
    sys.exit(1)
print("ok  colonies=%s" % s.get("derived", {}).get("colonies"))
PY
done <<< "$NAMES"

printf '%s\n' "$NAMES" | python3 -c '
import json, os, sys
tmp, out = sys.argv[1], sys.argv[2]
names = [n for n in sys.stdin.read().split("\n") if n]
merged = {"scenarios": {}}
for n in names:
    merged["scenarios"][n] = json.load(open(os.path.join(tmp, n + ".json")))["scenarios"][n]
with open(out, "w") as fh:
    json.dump(merged, fh, indent=1, sort_keys=True)
    fh.write("\n")
print("wrote %s: %d scenarios, %.1f KB" % (out, len(merged["scenarios"]), os.path.getsize(out) / 1024))
' "$TMP" "$OUT"
