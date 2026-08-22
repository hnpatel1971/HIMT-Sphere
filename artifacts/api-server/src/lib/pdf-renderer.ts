/**
 * pdf-renderer.ts
 *
 * Server-side document rendering with baked-in watermarks (DRM-002, DRM-010).
 *
 * Supported inputs:
 *   - PDF      → rendered directly via pdftoppm (Poppler, declared in replit.nix)
 *   - Office formats (DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, RTF, CSV, OD*)
 *              → converted to PDF via LibreOffice headless (declared in replit.nix), then rendered
 *
 * Pipeline:
 *   GCS readable stream
 *     → temp file (with correct extension for LibreOffice format detection)
 *     → [LibreOffice PDF conversion if non-PDF]
 *     → pdftoppm (page → PNG)
 *     → sharp SVG composite (watermark tile)
 *     → PNG buffer
 *     → HTTP response
 *
 * Runtime tools (installed as Nix system dependencies — not hard-coded store paths):
 *   pdftoppm  – Poppler     – renders one PDF page to PNG
 *   pdfinfo   – Poppler     – returns page count
 *   soffice   – LibreOffice – converts Office/text formats to PDF
 *   sharp     – npm         – composites SVG watermark tile onto PNG
 *
 * Both LibreOffice and Poppler are declared in the project's Nix system dependencies
 * so these binary names resolve correctly on any rebuild or deployment.
 */

import { execFile } from "child_process";
import { createWriteStream } from "fs";
import { mkdtemp, readFile, rename, rm } from "fs/promises";
import { basename, extname, join } from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import type { Readable } from "stream";
import sharp from "sharp";

// ── constants ─────────────────────────────────────────────────────────────────

/**
 * LibreOffice binary name — resolved from PATH at runtime.
 * LibreOffice is declared as a Nix system dependency (via installSystemDependencies)
 * so `soffice` is always available on PATH without a hard-coded store path.
 */
const SOFFICE = "soffice";

/** Maps MIME types to the file extension LibreOffice uses for format detection. */
const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "application/rtf": ".rtf",
  "text/rtf": ".rtf",
  "application/vnd.oasis.opendocument.text": ".odt",
  "application/vnd.oasis.opendocument.spreadsheet": ".ods",
  "application/vnd.oasis.opendocument.presentation": ".odp",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function exec(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin} failed: ${stderr?.trim() || String(err)}`));
      else resolve(stdout);
    });
  });
}

async function streamToFile(readable: Readable, dest: string): Promise<void> {
  const ws = createWriteStream(dest);
  await pipeline(readable, ws);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Return the file extension that best describes the MIME type (defaults to ".bin"). */
function extForMime(mimeType?: string | null): string {
  if (!mimeType) return ".bin";
  return MIME_TO_EXT[mimeType.toLowerCase().split(";")[0].trim()] ?? ".bin";
}

// ── page count ────────────────────────────────────────────────────────────────

/** Return the number of pages in a PDF already on disk. */
async function getPageCountFromFile(pdfPath: string): Promise<number> {
  const out = await exec("pdfinfo", [pdfPath]);
  const m = out.match(/^Pages:\s+(\d+)/m);
  if (!m) throw new Error("pdfinfo did not return a page count");
  return parseInt(m[1], 10);
}

// ── LibreOffice conversion ────────────────────────────────────────────────────

/**
 * Convert a non-PDF document to PDF using LibreOffice headless.
 * Each call uses an isolated user-profile directory to avoid locking conflicts
 * under concurrent requests.
 * Returns the path of the generated PDF file.
 */
async function convertToPdf(inputPath: string, outDir: string): Promise<string> {
  const profileDir = join(tmpdir(), `lo-profile-${randomUUID()}`);
  try {
    await exec(SOFFICE, [
      `--env:UserInstallation=file://${profileDir}`,
      "--headless",
      "--norestore",
      "--convert-to", "pdf:writer_pdf_Export",
      "--outdir", outDir,
      inputPath,
    ]);
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  // LibreOffice names the output after the input file's stem + ".pdf"
  const stem = basename(inputPath, extname(inputPath));
  return join(outDir, `${stem}.pdf`);
}

/**
 * Ensure we have a valid PDF at `inputPath`.
 * If `inputPath` is already a PDF, returns it unchanged.
 * Otherwise, runs LibreOffice conversion and returns the converted path.
 */
async function ensurePdf(inputPath: string, outDir: string): Promise<string> {
  try {
    await exec("pdfinfo", [inputPath]);
    return inputPath; // Already a valid PDF
  } catch {
    // Not a PDF (or corrupted) — try LibreOffice conversion
    return convertToPdf(inputPath, outDir);
  }
}

// ── page rendering ────────────────────────────────────────────────────────────

/** Render a single page (1-indexed) of a PDF to a raw PNG buffer. */
async function renderPageToBuffer(pdfPath: string, pageNum: number, dpi: number): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "himt-page-"));
  const prefix = join(dir, "p");
  try {
    await exec("pdftoppm", [
      "-f", String(pageNum),
      "-l", String(pageNum),
      "-png",
      "-r", String(dpi),
      "-singlefile",
      pdfPath,
      prefix,
    ]);
    return await readFile(`${prefix}.png`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── watermark compositing ─────────────────────────────────────────────────────

/**
 * Composite a diagonal tiling watermark onto a PNG buffer using sharp SVG overlay.
 * line1 — primary line  (e.g. "Jane Doe · jane@example.com")
 * line2 — secondary line (e.g. "CONFIDENTIAL · 21 Aug 2026, 14:30")
 */
export interface WatermarkOptions {
  pattern?: "tile" | "single";
  position?: "diagonal" | "horizontal";
}

async function applyWatermark(png: Buffer, line1: string, line2: string, options: WatermarkOptions = {}): Promise<Buffer> {
  const { width: w = 800, height: h = 1000 } = await sharp(png).metadata();

  const tW = 400;
  const tH = 160;
  let tiles = "";
  const pattern = options.pattern ?? "tile";
  const angle = options.position === "horizontal" ? 0 : -30;

  const rows = pattern === "single" ? [Math.ceil(h / 2 / tH)] : Array.from({ length: Math.ceil(h / tH) + 3 }, (_, i) => i - 1);
  const cols = pattern === "single" ? [Math.ceil(w / 2 / tW)] : Array.from({ length: Math.ceil(w / tW) + 3 }, (_, i) => i - 1);
  for (const row of rows) {
    for (const col of cols) {
      // Stagger every other row by half a tile width (DRM-011)
      const cx = col * tW + (pattern === "tile" && row % 2 !== 0 ? tW / 2 : 0) + tW / 2;
      const cy = row * tH + tH / 2;
      tiles += `<g transform="translate(${cx},${cy}) rotate(${angle})">
        <text y="-8" text-anchor="middle"
          font-family="Helvetica,Arial,sans-serif" font-size="12" font-weight="bold"
          fill="rgba(50,50,50,0.22)">${escapeXml(line1)}</text>
        <text y="10" text-anchor="middle"
          font-family="Helvetica,Arial,sans-serif" font-size="10"
          fill="rgba(50,50,50,0.16)">${escapeXml(line2)}</text>
      </g>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${tiles}</svg>`;

  return sharp(png)
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .png()
    .toBuffer();
}

// ── public API ────────────────────────────────────────────────────────────────

export interface RenderPageOpts {
  /** Readable stream of the document from GCS */
  pdfStream: Readable;
  /** 1-indexed page number */
  pageNum: number;
  /** First watermark line  (e.g. "Jane Doe · jane@example.com") */
  watermarkLine1: string;
  /** Second watermark line (e.g. "CONFIDENTIAL · 21 Aug 2026, 14:30") */
  watermarkLine2: string;
  /** Rendering resolution in DPI (default 150) */
  dpi?: number;
  /** MIME type of the source document (used to set the correct file extension for LibreOffice) */
  mimeType?: string | null;
  watermarkOptions?: WatermarkOptions;
}

/**
 * Full pipeline:
 *   stream → temp file → [LibreOffice PDF conversion if needed] → pdftoppm → watermark → PNG buffer.
 * The temp directory is always cleaned up, even on error.
 */
export async function renderProtectedPage(opts: RenderPageOpts): Promise<Buffer> {
  const { pdfStream, pageNum, watermarkLine1, watermarkLine2, dpi = 150, mimeType, watermarkOptions } = opts;
  const dir = await mkdtemp(join(tmpdir(), "himt-pdf-"));
  const inputPath = join(dir, `doc${extForMime(mimeType)}`);
  try {
    await streamToFile(pdfStream, inputPath);
    const pdfPath = await ensurePdf(inputPath, dir);
    const raw = await renderPageToBuffer(pdfPath, pageNum, dpi);
    return await applyWatermark(raw, watermarkLine1, watermarkLine2, watermarkOptions);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Full pipeline: stream → temp file → [LibreOffice PDF conversion if needed] → page count.
 * Returns null if the document cannot be converted to PDF or rendered.
 */
export async function getPageCountFromStream(
  pdfStream: Readable,
  mimeType?: string | null,
): Promise<number | null> {
  const dir = await mkdtemp(join(tmpdir(), "himt-pdf-"));
  const inputPath = join(dir, `doc${extForMime(mimeType)}`);
  try {
    await streamToFile(pdfStream, inputPath);
    const pdfPath = await ensurePdf(inputPath, dir);
    return await getPageCountFromFile(pdfPath);
  } catch {
    return null; // Unsupported format or conversion failed
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extract a plain-text representation for HIMT's approved accessible mode.
 * This is intentionally a separate, explicitly requested path: the original
 * document is still converted and read only on the server.
 */
export async function getAccessibleTextFromStream(
  pdfStream: Readable,
  mimeType?: string | null,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "himt-accessible-"));
  const inputPath = join(dir, `doc${extForMime(mimeType)}`);
  try {
    await streamToFile(pdfStream, inputPath);
    const pdfPath = await ensurePdf(inputPath, dir);
    return (await exec("pdftotext", ["-layout", pdfPath, "-"])).trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
