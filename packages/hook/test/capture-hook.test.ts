import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "..", "agent-deck-capture.sh");

interface Received {
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];

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
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  received = [];
});

/** Minimal-PATH mit genau den Werkzeugen, die das Skript braucht – optional ohne jq. */
function toolDir(withJq: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-bin-"));
  const tools = ["bash", "cat", "curl", "sort", "tr", "sed", ...(withJq ? ["jq"] : [])];
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
  withJq = true,
): Promise<HookResult> {
  const bin = toolDir(withJq);
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

const PAYLOAD = JSON.stringify({
  session_id: "abc123",
  hook_event_name: "Notification",
  notification_type: "permission_prompt",
  message: 'Claude braucht "Erlaubnis"\nfür Bash',
  cwd: "/home/user/agent-deck",
});

const SAFE_ENV = {
  CLAUDE_CODE_REMOTE: "true",
  CLAUDE_CODE_REMOTE_SESSION_ID: "cse_01ABC",
  GIT_HTTP_PROXY: "http://user:geheim@proxy.local:3128",
  MULTILINE: 'zeile1\nzeile2\t"quote" \\ backslash',
};
const SENSITIVE_ENV = {
  ANTHROPIC_API_KEY: "sk-geheim",
  GH_TOKEN: "ghp-geheim",
  AWS_SECRET_ACCESS_KEY: "aws-geheim",
  DB_PASSWORD: "pw-geheim",
  my_auth_header: "auth-geheim",
  CLAUDE_CODE_USER_EMAIL: "ich@example.com",
};

describe.each([
  ["mit jq", true],
  ["ohne jq", false],
])("agent-deck-capture.sh %s", (_label, withJq) => {
  it("schickt Payload und gefiltertes env, ohne Ausgabe und mit Exit 0", async () => {
    const result = await runHook(
      PAYLOAD,
      { ...SAFE_ENV, ...SENSITIVE_ENV, AGENT_DECK_URL: `${baseUrl}/` },
      withJq,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request?.url).toBe("/events");
    expect(request?.headers["content-type"]).toBe("application/json");

    const body = JSON.parse(request?.body ?? "") as {
      tool: string;
      payload: unknown;
      env: Record<string, string>;
    };
    expect(body.tool).toBe(withJq ? "jq" : "bash");
    expect(body.payload).toEqual(JSON.parse(PAYLOAD));
    expect(body.env.CLAUDE_CODE_REMOTE_SESSION_ID).toBe("cse_01ABC");
    expect(body.env.MULTILINE).toBe(SAFE_ENV.MULTILINE);
    expect(body.env.GIT_HTTP_PROXY).toBe("http://***@proxy.local:3128");
    for (const name of Object.keys(SENSITIVE_ENV)) expect(body.env).not.toHaveProperty(name);
    expect(request?.body).not.toMatch(/geheim|example\.com/);
  });

  it("schickt Nicht-JSON-Payload als String mit", async () => {
    await runHook("kein json", { ...SAFE_ENV, AGENT_DECK_URL: baseUrl }, withJq);
    const body = JSON.parse(received[0]?.body ?? "") as { payload: unknown };
    expect(body.payload).toBe("kein json");
  });
});

describe("agent-deck-capture.sh Abbruchbedingungen", () => {
  it("tut lokal nichts (CLAUDE_CODE_REMOTE nicht true)", async () => {
    for (const remote of [undefined, "false", "1"]) {
      const env: Record<string, string> = { AGENT_DECK_URL: baseUrl };
      if (remote !== undefined) env.CLAUDE_CODE_REMOTE = remote;
      const result = await runHook(PAYLOAD, env);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    }
    expect(received).toHaveLength(0);
  });

  it("tut ohne AGENT_DECK_URL nichts", async () => {
    const result = await runHook(PAYLOAD, { CLAUDE_CODE_REMOTE: "true" });
    expect(result.status).toBe(0);
    expect(received).toHaveLength(0);
  });

  it("endet mit Exit 0 und ohne Ausgabe, wenn der Hub nicht erreichbar ist", async () => {
    const result = await runHook(PAYLOAD, {
      CLAUDE_CODE_REMOTE: "true",
      AGENT_DECK_URL: "http://127.0.0.1:1",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("wartet höchstens ~2 s auf einen hängenden Hub", async () => {
    const hanging = createServer(() => {
      /* antwortet nie */
    });
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const port = (hanging.address() as AddressInfo).port;
    const started = Date.now();
    const result = await runHook(PAYLOAD, {
      CLAUDE_CODE_REMOTE: "true",
      AGENT_DECK_URL: `http://127.0.0.1:${port}`,
    });
    const elapsed = Date.now() - started;
    hanging.closeAllConnections();
    await new Promise<void>((resolve) => hanging.close(() => resolve()));
    expect(result.status).toBe(0);
    expect(elapsed).toBeLessThan(4000);
  });
});
