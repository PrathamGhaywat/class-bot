import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  ADMIN_PASSWORD: z.string().min(1, "ADMIN_PASSWORD is required"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_PROVIDER_NAME: z.string().default("openai"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_MODE: z.enum(["auto", "chat", "responses"]).default("chat"),
  MENTION_ALIASES: z.string().default("prgh"),
  WHATSAPP_AUTH_DIR: z.string().default(".baileys-auth"),
  WHATSAPP_ALLOWED_GROUP_JID: z.string().optional(),
  WHATSAPP_ALLOWED_GROUP_JIDS: z.string().default(""),
  WHATSAPP_PAIRING_PHONE: z.string().optional(),
  KNOWLEDGE_DIR: z.string().default("uploads"),
  OCR_LANGUAGES: z.string().default("eng+deu"),
  ENABLE_WHATSAPP_BOT: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const config = {
  port: parsed.data.PORT,
  adminPassword: parsed.data.ADMIN_PASSWORD,
  openAiApiKey: parsed.data.OPENAI_API_KEY,
  openAiBaseUrl: parsed.data.OPENAI_BASE_URL,
  openAiProviderName: parsed.data.OPENAI_PROVIDER_NAME,
  openAiModel: parsed.data.OPENAI_MODEL,
  openAiApiMode: parsed.data.OPENAI_API_MODE,
  mentionAliases: parsed.data.MENTION_ALIASES.split(",")
    .map((alias) => alias.trim().toLowerCase())
    .filter(Boolean),
  whatsappAuthDir: parsed.data.WHATSAPP_AUTH_DIR,
  initialAllowedGroupJids: [
    ...(parsed.data.WHATSAPP_ALLOWED_GROUP_JID ? [parsed.data.WHATSAPP_ALLOWED_GROUP_JID] : []),
    ...parsed.data.WHATSAPP_ALLOWED_GROUP_JIDS.split(","),
  ]
    .map((jid) => jid.trim())
    .filter(Boolean),
  whatsappPairingPhone: parsed.data.WHATSAPP_PAIRING_PHONE,
  knowledgeDir: parsed.data.KNOWLEDGE_DIR,
  ocrLanguages: parsed.data.OCR_LANGUAGES,
  enableWhatsAppBot: parsed.data.ENABLE_WHATSAPP_BOT,
};
