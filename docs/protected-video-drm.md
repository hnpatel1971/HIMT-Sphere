# Protected video delivery and DRM boundary

## Current browser delivery

HIMT stored recordings are never returned as an original MP4 download. The LMS
creates a short-lived viewer session bound to the signed-in Clerk user and
session, packages the private source into encrypted adaptive HLS segments, and
rechecks course access for every manifest, key, and segment request. Playback
position is saved during viewing; completion is recorded only after at least
90% of the duration has been reached.

The encryption key and all segment URLs are transient protected requests. They
use no-store caching, a restrictive content security policy, and no-referrer
headers. The application intentionally blocks external YouTube/Vimeo entries
from being represented as protected HIMT playback until they are migrated to an
approved delivery provider. Those sources are outside the DRM scope.

## Managed multi-DRM handoff

Commercial Widevine, FairPlay, and PlayReady delivery must be supplied by an
approved managed provider. The resource model has `drm_provider` and
`drm_asset_id` metadata so a provider-backed asset can replace the encrypted
HLS package without changing learner authorization, audit, progress, or
completion semantics.

Provider credentials, signing keys, and licence configuration must be stored
only as workspace secrets. They must never be committed to source, embedded in
client code, or returned through the LMS API. The future provider adapter must:

1. validate the existing HIMT viewer session and current course entitlement;
2. request a short-lived provider playback token/server-side signed manifest;
3. configure encrypted manifests and licence requests for Widevine, FairPlay,
   and PlayReady; and
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