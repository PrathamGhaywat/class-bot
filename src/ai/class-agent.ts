import { ToolLoopAgent, generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type { ClassDataService } from "../services/class-data-service.js";

interface AgentOptions {
  openAiModel: string;
  openAiApiKey: string | undefined;
  openAiBaseUrl: string | undefined;
  openAiProviderName: string;
  hasModelAccess: boolean;
}

export class ClassAgent {
  private readonly openai: ReturnType<typeof createOpenAI>;

  constructor(
    private readonly dataService: ClassDataService,
    private readonly options: AgentOptions,
  ) {
    const providerConfig: { apiKey?: string; baseURL?: string; name?: string } = {};
    if (options.openAiApiKey) {
      providerConfig.apiKey = options.openAiApiKey;
    }
    if (options.openAiBaseUrl) {
      providerConfig.baseURL = options.openAiBaseUrl;
    }
    if (options.openAiProviderName) {
      providerConfig.name = options.openAiProviderName;
    }
    this.openai = createOpenAI(providerConfig);
  }

  private createToolLoopAgent() {
    return new ToolLoopAgent({
      model: this.openai(this.options.openAiModel),
      instructions: `You are a class assistant for WhatsApp.
Use tools to answer questions about homework, timetable, appointments, tests, and uploaded context.
Always prefer concrete facts from tools. If data is missing, say that directly.
Keep responses concise and student-friendly.`,
      tools: {
        getHomework: tool({
          description: "Get all homework items.",
          inputSchema: z.object({}),
          execute: async () => this.dataService.listHomework(),
        }),
        getTimetable: tool({
          description: "Get timetable entries. Optionally filter by day (0=Sunday ... 6=Saturday).",
          inputSchema: z.object({ dayOfWeek: z.number().int().min(0).max(6).optional() }),
          execute: async ({ dayOfWeek }) => {
            const items = this.dataService.listTimetable();
            return dayOfWeek === undefined ? items : items.filter((item) => item.dayOfWeek === dayOfWeek);
          },
        }),
        getAppointments: tool({
          description: "Get class appointments/events.",
          inputSchema: z.object({}),
          execute: async () => this.dataService.listAppointments(),
        }),
        getTests: tool({
          description: "Get upcoming tests and context.",
          inputSchema: z.object({}),
          execute: async () => this.dataService.listTests(),
        }),
        searchKnowledge: tool({
          description: "Search uploaded text/image context and structured entries.",
          inputSchema: z.object({
            query: z.string().min(1),
            limit: z.number().int().positive().max(10).optional(),
          }),
          execute: async ({ query, limit }) => this.dataService.searchKnowledge(query, limit ?? 6),
        }),
      },
    });
  }

  private formatFallbackSearch(prompt: string): string {
    const fallbackHits = this.dataService.searchKnowledge(prompt, 4);
    if (fallbackHits.length === 0) {
      return "I could not find matching class data yet. Add homework, timetable, appointments, tests, or knowledge notes in the admin panel.";
    }

    return `I found these relevant entries:\n${fallbackHits
      .map((hit, index) => `${index + 1}. [${hit.source}] ${hit.text}`)
      .join("\n")}`;
  }

  private async answerWithoutTools(prompt: string): Promise<string> {
    const homework = this.dataService.listHomework().slice(0, 10);
    const timetable = this.dataService.listTimetable().slice(0, 20);
    const appointments = this.dataService.listAppointments().slice(0, 10);
    const tests = this.dataService.listTests().slice(0, 10);
    const matches = this.dataService.searchKnowledge(prompt, 8);

    const context = JSON.stringify(
      {
        homework,
        timetable,
        appointments,
        tests,
        matches,
      },
      null,
      2,
    );

    const retry = await generateText({
      model: this.openai(this.options.openAiModel),
      system: `You are a class assistant for WhatsApp.
Answer ONLY using the provided class data context.
If the context does not contain the answer, say that clearly.
Keep responses concise and student-friendly.`,
      prompt: `Question: ${prompt}\n\nClass data context (JSON):\n${context}`,
    });

    return retry.text.trim();
  }

  async answer(prompt: string): Promise<string> {
    if (!this.options.hasModelAccess) {
      // Fallback keeps the bot usable even before API key setup.
      console.log("[Agent] No model access, using fallback knowledge search");
      return this.formatFallbackSearch(prompt);
    }

    try {
      console.log(`[Agent] Calling AI model with prompt: "${prompt}"`);
      console.log(`[Agent] Using model: ${this.options.openAiModel}`);
      console.log(`[Agent] Has API key: ${Boolean(this.options.openAiApiKey)}`);
      console.log(`[Agent] Base URL: ${this.options.openAiBaseUrl || "default"}`);
      
      const result = await this.createToolLoopAgent().generate({ prompt });

      const text = result.text.trim();
      console.log(`[Agent] Response: "${text}"`);
      if (text.length > 0) {
        return text;
      }

      // Some providers/models can return tool results without final text.
      console.warn("[Agent] Model returned empty text after tool usage; retrying without tools.");
      const noToolText = await this.answerWithoutTools(prompt);
      if (noToolText.length > 0) {
        console.log(`[Agent] Non-tool retry response: "${noToolText}"`);
        return noToolText;
      }
      return this.formatFallbackSearch(prompt);
    } catch (error) {
      console.error("[Agent] Error calling AI:", error);
      try {
        const noToolText = await this.answerWithoutTools(prompt);
        if (noToolText.length > 0) {
          console.log(`[Agent] Error recovery response (no tools): "${noToolText}"`);
          return noToolText;
        }
      } catch (retryError) {
        console.error("[Agent] Non-tool retry also failed:", retryError);
      }
      return this.formatFallbackSearch(prompt);
    }
  }
}
