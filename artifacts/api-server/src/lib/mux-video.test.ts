import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import {
  createMuxPlaybackToken,
  createMuxSignedAsset,
  createMuxSignedPlaybackId,
  isMuxSignedPlaybackConfigured,
} from "./mux-video.ts";

const muxEnvironmentKeys = [
  "MUX_TOKEN_ID",
  "MUX_TOKEN_SECRET",
  "MUX_SIGNING_KEY_ID",
  "MUX_SIGNING_KEY",
  "MUX_DRM_CONFIGURATION_ID",
] as const;

function saveMuxEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(muxEnvironmentKeys.map((key) => [key, process.env[key]]));
}

function restoreMuxEnvironment(saved: Record<string, string | undefined>): void {
  for (const key of muxEnvironmentKeys) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("signed Mux playback does not require a DRM configuration", () => {
  const saved = saveMuxEnvironment();
  try {
    process.env.MUX_TOKEN_ID = "test-token-id";
    process.env.MUX_TOKEN_SECRET = "test-token-secret";
    process.env.MUX_SIGNING_KEY_ID = "test-signing-key";
    process.env.MUX_SIGNING_KEY = "not-needed-for-configuration-check";
    delete process.env.MUX_DRM_CONFIGURATION_ID;

    assert.equal(isMuxSignedPlaybackConfigured(), true);
  } finally {
    restoreMuxEnvironment(saved);
  }
});

test("provisions signed playback assets and upgrades legacy assets with a signed playback ID", async () => {
  const saved = saveMuxEnvironment();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  try {
    process.env.MUX_TOKEN_ID = "test-token-id";
    process.env.MUX_TOKEN_SECRET = "test-token-secret";
    process.env.MUX_SIGNING_KEY_ID = "test-signing-key";
    process.env.MUX_SIGNING_KEY = "not-needed-for-provider-request";
    delete process.env.MUX_DRM_CONFIGURATION_ID;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      });
      if (url.endsWith("/playback-ids")) {
        return new Response(JSON.stringify({ data: { id: "signed-existing", policy: "signed" } }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: {
          id: "asset-new",
          status: "preparing",
          playback_ids: [{ id: "signed-new", policy: "signed" }],
        },
      }), { status: 200 });
    }) as typeof fetch;

    const asset = await createMuxSignedAsset("https://private.example/video.mp4", "Lesson video", "resource-1");
    assert.deepEqual(asset, {
      assetId: "asset-new",
      playbackId: "signed-new",
      status: "preparing",
      error: null,
    });

    const legacyPlaybackId = await createMuxSignedPlaybackId("asset-existing");
    assert.equal(legacyPlaybackId, "signed-existing");
    assert.deepEqual(requests, [
      {
        url: "https://api.mux.com/video/v1/assets",
        method: "POST",
        body: {
          inputs: [{ url: "https://private.example/video.mp4" }],
          playback_policies: ["signed"],
          video_quality: "plus",
          meta: { title: "Lesson video", external_id: "resource-1" },
        },
      },
      {
        url: "https://api.mux.com/video/v1/assets/asset-existing/playback-ids",
        method: "POST",
        body: { policy: "signed" },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreMuxEnvironment(saved);
  }
});

test("creates a signed playback JWT without a DRM license audience", () => {
  const saved = saveMuxEnvironment();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  try {
    process.env.MUX_TOKEN_ID = "test-token-id";
    process.env.MUX_TOKEN_SECRET = "test-token-secret";
    process.env.MUX_SIGNING_KEY_ID = "test-signing-key";
    process.env.MUX_SIGNING_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    delete process.env.MUX_DRM_CONFIGURATION_ID;

    const token = createMuxPlaybackToken("signed-playback-id", new Date(Date.now() + 60_000));
    const [header, payload, signature] = token.split(".");
    const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    assert.equal(decodedHeader.kid, "test-signing-key");
    assert.equal(decodedPayload.aud, "v");
    assert.equal(decodedPayload.sub, "signed-playback-id");
    assert.ok(decodedPayload.exp > decodedPayload.iat);
    assert.equal(
      verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")),
      true,
    );
  } finally {
    restoreMuxEnvironment(saved);
  }
});