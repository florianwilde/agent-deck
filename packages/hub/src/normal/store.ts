import Database from "better-sqlite3";
import { SessionSchema } from "@agent-deck/shared";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { SessionRecord } from "./engine.ts";

const RecordSchema = SessionSchema.extend({
  lastSeenAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

/**
 * Persistiert den Session-Stand, damit ein Neustart ihn behält. Gespeichert werden nur die
 * Metadaten aus {@link SessionRecord}, keine Inhalte.
 */
export class SessionStore {
  private readonly db: Database.Database;
  private readonly upsertStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;
  private readonly listStmt: Database.Statement;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
    this.upsertStmt = this.db.prepare(
      "INSERT INTO sessions (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data",
    );
    this.deleteStmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    this.listStmt = this.db.prepare("SELECT data FROM sessions");
  }

  /** Alle gespeicherten Sessions; ungültige Zeilen (z. B. nach Schemaänderung) werden übersprungen. */
  load(): SessionRecord[] {
    const rows = this.listStmt.all() as { data: string }[];
    const records: SessionRecord[] = [];
    for (const row of rows) {
      let json: unknown;
      try {
        json = JSON.parse(row.data);
      } catch {
        continue;
      }
      const parsed = RecordSchema.safeParse(json);
      if (parsed.success) records.push(parsed.data);
    }
    return records;
  }

  save(record: SessionRecord): void {
    this.upsertStmt.run(record.id, JSON.stringify(record));
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }

  /** Anzahl Einträge aus dem Capture-Modus (Phase 0) in derselben Datenbank, sonst 0. */
  captureRows(): number {
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capture'")
      .get();
    if (table === undefined) return 0;
    const row = this.db.prepare("SELECT count(*) AS n FROM capture").get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
