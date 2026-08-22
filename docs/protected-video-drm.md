# Protected video delivery and DRM boundary

## Current browser delivery

HIMT stored recordings are never returned as an original MP4 download. Eligible
private recordings are ingested into Mux as DRM assets, and the LMS creates a
short-lived Mux playback and DRM authorization bound to the signed-in Clerk
user, browser session, and current enrollment. The browser receives a Mux
playback ID plus brief authorization tokens, never the private-object URL or a
permanent source-file URL.

The Mux Player uses adaptive delivery and Mux's managed Widevine, FairPlay, and
PlayReady license flows on supported browsers. The LMS renews authorization
before it expires, so each renewal repeats its revocation and enrollment check.
Playback position is saved during viewing; completion is recorded only after at
least 90% of the duration has been reached.

External YouTube/Vimeo entries are deliberately unavailable through this player
until HIMT migrates a recording it controls into private storage. They are
outside the DRM scope.

## Managed multi-DRM handoff

Commercial Widevine, FairPlay, and PlayReady delivery is supplied by Mux. The
resource model records the provider asset, DRM playback ID, provisioning state,
and safe failure detail without recording credentials or private source URLs.
Each asset carries the immutable LMS resource ID as Mux metadata so interrupted
provisioning retries reconcile an existing asset instead of creating a duplicate.
Provisioning also uses a PostgreSQL advisory lock per resource through the
provider call and database write, preventing concurrent servers from creating
two assets for the same recording.

Provider credentials, signing keys, and license configuration are workspace
secrets named `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_DRM_CONFIGURATION_ID`,
`MUX_SIGNING_KEY_ID`, and `MUX_SIGNING_KEY`. They must never be committed to
source or embedded in client code. The provider adapter:

1. validate the existing HIMT viewer session and current course entitlement;
2. requests short-lived provider playback and DRM tokens;
3. configures encrypted adaptive playback and managed license requests for
   Widevine, FairPlay, and PlayReady; and
4. keep the provider asset ID, rotation policy, and migration status auditable.

HIMT does not operate a proprietary DRM licence server.

## Browser and native capture boundary

Browser controls remove ordinary download, print, context-menu, and save paths,
and learner-specific watermarks improve traceability. They cannot guarantee
prevention of browser developer tools, operating-system capture, or external
cameras.

Native-app capture controls are separate work: Android needs `FLAG_SECURE`; iOS
needs capture detection plus content-obscuring behaviour. They are not present
in this browser-only artifact. See `docs/native-capture-controls.md` for the
native implementation requirements and limitations.