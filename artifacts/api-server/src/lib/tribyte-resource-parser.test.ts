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

test("keeps TriByte protected PDF downloads without persisting the admin email", () => {
  const resources = parseTriByteResources(`
    <input name="title" value="01. Introduction to ME-GI Marts" />
    <a href="/reviewer/download/clipping?nid=484891&amp;uname=admin@example.com&amp;format=pdf">Download</a>
  `, "https://admin.learn.himtelearning.com/node/484891/edit/content/tab");

  assert.deepEqual(resources, [{
    sourceUrl: "https://admin.learn.himtelearning.com/reviewer/download/clipping?nid=484891&format=pdf",
    title: "01. Introduction to ME-GI Marts",
    resourceType: "Document",
    fileName: "resource.pdf",
  }]);
});

test("classifies extensionless protected clipping downloads as videos on video-content pages", () => {
  const resources = parseTriByteResources(`
    <input name="title" value="Fire fighting on board ship part 1" />
    <a href="/reviewer/download/clipping?nid=428318&amp;uname=admin@example.com">Download</a>
    <a href="/upload/videos?nid=428318&amp;client=elearning-himtmarine-com&amp;reupload=true">Re-upload</a>
  `, "https://admin.learn.himtelearning.com/node/428318/edit/content/tab");

  assert.deepEqual(resources, [{
    sourceUrl: "https://admin.learn.himtelearning.com/reviewer/download/clipping?nid=428318",
    title: "Fire fighting on board ship part 1",
    resourceType: "Video",
    fileName: "clipping",
  }]);
});

test("classifies a Publitas URL in a final content form field as Document, not Video", () => {
  const resources = parseTriByteResources(`
    <input name="title" value="HANDOUT" />
    <input name="field_clipping_wurl[0][value]" value="https://view.publitas.com/himt/refresher-for-medical-first-aid" />
  `, "https://admin.learn.himtelearning.com/node/413239/edit/content/tab");

  assert.deepEqual(resources, [{
    sourceUrl: "https://view.publitas.com/himt/refresher-for-medical-first-aid",
    title: "HANDOUT",
    resourceType: "Document",
    fileName: "refresher-for-medical-first-aid",
  }]);
});