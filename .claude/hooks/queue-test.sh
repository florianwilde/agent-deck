#!/usr/bin/env bash
# agent-deck Queue-Test (Phase 0 B).
#
# Stop-Hook, der genau einmal einen Folgeauftrag einreiht: Existiert
# .claude/queue-test-pending, wird die Datei gelöscht und
# {"decision":"block","reason":"…"} ausgegeben. Claude arbeitet dann mit dem
# reason als neuer Anweisung weiter. Ohne Datei: keine Ausgabe. Immer Exit 0.

exec 2>/dev/null
trap 'exit 0' ERR

pending="${CLAUDE_PROJECT_DIR:-.}/.claude/queue-test-pending"
[ -f "$pending" ] || exit 0
rm -f "$pending" || exit 0

printf '%s\n' '{"decision":"block","reason":"Schreibe '"'"'Queue-Test ok'"'"' in docs/queue-test.md"}'
exit 0
