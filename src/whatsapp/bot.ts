import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import type { ClassDataService } from "../services/class-data-service.js";

let activeSocket: ReturnType<typeof makeWASocket> | null = null;

function extractText(message: WAMessage): string {
  return (
    message.message?.conversation ??
    message.message?.extendedTextMessage?.text ??
    message.message?.imageMessage?.caption ??
    message.message?.videoMessage?.caption ??
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
    return trailing.length > 0 ? trailing : null;
  }

  return null;
}

interface WhatsAppBotOptions {
  authDir: string;
  dataService: ClassDataService;
  pairingPhoneNumber?: string;
  mentionAliases: string[];
  responder: (prompt: string) => Promise<string>;
}

function normalizePhoneNumber(phone: string): string {
  // Baileys expects E.164 without "+" (digits only).
  return phone.replace(/\D/g, "");
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
  return syncKnownGroups(activeSocket, dataService);
}

export async function startWhatsAppBot(options: WhatsAppBotOptions): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(options.authDir);
  const { version } = await fetchLatestBaileysVersion();
  let pairingCodeRequested = false;

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
      const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } })?.output
        ?.statusCode;
      if (activeSocket === sock) {
        activeSocket = null;
      }
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log("WhatsApp disconnected, reconnecting...");
        void startWhatsAppBot(options);
      } else {
        console.error("WhatsApp session logged out. Delete auth dir and re-link.");
      }
    }
    if (update.connection === "open") {
      console.log("WhatsApp bot connected.");
      try {
        const count = await syncKnownGroups(sock, options.dataService);
        console.log(`Synced ${count} WhatsApp groups.`);
      } catch (error) {
        console.error("Failed to fetch participating groups", error);
      }
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
      console.log(`[Bot] Received message in group: "${text}"`);
      if (!text) {
        console.log("[Bot] No text content in message");
        continue;
      }

      console.log(`[Bot] Looking for mention aliases: ${options.mentionAliases.join(", ")}`);
      const prompt = parseMentionPrompt(text, options.mentionAliases);
      if (prompt === null) {
        console.log(`[Bot] No mention found in message: "${text}"`);
        continue;
      }

      console.log(`[Bot] Mention detected! Prompt: "${prompt}"`);
      try {
        const answer = await options.responder(prompt);
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
}
