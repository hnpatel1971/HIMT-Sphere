const TRIBYTE_AUTHENTICATED_HOSTS = new Set([
  "admin.learn.himtelearning.com",
]);

const TRIBYTE_HLS_HOSTS = new Set([
  ...TRIBYTE_AUTHENTICATED_HOSTS,
  "static.learn.himtelearning.com",
  "videos-elearning-himtmarine-com.s3.ap-southeast-1.amazonaws.com",
  "videos-elearning-himtmarine-com.s3.amazonaws.com",
  "d2ubwtvhjzuzf0.cloudfront.net",
]);

export function isApprovedTriByteHlsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TRIBYTE_HLS_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function triByteHlsRequestHeaders(
  url: string,
  sessionCookie: string,
  referer: string,
  range?: string,
): Record<string, string> {
  const hostname = new URL(url).hostname.toLowerCase();
  return {
    "User-Agent": "Mozilla/5.0",
    Referer: referer,
    ...(range ? { Range: range } : {}),
    ...(TRIBYTE_AUTHENTICATED_HOSTS.has(hostname) ? { Cookie: sessionCookie } : {}),
  };
}

/**
 * Rewrite every URI that an HLS client can dereference through a caller-owned
 * registration function. The registration function is responsible for
 * validating the absolute target and returning a local proxy URL.
 */
export function rewriteHlsManifest(
  manifest: string,
  manifestUrl: string,
  register: (absoluteUrl: string) => string,
): string {
  const absolute = (rawUrl: string) => new URL(rawUrl.trim(), manifestUrl).href;
  return manifest.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (!line.trimStart().startsWith("#")) {
      const leading = line.match(/^\s*/)?.[0] ?? "";
      const trailing = line.match(/\s*$/)?.[0] ?? "";
      return `${leading}${register(absolute(line.trim()))}${trailing}`;
    }

    let rewritten = line.replace(/\bURI\s*=\s*(["'])(.*?)\1/gi, (_match, quote: string, value: string) =>
      `URI=${quote}${register(absolute(value))}${quote}`
    );
    rewritten = rewritten.replace(/\bURI\s*=\s*([^,"'\s][^,\s]*)/gi, (_match, value: string) =>
      `URI="${register(absolute(value))}"`
    );
    return rewritten;
  }).join("\n");
}

export function isDefinitiveTriByteUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    /responded (?:404|410)\b/i,
    /redirected too many times/i,
    /HTML page, not a downloadable/i,
    /did not return a valid HLS playlist/i,
    /HLS child responded (?:404|410)\b/i,
  ].some(pattern => pattern.test(message));
}

export function shouldMarkTriByteResourceUnavailable(
  directError: unknown,
  previewError: unknown,
  previewIsOnlySource: boolean,
): boolean {
  const directUnavailable = previewIsOnlySource || isDefinitiveTriByteUnavailable(directError);
  return directUnavailable && isDefinitiveTriByteUnavailable(previewError);
}