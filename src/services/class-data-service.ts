import { randomUUID } from "crypto";
import type { Database } from "better-sqlite3";
import type {
  AppointmentItem,
  HomeworkItem,
  KnowledgeDocument,
  SearchHit,
  TestItem,
  TimetableItem,
} from "../types.js";

type HomeworkInput = Omit<HomeworkItem, "id" | "createdAt">;
type TimetableInput = Omit<TimetableItem, "id" | "createdAt">;
type AppointmentInput = Omit<AppointmentItem, "id" | "createdAt">;
type TestInput = Omit<TestItem, "id" | "createdAt">;
type KnowledgeInput = Omit<KnowledgeDocument, "id" | "createdAt" | "updatedAt">;

interface HomeworkRow {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  due_date: string | null;
  created_at: string;
}

interface TimetableRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  subject: string;
  teacher: string | null;
  room: string | null;
  notes: string | null;
  created_at: string;
}

interface AppointmentRow {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  location: string | null;
  kind: string | null;
  created_at: string;
}

interface TestRow {
  id: string;
  title: string;
  subject: string | null;
  test_date: string;
  scope: string | null;
  context: string | null;
  created_at: string;
}

interface KnowledgeRow {
  id: string;
  title: string;
  source_type: string;
  file_path: string | null;
  mime_type: string | null;
  content_text: string;
  created_at: string;
  updated_at: string;
}

interface KnowledgeSearchRow {
  id: string;
  title: string;
  content_text: string;
}

interface HomeworkSearchRow {
  id: string;
  title: string;
  subject: string | null;
  description: string | null;
  due_date: string | null;
}

interface TestSearchRow {
  id: string;
  title: string;
  subject: string | null;
  test_date: string;
  scope: string | null;
  context: string | null;
}

interface AllowedGroupRow {
  jid: string;
  created_at: string;
}

interface KnownGroupRow {
  jid: string;
  name: string | null;
  last_seen_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ClassDataService {
  constructor(private readonly db: Database) {}

  listAllowedGroups(): string[] {
    const rows = this.db
      .prepare<unknown[], AllowedGroupRow>(`SELECT jid, created_at FROM allowed_groups ORDER BY created_at ASC`)
      .all();

    return rows.map((row) => row.jid);
  }

  addAllowedGroup(jid: string): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO allowed_groups (jid, created_at) VALUES (?, ?)`)
      .run(jid, nowIso());
  }

  removeAllowedGroup(jid: string): void {
    this.db.prepare(`DELETE FROM allowed_groups WHERE jid = ?`).run(jid);
  }

  isGroupAllowed(jid: string): boolean {
    const row = this.db
      .prepare<[string], { exists_flag: 1 }>(
        `SELECT 1 as exists_flag FROM allowed_groups WHERE jid = ? LIMIT 1`,
      )
      .get(jid);
    return Boolean(row);
  }

  upsertKnownGroup(jid: string, name?: string | null): void {
    // Keep a lightweight memory of groups this session/account has seen.
    this.db
      .prepare(
        `INSERT INTO known_groups (jid, name, last_seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT(jid)
         DO UPDATE SET
           name = COALESCE(excluded.name, known_groups.name),
           last_seen_at = excluded.last_seen_at`,
      )
      .run(jid, name ?? null, nowIso());
  }

  listKnownGroups(): Array<{ jid: string; name: string | null; lastSeenAt: string; allowed: boolean }> {
    const rows = this.db
      .prepare<unknown[], KnownGroupRow>(
        `SELECT jid, name, last_seen_at
         FROM known_groups
         ORDER BY last_seen_at DESC`,
      )
      .all();

    return rows.map((row) => ({
      jid: row.jid,
      name: row.name,
      lastSeenAt: row.last_seen_at,
      allowed: this.isGroupAllowed(row.jid),
    }));
  }

  listHomework(): HomeworkItem[] {
    const rows = this.db
      .prepare<unknown[], HomeworkRow>(
        `SELECT id, title, description, subject, due_date, created_at
         FROM homework
         ORDER BY due_date IS NULL, due_date ASC`,
      )
      .all();

    return rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        subject: row.subject,
        dueDate: row.due_date,
        createdAt: row.created_at,
      }));
  }

  createHomework(input: HomeworkInput): HomeworkItem {
    const item: HomeworkItem = {
      id: randomUUID(),
      ...input,
      createdAt: nowIso(),
    };

    this.db
      .prepare(
        `INSERT INTO homework (id, title, description, subject, due_date, created_at)
         VALUES (@id, @title, @description, @subject, @dueDate, @createdAt)`,
      )
      .run(item);

    return item;
  }

  updateHomework(id: string, input: HomeworkInput): HomeworkItem {
    const result = this.db
      .prepare(
        `UPDATE homework
         SET title = @title, description = @description, subject = @subject, due_date = @dueDate
         WHERE id = @id`,
      )
      .run({ id, ...input });

    if (result.changes === 0) {
      throw new Error("Homework item not found");
    }

    return {
      id,
      ...input,
      createdAt: this.db
        .prepare<[string], { created_at: string }>(`SELECT created_at FROM homework WHERE id = ?`)
        .get(id)!.created_at,
    };
  }

  deleteHomework(id: string): void {
    this.db.prepare(`DELETE FROM homework WHERE id = ?`).run(id);
  }

  listTimetable(): TimetableItem[] {
    const rows = this.db
      .prepare<unknown[], TimetableRow>(
        `SELECT id, day_of_week, start_time, end_time, subject, teacher, room, notes, created_at
         FROM timetable
         ORDER BY day_of_week ASC, start_time ASC`,
      )
      .all();

    return rows
      .map((row) => ({
        id: row.id,
        dayOfWeek: row.day_of_week,
        startTime: row.start_time,
        endTime: row.end_time,
        subject: row.subject,
        teacher: row.teacher,
        room: row.room,
        notes: row.notes,
        createdAt: row.created_at,
      }));
  }

  createTimetable(input: TimetableInput): TimetableItem {
    const item: TimetableItem = {
      id: randomUUID(),
      ...input,
      createdAt: nowIso(),
    };

    this.db
      .prepare(
        `INSERT INTO timetable (id, day_of_week, start_time, end_time, subject, teacher, room, notes, created_at)
         VALUES (@id, @dayOfWeek, @startTime, @endTime, @subject, @teacher, @room, @notes, @createdAt)`,
      )
      .run(item);

    return item;
  }

  updateTimetable(id: string, input: TimetableInput): TimetableItem {
    const result = this.db
      .prepare(
        `UPDATE timetable
         SET day_of_week = @dayOfWeek, start_time = @startTime, end_time = @endTime, subject = @subject,
             teacher = @teacher, room = @room, notes = @notes
         WHERE id = @id`,
      )
      .run({ id, ...input });

    if (result.changes === 0) {
      throw new Error("Timetable item not found");
    }

    return {
      id,
      ...input,
      createdAt: this.db
        .prepare<[string], { created_at: string }>(`SELECT created_at FROM timetable WHERE id = ?`)
        .get(id)!.created_at,
    };
  }

  deleteTimetable(id: string): void {
    this.db.prepare(`DELETE FROM timetable WHERE id = ?`).run(id);
  }

  listAppointments(): AppointmentItem[] {
    const rows = this.db
      .prepare<unknown[], AppointmentRow>(
        `SELECT id, title, description, start_at, end_at, location, kind, created_at
         FROM appointments
         ORDER BY start_at ASC`,
      )
      .all();

    return rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        startAt: row.start_at,
        endAt: row.end_at,
        location: row.location,
        kind: row.kind,
        createdAt: row.created_at,
      }));
  }

  createAppointment(input: AppointmentInput): AppointmentItem {
    const item: AppointmentItem = {
      id: randomUUID(),
      ...input,
      createdAt: nowIso(),
    };

    this.db
      .prepare(
        `INSERT INTO appointments (id, title, description, start_at, end_at, location, kind, created_at)
         VALUES (@id, @title, @description, @startAt, @endAt, @location, @kind, @createdAt)`,
      )
      .run(item);

    return item;
  }

  updateAppointment(id: string, input: AppointmentInput): AppointmentItem {
    const result = this.db
      .prepare(
        `UPDATE appointments
         SET title = @title, description = @description, start_at = @startAt, end_at = @endAt,
             location = @location, kind = @kind
         WHERE id = @id`,
      )
      .run({ id, ...input });

    if (result.changes === 0) {
      throw new Error("Appointment item not found");
    }

    return {
      id,
      ...input,
      createdAt: this.db
        .prepare<[string], { created_at: string }>(`SELECT created_at FROM appointments WHERE id = ?`)
        .get(id)!.created_at,
    };
  }

  deleteAppointment(id: string): void {
    this.db.prepare(`DELETE FROM appointments WHERE id = ?`).run(id);
  }

  listTests(): TestItem[] {
    const rows = this.db
      .prepare<unknown[], TestRow>(
        `SELECT id, title, subject, test_date, scope, context, created_at
         FROM tests
         ORDER BY test_date ASC`,
      )
      .all();

    return rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        subject: row.subject,
        testDate: row.test_date,
        scope: row.scope,
        context: row.context,
        createdAt: row.created_at,
      }));
  }

  createTest(input: TestInput): TestItem {
    const item: TestItem = {
      id: randomUUID(),
      ...input,
      createdAt: nowIso(),
    };

    this.db
      .prepare(
        `INSERT INTO tests (id, title, subject, test_date, scope, context, created_at)
         VALUES (@id, @title, @subject, @testDate, @scope, @context, @createdAt)`,
      )
      .run(item);

    return item;
  }

  updateTest(id: string, input: TestInput): TestItem {
    const result = this.db
      .prepare(
        `UPDATE tests
         SET title = @title, subject = @subject, test_date = @testDate, scope = @scope, context = @context
         WHERE id = @id`,
      )
      .run({ id, ...input });

    if (result.changes === 0) {
      throw new Error("Test item not found");
    }

    return {
      id,
      ...input,
      createdAt: this.db
        .prepare<[string], { created_at: string }>(`SELECT created_at FROM tests WHERE id = ?`)
        .get(id)!.created_at,
    };
  }

  deleteTest(id: string): void {
    this.db.prepare(`DELETE FROM tests WHERE id = ?`).run(id);
  }

  listKnowledge(query?: string): KnowledgeDocument[] {
    if (!query?.trim()) {
      const rows = this.db
        .prepare<unknown[], KnowledgeRow>(
          `SELECT id, title, source_type, file_path, mime_type, content_text, created_at, updated_at
           FROM knowledge_documents
           ORDER BY updated_at DESC`,
        )
        .all();

      return rows
        .map((row) => ({
          id: row.id,
          title: row.title,
          sourceType: row.source_type,
          filePath: row.file_path,
          mimeType: row.mime_type,
          contentText: row.content_text,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    }

    const searchTerm = `%${query.toLowerCase()}%`;

    const rows = this.db
      .prepare<[string, string], KnowledgeRow>(
        `SELECT id, title, source_type, file_path, mime_type, content_text, created_at, updated_at
         FROM knowledge_documents
         WHERE lower(title) LIKE ? OR lower(content_text) LIKE ?
         ORDER BY updated_at DESC`,
      )
      .all(searchTerm, searchTerm);

    return rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        sourceType: row.source_type,
        filePath: row.file_path,
        mimeType: row.mime_type,
        contentText: row.content_text,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }

  getKnowledgeById(id: string): KnowledgeDocument | null {
    const row = this.db
      .prepare<[string], KnowledgeRow>(
        `SELECT id, title, source_type, file_path, mime_type, content_text, created_at, updated_at
         FROM knowledge_documents
         WHERE id = ?`,
      )
      .get(id);

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      sourceType: row.source_type,
      filePath: row.file_path,
      mimeType: row.mime_type,
      contentText: row.content_text,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createKnowledge(input: KnowledgeInput): KnowledgeDocument {
    const createdAt = nowIso();
    const item: KnowledgeDocument = {
      id: randomUUID(),
      ...input,
      createdAt,
      updatedAt: createdAt,
    };

    this.db
      .prepare(
        `INSERT INTO knowledge_documents (id, title, source_type, file_path, mime_type, content_text, created_at, updated_at)
         VALUES (@id, @title, @sourceType, @filePath, @mimeType, @contentText, @createdAt, @updatedAt)`,
      )
      .run(item);

    return item;
  }

  updateKnowledgeText(id: string, input: { title: string; contentText: string }): KnowledgeDocument {
    const updatedAt = nowIso();
    const result = this.db
      .prepare(
        `UPDATE knowledge_documents
         SET title = @title, content_text = @contentText, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        title: input.title,
        contentText: input.contentText,
        updatedAt,
      });

    if (result.changes === 0) {
      throw new Error("Knowledge item not found");
    }

    const row = this.db
      .prepare<[string], KnowledgeRow>(
        `SELECT id, title, source_type, file_path, mime_type, content_text, created_at, updated_at
         FROM knowledge_documents
         WHERE id = ?`,
      )
      .get(id);

    if (!row) {
      throw new Error("Knowledge item not found");
    }

    return {
      id: row.id,
      title: row.title,
      sourceType: row.source_type,
      filePath: row.file_path,
      mimeType: row.mime_type,
      contentText: row.content_text,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  deleteKnowledge(id: string): void {
    this.db.prepare(`DELETE FROM knowledge_documents WHERE id = ?`).run(id);
  }

  searchKnowledge(query: string, limit = 6): SearchHit[] {
    const searchTerm = `%${query.toLowerCase()}%`;
    const items: SearchHit[] = [];

    const docs = this.db
      .prepare<[string, string, number], KnowledgeSearchRow>(
        `SELECT id, title, content_text
         FROM knowledge_documents
         WHERE lower(title) LIKE ? OR lower(content_text) LIKE ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(searchTerm, searchTerm, limit);

    docs.forEach((row) => {
      items.push({
        source: "knowledge",
        id: row.id,
        text: `${row.title}: ${row.content_text.slice(0, 350)}`,
      });
    });

    const homework = this.db
      .prepare<[string, string, string, number], HomeworkSearchRow>(
        `SELECT id, title, subject, description, due_date
         FROM homework
         WHERE lower(title) LIKE ? OR lower(subject) LIKE ? OR lower(description) LIKE ?
         LIMIT ?`,
      )
      .all(searchTerm, searchTerm, searchTerm, limit);

    homework.forEach((row) => {
      items.push({
        source: "homework",
        id: row.id,
        text: `${row.title} (${row.subject ?? "no subject"}) due ${row.due_date ?? "unknown"}: ${row.description ?? ""}`,
      });
    });

    const tests = this.db
      .prepare<[string, string, string, string, number], TestSearchRow>(
        `SELECT id, title, subject, test_date, scope, context
         FROM tests
         WHERE lower(title) LIKE ? OR lower(subject) LIKE ? OR lower(scope) LIKE ? OR lower(context) LIKE ?
         LIMIT ?`,
      )
      .all(searchTerm, searchTerm, searchTerm, searchTerm, limit);

    tests.forEach((row) => {
      items.push({
        source: "test",
        id: row.id,
        text: `${row.title} (${row.subject ?? "no subject"}) on ${row.test_date}: ${row.scope ?? ""} ${row.context ?? ""}`,
      });
    });

    return items.slice(0, limit);
  }
}
