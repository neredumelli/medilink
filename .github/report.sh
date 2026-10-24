#!/usr/bin/env bash
# Turns a failed step's output into annotations that show on the pull request (and through the API),
# so a failure can be read without opening the raw log. Usage: report.sh <output file> <exit code>
out="$1"; code="$2"
[ "$code" = "0" ] && exit 0
enc() { local s="${1//'%'/'%25'}"; s="${s//$'\r'/}"; printf '%s' "${s//$'\n'/'%0A'}"; }
# 1) Likely causes, one per line (first 8)
grep -E "✕|●|Expected|Received|error TS|FAIL|Cannot|Timeout|thrown|Error:|ERR_" "$out" | head -8 | while IFS= read -r l; do echo "::error::$(enc "$l")"; done
# 2) The last part of the output as one block, cut into pieces that fit an annotation
tail -c 24000 "$out" > /tmp/report-tail.txt
split -b 7000 /tmp/report-tail.txt /tmp/report-part-
for f in /tmp/report-part-*; do echo "::error title=Output ($(basename "$f"))::$(enc "$(cat "$f")")"; done
rm -f /tmp/report-part-* /tmp/report-tail.txt
exit "$code"
