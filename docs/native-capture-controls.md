# Native protected-content capture controls

**Status:** Future native-app requirement  
**Scope:** VID-006, with supporting DRM-012 through DRM-014  
**Applies to:** A future HIMT Android and iOS application only

## Purpose

HIMT's current learner experience is a browser application. A browser cannot
reliably prevent operating-system screenshots, browser capture tools, or an
external camera, so the current web artifact must not claim to be
screenshot-proof.

This note defines the native controls that should be implemented if HIMT
ships a mobile application. They are additional layers around protected
documents and Mux DRM video playback, not a replacement for authentication,
authorization, encryption, signed playback, watermarking, or access logging.

The controls are intended to materially reduce casual copying and provide
traceability. They are not a guarantee that content can never be captured.

## Control vocabulary

The native product and acceptance tests must use these terms precisely:

- **Prevention:** The platform rejects or blanks a capture operation before
  protected pixels are included, where the operating system supports it.
- **Detection:** The app learns that capture, recording, mirroring, or a
  screenshot event occurred. Detection may happen after pixels were captured.
- **Obscuring:** The app replaces protected content with an opaque or
  non-sensitive state while capture is active or while the app is leaving the
  foreground.
- **Notification:** The app tells the learner why content is temporarily
  unavailable and may record an audit event. Notification alone is not
  protection.

Every product statement, test result, and support response must identify which
of these behaviors is being provided.

## Shared policy for protected surfaces

The policy applies to:

- Mux DRM video playback surfaces;
- server-rendered document pages and tiles;
- document and video watermarks;
- full-screen, modal, picture-in-picture, and background-transition states; and
- any future native screen that displays protected content.

When the app cannot establish that the surface is protected, it must fail
closed: show the protected-content placeholder rather than the source file,
raw media bytes, or an unwatermarked fallback.

While a capture restriction is active, the placeholder should:

1. remove or cover the protected pixels with an opaque surface;
2. expose an accessible status message such as “Protected content is hidden
   while screen recording or mirroring is active”;
3. keep focus and playback state recoverable without re-exposing a permanent
   source URL; and
4. restore the protected surface only after the platform reports that the
   capture condition has ended and the normal authorization checks still pass.

The app may pause playback when content is obscured. It must not treat a
capture restriction as successful course completion.

## Android requirements

### Window protection

Every Android window that can display protected content must enable
`WindowManager.LayoutParams.FLAG_SECURE` before the content is rendered. The
implementation must cover the whole protected surface, not only the video
view, including:

- document viewer activities and fragments;
- video player activities, dialogs, and full-screen transitions;
- picture-in-picture or other supported secondary windows;
- loading, error, and transition states that might briefly reveal content; and
- app-switcher snapshots.

The native implementation must verify the flag is applied early enough that a
new activity cannot render a frame before protection is enabled. It must also
ensure that navigation to an unprotected screen removes only the protected
surface, not the global authorization contract.

### Expected Android behavior

With a supported Android OS/device combination, `FLAG_SECURE` should cause:

- system screenshots to omit or blank the protected window;
- supported screen recordings to omit or blank the protected window; and
- insecure or unsupported external displays/casting surfaces to omit or blank
  the protected window.

The app must not advertise that every OEM recorder, rooted device, custom
ROM, hardware path, or external camera is blocked. If the platform cannot
confirm that the protected window is secure, the app should prefer obscuring
the surface and show the shared capture-restriction message.

### Android acceptance criteria

- A screenshot of a protected document or video contains no readable
  protected pixels on each supported Android device in the test matrix.
- A system screen recording contains no readable protected pixels on each
  supported Android device in the test matrix.
- Insecure casting or a non-secure external display blanks the protected
  surface; an approved secure playback path must be explicitly tested before
  it is allowed.
- The recent-apps/app-switcher preview does not reveal protected pixels.
- A protected modal, full-screen player, error transition, and supported
  picture-in-picture state all retain secure-window protection.
- The learner sees an accessible explanation when the app obscures content,
  and protected playback resumes only after the capture condition has ended
  and authorization remains valid.
- A test using an external camera is recorded as a known limitation, not as a
  pass/fail claim that Android prevented capture.

## iOS requirements

### Capture and recording detection

The iOS implementation must observe the active screen's capture state using
`UIScreen.isCaptured` and
`UIScreen.capturedDidChangeNotification`. The capture policy must cover
screen recording, mirroring, and supported AirPlay or external-display
capture paths reported by the OS.

When capture becomes active, the app must immediately obscure or replace
protected content. The protected view must remain obscured until the capture
state is reported as inactive and the usual authorization checks pass again.
The implementation must handle a capture-state change while the player is
paused, buffering, full-screen, or transitioning between scenes.

The app may observe
`UIApplication.userDidTakeScreenshotNotification` for audit and user
feedback, but that notification occurs after the screenshot. It is not a
preventive control and must never be described as screenshot prevention.

### Background and task-switching protection

Before a protected scene resigns active or enters the background, the app
must replace protected pixels with an opaque privacy view so the app switcher
and OS transition snapshots do not expose content. The privacy view must also
be applied during logout, account switching, authorization refresh, and any
temporary state in which protected content is not authorized.

On return to the foreground, the app must re-check learner enrollment,
resource authorization, token freshness, and capture state before restoring
the document or video surface. A stale view or stale playback license must
not be made visible merely because the app resumed.

### FairPlay and native video behavior

Mux FairPlay playback and the native capture-obscuring policy are
complementary:

- FairPlay protects the video stream and license exchange through the
  platform's content-protection path.
- The app-level capture policy covers the player container, overlays,
  documents, controls, and non-video protected content.
- If the OS or player does not confirm a protected output path, the app must
  obscure the protected surface instead of falling back to a raw stream.

FairPlay or an OS-provided black capture result must not be used as proof that
documents, overlays, watermarks, or every device output are protected.

### iOS acceptance criteria

- When screen recording, mirroring, or a reported capture path starts, the
  protected video and document surface is obscured promptly and remains
  obscured while capture is active.
- A screenshot notification is used only for post-event audit or messaging;
  tests and product copy explicitly state that iOS cannot prevent every
  screenshot.
- App-switcher and background snapshots contain no readable protected pixels.
- Returning to the app performs authorization and capture-state checks before
  restoring content.
- Protected content is obscured during full-screen transitions, buffering
  transitions, scene changes, and account changes.
- The learner receives an accessible explanation and can recover without
  receiving a permanent media or document URL.
- A test using an external camera is recorded as a known limitation, not as a
  claim that iOS prevented capture.

## Cross-platform behavior matrix

| Event | Android native app | iOS native app | Current browser app |
| --- | --- | --- | --- |
| System screenshot | `FLAG_SECURE` blanks supported protected windows | Cannot reliably prevent; use capture policy where reported and document the post-event screenshot notification limitation | Cannot reliably prevent |
| Screen recording | `FLAG_SECURE` blanks supported protected windows | Detect capture state and obscure the protected surface; protected video may also receive OS/DRM output protection | Cannot reliably prevent |
| Mirroring / casting | Blank insecure or unsupported displays; allow only an explicitly approved secure path | Detect reported capture/mirroring state and obscure unless a deliberately approved secure path exists | Cannot reliably prevent |
| App switcher / background snapshot | Secure-window protection plus protected transition state | Obscure before the scene resigns active/backgrounds | Use ordinary browser limitations; do not claim prevention |
| External camera | Cannot be blocked | Cannot be blocked | Cannot be blocked |
| Watermark | Keep learner email watermark visible whenever protected pixels are visible | Keep learner email watermark visible whenever protected pixels are visible | Existing browser watermarking remains a traceability control, not capture prevention |

The browser column is intentionally conservative. VID-006 does not authorize
adding a “screenshots blocked” claim to the current web experience.

## Boundary with authenticated playback and Mux

The future native app must reuse the LMS's protected-content contract:

1. The learner authenticates through the approved identity flow and must have
   active course access.
2. The native client requests short-lived playback authorization for the
   resource. It must not construct authorization tokens, embed provider
   secrets, or persist a permanent media URL.
3. The server provisions or resolves the Mux asset and returns only the
   signed playback information needed by the native DRM player.
4. The native player uses Mux adaptive playback and the platform DRM path:
   Widevine on supported Android devices and FairPlay on supported Apple
   devices. PlayReady remains part of the Mux multi-DRM contract for supported
   clients where applicable.
5. The native capture controls wrap the player and document viewer. They do
   not replace server-side enrollment checks, short-lived authorization,
   encryption, watermarks, revocation, or access logs.
6. When capture or authorization checks fail, the app stops or obscures
   playback and records a meaningful event if the LMS audit contract supports
   that event.

The native app must never download an unencrypted MP4 as a workaround for a
DRM or capture-control failure.

## Device and OS test matrix

The mobile release gate must be run on real devices, not only simulators or
emulators. The exact supported-version list should be approved when the
native artifact is started.

| Platform | Minimum coverage | Capture cases |
| --- | --- | --- |
| Android | One current and one minimum-supported Android phone; at least one OEM skin in addition to the reference device | Screenshot, system recording, app switcher, background/foreground, insecure cast/display, secure cast decision, full-screen video, document viewer, external camera limitation |
| Android | One tablet or large-screen configuration if supported | Same cases, including rotation, multi-window, and any supported picture-in-picture path |
| iOS | One current and one minimum-supported iPhone; one iPad configuration if supported | Screenshot notification, screen recording, Control Center transition, mirroring/AirPlay, app switcher, background/foreground, full-screen video, document viewer, external camera limitation |
| iOS | At least one supported device with a notch/Dynamic Island or equivalent system transition behavior | Scene transitions, rotation, interruption, lock/unlock, and restoration after capture ends |

For every device/configuration, tests must verify:

- no readable protected pixels in the capture output where the platform
  promises blanking or app obscuring;
- no permanent source URL or raw media fallback is introduced;
- the learner-facing message is understandable and accessible;
- playback does not count as completed merely because a restriction occurred;
- content restores only after authorization and capture-state checks; and
- the known limitations are reported separately from product defects.

## Release and product-copy gates

The future native artifact must not be released until:

- Android and iOS acceptance cases above pass on the approved device matrix;
- all protected surfaces, not just the primary video view, are covered;
- the Mux playback and license configuration has been tested independently of
  capture behavior;
- access logs and learner-facing errors distinguish authorization failures
  from capture restrictions;
- support documentation states that external cameras and some
  device/OS-level capture paths cannot be universally blocked; and
- marketing, onboarding, and in-app copy says “reduces capture on supported
  devices” or equivalent, never “prevents screenshots everywhere.”

This requirement remains documentation-only until HIMT approves a separate
native mobile artifact. The current browser application is not changed by this
document.

## Source requirements

- `attached_assets/Pasted-5-Protected-document-and-video-delivery-The-controls-be_1787203383089.txt`
- `artifacts/himt-lms/src/App.tsx`