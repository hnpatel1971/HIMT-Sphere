import { createSign } from "crypto";

const MUX_VIDEO_API = "https://api.mux.com/video/v1";

type MuxPlaybackId = {
  id?: string;
  policy?: string;
  drm_configuration_id?: string;
};

type MuxAssetPayload = {
  id?: string;
  status?: string;
  playback_ids?: MuxPlaybackId[];
  errors?: { messages?: Array<{ message?: string }> };
  meta?: { external_id?: string };
};

export type MuxAssetState = {
  assetId: string;
  playbackId: string | null;
  status: string;
  error: string | null;
};

export class MuxConfigurationError extends Error {
  constructor(message = "Mux DRM is not configured") {
    super(message);
    this.name = "MuxConfigurationError";
  }
}

export class MuxProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MuxProviderError";
  }
}

function value(name: string): string {
  const configured = process.env[name]?.trim();
  if (!configured) throw new MuxConfigurationError(`Missing managed secret: ${name}`);
  return configured;
}

function signingKey(): string {
  const raw = value("MUX_SIGNING_KEY");
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  if (!decoded.includes("BEGIN")) throw new MuxConfigurationError("MUX_SIGNING_KEY must contain a PEM private key");
  return decoded.replace(/\\n/g, "\n");
}

export function isMuxDrmConfigured(): boolean {
  return [
    "MUX_TOKEN_ID",
    "MUX_TOKEN_SECRET",
    "MUX_DRM_CONFIGURATION_ID",
    "MUX_SIGNING_KEY_ID",
    "MUX_SIGNING_KEY",
  ].every((name) => Boolean(process.env[name]?.trim()));
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function signMuxToken(audience: "v" | "d", playbackId: string, expiresAt: Date): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: value("MUX_SIGNING_KEY_ID") };
  const payload = {
    aud: audience,
    sub: playbackId,
    iat: now,
    exp: Math.max(now + 30, Math.floor(expiresAt.getTime() / 1000)),
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(signingKey()).toString("base64url")}`;
}

export function createMuxPlaybackTokens(playbackId: string, expiresAt: Date): { playback: string; drm: string } {
  return {
    playback: signMuxToken("v", playbackId, expiresAt),
    drm: signMuxToken("d", playbackId, expiresAt),
  };
}

async function muxRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tokenId = value("MUX_TOKEN_ID");
  const tokenSecret = value("MUX_TOKEN_SECRET");
  const response = await fetch(`${MUX_VIDEO_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64")}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // A provider error can echo the temporary private source URL. Keep it out
    // of application logs while retaining enough information to investigate in
    // the Mux dashboard.
    const requestId = response.headers.get("mux-request-id") ?? response.headers.get("x-request-id");
    throw new MuxProviderError(`Mux Video API returned ${response.status}${requestId ? ` (request ${requestId})` : ""}`);
  }
  return response.json() as Promise<T>;
}

function muxAssetState(payload: MuxAssetPayload): MuxAssetState {
  const assetId = payload.id;
  if (!assetId) throw new MuxProviderError("Mux did not return an asset ID");
  const drmPlayback = payload.playback_ids?.find((entry) => entry.policy === "drm")?.id ?? null;
  return {
    assetId,
    playbackId: drmPlayback,
    status: payload.status ?? "preparing",
    error: payload.errors?.messages?.map((item) => item.message).filter(Boolean).join("; ").slice(0, 500) || null,
  };
}

export async function createMuxDrmAsset(inputUrl: string, title: string, externalId: string): Promise<MuxAssetState> {
  const response = await muxRequest<{ data?: MuxAssetPayload }>("/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: [{ url: inputUrl }],
      advanced_playback_policies: [{
        policy: "drm",
        drm_configuration_id: value("MUX_DRM_CONFIGURATION_ID"),
      }],
      video_quality: "plus",
      meta: { title: title.slice(0, 512), external_id: externalId.slice(0, 128) },
    }),
  });
  return muxAssetState(response.data ?? {});
}

export async function getMuxAsset(assetId: string): Promise<MuxAssetState> {
  const response = await muxRequest<{ data?: MuxAssetPayload }>(`/assets/${encodeURIComponent(assetId)}`);
  return muxAssetState(response.data ?? {});
}

/**
 * Reconciles a create request that may have reached Mux before an API process
 * died. Mux persists the externally stable LMS resource ID in asset metadata,
 * so a retry reuses that asset instead of creating another billable one.
 */
export async function findMuxAssetByExternalId(externalId: string): Promise<MuxAssetState | null> {
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const response = await muxRequest<{ data?: MuxAssetPayload[]; next_cursor?: string }>(`/assets?${query.toString()}`);
    const existing = response.data?.find((asset) => asset.meta?.external_id === externalId);
    if (existing) return muxAssetState(existing);
    cursor = response.next_cursor;
  } while (cursor);
  return null;
}