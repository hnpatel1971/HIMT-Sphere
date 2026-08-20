export type TriByteResourceType = "Document" | "Recording" | "Video" | "Learning package" | "Learning resource";

export type ParsedTriByteResource = {
  sourceUrl: string;
  title: string;
  resourceType: TriByteResourceType;
  fileName: string;
};

const FILE_EXTENSION = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|rtf|zip|rar|7z|scorm|mp4|m4v|mov|webm|avi|mp3|wav|m4a|ogg)(?:[?#].*)?$/i;
const DOCUMENT_EXTENSION = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|rtf)(?:[?#].*)?$/i;
const RECORDING_EXTENSION = /\.(mp4|m4v|mov|webm|avi|mp3|wav|m4a|ogg)(?:[?#].*)?$/i;
const PACKAGE_EXTENSION = /\.(zip|rar|7z|scorm)(?:[?#].*)?$/i;
const RESOURCE_LANGUAGE = /\b(document|download|attachment|resource|recording|video|audio|file|package|scorm|material|handout|presentation)\b/i;
const MEDIA_HOST = /\b(youtu\.be|youtube\.com|vimeo\.com|publitas\.com|drive\.google\.com|onedrive\.live\.com|sharepoint\.com)\b/i;
const VIDEO_HOST = /\b(youtu\.be|youtube\.com|vimeo\.com|publitas\.com)\b/i;
const ADMIN_ONLY_PATH = /\/(user|reviewer|generate|apps|node\/\d+\/edit)(?:\/|$|\?)/i;
const NAVIGATION_PATH = /\/(?:taxonomy\/term|reviewer\/topics|category)(?:\/|$|\?)/i;
const TRIBYTE_FILE_PATH = /\/(?:sites\/(?:default|all)\/files|files|file|download)(?:\/|$)/i;
const TRIBYTE_CONTENT_DOWNLOAD = /\/reviewer\/download\/clipping(?:\/|$|\?)/i;

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const pathName = pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (pathName && pathName !== "clipping") return pathName;
    const format = parsed.searchParams.get("format")?.toLowerCase();
    return format ? `resource.${format}` : pathName;
  } catch {
    return "";
  }
}

function resourceTypeFor(url: string, context: string): TriByteResourceType {
  if (VIDEO_HOST.test(url)) return "Video";
  if (/[?&]format=pdf(?:&|$)/i.test(url)) return "Document";
  if (RECORDING_EXTENSION.test(url) || /\b(recording|audio|video)\b/i.test(context)) {
    return RECORDING_EXTENSION.test(url) ? "Recording" : "Video";
  }
  if (PACKAGE_EXTENSION.test(url) || /\b(scorm|package)\b/i.test(context)) return "Learning package";
  if (DOCUMENT_EXTENSION.test(url) || /\b(document|handout|presentation|attachment)\b/i.test(context)) return "Document";
  return "Learning resource";
}

function toAbsoluteUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const url = new URL(decodeHtml(rawUrl).trim(), baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = "";
    // The admin-only download link includes the authenticated user's email.
    // The server-side session is sufficient, so do not persist that PII.
    url.searchParams.delete("uname");
    return url.href;
  } catch {
    return null;
  }
}

function shouldKeep(url: string, context: string): boolean {
  if (TRIBYTE_CONTENT_DOWNLOAD.test(url)) return true;
  if (ADMIN_ONLY_PATH.test(url) || NAVIGATION_PATH.test(url)) return false;
  if (FILE_EXTENSION.test(url) || MEDIA_HOST.test(url)) return true;
  // TriByte commonly serves extensionless protected files through its download
  // routes. A generic “video/resource” label alone is not enough: it also
  // appears on taxonomy navigation links throughout the course pages.
  return TRIBYTE_FILE_PATH.test(url) && RESOURCE_LANGUAGE.test(context);
}

/**
 * Extract learner-facing resource links from a rendered TriByte node.
 * The platform is Drupal and has inconsistent markup, so this deliberately
 * uses stable signals (downloadable extensions, media hosts, and link labels)
 * instead of theme-specific CSS classes.
 */
export function parseTriByteResources(html: string, baseUrl: string): ParsedTriByteResource[] {
  const resources: ParsedTriByteResource[] = [];
  const seen = new Set<string>();
  const formTitle = html
    .match(/<input\b(?=[^>]*\bname=["']title["'])[^>]*>/i)?.[0]
    ?.match(/\bvalue=["']([^"']*)["']/i)?.[1];
  const pageTitle = formTitle ? cleanHtml(formTitle) : "";
  // TriByte's protected recording download URLs are intentionally extensionless.
  // On an individual video-content form, the upload/re-upload action is the
  // stable signal that these clipping links represent videos rather than generic
  // learning resources.
  const hasVideoUploadControl = /\/upload\/videos\?[^"'\s>]*\bnid=\d+/i.test(html);
  const add = (rawUrl: string, rawLabel: string) => {
    const sourceUrl = toAbsoluteUrl(rawUrl, baseUrl);
    if (!sourceUrl) return;
    const fileName = fileNameFromUrl(sourceUrl);
    const clippingVideoContext = hasVideoUploadControl && TRIBYTE_CONTENT_DOWNLOAD.test(sourceUrl)
      ? " video"
      : "";
    const context = `${cleanHtml(rawLabel)} ${sourceUrl}${clippingVideoContext}`;
    if (!shouldKeep(sourceUrl, context)) return;
    if (seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    resources.push({
      sourceUrl,
      title: (cleanHtml(rawLabel).toLowerCase() === "download" && pageTitle)
        ? pageTitle
        : cleanHtml(rawLabel) || pageTitle || fileName || "Learning resource",
      resourceType: resourceTypeFor(sourceUrl, context),
      fileName,
    });
  };

  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let anchor: RegExpExecArray | null;
  while ((anchor = anchorPattern.exec(html)) !== null) {
    const href = anchor[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) add(href, anchor[2]);
  }

  const mediaPattern = /<(?:video|audio|source|iframe)\b([^>]*)>/gi;
  let media: RegExpExecArray | null;
  while ((media = mediaPattern.exec(html)) !== null) {
    const src = media[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) add(src, media[0]);
  }

  // TriByte's final content form can hold external video players in fields
  // rather than anchor or media tags. These values are only accepted when the
  // URL passes the same trusted-host checks as other embedded media.
  const clippingUrlField = /<input\b([^>]*)>/gi;
  let field: RegExpExecArray | null;
  while ((field = clippingUrlField.exec(html)) !== null) {
    const name = field[1].match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    if (!/^field_clipping_(?:wurl|murl)\[\d+\]\[value\]$/i.test(name)) continue;
    const value = field[1].match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1];
    if (value) add(value, `Video ${pageTitle}`);
  }

  return resources;
}