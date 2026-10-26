# Event-Mapping (endgültig, Phase 0 B)

Dieses Mapping hat Vorrang vor der Tabelle in `CLAUDE.md`. Die Belege stehen in [`cloud-findings.md`](cloud-findings.md) (abgekürzt **F§n**) und in der [Hooks-Doku](https://code.claude.com/docs/en/hooks) (**Doku**).

## Schlüssel und Metadaten

| Wert        | Quelle im Hook                                                                                                   | Beleg       |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ----------- |
| Session-Key | env `CLAUDE_CODE_REMOTE_SESSION_ID` (`cse_…`), Fallback: Payload `session_id`                                    | F§2         |
| Session-URL | `https://claude.ai/code/session_` + Key ohne `cse_`. Fallback ohne `cse_`-Key: `https://claude.ai/code`          | F§2         |
| Repo        | `owner/repo` aus `git -C "$CLAUDE_PROJECT_DIR" remote get-url origin`, Fallback `basename "$CLAUDE_PROJECT_DIR"` | F§3         |
| Zeit        | Zeitstempel des Hooks (`date -u +%FT%T.%3NZ`), **nicht** die Ankunftszeit am Hub                                 | siehe unten |
| Meldung     | nur `Notification.message`, `StopFailure.error`, `PermissionRequest.tool_name`, gekürzt auf 120 Zeichen          | F§1         |

Async-Hooks kommen **nicht in Reihenfolge** an. Beobachtet: `PostToolBatch` vor `PostToolUse` und `PostToolUse` vor `PreToolUse` desselben Tools (Capture-IDs 23/24, 127/128, 152/153). Der Hub wertet deshalb nach dem Hook-Zeitstempel aus und verwirft Events, die älter sind als der aktuelle Stand der Session.

## Mapping

| Event (+ Bedingung)                                                                                                                             | Status         | Beleg                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `PermissionRequest`                                                                                                                             | `needs_input`  | F§1/F§4: kommt sofort bei `AskUserQuestion`                                        |
| `Notification`, `notification_type` ∈ {`permission_prompt`, `idle_prompt`, `elicitation_dialog`, `elicitation_url_dialog`, `agent_needs_input`} | `needs_input`  | F§4 (`permission_prompt` gesehen), Rest Doku                                       |
| `Notification`, andere Typen                                                                                                                    | – (ignorieren) | Doku                                                                               |
| `Stop`, Hub hat in diesem Stop einen Queue-Eintrag ausgeliefert                                                                                 | `working`      | F§7                                                                                |
| `Stop`, sonst (auch bei `stop_hook_active: true`)                                                                                               | `done`         | F§1, F§7                                                                           |
| `StopFailure`                                                                                                                                   | `error`        | Doku (in der Cloud nicht provozierbar)                                             |
| `SessionStart` mit `source` ∈ {`startup`, `compact`}                                                                                            | `working`      | F§1: `startup` kommt zusammen mit dem ersten Prompt                                |
| `SessionStart` mit `source` ∈ {`resume`, `clear`}                                                                                               | `idle`         | Doku                                                                               |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `PreCompact`, `PostCompact`                             | `working`      | F§1                                                                                |
| `SessionEnd`                                                                                                                                    | `idle`         | Doku (kommt in der Cloud nicht, auch nicht beim Archivieren, F§1)                  |
| `Setup`, `SubagentStart`, `SubagentStop`, `MessageDisplay`, `InstructionsLoaded`, `CwdChanged`, `ConfigChange`, `FileChanged` und alle übrigen  | – (ignorieren) | F§1: `SubagentStop` ist der Prompt-Vorschlag, `Setup` hat eine fremde `session_id` |

`PostToolUse` nach einer beantworteten Rückfrage setzt `needs_input` wieder auf `working`. Das passt, weil Claude danach weiterarbeitet (F§1, Test 1).

## Timeouts (im Hub)

| Bedingung                                | Status | Grund                                                   |
| ---------------------------------------- | ------ | ------------------------------------------------------- |
| `working` und 10 Min. kein Event         | `idle` | Nach einem Abbruch (Stopp-Knopf) kommt kein Event (F§6) |
| beliebiger Status und 30 Min. kein Event | `idle` | wie in `CLAUDE.md`, ersetzt das fehlende `SessionEnd`   |

`offline` setzt nur das Plugin, wenn es keine Hub-Verbindung hat.

## Hook-Konfiguration ab Phase 1

Registriert werden nur die Events, die einen Status setzen:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PermissionRequest`
- `Notification`
- `Stop`
- `StopFailure`
- `SessionEnd`

`PostToolBatch` und die Compact-Events sind nicht nötig, weil `PreToolUse`/`PostToolUse` sie abdecken. Alle Hooks laufen `async: true`. Ausnahme ist `Stop`, er läuft synchron mit `timeout` ≤ 5, weil er ab Phase 3 die Queue abfragt.
