---
name: TriByte resource migration coverage
description: Prerequisites and source views required for an accurate TriByte learning-resource scan.
---

Run the full course-structure migration before a resource migration so every available topic and sub-topic node can be inspected. Resource discovery must include authenticated content-management views as well as learner-facing node pages, while excluding Drupal navigation/category links from asset candidates.

**Why:** Course landing pages alone do not expose the complete teaching structure, and labels such as “Online class video” can link to taxonomy navigation rather than a playable recording or downloadable file.

**How to apply:** Before reporting a full-catalogue asset migration result, confirm that the structure job completed and scan each imported topic’s learner, content, metadata, and sub-topic views. Treat a zero-resource result as a verified source-coverage finding, not a transfer failure.

## Large-file transfer policy

TriByte resource migrations have **no application-level size ceiling**. File sizes are stored as PostgreSQL `bigint` values, and a completed private-object upload can be registered on a later retry without downloading it again.

**Why:** HIMT chose catalogue completeness over a transfer cap. The former integer file-size field could not record uploads over roughly 2 GB even after their streams finished, so resilient retries must preserve and reuse completed objects.

**How to apply:** Do not add header or streamed-byte limits. Preserve `bigint` storage for resource sizes. When retrying, process only failed or pending course items; a deterministic existing private object should be registered as ready rather than fetched a second time.

## Content-record depth

**Rule:** Traverse a sub-topic’s `Contents` view one level further into each content-record page (`/node/{content-id}/edit/content/tab`) before deciding which resource URLs are available.

**Why:** TriByte uses `/edit/contents` for sub-topic containers but `/edit/content/tab` for individual document/video records. The latter is where protected clipping-download and video upload metadata are exposed, so treating both paths as the same link shape skips valid content records.

**How to apply:** Use separate discovery patterns for sub-topic containers and content records. Parse each discovered content-record page for protected downloads and media metadata; an empty media URL there still means recovery requires the source file, not a different downloader.

## Form-field media URLs

**Rule:** Parse approved media URLs from a final content record’s `field_clipping_wurl` and `field_clipping_murl` form values as well as from links and media tags.

**Why:** TriByte can store a playable external video in a Drupal text field rather than an `<a>`, `<video>`, or `<iframe>`. Treating the absence of a direct download link as an empty node misses those resources.

**How to apply:** Inspect the exact final-node form shape. Accept only explicitly reviewed external hosts, store the content-record node as the resource identity, and open the external media through the same learner access check used for stored files.

## Empty content records

**Rule:** A discovered TriByte content record may be structurally valid but have no attached learner asset; do not synthesize a resource row for it until both direct media and supported form-field media have been checked.

**Why:** Some records expose only an empty thumbnail/upload field and administrative controls, while others place their playable URL in a form field. Only a scan that finds neither is a verified empty source.

**How to apply:** Report empty-source nodes separately from pending or failed transfers, and keep the parent topic/sub-topic visible even when its resource list is empty.