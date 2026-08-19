import assert from "node:assert/strict";
import test from "node:test";
import { courseResources } from "@workspace/db/schema";
import { inspectStoredResource } from "./resource-recovery.ts";

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