import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface CaptureEntry {
  id: number;
  receivedAt: string;
  remoteAddress: string;
  headers: Record<string, string | string[]>;
  /** Request-Body exakt so, wie er angekommen ist. */
  body: string;
}

interface CaptureRow {
  id: number;
  received_at: string;
  remote_address: string;
  headers: string;
  body: string;
}

/** Header, die nie gespeichert werden. */
const DROPPED_HEADERS = new Set(["authorization", "proxy-authorization", "cookie"]);

export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || DROPPED_HEADERS.has(name.toLowerCase())) continue;
    result[name] = value;
  }
  return result;
}

export class CaptureStore {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly listStmt: Database.Statement;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capture (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at TEXT NOT NULL,
        remote_address TEXT NOT NULL,
        headers TEXT NOT NULL,
        body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS capture_received_at ON capture (received_at);
    `);
    this.insertStmt = this.db.prepare(
      "INSERT INTO capture (received_at, remote_address, headers, body) VALUES (?, ?, ?, ?)",
    );
    this.listStmt = this.db.prepare(
      "SELECT * FROM capture WHERE received_at > ? ORDER BY id LIMIT ?",
    );
  }

  insert(entry: Omit<CaptureEntry, "id">): number {
    const result = this.insertStmt.run(
      entry.receivedAt,
      entry.remoteAddress,
      JSON.stringify(entry.headers),
      entry.body,
    );
    return Number(result.lastInsertRowid);
  }

  /** Einträge mit `receivedAt` nach `since` (ISO-8601, UTC), älteste zuerst. */
  list(since: string, limit: number): CaptureEntry[] {
    const rows = this.listStmt.all(since, limit) as CaptureRow[];
    return rows.map((row) => ({
      id: row.id,
      receivedAt: row.received_at,
      remoteAddress: row.remote_address,
      headers: JSON.parse(row.headers) as Record<string, string | string[]>,
      body: row.body,
    }));
  }

  close(): void {
    this.db.close();
  }
}
