// Property Inspector „Projekt-Slot“ – Logik, die sdpi-components nicht selbst abdeckt.
// Nachrichtenformate: siehe packages/streamdeck-plugin/src/settings.ts (PiToPlugin / PluginToPi).
"use strict";

(function () {
  // Prompt für das Anbinden eines weiteren Repos (docs/setup-hub.md, Abschnitt 7).
  const SNIPPET =
    "Klone `https://github.com/florianwilde/agent-deck` nach `/tmp/agent-deck`, führe dort " +
    "`pnpm install --filter @agent-deck/cli...` aus und dann im Ziel-Repo " +
    "`node --conditions=source /tmp/agent-deck/packages/cli/src/index.ts init .`. " +
    "Lösche `.claude/settings.json.bak`, committe `.claude/settings.json` und " +
    "`.claude/hooks/agent-deck.sh` und öffne einen PR.";

  const $ = (id) => document.getElementById(id);

  if (!window.SDPIComponents) {
    // sdpi-components nicht geladen (vendor/sdpi-components.js fehlt) – Formular bleibt ohne Funktion.
    $("status-label").textContent = "sdpi-components nicht geladen";
    return;
  }
  const client = window.SDPIComponents.streamDeckClient;

  /** Nachricht an das Plugin (kommt dort als onSendToPlugin an). */
  function sendToPlugin(payload) {
    return client.send("sendToPlugin", payload);
  }

  // ---------------------------------------------------------------------
  // Verbindungsstatus
  // ---------------------------------------------------------------------

  const STATUS_TEXT = {
    unconfigured: "nicht eingerichtet",
    connecting: "verbinde …",
    connected: "verbunden",
    disconnected: "getrennt",
  };

  function showStatus(status) {
    const state = status && STATUS_TEXT[status.state] ? status.state : "unconfigured";
    let extra = "";
    if (state === "connected") {
      const n = Number(status.sessions) || 0;
      extra = ` · ${n} ${n === 1 ? "Session" : "Sessions"}`;
    } else if (state === "disconnected" && status.error) {
      extra = ` – ${status.error}`;
    }
    $("status").dataset.state = state;
    $("conn-dot").dataset.state = state;
    $("status-label").textContent = STATUS_TEXT[state];
    $("status-extra").textContent = extra;
  }

  function showFeedback(id, ok, text) {
    const el = $(id);
    el.className = "feedback " + (ok ? "ok" : "err");
    el.textContent = text;
  }

  // Antworten und Pushes vom Plugin (sendToPropertyInspector).
  client.sendToPropertyInspector.subscribe((ev) => {
    const msg = ev && ev.payload;
    if (!msg) return;
    if (msg.event === "status") {
      showStatus(msg.status);
    } else if (msg.event === "testResult") {
      showFeedback("test-result", !!msg.ok, msg.message || (msg.ok ? "OK" : "Fehler"));
    }
    // "repos" verarbeitet sdpi-select (datasource + hot-reload) selbst.
  });

  // send() wartet intern, bis Stream Deck die Verbindung aufgebaut hat.
  sendToPlugin({ event: "getStatus" });

  // ---------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------

  $("test-connection").addEventListener("click", () => {
    const el = $("test-result");
    el.className = "feedback";
    el.textContent = "teste …";
    sendToPlugin({ event: "testConnection" });
  });

  /** Kopiert Text; fällt auf execCommand zurück, falls die Clipboard-API gesperrt ist. */
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // weiter mit dem Fallback
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  let copyTimer;
  $("copy-snippet").addEventListener("click", async () => {
    const ok = await copyText(SNIPPET);
    showFeedback("copy-result", ok, ok ? "kopiert" : "Kopieren nicht möglich");
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => ($("copy-result").textContent = ""), 2500);
  });

  // ---------------------------------------------------------------------
  // Belegung: Position nur bei „Automatisch“, Repo nur bei „Fest“
  // ---------------------------------------------------------------------

  const mode = $("mode");
  function applyMode() {
    const fixed = mode.value === "fixed";
    $("position").disabled = fixed;
    $("repo").disabled = !fixed;
  }
  // "valuechange" feuert sdpi bei jeder Wertänderung, auch beim Laden der Einstellungen.
  mode.addEventListener("valuechange", applyMode);
  applyMode();
})();
