// agent-deck – Referenz-Renderer für Stream-Deck-Tasten (144 × 144 px, @2x).
// Diese Funktion ist die Design-Vorlage: Das Plugin soll seine Tastenbilder
// genauso als SVG erzeugen und per setImage("data:image/svg+xml,...") setzen.

const TOKENS = {
  bg: "#14171C",          // Grundfläche jeder Taste
  bgRaised: "#1E232B",    // Innenfläche ruhiger Tasten
  text: "#F2F4F7",
  textDim: "#8A93A1",
  status: {
    approval: { fill: "#E5484D", ink: "#FFFFFF", label: "ANTWORT" },
    done:     { fill: "#F5B83D", ink: "#1A1300", label: "FERTIG" },
    error:    { fill: "#F76B15", ink: "#FFFFFF", label: "FEHLER" },
    working:  { fill: "#30A46C", ink: "#FFFFFF", label: "ARBEITET" },
    idle:     { fill: "#5B6470", ink: "#F2F4F7", label: "INAKTIV" },
    offline:  { fill: "#3A404A", ink: "#8A93A1", label: "OFFLINE" },
  },
  tool: { CC: "#D97757", CX: "#8E8CF5" }, // Claude Code / Codex
  font: "'Segoe UI', Inter, Arial, sans-serif",
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Projektnamen in 1–2 Zeilen setzen. Bis 15 Zeichen pro Zeile; die Schrift
// schrumpft dafür von 20 px auf bis zu 15 px (siehe nameFontSize).
// Umbruch bevorzugt an - _ . oder Leerzeichen, Rest wird mit … gekürzt.
function wrapName(name, max = 15) {
  if (name.length <= max) return [name];
  const parts = name.split(/(?<=[-_. ])/);
  let first = "";
  while (parts.length && (first + parts[0]).length <= max) first += parts.shift();
  if (!first) { first = name.slice(0, max); parts.splice(0, parts.length, name.slice(max)); }
  let second = parts.join("");
  if (second.length > max) second = second.slice(0, max - 1) + "…";
  return [first.replace(/[-_. ]$/, ""), second];
}

function nameFontSize(lines) {
  const longest = Math.max(...lines.map((l) => l.length));
  return Math.max(15, Math.min(20, Math.floor((20 * 11) / longest)));
}

function badge(tool, x, y, onColor) {
  const c = onColor ? "rgba(0,0,0,.28)" : TOKENS.tool[tool];
  const ink = onColor ? "#FFFFFF" : "#14171C";
  return `<rect x="${x}" y="${y}" width="30" height="18" rx="5" fill="${c}"/>
  <text x="${x + 15}" y="${y + 13}" text-anchor="middle" font-size="11" font-weight="700" fill="${ink}">${tool}</text>`;
}

// Kleines Wolken-Symbol = Cloud-Session
function cloudIcon(x, y, c) {
  return `<path d="M${x + 7} ${y + 16}h16a5 5 0 0 0 0-10a7 7 0 0 0-13-1a5 5 0 0 0-3 11z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
}

// Projekt-Slot. state: approval | done | error | working | idle | offline
// opts: { name, tool?: 'CC'|'CX' (ohne = Wolken-Symbol), since: '4m', queue: 0, count: 1, blinkPhase: 0|1, pinned }
function projectKey(state, o) {
  const s = TOKENS.status[state];
  const loud = state === "approval" || state === "done" || state === "error";
  const dimPhase = state === "approval" && o.blinkPhase === 1; // Blinken: 2. Phase dunkler
  const fill = dimPhase ? "#8E2B2F" : s.fill;
  const ink = loud ? s.ink : TOKENS.text;
  const lines = wrapName(o.name);
  const fs = nameFontSize(lines);
  const nameY = lines.length === 1 ? 74 : 64;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="${TOKENS.font}">
  <rect width="144" height="144" fill="${TOKENS.bg}"/>`;
  if (loud) {
    out += `<rect x="0" y="0" width="144" height="144" fill="${fill}"/>`;
  } else {
    out += `<defs><clipPath id="k"><rect x="6" y="6" width="132" height="132" rx="14"/></clipPath></defs>
    <g clip-path="url(#k)"><rect x="6" y="6" width="132" height="132" fill="${TOKENS.bgRaised}"/>
    <rect x="6" y="114" width="132" height="24" fill="${s.fill}" opacity="${state === "offline" ? 0.5 : 1}"/></g>`;
  }
  // Kopfzeile: Tool-Badge links, Sitzungszahl / Pin rechts
  if (o.tool) out += badge(o.tool, 12, 12, loud);
  else out += cloudIcon(12, 12, loud ? ink : TOKENS.textDim);
  if (o.count > 1) out += `<text x="132" y="25" text-anchor="end" font-size="13" font-weight="700" fill="${ink}">${o.count}×</text>`;
  if (o.pinned) out += `<circle cx="${o.count > 1 ? 108 : 128}" cy="21" r="4" fill="${ink}" opacity=".85"/>`;
  // Projektname
  lines.forEach((l, i) => {
    out += `<text x="72" y="${nameY + i * (fs + 3)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${ink}" opacity="${state === "idle" || state === "offline" ? 0.7 : 1}">${esc(l)}</text>`;
  });
  // Fußzeile
  if (loud) {
    out += `<rect x="12" y="110" width="120" height="22" rx="11" fill="rgba(0,0,0,.22)"/>
    <text x="72" y="125" text-anchor="middle" font-size="12" font-weight="700" letter-spacing=".6" fill="${s.ink === "#1A1300" ? "#1A1300" : "#FFFFFF"}">${s.label} · ${esc(o.since)}</text>`;
  } else {
    out += `<text x="72" y="131" text-anchor="middle" font-size="12" font-weight="700" letter-spacing=".6" fill="${s.ink}">${s.label} · ${esc(o.since)}</text>`;
  }
  if (state === "working") {
    // Fortschrittspunkte (Animation: der helle Punkt wandert alle 500 ms)
    [0, 1, 2].forEach((i) => {
      out += `<circle cx="${60 + i * 12}" cy="100" r="3.5" fill="${s.fill}" opacity="${i === (o.dot ?? 0) ? 1 : 0.35}"/>`;
    });
  }
  if (o.queue > 0) {
    // Queue-Zähler oben rechts (neben einem evtl. Sitzungszähler)
    const qx = o.count > 1 ? 70 : 102;
    out += `<rect x="${qx}" y="12" width="30" height="18" rx="9" fill="${loud ? "rgba(0,0,0,.28)" : "#F5B83D"}"/>
    <text x="${qx + 15}" y="25" text-anchor="middle" font-size="11" font-weight="800" fill="${loud ? "#FFFFFF" : "#1A1300"}">+${o.queue}</text>`;
  }
  return out + `</svg>`;
}

// Ampel: Summe aller roten + gelben Projekte
function overviewKey({ approval, done }) {
  const fill = approval > 0 ? TOKENS.status.approval.fill : done > 0 ? TOKENS.status.done.fill : TOKENS.bgRaised;
  const ink = approval > 0 ? "#FFFFFF" : done > 0 ? "#1A1300" : TOKENS.textDim;
  const n = approval + done;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="${TOKENS.font}">
  <rect width="144" height="144" fill="${TOKENS.bg}"/>
  <rect width="144" height="144" fill="${fill}"/>
  <text x="72" y="30" text-anchor="middle" font-size="12" font-weight="700" letter-spacing="1" fill="${ink}" opacity=".85">WARTET</text>
  <text x="72" y="92" text-anchor="middle" font-size="58" font-weight="800" fill="${ink}">${n}</text>
  <text x="72" y="126" text-anchor="middle" font-size="12" font-weight="600" fill="${ink}" opacity=".9">${approval} rot · ${done} gelb</text>
  </svg>`;
}

const ICONS = {
  macro: `<path d="M76 34L56 62h16l-4 22 20-30H72z" fill="currentColor"/>`,
  queue: `<rect x="48" y="38" width="48" height="10" rx="4" fill="currentColor"/><rect x="48" y="54" width="48" height="10" rx="4" fill="currentColor" opacity=".6"/><rect x="48" y="70" width="48" height="10" rx="4" fill="currentColor" opacity=".35"/>`,
  page: `<path d="M62 40l20 18-20 18" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
};

// Makro / Queue / Blättern
function commandKey(kind, label, sub, o = {}) {
  const warn = o.warn; // z. B. Ziel-Session nicht gefunden → Warnzustand
  const color = warn ? TOKENS.status.error.fill : o.accent || TOKENS.text;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="${TOKENS.font}">
  <rect width="144" height="144" fill="${TOKENS.bg}"/>
  <rect x="6" y="6" width="132" height="132" rx="14" fill="${TOKENS.bgRaised}"/>
  <g style="color:${color}" color="${color}">${ICONS[kind]}</g>
  <text x="72" y="104" text-anchor="middle" font-size="16" font-weight="700" fill="${TOKENS.text}">${esc(label)}</text>
  <text x="72" y="124" text-anchor="middle" font-size="11.5" font-weight="600" fill="${warn ? TOKENS.status.error.fill : TOKENS.textDim}">${esc(sub)}</text>`;
  if (o.count != null) {
    out += `<rect x="100" y="14" width="30" height="20" rx="10" fill="${o.count > 0 ? TOKENS.status.done.fill : "#2C333D"}"/>
    <text x="115" y="28" text-anchor="middle" font-size="12" font-weight="800" fill="${o.count > 0 ? "#1A1300" : TOKENS.textDim}">${o.count}</text>`;
  }
  if (warn) out += `<path d="M112 14l14 24h-28z" fill="${TOKENS.status.error.fill}"/><text x="112" y="34" text-anchor="middle" font-size="13" font-weight="800" fill="#FFFFFF">!</text>`;
  return out + `</svg>`;
}

if (typeof module !== "undefined") module.exports = { TOKENS, projectKey, overviewKey, commandKey, wrapName, nameFontSize };
