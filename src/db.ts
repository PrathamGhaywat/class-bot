import Database from "better-sqlite3";

export const db = new Database("class-agent.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS homework (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      subject TEXT,
      due_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timetable (
      id TEXT PRIMARY KEY,
      day_of_week INTEGER NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      subject TEXT NOT NULL,
      teacher TEXT,
      room TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT,
      location TEXT,
      kind TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT,
      test_date TEXT NOT NULL,
      scope TEXT,
      context TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      file_path TEXT,
      mime_type TEXT,
      content_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS allowed_groups (
      jid TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS known_groups (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_seen_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_homework_due_date ON homework(due_date);
    CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable(day_of_week, start_time);
    CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
    CREATE INDEX IF NOT EXISTS idx_tests_date ON tests(test_date);
    CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge_documents(updated_at);
    CREATE INDEX IF NOT EXISTS idx_known_groups_seen ON known_groups(last_seen_at DESC);
  `);
}
