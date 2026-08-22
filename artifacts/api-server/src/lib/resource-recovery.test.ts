import assert from "node:assert/strict";
import test from "node:test";
import { courseResources } from "@workspace/db/schema";
import { inspectStoredResource, resumeStoredResourceImport } from "./resource-recovery.ts";

test("accepts stored recordings larger than PostgreSQL's 32-bit integer limit", async () => {
  const objectPath = "/objects/tribyte/course/resource/clipping";
  let lookupCount = 0;

  const stored = await inspectStoredResource(objectPath, async (requestedPath) => {
    lookupCount += 1;
    assert.equal(requestedPath, objectPath);
    return {
      getMetadata: async () => [{
        size: "4297706277",
        contentType: "video/mp4",
      }],
    };
  });

  assert.deepEqual(stored, {
    sizeBytes: 4297706277,
    contentType: "video/mp4",
  });
  assert.equal(lookupCount, 1);
});

test("rejects missing or invalid stored-object metadata", async () => {
  const missing = await inspectStoredResource(
    "/objects/tribyte/missing",
    async () => { throw new Error("not found"); },
  );
  assert.equal(missing, null);

  const invalid = await inspectStoredResource(
    "/objects/tribyte/empty",
    async () => ({
      getMetadata: async () => [{ size: "0", contentType: "video/mp4" }],
    }),
  );
  assert.equal(invalid, null);
});

test("keeps the resource size column on bigint", () => {
  assert.equal(courseResources.sizeBytes.getSQLType(), "bigint");
});

test("resumes a non-ready resource from an existing private object without downloading again", async () => {
  const objectPath = "/objects/tribyte/course/resource/large-recording.mp4";
  let resourceRow = {
    status: "failed",
    storagePath: null as string | null,
    mimeType: null as string | null,
    sizeBytes: null as number | null,
    checksum: null as string | null,
    recoveryMethod: null as string | null,
  };
  let downloadCount = 0;

  const recovered = await resumeStoredResourceImport(objectPath, {
    mimeType: "video/mp4",
    getStoredResource: async (requestedPath) => {
      assert.equal(requestedPath, objectPath);
      return {
        getMetadata: async () => [{
          size: "4297706277",
          contentType: "video/mp4",
        }],
      };
    },
    registerStoredResource: async (registration) => {
      resourceRow = {
        ...resourceRow,
        ...registration,
        status: "ready",
      };
    },
  });
  if (!recovered) {
    downloadCount++;
    throw new Error("the importer should not download an existing object");
  }

  assert.equal(recovered, true);
  assert.deepEqual(resourceRow, {
    status: "ready",
    storagePath: objectPath,
    mimeType: "video/mp4",
    sizeBytes: 4297706277,
    checksum: null,
    recoveryMethod: "storage_resume",
  });
  assert.equal(downloadCount, 0);
});