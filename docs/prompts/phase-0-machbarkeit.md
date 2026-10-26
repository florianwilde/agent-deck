# Phase 0 – Machbarkeit in der Cloud prüfen

Lies zuerst `CLAUDE.md`. Diese Phase hat zwei Teile, jeweils in einer eigenen Session.

## Teil A – Capture-Server und Test-Hook bauen

Ziel: Herausfinden, was in Claude-Code-Cloud-Sessions wirklich ankommt, bevor wir das echte System bauen.

1. Lies per Context7 bzw. WebFetch die aktuellen Docs:
   - https://code.claude.com/docs/en/hooks
   - https://code.claude.com/docs/en/cloud-environments
   - https://code.claude.com/docs/en/claude-code-on-the-web
2. Lege das Monorepo-Gerüst an (pnpm workspaces, TypeScript strict, vitest, ESLint, Prettier) mit den Paketen aus `CLAUDE.md`; vorerst nur leere Pakete mit README.
3. Baue in `packages/hub` einen **Capture-Modus** (`HUB_MODE=capture`):
   - `POST /events` speichert jeden Request-Body unverändert plus Zeitstempel und Header (ohne `Authorization`) in SQLite.
   - `GET /capture?since=<iso>` liefert die gespeicherten Einträge als JSON (Bearer-Token Pflicht).
   - Dockerfile + `docker-compose.yml`, Konfiguration über `.env` (`.env.example` mitliefern).
4. Baue `packages/hook/agent-deck-capture.sh`: liest den Hook-Payload von stdin und schickt ihn **vollständig** an `POST /events`, zusammen mit `env` (Variablen, deren Name `KEY`, `TOKEN`, `SECRET`, `PASSWORD` oder `AUTH` enthält, entfernen). Läuft nur, wenn `CLAUDE_CODE_REMOTE=true`. Immer Exit 0, keine Ausgabe.
5. Trage den Capture-Hook in **dieses** Repo ein (`.claude/settings.json`, `.claude/hooks/`) für: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `StopFailure`, `SessionEnd` (alle Events, die die aktuelle Doku nennt). Hub-URL aus einer Umgebungsvariable `AGENT_DECK_URL`.
6. Schreibe `docs/setup-phase-0.md` mit einer Schritt-für-Schritt-Anleitung für mich (siehe unten), committe, öffne einen PR und halte an.

### Was ich (Florian) danach mache – bitte in `docs/setup-phase-0.md` ausformulieren
- Hub im Homelab per Docker starten, NetBird-Reverse-Proxy-Eintrag für die Subdomain anlegen.
- In der Claude-Cloud-Umgebung: Network access **Custom**, Hub-Domain + Defaults erlauben; Network Secret mit dem Token für die Hub-Domain anlegen; `AGENT_DECK_URL` als Umgebungsvariable setzen.
- PR mergen, dann in einer **neuen** Session in diesem Repo ein paar Dinge tun: eine Frage stellen lassen, eine Datei ändern lassen, eine Aufgabe fertig werden lassen, einen Fehler provozieren, die Session beenden.

## Teil B – Auswerten

(Neue Session, nachdem ich Teil A eingerichtet und getestet habe.)

1. Hole die Einträge über `GET /capture`.
2. Beantworte in `docs/cloud-findings.md` mit echten Beispiel-Payloads (gekürzt, ohne Secrets):
   - Welche Events kommen an, mit welchen Feldern? Welche fehlen?
   - Lässt sich die **Session-URL** (`claude.ai/code/session_…`) ermitteln (Umgebungsvariable, Payload-Feld)? Entspricht die Hook-`session_id` der Web-Session-ID?
   - Wie heißt das Repo (Feld oder `git remote`)?
   - Welche `Notification`-Typen gibt es und welche bedeuten „wartet auf mich“?
   - Sind `jq` und `curl` vorhanden?
3. Teste den Queue-Mechanismus: Ein Stop-Hook, der einmalig `{"decision":"block","reason":"Schreibe 'Queue-Test ok' in docs/queue-test.md"}` ausgibt, wenn eine Testdatei `.claude/queue-test-pending` existiert (und sie dann löscht). Dokumentiere, ob Claude danach weiterarbeitet und wie sich das in der Oberfläche zeigt.
4. Lege das endgültige Mapping in `docs/event-mapping.md` fest: Event (+ Bedingung) → Status aus `CLAUDE.md`. Mit Quelle (Doku-Link oder Payload aus den Findings).
5. Schreibe in `docs/progress.md`, was für die folgenden Phasen gilt (z. B. Fallback, falls es keine Session-URL gibt: Taste öffnet `https://claude.ai/code`).

## Fertig, wenn
- `docs/cloud-findings.md` und `docs/event-mapping.md` alle Fragen oben beantworten.
- Klar ist, ob Sprung in die Session und Queue in der Cloud funktionieren.
- PR offen, Phase angehalten.
