# Operations and data handling

## Data inventory

SQLite holds names, work email addresses, Argon2 password hashes, role/active state, session hashes/expiry, meeting titles/descriptions/UTC times/timezones, invite recipient addresses, invitation hashes plus encrypted token copies, generated meeting usernames, meeting password hashes and encrypted copies, personal/shared guest-session hashes, participant names/admission/hand/attendance state, and audit actions with actor/target IDs. It does not store audio/video or chat. Uploaded branding images are re-encoded to PNG under `/data/assets`.

Admins may view/manage all meetings and users and inspect audit events. Hosts manage their meetings and shared meeting credentials. Guests see only their authorized meeting and participant information. Operators with database and server-secret access can decrypt invitation links and meeting passwords and read metadata. Email providers and recipients receive meeting details and join capabilities. Protect descriptions accordingly.

LiveKit operational logs may include identities, room IDs, network addresses and connection diagnostics. They are sensitive operational data. API access logging is disabled to reduce credential exposure; meeting credentials are sent in POST bodies; legacy invitation capabilities are carried in fragments. Never log request bodies or shared passwords. The signaling gateway must not log access-token query strings. Restrict OS/Docker logs and backups to company operators; default container log rotation is 3 × 10 MB per service.

Recording is disabled. If added later, Egress needs explicit host action, a persistent visible indication, authenticated storage/download authorization, retention enforcement and verified playable output. It also changes data access and retention obligations. E2EE and server-side recording require a compatible, deliberate key architecture; neither is advertised here.

## SQLite backup and restore

WAL, foreign keys and a 15-second busy timeout are enabled for every SQLite connection. Use one app replica/worker and a local persistent disk, not a network-mounted database file. Do **not** simply copy an open `.db` and ignore its WAL.

Create a consistent online backup using SQLite's backup API:

```bash
docker compose exec api python /app/backup.py /data/backups/skymeet-2026-09-26.db
mkdir -p backups
docker compose cp api:/data/backups/skymeet-2026-09-26.db ./backups/
docker compose cp api:/data/assets ./backups/assets
```

Use a new timestamped filename each time; the script refuses overwrite and runs `PRAGMA integrity_check`. Back up `.env` and LiveKit credentials separately in your company secret store, plus branding assets and deployment files. Encrypt backup files before offsite transfer and restrict access. Rotating `APP_SECRET` without retaining the old key invalidates encrypted invitation and meeting-password copies, so key and database restores must match.

Restore into staging first. Stop the API, copy the verified backup and assets into a **new** volume mounted at `/data`, assign owner UID 10001, and run `alembic upgrade head`. The restored database must be named `skymeet.db`; do not mix it with old `-wal`/`-shm` files. Point a staging copy of Compose to the new volume. Verify login, settings, invitation resend/decryption and foreign-key integrity before switching production. Retain the original volume until the restore is accepted. Do not use `docker compose down -v` during routine updates.

Local backup example: `.venv/bin/python scripts/backup.py ./backups/skymeet-date.db` (use `.venv\Scripts\python.exe` on Windows). Set `DATABASE_URL` explicitly if using a non-default location.

## Retention and deletion

Expired login/guest sessions are removed by the worker. No automatic meeting/audit deletion is enabled in this release: the company must choose its retention policy. Cancel/end preserve the audit trail; they are not data erasure. To erase a meeting under an approved retention request, stop the API, back up, delete that meeting's participants first, then the meeting in a database transaction; guest sessions/invitations cascade. Audit rows intentionally have no foreign keys and must be considered separately for retention. Check `PRAGMA foreign_key_check` afterward. Erase users only after resolving host and attendance references; otherwise disable them and reset identifying fields under an operator-reviewed procedure. Propagate approved deletion to backup expiry policies.

Branding uploads persist even if replaced. Periodically remove orphaned asset files after comparing with the company's current logo/favicon URLs and checking backups. Do not blindly empty `/data/assets`.

## Updates and monitoring

Back up first, read release notes, update lockfiles/image digests in staging, run backend tests/build/audit and the real-browser suite, then the two-network checklist. Build new images, run migrations with one API process, and restart Compose. Keep previous images and a matching database backup for rollback. Do not roll code back across an incompatible schema without restoring the matching database.

Monitor `/skymeet/api/health`, API container health, disk free space, SMTP failure audit events, LiveKit CPU/memory/bandwidth, container restart count, certificate renewal and the ability to establish a real synthetic call. Health currently verifies the application database, not end-to-end media or SMTP. Reminders and meeting-deadline reconciliation run every 15 seconds in the API process. Persistent worker failure is an operational incident; review `Meeting reconciliation failed` logs. No managed alerting integration is configured.

Rate limits are per effective client IP and endpoint scope, in process memory. Only trust proxy headers from loopback (`--forwarded-allow-ips=127.0.0.1`). Caddy's ordinary HTTP frontend proxy forwards client addresses; the outer TLS TCP proxy currently loses the original remote address, so multiple public clients may share one limiter bucket. The conservative global protection is functional but may throttle larger offices. Before expanding traffic, introduce a tested PROXY-protocol/client-IP chain and shared rate limiter; never blindly trust arbitrary X-Forwarded-For.

## PostgreSQL growth path

The ORM uses portable SQLAlchemy types, foreign keys and UUID strings, and the migration creates the schema without SQLite-only SQL. SQLite-specific PRAGMAs run only for SQLite URLs. For growth: add/pin `psycopg`, provision PostgreSQL with TLS/backups, change `DATABASE_URL`, run Alembic against an empty staging database, and migrate table data transactionally with row counts, FK validation and timestamp checks. A data-copy utility is **not** included. Move rate limits/reminders/reconciliation to shared infrastructure before increasing API replicas. Test the complete meeting flow and restore drills against PostgreSQL before switching.

## Troubleshooting

| Symptom                        | Checks                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSRF/origin failure            | Browser URL must match `APP_ORIGIN` exactly; `/skymeet` belongs in `APP_BASE_PATH`. Reload after login/session changes.                                             |
| Camera/microphone unavailable  | Use HTTPS or localhost; review browser site permission, OS permission and device contention. Meet without devices while resolving hardware.                         |
| Connected but no media         | Check UDP 50000–60000, ICE/TCP 7881, advertised public IP and cloud firewall. WSS alone does not prove RTP reachability.                                            |
| Corporate/mobile network fails | Confirm TURN hostname DNS/certificate, TLS SNI route to 5349 and external port 443. Force relay and inspect ICE diagnostics.                                        |
| Media authorization fails      | Confirm gateway :7883 is in front of raw :7880, valid invitation/admission, UTC window, lock state and matching API secrets. Raw :7880 must be firewalled.          |
| Guest refresh denied           | Check revoked/expired invitation and room lock. Unlock before a fresh join. Shared links support separate browser sessions; an expired session requires the meeting login again.                             |
| End/remove returns 503         | Application access is already revoked; media API was unreachable. Worker retries every 15 seconds. Restore LiveKit immediately and verify everyone is disconnected. |
| Email says disabled/failed     | Set SMTP variables and enable Settings → email invitations; check STARTTLS/port/relay access. Shared invitations remain available for manual copying.                   |
| SQLite locked                  | Ensure one API worker, local disk and no external long-running write transaction; inspect free space. WAL is not multi-node replication.                            |
| TLS issuance fails             | All three DNS names must point to this VPS; ports 80/443 must reach the edge; inspect existing proxies and stale AAAA records.                                      |
| Docker unavailable on Windows  | Use the native development flow. Production Compose requires Linux host networking and has not been run on this Windows host.                                       |

## Secrets and administrative recovery

Keep `.env`, `deploy/livekit.yaml`, `.local`, data, backups and reports out of Git. The container build context excludes them. APP_SECRET is used for invitation and meeting-password encryption and CSRF proofs; rotate with an explicit plan to reissue outstanding invitations and invalidate sessions. LiveKit key changes require coordinated server/API changes and disconnect existing rooms. Password reset invalidates all sessions for that user; account disable also marks existing participants for removal. Retain an operator access path to the database/CLI rather than adding an unauthenticated password recovery endpoint.
