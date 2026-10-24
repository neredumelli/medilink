#!/usr/bin/env bash
# Turns a failed step's output into annotations that show on the pull request (and through the API),
# so a failure can be read without opening the raw log. Usage: report.sh <output file> <exit code>
# GitHub keeps at most 10 annotations per step: 1 summary + up to 7 parts of the output's end.
out="$1"; code="$2"
[ "$code" = "0" ] && exit 0
enc() { local s="${1//'%'/'%25'}"; s="${s//$'\r'/}"; printf '%s' "${s//$'\n'/'%0A'}"; }
summary="$(grep -E "✕|●|Expected|Received|error TS|FAIL|Cannot|Timeout|thrown|Error:|ERR_|FATAL|ERROR" "$out" | head -12)"
[ -n "$summary" ] && echo "::error title=Summary::$(enc "$summary")"
tail -c 42000 "$out" > /tmp/report-tail.txt
split -b 6000 /tmp/report-tail.txt /tmp/report-part-
for f in /tmp/report-part-*; do echo "::error title=Output ($(basename "$f"))::$(enc "$(cat "$f")")"; done
rm -f /tmp/report-part-* /tmp/report-tail.txt
exit "$code"
