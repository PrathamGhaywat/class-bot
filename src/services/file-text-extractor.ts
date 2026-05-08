import path from "path";
import { readFile } from "fs/promises";
import { PDFParse } from "pdf-parse";
import { createWorker, setLogging } from "tesseract.js";

export type ExtractionMethod =
  | "text"
  | "pdf"
  | "pdf-ocr"
  | "ocr-image"
  | "unsupported"
  | "error";

export interface ExtractedTextResult {
  text: string;
  method: ExtractionMethod;
  warning?: string;
}

interface FileTextExtractorOptions {
  ocrLanguages: string;
  maxExtractedChars?: number;
  pdfOcrFallbackMinChars?: number;
  pdfOcrMaxPages?: number;
  pdfOcrScale?: number;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);

function isTextLikeMime(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("csv")
  );
}

function isPdfMime(mimeType: string): boolean {
  return mimeType.includes("pdf");
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function hasPdfExtension(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

function hasImageExtension(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function stripPdfPageMarkers(text: string): string {
  return text
    .replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countMeaningfulChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

export class FileTextExtractor {
  private workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;
  private ocrQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: FileTextExtractorOptions) {
    // Avoid noisy OCR progress logs for each extraction.
    setLogging(false);
  }

  private normalizeText(text: string): string {
    const normalized = text.replace(/\u0000/g, "").trim();
    const maxChars = this.options.maxExtractedChars ?? 20_000;
    return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars);
  }

  private async getWorker() {
    if (!this.workerPromise) {
      this.workerPromise = createWorker(this.options.ocrLanguages || "eng");
    }
    return this.workerPromise;
  }

  private runOcrTask<T>(task: () => Promise<T>): Promise<T> {
    const next = this.ocrQueue.then(task, task);
    this.ocrQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async extractImageText(image: Buffer): Promise<string> {
    return this.runOcrTask(async () => {
      const worker = await this.getWorker();
      const result = await worker.recognize(image);
      return result.data.text ?? "";
    });
  }

  private async extractPdfTextViaOcr(parser: PDFParse): Promise<string> {
    const maxPages = Math.max(1, this.options.pdfOcrMaxPages ?? 5);
    const scale = this.options.pdfOcrScale ?? 1.8;

    const screenshots = await parser.getScreenshot({
      first: maxPages,
      imageBuffer: true,
      imageDataUrl: false,
      scale,
    });

    const chunks: string[] = [];
    for (const page of screenshots.pages) {
      if (!page.data || page.data.length === 0) {
        continue;
      }

      const pageText = (await this.extractImageText(Buffer.from(page.data))).trim();
      if (pageText.length > 0) {
        chunks.push(`Page ${page.pageNumber}:\n${pageText}`);
      }
    }

    return chunks.join("\n\n");
  }

  private async extractPdfText(buffer: Buffer): Promise<{ text: string; usedOcrFallback: boolean; warning?: string }> {
    const parser = new PDFParse({ data: buffer });
    const minChars = Math.max(1, this.options.pdfOcrFallbackMinChars ?? 40);

    let directText = "";
    let directTextError: unknown = null;

    try {
      try {
        const result = await parser.getText({ pageJoiner: "" });
        directText = stripPdfPageMarkers(result.text ?? "");
      } catch (error) {
        directTextError = error;
      }

      if (countMeaningfulChars(directText) >= minChars) {
        return {
          text: directText,
          usedOcrFallback: false,
        };
      }

      const ocrText = await this.extractPdfTextViaOcr(parser);
      if (ocrText.trim().length === 0) {
        const warnings: string[] = [
          "PDF had little/no extractable text and OCR fallback produced no readable text.",
        ];

        if (directTextError instanceof Error) {
          warnings.push(`pdf-parse error: ${directTextError.message}`);
        }

        return {
          text: directText,
          usedOcrFallback: false,
          warning: warnings.join(" "),
        };
      }

      const combined = [directText.trim(), ocrText.trim()].filter(Boolean).join("\n\n");
      return {
        text: combined,
        usedOcrFallback: true,
        ...(directTextError instanceof Error
          ? { warning: `pdf-parse error before OCR fallback: ${directTextError.message}` }
          : {}),
      };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  async extractFromBuffer(
    buffer: Buffer,
    mimeType?: string,
    filePathHint?: string,
  ): Promise<ExtractedTextResult> {
    const normalizedMime = (mimeType ?? "").toLowerCase();
    const hasPdfHint = filePathHint ? hasPdfExtension(filePathHint) : false;
    const hasImageHint = filePathHint ? hasImageExtension(filePathHint) : false;

    try {
      if (isTextLikeMime(normalizedMime)) {
        return {
          method: "text",
          text: this.normalizeText(buffer.toString("utf8")),
        };
      }

      if (isPdfMime(normalizedMime) || hasPdfHint) {
        const pdfResult = await this.extractPdfText(buffer);
        return {
          method: pdfResult.usedOcrFallback ? "pdf-ocr" : "pdf",
          text: this.normalizeText(pdfResult.text),
          ...(pdfResult.warning ? { warning: pdfResult.warning } : {}),
        };
      }

      if (isImageMime(normalizedMime) || hasImageHint) {
        const text = await this.extractImageText(buffer);
        return {
          method: "ocr-image",
          text: this.normalizeText(text),
        };
      }

      return {
        method: "unsupported",
        text: "",
      };
    } catch (error) {
      return {
        method: "error",
        text: "",
        warning: error instanceof Error ? error.message : "Unknown extraction error",
      };
    }
  }

  async extractFromFile(filePath: string, mimeType?: string): Promise<ExtractedTextResult> {
    const normalizedMime = (mimeType ?? "").toLowerCase();

    if (isTextLikeMime(normalizedMime)) {
      try {
        const text = await readFile(filePath, "utf8");
        return {
          method: "text",
          text: this.normalizeText(text),
        };
      } catch (error) {
        return {
          method: "error",
          text: "",
          warning: error instanceof Error ? error.message : "Unknown extraction error",
        };
      }
    }

    const buffer = await readFile(filePath);
    return this.extractFromBuffer(buffer, mimeType, filePath);
  }

  async terminate(): Promise<void> {
    if (!this.workerPromise) {
      return;
    }

    const worker = await this.workerPromise;
    this.workerPromise = null;
    await worker.terminate().catch(() => undefined);
  }
}
