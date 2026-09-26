# Local verification — 26 September 2026

Environment: Windows, Python 3.14.5, Node 22.17.1, React/Vite development server, FastAPI, SQLite WAL, official **LiveKit Server 1.13.7**, and **Caddy 2.11.4** signaling admission gateway. Services bind to localhost; there is no public deployment.

## Passed

- **18 backend tests:** Argon2/session login/logout; CSRF and origin rejection; login rate limiting; admin/employee/host boundaries; invitation hashing/encryption, expiry and revocation; waiting-room checks; narrow 60-second JWT claims; lock/end/removal state; cross-meeting capability rejection; timezone and join-window validation; disabled accounts and company policies; calendar output; safe raster upload; signed/tampered/replayed webhooks; session invalidation after password reset; recording refusal; signaling-gateway replay rejection; overdue/old-ended-room reconciliation; employees-only invitation exchange; brand-color contrast validation.
- **Three browser suites:** axe WCAG A/AA checks on login, dashboard, pre-join and in-call controls; scheduling plus English/Arabic RTL and a 390px mobile layout; and an actual self-hosted three-person meeting using isolated Chromium contexts for Sara (host), Omar (invited employee) and an external guest.
- The media suite verifies remote video decoding in both the host and guest browsers and live remote audio playback tracks. The sources are synthetic browser camera/microphone devices; they do not capture the operator's physical devices.
- Waiting guest admitted by the host; host mute; speaker/grid view; chat delivered through LiveKit; hand raise; guest refresh/rejoin; lock rejects a new join; unlock permits it; removal disconnects the guest; a still-valid earlier token is rejected by the real Caddy gateway; End for everyone disconnects the invited employee.
- Screen-share track publication and remote display tested with a synthetic canvas returned by the browser-test capture fixture. This tests the SDK/SFU screen-track path, **not** the OS desktop picker or real desktop capture permissions.
- TypeScript checking and Vite production build; `npm audit` reports zero known vulnerabilities in the locked dependency tree.
- Alembic upgrade on the local database and schema-drift check; SQLite online backup with integrity check; Compose parsing; standard frontend and media-gateway Caddy configuration validation.

Screenshots and HTML test report are generated under `test-results/` and `playwright-report/`. They are ignored by Git. The live meeting screenshot is `test-results/real-local-call.png`. Do not publish failure screenshots without reviewing them for invitation links.

## Not verified here

- A real call across separate physical devices or separate networks; physical microphone/speaker quality; native screen picker and actual desktop capture; Safari/Firefox; packet-loss recovery under a real poor network.
- Hostinger deployment, DNS and public ACME certificates, HTTPS/WSS in production, TURN/TLS forced relay and the public firewall. Docker's daemon was not running, so the Linux containers and the Caddy layer-4 edge were not executed on this host. Compose and standard Caddy templates were validated; the full Ubuntu stack still needs staging validation.
- Delivery to real SMTP mailboxes and actual scheduled reminder arrival. Credentials were not supplied; local invitations were securely copied instead. Email/ICS generation is implemented.
- Restore into a separate production-like volume, PostgreSQL data migration, load/capacity testing, independent penetration review or a full human screen-reader audit.
- GitHub Actions execution. The workflow is supplied but has not run remotely. Nothing has been pushed to GitHub or deployed to the VPS.
- Recording and E2EE are **not implemented**. There is no recording file and no playback claim.

Before go-live, complete [MANUAL_TESTS.md](MANUAL_TESTS.md) on staging and record browser/device/network/ICE candidate and backup-restore results. Local success is not a substitute for the production network acceptance test.

## Administrator settings update — 26 September 2026

Added configurable application title/version, Garden/Studio/Compact appearance templates, a unified admin Settings navigation, and current-password-verified admin password changes with all-session revocation. Existing logo/icon upload and user management are now available together in Settings. New UI text includes Arabic translations.

Validation: 22 backend tests pass, including employee rejection, settings persistence/defaults, password verification, CSRF, rate limits and session revocation. The admin browser workflow passes for image uploads, title/version persistence, all three themes with axe accessibility checks, creating a temporary administrator, changing its password and signing in again, employee UI/API rejection, and mobile Arabic layout. Test settings were restored and the temporary administrator was disabled. The production build passes.

## Meeting management update — 26 September 2026

29 backend tests pass, including deletion in all four meeting states, administrator/host authorization, CSRF, invalidated guest links/media tokens, cascade cleanup with audit retention, cleanup retry, rescheduling invitation expiry/calendar, and lists exceeding 200 entries. A browser test passes for sorting both directions, administrator rescheduling of an employee meeting, scheduling a fresh occurrence, confirmed deletion, accessibility and mobile Arabic layout. Disposable meetings were deleted afterward. Production build verified.

## Account email update — 26 September 2026

32 backend tests pass, including password verification, CSRF, admin-only authorization, duplicate/invalid addresses, rate limits, old-login rejection, all-session revocation, and retained account/meeting ownership. A browser workflow passes for wrong passwords, duplicate addresses, successful email change and sign-in with the existing password, accessibility, and mobile Arabic layout. The saved sample administrator credentials had changed, so a disposable local test administrator was provisioned and then removed; the account used for email changes was disabled afterward. No existing user credentials were changed. Production build passes.

## Calendar grouping update — 26 September 2026

Browser checks pass for year/month filtering, grouping by month/year or no grouping, reverse date order, a UTC-to-Asia/Muscat year boundary, clear/empty filter states, cancelling then confirming direct deletion of a completed meeting, deleting the final meeting in a selected year, accessibility and Arabic mobile layout. Screenshots visually checked. The production build passes. Disposable test meetings and their temporary administrator were removed. No backend behavior changed in this update.

## Invitation experience update — 26 September 2026

Added a scheduling handoff to Invite people, direct Invite actions, separate link retrieval and mail sending, copyable invitation text and mail-app drafts, explicit local-preview/delivery states, and a simplified guest preview with calendar download and early-join guidance. Branded email templates include escaped text, meeting-local time, a Join button and ICS attachment. 35 backend tests pass, including no-send link retrieval, host/meeting scoping, revoked/closed links, mail content escaping and calendar times. A browser workflow verifies scheduling, invitation text, anonymous guest preview, actual local LiveKit connection, waiting-room admission and ending the call. No external email was sent; real SMTP delivery and public-network attendance remain deployment acceptance items.

## Automatic password-protected invitations — 26 September 2026

Every meeting now gets one shared link and generated meeting username/password. Host/admin-only sharing shows masked credentials and copies the complete invitation. Guests sign in to the meeting before pre-join, with independent browser sessions and existing waiting-room, timing, lock and moderation enforcement. Legacy links require the new meeting credentials for guest access. This supersedes the per-email UI described in the previous update.

41 backend tests pass, including credential encryption/privacy, wrong and cross-meeting credentials, rate limiting/origin checks, independent guest identities, admission, refresh, removed/expired session rejection, logout/media-token revocation, legacy-link bypass prevention and deletion cleanup. TypeScript and the production build pass. Two browser workflows pass: automatic sharing and two concurrent guests using one password-protected link; and the full three-person LiveKit media/chat/moderation suite. Accessibility checks cover the sharing panel, guest login, pre-join and call; mobile English/Arabic layouts were checked. One low-contrast login label was corrected during verification.

The development database was backed up before migration, all 23 existing meetings received credentials, and the foreign-key check passes. Disposable test meetings and all three temporary accounts were removed. Existing staff credentials/settings were preserved. No external email was sent and no deployment was performed; public-network, SMTP and TURN acceptance remain outstanding deployment checks.

## Multiple-meeting deletion — 26 September 2026

Investigation confirmed the user's seven recent deletion audit targets were absent from the database; many remaining records shared the same title. Added explicit row selection, filtered select-all, exact-count/date confirmation, immediate local removal/count updates, stale-row handling and refresh on returning to a tab. Bulk deletion authorizes the entire explicit ID list before one transaction, removes dependent data and preserves audit events. Media cleanup has a three-second response budget and continues via orphan-room reconciliation when needed.

46 backend tests pass, including mixed-state deletion, unauthorized mixed selections, CSRF/origin validation, transaction rollback, repeat requests, dependency cleanup and failed/slow media cleanup. Browser checks pass for duplicate-title single deletion with reload, multi-delete, cancellation, filtered selection, selection reset, preserving unrelated meetings, stale-list refresh, calendar filters, accessibility and mobile Arabic layout. TypeScript and the production build pass. Disposable test meetings/accounts were removed; existing user meetings were preserved.
