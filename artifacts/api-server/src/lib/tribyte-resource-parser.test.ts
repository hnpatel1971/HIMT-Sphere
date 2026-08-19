import assert from "node:assert/strict";
import test from "node:test";
import { parseTriByteResources } from "./tribyte-resource-parser.ts";

test("keeps course files and trusted video hosts", () => {
  const resources = parseTriByteResources(`
    <a href="/sites/default/files/handbook.pdf">Learner handbook</a>
    <iframe src="https://www.youtube.com/embed/abc123"></iframe>
  `, "https://admin.learn.himtelearning.com/node/123");

  assert.deepEqual(resources.map(resource => resource.sourceUrl), [
    "https://admin.learn.himtelearning.com/sites/default/files/handbook.pdf",
    "https://www.youtube.com/embed/abc123",
  ]);
});

test("does not mistake TriByte taxonomy navigation for a learning resource", () => {
  const resources = parseTriByteResources(`
    <a href="/taxonomy/term/18007">Online class video</a>
  `, "https://admin.learn.himtelearning.com/node/123");

  assert.deepEqual(resources, []);
});