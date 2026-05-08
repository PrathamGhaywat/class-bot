import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import type { ClassDataService } from "../services/class-data-service.js";
import type { FileTextExtractor } from "../services/file-text-extractor.js";

let activeSocket: ReturnType<typeof makeWASocket> | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
let startupInProgress = false;

let groupSyncInProgress = false;
let lastGroupSyncAttemptAt = 0;
let lastGroupSyncSuccessAt = 0;
let groupSyncBlockedUntil = 0;

const AUTO_GROUP_SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000;
const AUTO_GROUP_SYNC_ATTEMPT_INTERVAL_MS = 2 * 60 * 1000;
const AUTO_GROUP_SYNC_RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;

function extractText(message: WAMessage): string {
  return (
    message.message?.conversation ??
    message.message?.extendedTextMessage?.text ??
    message.message?.imageMessage?.caption ??
    message.message?.videoMessage?.caption ??
    message.message?.documentMessage?.caption ??
    ""
  ).trim();
}

function parseMentionPrompt(messageText: string, aliases: string[]): string | null {
  const lowered = messageText.toLowerCase();

  for (const alias of aliases) {
    const pattern = new RegExp(`(^|\\s)@${alias}\\b`, "i");
    const match = pattern.exec(lowered);
    if (!match || match.index < 0) {
      continue;
    }

    const triggerStart = match.index + match[0].length;
    const trailing = messageText.slice(triggerStart).trim().replace(/^[:,-]\s*/, "");
    // Empty string means mention exists but no explicit trailing prompt.
    return trailing;
  }

  return null;
}

function getAttachmentInfo(message: WAMessage): { mimeType: string; fileName?: string } | null {
  if (message.message?.imageMessage) {
    return {
      mimeType: message.message.imageMessage.mimetype ?? "image/jpeg",
    };
  }

  if (message.message?.documentMessage) {
    const fileName = message.message.documentMessage.fileName;
    return {
      mimeType: message.message.documentMessage.mimetype ?? "application/octet-stream",
      ...(fileName ? { fileName } : {}),
    };
  }

  return null;
}

interface WhatsAppBotOptions {
  authDir: string;
  dataService: ClassDataService;
  fileTextExtractor: FileTextExtractor;
  pairingPhoneNumber?: string;
  mentionAliases: string[];
  responder: (prompt: string) => Promise<string>;
}

function normalizePhoneNumber(phone: string): string {
  // Baileys expects E.164 without "+" (digits only).
  return phone.replace(/\D/g, "");
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as {
    data?: unknown;
    message?: unknown;
    output?: { statusCode?: number };
  };

  if (maybe.data === 429) {
    return true;
  }

  if (maybe.output?.statusCode === 429) {
    return true;
  }

  if (typeof maybe.message === "string" && /rate[-_ ]?overlimit|429/i.test(maybe.message)) {
    return true;
  }

  return false;
}

function scheduleReconnect(options: WhatsAppBotOptions): void {
  if (reconnectTimer) {
    return;
  }

  reconnectAttempt += 1;
  const delayMs = Math.min(30_000, 2_000 * 2 ** (reconnectAttempt - 1));
  console.log(`[Bot] Reconnecting in ${delayMs}ms (attempt ${reconnectAttempt})...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startWhatsAppBot(options);
  }, delayMs);
}

async function maybeAutoSyncKnownGroups(
  sock: ReturnType<typeof makeWASocket>,
  dataService: ClassDataService,
): Promise<void> {
  const now = Date.now();

  if (groupSyncInProgress) {
    return;
  }

  if (now - lastGroupSyncAttemptAt < AUTO_GROUP_SYNC_ATTEMPT_INTERVAL_MS) {
    return;
  }

  if (now < groupSyncBlockedUntil) {
    const waitMs = groupSyncBlockedUntil - now;
    console.log(`[Bot] Skipping auto group sync (rate-limited cooldown ${Math.ceil(waitMs / 1000)}s).`);
    return;
  }

  if (lastGroupSyncSuccessAt > 0 && now - lastGroupSyncSuccessAt < AUTO_GROUP_SYNC_MIN_INTERVAL_MS) {
    return;
  }

  groupSyncInProgress = true;
  lastGroupSyncAttemptAt = now;
  try {
    const count = await syncKnownGroups(sock, dataService);
    lastGroupSyncSuccessAt = Date.now();
    console.log(`Synced ${count} WhatsApp groups.`);
  } catch (error) {
    if (isRateLimitError(error)) {
      groupSyncBlockedUntil = Date.now() + AUTO_GROUP_SYNC_RATE_LIMIT_COOLDOWN_MS;
      console.warn("[Bot] Auto group sync hit rate limit; pausing sync attempts for 10 minutes.");
      return;
    }

    console.error("Failed to fetch participating groups", error);
  } finally {
    groupSyncInProgress = false;
  }
}

async function syncKnownGroups(
  sock: ReturnType<typeof makeWASocket>,
  dataService: ClassDataService,
): Promise<number> {
  const groups = await sock.groupFetchAllParticipating();
  Object.entries(groups).forEach(([jid, metadata]) => {
    dataService.upsertKnownGroup(jid, metadata.subject ?? null);
  });
  return Object.keys(groups).length;
}

export async function syncKnownGroupsFromWhatsApp(dataService: ClassDataService): Promise<number> {
  if (!activeSocket) {
    throw new Error("WhatsApp socket is not connected yet");
  }

  try {
    lastGroupSyncAttemptAt = Date.now();
    const count = await syncKnownGroups(activeSocket, dataService);
    lastGroupSyncSuccessAt = Date.now();
    groupSyncBlockedUntil = 0;
    return count;
  } catch (error) {
    if (isRateLimitError(error)) {
      groupSyncBlockedUntil = Date.now() + AUTO_GROUP_SYNC_RATE_LIMIT_COOLDOWN_MS;
    }
    throw error;
  }
}

export async function startWhatsAppBot(options: WhatsAppBotOptions): Promise<void> {
  if (startupInProgress) {
    console.log("[Bot] WhatsApp startup already in progress; skipping duplicate start call.");
    return;
  }

  if (activeSocket) {
    console.log("[Bot] WhatsApp socket already active; skipping duplicate start call.");
    return;
  }

  startupInProgress = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(options.authDir);
    const { version } = await fetchLatestBaileysVersion();
    let pairingCodeRequested = false;
    let closeHandled = false;

    const sock = makeWASocket({
      version,
      auth: state,
    });
    activeSocket = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      if (update.qr) {
        console.log("Scan this QR with WhatsApp (Linked Devices):");
        qrcode.generate(update.qr, { small: true });
      }

      if (
        (update.connection === "connecting" || Boolean(update.qr)) &&
        !state.creds.registered &&
        options.pairingPhoneNumber &&
        !pairingCodeRequested
      ) {
        pairingCodeRequested = true;
        try {
          const code = await sock.requestPairingCode(
            normalizePhoneNumber(options.pairingPhoneNumber),
          );
          console.log(`WhatsApp pairing code: ${code}`);
        } catch (error) {
          pairingCodeRequested = false;
          console.error("Failed to request pairing code", error);
        }
      }

      if (update.connection === "close") {
        if (closeHandled) {
          return;
        }
        closeHandled = true;

        const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;

        if (activeSocket === sock) {
          activeSocket = null;
        }

        if (statusCode !== DisconnectReason.loggedOut) {
          console.log("WhatsApp disconnected.");
          scheduleReconnect(options);
        } else {
          console.error("WhatsApp session logged out. Delete auth dir and re-link.");
        }
        return;
      }

      if (update.connection === "open") {
        reconnectAttempt = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        console.log("WhatsApp bot connected.");
        await maybeAutoSyncKnownGroups(sock, options.dataService);
      }
    });

  sock.ev.on("groups.upsert", (groups) => {
    groups.forEach((group) => {
      if (group.id) {
        options.dataService.upsertKnownGroup(group.id, group.subject ?? null);
      }
    });
  });

  sock.ev.on("groups.update", (groups) => {
    groups.forEach((group) => {
      if (group.id) {
        options.dataService.upsertKnownGroup(group.id, group.subject ?? null);
      }
    });
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const message of messages) {
      if (!message.key.remoteJid) {
        continue;
      }

      // Restrict replies to explicitly allowed group chats only.
      if (!message.key.remoteJid.endsWith("@g.us")) {
        continue;
      }

      options.dataService.upsertKnownGroup(message.key.remoteJid, null);

      if (!options.dataService.isGroupAllowed(message.key.remoteJid)) {
        console.log(`[Bot] Group ${message.key.remoteJid} is not in allowed list`);
        continue;
      }

      const text = extractText(message);
      const prompt = parseMentionPrompt(text, options.mentionAliases);
      if (prompt === null) {
        continue;
      }

      let attachmentText = "";
      const attachment = getAttachmentInfo(message);
      if (attachment) {
        try {
          const media = await downloadMediaMessage(
            message,
            "buffer",
            {},
            {
              logger: sock.logger,
              reuploadRequest: sock.updateMediaMessage,
            },
          );
          const extraction = await options.fileTextExtractor.extractFromBuffer(
            media,
            attachment.mimeType,
            attachment.fileName,
          );
          if (extraction.warning) {
            console.warn(`[Bot] Attachment extraction warning: ${extraction.warning}`);
          }
          attachmentText = extraction.text.slice(0, 4_000);
          console.log(`[Bot] Attachment extraction method: ${extraction.method}`);
        } catch (error) {
          console.warn("[Bot] Failed to extract attachment text", error);
        }
      }

      const finalPrompt = [
        prompt.trim(),
        attachmentText ? `Attached file text:\n${attachmentText}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
        .trim();

      if (!finalPrompt) {
        await sock.sendMessage(
          message.key.remoteJid,
          { text: "I saw the mention but need a question or readable file text to help." },
          { quoted: message },
        );
        continue;
      }

      console.log(`[Bot] Mention detected! Prompt length: ${finalPrompt.length}`);
      try {
        const answer = await options.responder(finalPrompt);
        console.log(`[Bot] Response generated: "${answer}"`);
        await sock.sendMessage(
          message.key.remoteJid,
          { text: answer || "I could not generate an answer right now." },
          { quoted: message },
        );
      } catch (error) {
        console.error("Failed to process WhatsApp mention", error);
        await sock.sendMessage(
          message.key.remoteJid,
          { text: "I hit an error while answering. Please try again in a moment." },
          { quoted: message },
        );
      }
    }
  });
  } catch (error) {
    if (activeSocket) {
      activeSocket = null;
    }
    console.error("Failed to start WhatsApp bot", error);
    scheduleReconnect(options);
  } finally {
    startupInProgress = false;
  }
}
