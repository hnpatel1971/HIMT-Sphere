import { createHash } from "crypto";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { Storage, type File } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const resourceStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateObjectDir(): string {
  const value = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  return value.replace(/\/+$/, "");
}

function parseObjectPath(value: string): { bucketName: string; objectName: string } {
  const segments = value.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length < 2) throw new Error("Invalid object storage path");
  return { bucketName: segments[0], objectName: segments.slice(1).join("/") };
}

export function resourceObjectPath(key: string): string {
  return `/objects/tribyte/${key.replace(/^\/+/, "")}`;
}

function gcsFileForObjectPath(objectPath: string): File {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid resource object path");
  const fullPath = `${privateObjectDir()}/${objectPath.slice("/objects/".length)}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  return resourceStorageClient.bucket(bucketName).file(objectName);
}

export async function storeResourceStream(
  objectPath: string,
  body: ReadableStream<Uint8Array>,
  contentType: string,
): Promise<{ checksum: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(data);
      sizeBytes += data.length;
      callback(null, data);
    },
  });
  const file = gcsFileForObjectPath(objectPath);
  try {
    await pipeline(
      Readable.fromWeb(body),
      meter,
      file.createWriteStream({
        resumable: true,
        metadata: { contentType: contentType || "application/octet-stream" },
      }),
    );
  } catch (error) {
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  return { checksum: hash.digest("hex"), sizeBytes };
}

export async function getStoredResource(objectPath: string): Promise<File> {
  const file = gcsFileForObjectPath(objectPath);
  const [exists] = await file.exists();
  if (!exists) throw new Error("Stored resource does not exist");
  return file;
}

export async function deleteStoredResource(objectPath: string): Promise<void> {
  const file = gcsFileForObjectPath(objectPath);
  await file.delete({ ignoreNotFound: true });
}