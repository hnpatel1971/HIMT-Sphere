import assert from "node:assert/strict";
import test from "node:test";
import {
  isTriByteVideoContentRecord,
  parseTriBytePreviewLinks,
  parseTriBytePreviewPlaylists,
  parseTriByteResources,
} from "./tribyte-resource-parser.ts";
import {
  isApprovedTriByteHlsUrl,
  rewriteHlsManifest,
  shouldMarkTriByteResourceUnavailable,
  triByteHlsRequestHeaders,
} from "./tribyte-hls.ts";

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

test("extracts content-specific Preview links without treating them as learner resources", () => {
  const html = `
    <a class="preview" href="/video?vid=428318&amp;dialog=true&amp;width=640">Preview the Content</a>
    <a href="/reviewer/topics?cat=19186">Online class video</a>
  `;

  assert.deepEqual(parseTriBytePreviewLinks(
    html,
    "https://admin.learn.himtelearning.com/node/428024/edit/contents",
  ), [{
    sourceNid: "428318",
    previewUrl: "https://admin.learn.himtelearning.com/video?vid=428318&dialog=true&width=640",
  }]);
  assert.deepEqual(parseTriByteResources(
    html,
    "https://admin.learn.himtelearning.com/node/428024/edit/contents",
  ), []);
});

test("extracts HTML-encoded and JSON-escaped HLS playlists from Preview markup", () => {
  const playlists = parseTriBytePreviewPlaylists(`
    <script>
      PlayerManager.load({"playerUrl":"https:\\/\\/d2ubwtvhjzuzf0.cloudfront.net\\/428318\\/master.m3u8?policy=example\\u0026key=one"});
    </script>
    <source src="/streams/fallback.m3u8?token=example&amp;quality=auto">
  `, "https://admin.learn.himtelearning.com/video?vid=428318");

  assert.deepEqual(playlists, [
    "https://d2ubwtvhjzuzf0.cloudfront.net/428318/master.m3u8?policy=example&key=one",
    "https://admin.learn.himtelearning.com/streams/fallback.m3u8?token=example&quality=auto",
  ]);
});

test("requires video-specific content evidence before using a Preview-only source", () => {
  assert.equal(isTriByteVideoContentRecord(`
    <a href="/node/428318/edit/video/clipper">Edit video clipping</a>
    <a href="/reviewer/download/clipping?nid=428318">Download</a>
  `), true);
  assert.equal(isTriByteVideoContentRecord(`
    <a href="/video?vid=428319&amp;dialog=true">Preview the Content</a>
    <input name="document_upload" value="safety-checklist.pdf">
  `), false);
});

test("rewrites all HLS child requests through an approved local proxy", () => {
  let nextId = 0;
  const registered: string[] = [];
  const rewritten = rewriteHlsManifest(`
#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"
#EXT-X-MAP:URI=https://d2ubwtvhjzuzf0.cloudfront.net/video/init.mp4
segments/part-1.ts
`, "https://admin.learn.himtelearning.com/streams/master.m3u8", (url) => {
    assert.equal(isApprovedTriByteHlsUrl(url), true);
    registered.push(url);
    return `http://127.0.0.1:43210/hls/${++nextId}`;
  });

  assert.deepEqual(registered, [
    "https://admin.learn.himtelearning.com/streams/keys/key.bin",
    "https://d2ubwtvhjzuzf0.cloudfront.net/video/init.mp4",
    "https://admin.learn.himtelearning.com/streams/segments/part-1.ts",
  ]);
  assert.equal(rewritten.includes("https://"), false);
  assert.equal(rewritten.includes("http://127.0.0.1:43210/hls/3"), true);
});

test("rejects hostile HLS children and never sends the TriByte cookie cross-origin", () => {
  assert.throws(() => rewriteHlsManifest(
    "#EXTM3U\nhttps://evil.example/segment.ts",
    "https://admin.learn.himtelearning.com/streams/master.m3u8",
    (url) => {
      if (!isApprovedTriByteHlsUrl(url)) throw new Error("blocked");
      return "http://127.0.0.1/hls/1";
    },
  ), /blocked/);

  assert.equal(
    triByteHlsRequestHeaders(
      "https://admin.learn.himtelearning.com/streams/master.m3u8",
      "session=secret",
      "https://admin.learn.himtelearning.com/video?vid=1",
    ).Cookie,
    "session=secret",
  );
  assert.equal(
    triByteHlsRequestHeaders(
      "https://d2ubwtvhjzuzf0.cloudfront.net/video/segment.ts",
      "session=secret",
      "https://admin.learn.himtelearning.com/video?vid=1",
    ).Cookie,
    undefined,
  );
});

test("marks direct and Preview terminal absence unavailable, not retryable failed", () => {
  assert.equal(shouldMarkTriByteResourceUnavailable(
    new Error("Source file responded 404"),
    new Error("TriByte page responded 410"),
    false,
  ), true);
  assert.equal(shouldMarkTriByteResourceUnavailable(
    new Error("Source file responded 404"),
    new Error("Preview playlist responded 503"),
    false,
  ), false);
  assert.equal(shouldMarkTriByteResourceUnavailable(
    new Error("No direct source"),
    new Error("Preview HLS child responded 404"),
    true,
  ), true);
});