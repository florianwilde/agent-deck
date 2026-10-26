import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookEventSchema } from "@agent-deck/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "agent-deck.sh");

interface Received {
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];
const tmpDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** Temporäres git-Repo mit origin-Remote und Branch. */
function gitRepo(origin: string | null, branch = "claude/phase-1", name = "projekt"): string {
  const dir = join(tempDir("agent-deck-repo-"), name);
  mkdirSync(dir);
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  };
  git("init", "-q", "-b", branch);
  if (origin !== null) git("remote", "add", "origin", origin);
  return dir;
}

let repoDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    req.on("end", () => {
      received.push({ url: req.url, headers: req.headers, body });
      res.writeHead(202).end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  repoDir = gitRepo("https://github.com/florianwilde/agent-deck");
});

afterAll(async () => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
});

interface Tools {
  jq?: boolean;
  git?: boolean;
  date?: boolean;
  curl?: boolean;
}

/** Minimal-PATH mit genau den Werkzeugen, die das Skript braucht. */
function toolDir({ jq = true, git = true, date = true, curl = true }: Tools): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-bin-"));
  const tools = [
    "bash",
    "cat",
    "sed",
    ...(curl ? ["curl"] : []),
    ...(date ? ["date"] : []),
    ...(git ? ["git"] : []),
    ...(jq ? ["jq"] : []),
  ];
  for (const tool of tools) {
    const which = spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" });
    const target = which.stdout.trim();
    if (target === "") throw new Error(`${tool} fehlt auf diesem System`);
    symlinkSync(target, join(dir, tool));
  }
  return dir;
}

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Asynchron, damit der Fake-Server im selben Prozess antworten kann. */
async function runHook(
  stdin: string,
  env: Record<string, string>,
  tools: Tools = {},
): Promise<HookResult> {
  const bin = toolDir(tools);
  try {
    return await new Promise<HookResult>((resolve, reject) => {
      const child = spawn(join(bin, "bash"), [SCRIPT], { env: { PATH: bin, ...env } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(stdin);
    });
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SESSION = "cse_01224BkeU5FpJaeMfCorWkYF";
const UUID = "a213d775-1fda-5b6a-9a1f-2726051584c9";

function remoteEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    CLAUDE_CODE_REMOTE: "true",
    CLAUDE_CODE_REMOTE_SESSION_ID: SESSION,
    CLAUDE_PROJECT_DIR: repoDir,
    AGENT_DECK_URL: `${baseUrl}/`,
    ...extra,
  };
}

/** Prüft Exit 0, keine Ausgabe, genau einen Request und gibt den Body zurück. */
function singleBody(result: HookResult): Record<string, unknown> {
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
  expect(received).toHaveLength(1);
  const [request] = received;
  expect(request?.url).toBe("/events");
  expect(request?.headers["content-type"]).toBe("application/json");
  expect(Buffer.byteLength(request?.body ?? "")).toBeLessThanOrEqual(4096);
  const body = JSON.parse(request?.body ?? "") as Record<string, unknown>;
  // Vertrag mit dem Hub.
  HookEventSchema.parse(body);
  expect(body.ts).toMatch(TS);
  expect(Math.abs(Date.parse(String(body.ts)) - Date.now())).toBeLessThan(60_000);
  return body;
}

const BASE = {
  v: 1,
  sessionId: SESSION,
  repo: "florianwilde/agent-deck",
  branch: "claude/phase-1",
  ts: expect.stringMatching(TS) as unknown,
};

// Beispiel-Payloads aus docs/cloud-findings.md (vollständige Felder ergänzt).
const common = {
  session_id: UUID,
  transcript_path: "/root/.claude/projects/-home-user-agent-deck/a213d775.jsonl",
  cwd: "/home/user/agent-deck",
};
const EXAMPLES: [string, Record<string, unknown>, Record<string, unknown>][] = [
  [
    "SessionStart",
    { ...common, hook_event_name: "SessionStart", source: "startup" },
    { event: "SessionStart", source: "startup" },
  ],
  [
    "UserPromptSubmit",
    {
      ...common,
      prompt_id: "efae3a37-0000",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
      prompt: "GEHEIMER-PROMPT Capture-Test für Phase 0 B. Stell mir eine Frage",
    },
    { event: "UserPromptSubmit" },
  ],
  [
    "PermissionRequest",
    {
      ...common,
      permission_mode: "default",
      hook_event_name: "PermissionRequest",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{ question: "GEHEIMER-INPUT Welche Datei soll ich …", message: "x" }],
      },
    },
    { event: "PermissionRequest", message: "AskUserQuestion" },
  ],
  [
    "Notification",
    {
      ...common,
      prompt_id: "efae3a37-0000",
      hook_event_name: "Notification",
      message: "Claude needs your permission to use AskUserQuestion",
      notification_type: "permission_prompt",
    },
    {
      event: "Notification",
      notificationType: "permission_prompt",
      message: "Claude needs your permission to use AskUserQuestion",
    },
  ],
  [
    "PostToolUseFailure",
    {
      ...common,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "curl GEHEIMER-INPUT" },
      error: "Exit code 56\ncurl: (56) CONNECT tunnel failed, response 403",
      is_interrupt: false,
      duration_ms: 172,
    },
    { event: "PostToolUseFailure" },
  ],
  [
    "Stop",
    {
      ...common,
      permission_mode: "default",
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "GEHEIME-ANTWORT The request didn't get through, …",
      background_tasks: [],
      session_crons: [],
    },
    { event: "Stop" },
  ],
  [
    "StopFailure",
    { ...common, hook_event_name: "StopFailure", error: "rate_limit" },
    { event: "StopFailure", message: "rate_limit" },
  ],
  [
    "SessionEnd",
    { ...common, hook_event_name: "SessionEnd", reason: "prompt_input_exit" },
    { event: "SessionEnd", source: "prompt_input_exit" },
  ],
];

describe.each([
  ["mit jq", true],
  ["ohne jq", false],
])("agent-deck.sh %s", (_label, jq) => {
  it.each(EXAMPLES)("%s: schickt genau die Metadaten", async (_name, payload, expected) => {
    const result = await runHook(JSON.stringify(payload), remoteEnv(), { jq });
    const body = singleBody(result);
    expect(body).toEqual({ ...BASE, ...expected });
    const raw = received[0]?.body ?? "";
    expect(raw).not.toMatch(/GEHEIM|transcript|\/home\/user|tool_input|prompt_id|Exit code/);
    expect(raw.startsWith('{"v":1,"event":')).toBe(true);
  });

  it("nimmt die Payload-session_id, wenn CLAUDE_CODE_REMOTE_SESSION_ID fehlt", async () => {
    const env = remoteEnv();
    delete env.CLAUDE_CODE_REMOTE_SESSION_ID;
    const result = await runHook(JSON.stringify({ ...common, hook_event_name: "Stop" }), env, {
      jq,
    });
    expect(singleBody(result).sessionId).toBe(UUID);
  });

  it("sendet nichts bei ungültiger Session-ID", async () => {
    const env = remoteEnv({ CLAUDE_CODE_REMOTE_SESSION_ID: "cse_01 ABC/../x" });
    const result = await runHook(JSON.stringify({ ...common, hook_event_name: "Stop" }), env, {
      jq,
    });
    expect(result.status).toBe(0);
    expect(received).toHaveLength(0);
  });

  it.each([
    ["https://github.com/owner/repo.git", "owner/repo"],
    ["https://x-access-token:ghs_GEHEIM@github.com/owner/repo.git", "owner/repo"],
    ["git@github.com:owner/my.repo.git", "owner/my.repo"],
    ["ssh://git@github.com/owner/repo", "owner/repo"],
    ["http://local_proxy@127.0.0.1:44187/git/florianwilde/agent-deck", "florianwilde/agent-deck"],
    ["http://127.0.0.1:1234/git/owner/repo/", "owner/repo"],
  ])("liest repo aus dem Remote %s", async (origin, expected) => {
    const dir = gitRepo(origin, "main");
    const result = await runHook(
      JSON.stringify({ ...common, hook_event_name: "Stop" }),
      remoteEnv({ CLAUDE_PROJECT_DIR: dir }),
      { jq },
    );
    const body = singleBody(result);
    expect(body.repo).toBe(expected);
    expect(body.branch).toBe("main");
    expect(received[0]?.body).not.toMatch(/GEHEIM|token|local_proxy/);
  });

  it("fällt ohne Remote auf den Verzeichnisnamen zurück", async () => {
    const dir = gitRepo(null, "main", "ohne-remote");
    const body = singleBody(
      await runHook(
        JSON.stringify({ ...common, hook_event_name: "Stop" }),
        remoteEnv({ CLAUDE_PROJECT_DIR: `${dir}/` }),
        { jq },
      ),
    );
    expect(body.repo).toBe("ohne-remote");
    expect(body.branch).toBe("main");
  });

  it("fällt ohne git und ohne CLAUDE_PROJECT_DIR auf basename(cwd) zurück, ohne branch", async () => {
    const env = remoteEnv();
    delete env.CLAUDE_PROJECT_DIR;
    const body = singleBody(
      await runHook(JSON.stringify({ ...common, hook_event_name: "Stop" }), env, {
        jq,
        git: false,
      }),
    );
    expect(body.repo).toBe("agent-deck");
    expect(body).not.toHaveProperty("branch");
  });

  it("kürzt message auf 120 Zeichen und ersetzt Steuerzeichen", async () => {
    const long = "ä".repeat(50) + "\n\t" + "x".repeat(200);
    const body = singleBody(
      await runHook(
        JSON.stringify({ ...common, hook_event_name: "StopFailure", error: long }),
        remoteEnv(),
        { jq },
      ),
    );
    expect(body.message).toBe("ä".repeat(50) + "  " + "x".repeat(68));
  });

  it("behandelt Escapes, Umlaute und Emoji in message", async () => {
    const message = 'Claude braucht "Erlaubnis" für C:\\Temp\\neu\r\nGrüße 😀 / \u0001 Ende';
    const payload = JSON.stringify({
      ...common,
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message,
    });
    // Zusätzlich als \u-Escapes, wie es andere JSON-Encoder schreiben.
    const escaped = payload.replace(/[^\x20-\x7e]/gu, (c) =>
      [...c]
        .map((ch) => {
          const code = ch.codePointAt(0) ?? 0;
          if (code <= 0xffff) return `\\u${code.toString(16).padStart(4, "0")}`;
          const v = code - 0x10000;
          return `\\u${(0xd800 + (v >> 10)).toString(16)}\\u${(0xdc00 + (v & 0x3ff)).toString(16)}`;
        })
        .join(""),
    );
    const expected = 'Claude braucht "Erlaubnis" für C:\\Temp\\neu  Grüße 😀 /   Ende';
    for (const input of [payload, escaped, payload.replaceAll("/", "\\/")]) {
      received = [];
      const body = singleBody(await runHook(input, remoteEnv(), { jq }));
      expect(body.message).toBe(expected);
    }
  });

  it("ignoriert gleichnamige Felder in verschachtelten Objekten", async () => {
    const payload =
      '{"tool_input":{"hook_event_name":"Falsch","tool_name":"Falsch","session_id":"falsch"},' +
      `"hook_event_name":"PermissionRequest","tool_name":"Bash","session_id":"${UUID}"}`;
    const env = remoteEnv();
    delete env.CLAUDE_CODE_REMOTE_SESSION_ID;
    const body = singleBody(await runHook(payload, env, { jq }));
    expect(body).toMatchObject({ event: "PermissionRequest", message: "Bash", sessionId: UUID });
  });

  it("verkraftet einen großen Payload (PostToolUse mit Read)", async () => {
    const payload = JSON.stringify({
      ...common,
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/x" },
      tool_response: { file: { content: 'GEHEIM "\\ \n'.repeat(20_000) } },
    });
    const body = singleBody(await runHook(payload, remoteEnv(), { jq }));
    expect(body.event).toBe("PostToolUse");
    expect(received[0]?.body).not.toMatch(/GEHEIM/);
  });

  it("sendet Events, die der Hub ignoriert, trotzdem", async () => {
    const body = singleBody(
      await runHook(
        JSON.stringify({ ...common, hook_event_name: "SubagentStop", agent_type: "" }),
        remoteEnv(),
        { jq },
      ),
    );
    expect(body.event).toBe("SubagentStop");
  });

  it.each([
    ["kein JSON", "kein json"],
    ["abgeschnitten", '{"hook_event_name":"Stop","session_id":"abc"'],
    ["Array", '[{"hook_event_name":"Stop"}]'],
    ["ohne hook_event_name", '{"session_id":"abc"}'],
    ["ungültiger Event-Name", '{"hook_event_name":"Stop; rm -rf","session_id":"abc"}'],
    ["Event-Name keine Zeichenkette", '{"hook_event_name":42,"session_id":"abc"}'],
    ["leer", ""],
  ])("kaputter Payload (%s): kein Request, Exit 0", async (_name, payload) => {
    const result = await runHook(payload, remoteEnv(), { jq });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(received).toHaveLength(0);
  });
});

describe("agent-deck.sh Werkzeuge und Abbruchbedingungen", () => {
  const STOP = JSON.stringify({ ...common, hook_event_name: "Stop" });

  it("liefert mit und ohne jq denselben Body (bis auf ts)", async () => {
    const payload = JSON.stringify({
      ...common,
      hook_event_name: "Notification",
      notification_type: "idle_prompt",
      message: 'Tab\tund "Quote" \\ ä 😀 \u007f',
    });
    await runHook(payload, remoteEnv(), { jq: true });
    await runHook(payload, remoteEnv(), { jq: false });
    expect(received).toHaveLength(2);
    const strip = (raw: string) => raw.replace(/"ts":"[^"]*"/, '"ts":""');
    expect(strip(received[0]?.body ?? "a")).toBe(strip(received[1]?.body ?? "b"));
  });

  it("kommt ohne date aus", async () => {
    const body = singleBody(await runHook(STOP, remoteEnv(), { date: false }));
    expect(body.ts).toMatch(TS);
  });

  it("tut lokal nichts (CLAUDE_CODE_REMOTE nicht true)", async () => {
    for (const remote of [undefined, "false", "1"]) {
      const env = remoteEnv();
      if (remote === undefined) delete env.CLAUDE_CODE_REMOTE;
      else env.CLAUDE_CODE_REMOTE = remote;
      const result = await runHook(STOP, env);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    }
    expect(received).toHaveLength(0);
  });

  it("tut ohne AGENT_DECK_URL nichts", async () => {
    const env = remoteEnv();
    delete env.AGENT_DECK_URL;
    const result = await runHook(STOP, env);
    expect(result.status).toBe(0);
    expect(received).toHaveLength(0);
  });

  it("endet ohne curl mit Exit 0", async () => {
    const result = await runHook(STOP, remoteEnv(), { curl: false });
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("endet mit Exit 0 und ohne Ausgabe, wenn der Hub nicht erreichbar ist", async () => {
    for (const jq of [true, false]) {
      const result = await runHook(STOP, remoteEnv({ AGENT_DECK_URL: "http://127.0.0.1:1" }), {
        jq,
      });
      expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    }
  });

  it("wartet höchstens ~2 s auf einen hängenden Hub", async () => {
    const hanging = createServer(() => {
      /* antwortet nie */
    });
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const port = (hanging.address() as AddressInfo).port;
    const started = Date.now();
    const result = await runHook(STOP, remoteEnv({ AGENT_DECK_URL: `http://127.0.0.1:${port}` }));
    const elapsed = Date.now() - started;
    hanging.closeAllConnections();
    await new Promise<void>((resolve) => hanging.close(() => resolve()));
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(elapsed).toBeLessThan(4000);
  });
});
