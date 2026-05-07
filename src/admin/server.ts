import express, { type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { z } from "zod";
import type { ClassDataService } from "../services/class-data-service.js";
import { syncKnownGroupsFromWhatsApp } from "../whatsapp/bot.js";
import { clearAuthCookie, createAdminToken, requireAuth, setAuthCookie } from "./auth.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const homeworkSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional().default(null),
  subject: z.string().nullable().optional().default(null),
  dueDate: z.string().nullable().optional().default(null),
});

const timetableSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  subject: z.string().min(1),
  teacher: z.string().nullable().optional().default(null),
  room: z.string().nullable().optional().default(null),
  notes: z.string().nullable().optional().default(null),
});

const appointmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional().default(null),
  startAt: z.string().min(1),
  endAt: z.string().nullable().optional().default(null),
  location: z.string().nullable().optional().default(null),
  kind: z.string().nullable().optional().default(null),
});

const testSchema = z.object({
  title: z.string().min(1),
  subject: z.string().nullable().optional().default(null),
  testDate: z.string().min(1),
  scope: z.string().nullable().optional().default(null),
  context: z.string().nullable().optional().default(null),
});

const knowledgeTextSchema = z.object({
  title: z.string().min(1),
  contentText: z.string().min(1),
});

const groupJidSchema = z.object({
  jid: z.string().min(1).regex(/@g\.us$/, "Group JID must end with @g.us"),
});

async function readTextContent(filePath: string, mimeType: string): Promise<string> {
  if (mimeType.startsWith("text/") || mimeType.includes("json")) {
    return fs.readFile(filePath, "utf8");
  }

  // Images and other binaries can still be indexed through manual context notes.
  return "";
}

function getRouteId(req: Request, res: Response): string | null {
  const id = req.params.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    res.status(400).json({ error: "Invalid id parameter" });
    return null;
  }
  return id;
}

async function resolvePublicDir(): Promise<string> {
  const candidateDirs = [
    path.join(currentDir, "public"),
    path.join(process.cwd(), "src", "admin", "public"),
    path.join(process.cwd(), "dist", "admin", "public"),
  ];

  for (const dir of candidateDirs) {
    try {
      await fs.access(path.join(dir, "index.html"));
      return dir;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("Could not locate admin public directory.");
}

export async function createAdminServer(options: {
  dataService: ClassDataService;
  adminPassword: string;
  knowledgeDir: string;
}) {
  const app = express();
  const authMiddleware = requireAuth(options.adminPassword);
  const publicDir = await resolvePublicDir();

  await fs.mkdir(options.knowledgeDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, options.knowledgeDir),
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const sanitized = file.originalname.replace(/[^\w.-]/g, "_");
      cb(null, `${timestamp}_${sanitized}`);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
  });

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/", (_req, res) => {
    res.redirect("/admin");
  });

  app.get("/admin", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.post("/api/login", (req: Request, res: Response) => {
    const password = z.string().parse(req.body?.password);
    if (password !== options.adminPassword) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }

    const token = createAdminToken(options.adminPassword);
    setAuthCookie(res, token);
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/session", authMiddleware, (_req, res) => {
    res.json({ authenticated: true });
  });

  app.get("/api/groups", authMiddleware, (_req, res) => {
    res.json({
      items: options.dataService.listKnownGroups(),
      allowedJids: options.dataService.listAllowedGroups(),
    });
  });

  app.post("/api/groups/sync", authMiddleware, async (_req, res, next) => {
    try {
      const count = await syncKnownGroupsFromWhatsApp(options.dataService);
      res.json({
        syncedCount: count,
        items: options.dataService.listKnownGroups(),
        allowedJids: options.dataService.listAllowedGroups(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/groups/allowed", authMiddleware, (req, res) => {
    const payload = groupJidSchema.parse(req.body);
    options.dataService.addAllowedGroup(payload.jid);
    res.status(201).json({ ok: true });
  });

  app.delete("/api/groups/allowed/:id", authMiddleware, (req, res) => {
    const id = getRouteId(req, res);
    if (!id) {
      return;
    }
    if (!/@g\.us$/.test(id)) {
      res.status(400).json({ error: "Group JID must end with @g.us" });
      return;
    }
    options.dataService.removeAllowedGroup(id);
    res.json({ ok: true });
  });

  app.get("/api/homework", authMiddleware, (_req, res) => {
    res.json({ items: options.dataService.listHomework() });
  });

  app.post("/api/homework", authMiddleware, (req, res) => {
    const payload = homeworkSchema.parse(req.body);
    const item = options.dataService.createHomework(payload);
    res.status(201).json({ item });
  });

  app.put("/api/homework/:id", authMiddleware, (req, res, next) => {
    try {
      const id = getRouteId(req, res);
      if (!id) {
        return;
      }
      const payload = homeworkSchema.parse(req.body);
      const item = options.dataService.updateHomework(id, payload);
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/homework/:id", authMiddleware, (req, res) => {
    const id = getRouteId(req, res);
    if (!id) {
      return;
    }
    options.dataService.deleteHomework(id);
    res.json({ ok: true });
  });

  app.get("/api/timetable", authMiddleware, (_req, res) => {
    res.json({ items: options.dataService.listTimetable() });
  });

  app.post("/api/timetable", authMiddleware, (req, res) => {
    const payload = timetableSchema.parse(req.body);
    const item = options.dataService.createTimetable(payload);
    res.status(201).json({ item });
  });

  app.put("/api/timetable/:id", authMiddleware, (req, res, next) => {
    try {
      const id = getRouteId(req, res);
      if (!id) {
        return;
      }
      const payload = timetableSchema.parse(req.body);
      const item = options.dataService.updateTimetable(id, payload);
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/timetable/:id", authMiddleware, (req, res) => {
    const id = getRouteId(req, res);
    if (!id) {
      return;
    }
    options.dataService.deleteTimetable(id);
    res.json({ ok: true });
  });

  app.get("/api/appointments", authMiddleware, (_req, res) => {
    res.json({ items: options.dataService.listAppointments() });
  });

  app.post("/api/appointments", authMiddleware, (req, res) => {
    const payload = appointmentSchema.parse(req.body);
    const item = options.dataService.createAppointment(payload);
    res.status(201).json({ item });
  });

  app.put("/api/appointments/:id", authMiddleware, (req, res, next) => {
    try {
      const id = getRouteId(req, res);
      if (!id) {
        return;
      }
      const payload = appointmentSchema.parse(req.body);
      const item = options.dataService.updateAppointment(id, payload);
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/appointments/:id", authMiddleware, (req, res) => {
    const id = getRouteId(req, res);
    if (!id) {
      return;
    }
    options.dataService.deleteAppointment(id);
    res.json({ ok: true });
  });

  app.get("/api/tests", authMiddleware, (_req, res) => {
    res.json({ items: options.dataService.listTests() });
  });

  app.post("/api/tests", authMiddleware, (req, res) => {
    const payload = testSchema.parse(req.body);
    const item = options.dataService.createTest(payload);
    res.status(201).json({ item });
  });

  app.put("/api/tests/:id", authMiddleware, (req, res, next) => {
    try {
      const id = getRouteId(req, res);
      if (!id) {
        return;
      }
      const payload = testSchema.parse(req.body);
      const item = options.dataService.updateTest(id, payload);
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/tests/:id", authMiddleware, (req, res) => {
    const id = getRouteId(req, res);
    if (!id) {
      return;
    }
    options.dataService.deleteTest(id);
    res.json({ ok: true });
  });

  app.get("/api/knowledge", authMiddleware, (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query : undefined;
    res.json({ items: options.dataService.listKnowledge(query) });
  });

  app.post("/api/knowledge-text", authMiddleware, (req, res) => {
    const payload = knowledgeTextSchema.parse(req.body);
    const item = options.dataService.createKnowledge({
      title: payload.title,
      sourceType: "text",
      filePath: null,
      mimeType: "text/plain",
      contentText: payload.contentText,
    });
    res.status(201).json({ item });
  });

  app.put("/api/knowledge/:id", authMiddleware, (req, res, next) => {
    try {
      const id = getRouteId(req, res);
      if (!id) {
        return;
      }
      const payload = knowledgeTextSchema.parse(req.body);
      const item = options.dataService.updateKnowledgeText(id, {
        title: payload.title,
        contentText: payload.contentText,
      });
      res.json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/upload", authMiddleware, upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Missing file upload" });
        return;
      }

      const title = typeof req.body.title === "string" && req.body.title.trim().length > 0
        ? req.body.title.trim()
        : req.file.originalname;

      const manualContext =
        typeof req.body.contentText === "string" ? req.body.contentText.trim() : "";
      const extractedText = await readTextContent(req.file.path, req.file.mimetype);
      const finalContent = [manualContext, extractedText].filter(Boolean).join("\n\n").trim();

      const item = options.dataService.createKnowledge({
        title,
        sourceType: "upload",
        filePath: req.file.path,
        mimeType: req.file.mimetype,
        contentText:
          finalContent.length > 0
            ? finalContent
            : "Binary file uploaded. Add a context note so the bot can use it.",
      });

      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/knowledge/:id", authMiddleware, async (req, res, next) => {
    try {
      const id = getRouteId(req, res);
      if (!id) {
        return;
      }

      const item = options.dataService.listKnowledge().find((doc) => doc.id === id);
      if (item?.filePath) {
        await fs.rm(item.filePath, { force: true });
      }
      options.dataService.deleteKnowledge(id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: () => void) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues.map((issue) => issue.message).join(", ") });
      return;
    }

    if (error instanceof Error && /not found/i.test(error.message)) {
      res.status(404).json({ error: error.message });
      return;
    }

    console.error("Admin API error", error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
