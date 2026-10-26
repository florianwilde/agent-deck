# Cloud-Findings (Phase 0 B)

Ausgewertet am 2026-10-26. Die Daten stammen aus dem Capture-Hub (`GET /capture`): 285 Einträge aus 5 Cloud-Sessions dieses Repos, Claude Code 2.1.42, Umgebung `cloud_default`. Die Payloads unten sind gekürzt, `transcript_path` und `scratchpad_dir` sind weggelassen, Secrets sind keine enthalten.

| Session (Web-ID)                   | Zweck                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `session_01Hu618RsKx8kryRuo6KABiH` | Florians erste Test-Session (3 Prompts)                                          |
| `session_01K2MjdYA8c6e9VP15HU27Eq` | diese Teil-B-Session, mit dem Queue-Test                                         |
| `session_01224BkeU5FpJaeMfCorWkYF` | Test 1: Rückfrage per `AskUserQuestion`, 2,5 Min. warten, danach archivieren     |
| `session_0159HXYtqVuy4s5wNvb6xn18` | Test 2: Bash im Modus `default`, Befehl schlägt fehl, danach archivieren         |
| `session_01HbeQWa2iBrqo3yqY1P4Rgg` | Test 3: lange Aufgabe, mittendrin unterbrochen (Stopp-Knopf), danach archivieren |

Die Tests 1–3 hat diese Session selbst gestartet und gesteuert (`create_session`, `interrupt_session`, `archive_session`). Die Rückfrage in Test 1 wurde in der Oberfläche beantwortet.

## 1. Welche Events kommen an?

| Event                | Anzahl | Bemerkung                                                                      |
| -------------------- | -----: | ------------------------------------------------------------------------------ |
| `Setup`              |      5 | eigene `session_id` (anderer Prozess), `trigger`: `init` oder `maintenance`    |
| `SessionStart`       |      5 | `source: "startup"`, kommt fast gleichzeitig mit dem ersten `UserPromptSubmit` |
| `InstructionsLoaded` |      5 | CLAUDE.md geladen                                                              |
| `UserPromptSubmit`   |     10 | enthält `prompt` (Klartext!)                                                   |
| `PreToolUse`         |     83 | `tool_name`, `tool_input`                                                      |
| `PostToolUse`        |     79 | `tool_response`, `duration_ms`                                                 |
| `PostToolUseFailure` |      3 | `error`, `is_interrupt`                                                        |
| `PostToolBatch`      |     49 | nach jedem Tool-Block                                                          |
| `PermissionRequest`  |      2 | nur für `AskUserQuestion`                                                      |
| `Notification`       |      2 | nur `permission_prompt`, ca. 6 s nach `PermissionRequest`                      |
| `MessageDisplay`     |     17 | Antworttext (`delta`)                                                          |
| `Stop`               |     11 | `stop_hook_active`, `last_assistant_message`, `background_tasks`               |
| `SubagentStop`       |      8 | Prompt-Vorschlags-Subagent nach fast jedem `Stop`, siehe unten                 |
| `CwdChanged`         |      5 |                                                                                |
| `ConfigChange`       |      1 | `source: "project_settings"` nach Änderung an `.claude/settings.json`          |

**Nicht angekommen**, obwohl registriert:

- **`SessionEnd`**: kommt auch beim **Archivieren** nicht (3 von 3 Sessions archiviert, kein Event). Der Container wird offenbar einfach abgebaut. In der Cloud gibt es kein `/exit`.
- **`StopFailure`**: nicht provozierbar, ein API-Fehler (`rate_limit`, `overloaded` …) trat nicht auf. Laut [Hooks-Doku](https://code.claude.com/docs/en/hooks#stopfailure) kommt dann `StopFailure` mit `error`. **Unbestätigt.**
- **`Notification` mit `idle_prompt`**: kommt in der Cloud **nicht**. Zweimal mehr als 2 Minuten nach `Stop` gewartet (13:28:25 → 13:30:56 und 13:41:03 → 13:43:51): kein Event.
- Kein `Stop` nach einem Abbruch (siehe Abschnitt 6).
- Nicht ausgelöst wurden außerdem: `PreCompact`/`PostCompact`, `SubagentStart`, `TaskCreated`/`TaskCompleted`, `Elicitation*`, `FileChanged`, `UserPromptExpansion`, `TeammateIdle`. Für den Status sind sie nicht nötig.

### Gemeinsame Felder

Jeder Payload hat `session_id`, `transcript_path`, `cwd`, `hook_event_name`. Turn-Events haben zusätzlich `prompt_id`, `permission_mode` (`default`, `auto` …) und `effort`. Ein Feld `model` gibt es in `SessionStart` nicht.

### Beispiel-Payloads

```jsonc
// SessionStart
{"session_id":"a213d775-1fda-5b6a-9a1f-2726051584c9","cwd":"/home/user/agent-deck",
 "hook_event_name":"SessionStart","source":"startup"}

// Setup – andere session_id als SessionStart derselben Web-Session
{"session_id":"a5f16b1b-edb8-4a6f-940d-e2a46388d17b","cwd":"/home/user/agent-deck",
 "hook_event_name":"Setup","trigger":"init"}

// UserPromptSubmit – Prompt im Klartext, darf ab Phase 1 nicht mehr gesendet werden
{"session_id":"a213d775-…","prompt_id":"efae3a37-…","permission_mode":"default",
 "hook_event_name":"UserPromptSubmit","prompt":"Capture-Test für Phase 0 B. Stell mir …"}

// PermissionRequest – sofort, wenn Claude eine Rückfrage stellt
{"session_id":"a213d775-…","permission_mode":"default","hook_event_name":"PermissionRequest",
 "tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Welche Datei soll ich …"}]}}

// Notification – 6 s später
{"session_id":"a213d775-…","prompt_id":"efae3a37-…","hook_event_name":"Notification",
 "message":"Claude needs your permission to use AskUserQuestion","notification_type":"permission_prompt"}

// PostToolUseFailure
{"session_id":"3a6f593a-…","hook_event_name":"PostToolUseFailure","tool_name":"Bash",
 "error":"Exit code 56\ncurl: (56) CONNECT tunnel failed, response 403 …","is_interrupt":false,"duration_ms":172}

// Stop
{"session_id":"3a6f593a-…","permission_mode":"default","hook_event_name":"Stop",
 "stop_hook_active":false,"last_assistant_message":"The request didn't get through, …",
 "background_tasks":[],"session_crons":[]}

// SubagentStop des Prompt-Vorschlags – last_assistant_message ist der VORGESCHLAGENE nächste Prompt
{"session_id":"82e59284-…","hook_event_name":"SubagentStop","agent_id":"a69587a6d9b3530e4",
 "agent_type":"","stop_hook_active":false,
 "last_assistant_message":"Lies CLAUDE.md und fasse sie in zwei Sätzen zusammen."}

// ConfigChange
{"session_id":"5d93a14b-…","hook_event_name":"ConfigChange","source":"project_settings",
 "file_path":"/home/user/agent-deck/.claude/settings.json"}
```

### Auffälligkeiten

- **`SubagentStop` mit `agent_type: ""`** kommt ca. 2 s nach fast jedem `Stop`. Es ist der Subagent, der in der Oberfläche den nächsten Prompt vorschlägt. Er darf den Status **nicht** ändern.
- **`Setup`** läuft in einem eigenen Prozess mit eigener `session_id` und teilweise erst nach `SessionStart`. Ignorieren.
- **`Stop` kann mehrfach pro Turn kommen.** Der Plattform-Hook `~/.claude/stop-hook-git-check.sh` blockiert per Exit 2, wenn es ungepushte oder nicht committete Änderungen gibt. Dann arbeitet Claude weiter, und es folgt ein zweiter `Stop` mit `stop_hook_active: true`. Beobachtet in Test 1 und in dieser Session.
- **In `default` liefen `Bash` und `Write` ohne Rechte-Abfrage.** Nur `AskUserQuestion` erzeugte `PermissionRequest`. Die Cloud-Sandbox erlaubt Tool-Aufrufe offenbar ohne Rückfrage. Ein „wartet auf Freigabe“ entsteht daher praktisch nur bei Rückfragen.
- **Payload-Größe:** Payload plus env sind 9–12 KB, `PostToolUse` mit `Read` deutlich mehr. Der echte Hook muss die Felder selbst auswählen, nicht weiterreichen.

## 2. Session-URL und Session-ID

Die URL lässt sich **zuverlässig** ermitteln, allerdings nicht aus dem Payload, sondern aus der Umgebung des Hooks:

| Quelle                                   | Beispiel                                                     | Bedeutung                       |
| ---------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| Payload `session_id`                     | `a213d775-1fda-5b6a-9a1f-2726051584c9`                       | interne CLI-Session (UUID)      |
| env `CLAUDE_CODE_SESSION_ID`             | `a213d775-1fda-5b6a-9a1f-2726051584c9`                       | gleich der Payload-`session_id` |
| env `CLAUDE_CODE_REMOTE_SESSION_ID`      | `cse_01224BkeU5FpJaeMfCorWkYF`                               | **Web-Session**                 |
| env `CLAUDE_CODE_REMOTE_SDK_URL`         | `https://api.anthropic.com/v1/code/sessions/cse_01224BkeU5…` | enthält dieselbe `cse_`-ID      |
| Web-URL (aus `create_session` bestätigt) | `https://claude.ai/code/session_01224BkeU5FpJaeMfCorWkYF`    | `cse_` → `session_`             |

- **Die Hook-`session_id` entspricht nicht der Web-Session-ID.** Sie ist eine UUID und unterscheidet sich sogar zwischen `Setup` und den übrigen Events derselben Web-Session.
- Bei allen 5 Sessions war `CLAUDE_CODE_REMOTE_SESSION_ID` in jedem Event vorhanden und konstant, und `cse_X` gehörte zu `session_X`. Für die 3 Test-Sessions habe ich das mit der von `create_session` zurückgegebenen ID abgeglichen.
- **Folge:** Der Hook schickt `CLAUDE_CODE_REMOTE_SESSION_ID` mit, und der Hub nutzt sie als Schlüssel. Fallback, wenn sie fehlt (z. B. lokal): Payload-`session_id` als Schlüssel, Taste öffnet `https://claude.ai/code`.

## 3. Repo-Name

Ein Feld im Payload gibt es nicht. Verfügbar sind:

- `cwd` bzw. env `CLAUDE_PROJECT_DIR`: immer `/home/user/<repo>`, also `/home/user/agent-deck`.
- `git remote get-url origin`: `https://github.com/florianwilde/agent-deck`, ohne Zugangsdaten. Daraus lässt sich `owner/repo` lesen.

**Folge:** Der Hook nimmt `owner/repo` aus `git -C "$CLAUDE_PROJECT_DIR" remote get-url origin` und fällt auf `basename "$CLAUDE_PROJECT_DIR"` zurück. Die Branch kommt aus `git branch --show-current`, ist aber optional.

## 4. Notification-Typen

| Typ                                                                                                                             | In der Cloud gesehen | Bedeutet „wartet auf mich“                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `permission_prompt`                                                                                                             | ja (2×)              | **ja**: Rückfrage bzw. Freigabe offen. Kommt 6 s nach `PermissionRequest`. |
| `idle_prompt`                                                                                                                   | **nein**             | (wäre ja), kommt in der Cloud nicht                                        |
| `elicitation_dialog`, `elicitation_url_dialog`                                                                                  | nein                 | ja (MCP-Server fragt nach), laut Doku                                      |
| `agent_needs_input`                                                                                                             | nein                 | ja, laut Doku                                                              |
| `auth_success`, `elicitation_complete`, `elicitation_response`, `agent_completed`, `quota_auto_resume_*`, `plugin_notification` | nein                 | nein, informativ                                                           |

Das schnellere Signal für „wartet auf mich“ ist **`PermissionRequest`**: Es kommt sofort, `permission_prompt` erst 6 s später. Wird die Frage beantwortet, folgt `PostToolUse` für dasselbe Tool. Bei einer Ablehnung folgt laut Doku `PostToolUseFailure` bzw. der nächste Turn.

Wichtig: Weil `idle_prompt` als zweite Stufe fehlt, bleibt nach `Stop` nur der Status `done`. Daraus wird **nicht** automatisch `needs_input`.

## 5. Werkzeuge

Bei allen 285 Events lief der Hook über den `jq`-Weg (`"tool":"jq"`). Vorhanden sind `jq` 1.7 und `curl` 8.5.0 (User-Agent `curl/8.5.0` in allen Requests). `git` und `bash` 5.2 sind ebenfalls da. Der Hook soll trotzdem ohne `jq` funktionieren, für Umgebungen mit eigenem Image.

## 6. Abbruch (Stopp-Knopf)

Test 3 wurde um 13:47:01 mitten in einer Folge von `Read`-Aufrufen unterbrochen. Danach kam **kein** Event: weder `Stop` noch `StopFailure` noch `PostToolUseFailure` mit `is_interrupt: true`. Die Session stand laut API auf `idle`.

**Folge:** Nach einem Abbruch bleibt die Taste auf `working`, bis der 30-Minuten-Timeout greift oder ein neues Event kommt. Phase 1 sollte dafür einen kürzeren Timeout für `working` vorsehen (Vorschlag: 10 Min. ohne Event → `idle`). Während Claude arbeitet, kommen alle paar Sekunden Tool-Events, ein längeres Schweigen deutet also auf einen Abbruch hin.

## 7. Queue-Test (Stop-Hook mit `decision: block`)

Aufbau: `.claude/hooks/queue-test.sh` als zweiter, **synchroner** `Stop`-Hook (`timeout: 5`). Existiert `.claude/queue-test-pending`, löscht der Hook die Datei und gibt Folgendes aus:

```json
{ "decision": "block", "reason": "Schreibe 'Queue-Test ok' in docs/queue-test.md" }
```

Ergebnis:

- **Es funktioniert.** Claude arbeitete nach `Stop` (13:36:58) ohne neuen Prompt weiter, legte `docs/queue-test.md` an, committete und pushte (13:37:06).
- **Geänderte Hooks wirken sofort.** Der Hook kam erst während der laufenden Session in `.claude/settings.json`. Claude Code meldete `ConfigChange` (`project_settings`) und nutzte ihn beim nächsten `Stop`. Ein Neustart war nicht nötig.
- **Oberfläche:** Der eingereihte Auftrag erscheint im Verlauf als Nachricht im Nutzer-Stil, mit dem Text `Stop hook feedback:` und darunter dem `reason`. Ein `UserPromptSubmit` gibt es dafür **nicht**, der Hub sieht nach `Stop` direkt wieder Tool-Events.
- **Zusammenspiel mit dem Plattform-Hook:** Im selben `Stop` hat auch `~/.claude/stop-hook-git-check.sh` blockiert („unpushed commit“). Beide Rückmeldungen kamen in **einer** Fortsetzung zusammen an. Beim nächsten `Stop` ist `stop_hook_active: true`.
- **Gelöscht:** `.claude/queue-test-pending` war danach weg. Der Auftrag kam genau einmal.

Folgen für Phase 3:

- **Taste:** Nach `Stop` mit ausgeliefertem Queue-Eintrag bleibt der Status `working`. Der Hub weiß das, weil er den Eintrag selbst über `POST /queue/next` herausgegeben hat.
- **`stop_hook_active`:** Ist das Feld `true`, darf der Hook trotzdem ausliefern. Claude Code begrenzt die Kette selbst (Standard 8). Der Hook muss aber sicherstellen, dass ein Eintrag nur einmal ausgeliefert wird.
- **Weitere Stop-Hooks:** Der Plattform-Hook für Git kann im selben `Stop` zusätzlich blockieren. Das ist harmlos, Claude erledigt beides.

## 8. Sonstiges

- **Rückfragen beantworten:** Eine Session nimmt Nachrichten von einer anderen Session (`send_message`) bewusst **nicht** als Auftrag an, nur den ersten Prompt einer neuen Session. Für die Queue ist das egal, sie läuft über den Stop-Hook in derselben Session.
- **Die Session-API liefert einen eigenen Status** (`status_bucket`, `post_turn_summary.status_category`: `need_input`, `completed` …). Das Plugin erreicht diese API aber nicht ohne Claude-Login. Für dieses Projekt ist das kein Weg.
- **Privatsphäre:** Die Capture-Daten enthalten Prompts, Antworttexte und Datei-Inhalte. Nach dem Merge löschen (`docs/setup-phase-0.md`, Schritt 7).
