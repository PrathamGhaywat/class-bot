export interface HomeworkItem {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  dueDate: string | null;
  createdAt: string;
}

export interface TimetableItem {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subject: string;
  teacher: string | null;
  room: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AppointmentItem {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  location: string | null;
  kind: string | null;
  createdAt: string;
}

export interface TestItem {
  id: string;
  title: string;
  subject: string | null;
  testDate: string;
  scope: string | null;
  context: string | null;
  createdAt: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  sourceType: string;
  filePath: string | null;
  mimeType: string | null;
  contentText: string;
  createdAt: string;
  updatedAt: string;
}

export type SearchHit =
  | { source: "homework"; text: string; id: string }
  | { source: "timetable"; text: string; id: string }
  | { source: "appointment"; text: string; id: string }
  | { source: "test"; text: string; id: string }
  | { source: "knowledge"; text: string; id: string };
