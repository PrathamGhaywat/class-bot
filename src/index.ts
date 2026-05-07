import { config } from "./config.js";
import { db, initDatabase } from "./db.js";
import { ClassDataService } from "./services/class-data-service.js";
import { ClassAgent } from "./ai/class-agent.js";
import { createAdminServer } from "./admin/server.js";
import { startWhatsAppBot } from "./whatsapp/bot.js";

async function main(): Promise<void> {
  initDatabase();

  const dataService = new ClassDataService(db);
  // Seed initial allowed groups from env for first-time setup or deployments.
  config.initialAllowedGroupJids.forEach((jid) => dataService.addAllowedGroup(jid));

  const agent = new ClassAgent(dataService, {
    openAiModel: config.openAiModel,
    openAiApiKey: config.openAiApiKey,
    openAiBaseUrl: config.openAiBaseUrl,
    openAiProviderName: config.openAiProviderName,
    hasModelAccess: Boolean(config.openAiApiKey || config.openAiBaseUrl),
  });

  const adminApp = await createAdminServer({
    dataService,
    adminPassword: config.adminPassword,
    knowledgeDir: config.knowledgeDir,
  });

  adminApp.listen(config.port, () => {
    console.log(`Admin server running on http://localhost:${config.port}/admin`);
  });

  if (config.enableWhatsAppBot) {
    await startWhatsAppBot({
      authDir: config.whatsappAuthDir,
      dataService,
      ...(config.whatsappPairingPhone
        ? { pairingPhoneNumber: config.whatsappPairingPhone }
        : {}),
      mentionAliases: config.mentionAliases,
      responder: (prompt) => agent.answer(prompt),
    });
  } else {
    console.log("WhatsApp bot disabled via ENABLE_WHATSAPP_BOT=false");
  }
}

void main().catch((error) => {
  console.error("Startup failed", error);
  process.exitCode = 1;
});
