# Sky Meet

A company-owned meeting workspace for **Sky Green Line**, built with React/TypeScript/Vite, Radix Themes, FastAPI/Pydantic/SQLAlchemy/Alembic, SQLite WAL and **self-hosted LiveKit**. The production application is configured for **https://skygreenline-lab.io/skymeet/**.

This is an implemented application, with real meeting authorization and media integration. It is an initial unrecorded release, not a claim of production certification. See [verification results](docs/VERIFICATION.md), [architecture and policies](docs/ARCHITECTURE.md), [security/operations](docs/OPERATIONS.md), and [manual acceptance tests](docs/MANUAL_TESTS.md).

## Implemented

- Operator-only first-admin CLI; Argon2 password hashes; employee/admin roles; user creation, disabling and password reset; HttpOnly sessions, CSRF/origin enforcement, login/join rate limits, audit trail.
- Responsive English/Arabic workspace with RTL, dashboard, upcoming/recent meetings, instant meeting, schedule/edit/cancel, UTC storage, viewer-local times, host assignment by admins.
- Automatic shared invitation link and generated meeting username/password, host/admin-only credential retrieval, independent guest sessions, waiting-room admission, branded SMTP mail and ICS attachment/download. SMTP credentials stay server-side.
- LiveKit camera/microphone preview and device menus, mic level and speaker test, join muted, participant grid, speaker view, screen-share stage, ephemeral chat, hand raise, connection state, leave/rejoin and post-call summary.
- Waiting-room admission/denial, mute, removal, lock/unlock and end-for-all enforced through the backend. Short JWTs plus a Caddy admission gateway protect fresh signaling connections from replay after removal/revocation.
- Branding name/logo/favicon/color/support, default duration, employee/guest permissions, waiting-room and email/reminder policies; safe raster image re-encoding.
- Alembic migration, consistent SQLite backup script, official-guidance-based Docker/Caddy/LiveKit/Redis deployment, OpenAPI, backend security tests and a real local WebRTC browser suite.

## Deliberately deferred / limitations

- **Recording is disabled.** No Egress, recording button, file, retention claim or playback claim. E2EE is not implemented; TLS/WebRTC protect transport, and the company-controlled SFU can access media.
- No SSO/MFA, recurring series, password-free public guest access, persistent chat, password reset by email, transcription, HA or multi-worker app deployment. Shared meeting credentials authorize attendance, not identity or email ownership. Anyone given both the link and credentials can request entry; use the waiting room to verify attendees. A new browser creates a separate guest identity, so removal is not a permanent person-level ban.
- Editing a meeting does not automatically email updates/cancellations: use explicit resend for edits and notify recipients when cancelling. Reminder delivery retries every 15 seconds on transient failure; a crash after SMTP acceptance can duplicate a reminder (at-least-once delivery). No external delivery provider tracking.
- Browser timezone is used for scheduling; arbitrary timezone selection is deferred. Server API errors and some SDK diagnostics/device names are English, even in Arabic mode.
- Admin colors must remain readable. Automated accessibility checks cover the included default theme, not every uploaded logo or custom brand choice.
- The Hostinger deployment has passed public HTTPS/WSS and two-browser audio/video checks, including forced TLS TURN relay, from an external Windows client. Physical-device quality, separate attendee networks, Safari/Firefox, and real SMTP delivery remain unverified. See `docs/VERIFICATION.md` for the deployment record.

## Local setup (Windows)

Use Python 3.14, Node **22.22+** (or a compatible current LTS), and npm. Dependency versions are locked in `backend/requirements.txt` and `package-lock.json`; the application was built locally on Node 22.17, whose transitive SDK dependency emits an engine warning. Use the supported newer runtime for deployment.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm ci
.venv\Scripts\python.exe scripts/init_local.py
.venv\Scripts\python.exe -m alembic -c backend/alembic.ini upgrade head
$env:PYTHONPATH = 'backend'
.venv\Scripts\python.exe -m app.cli create-admin --email you@your-company.com --name 'Your Name'
```

The CLI prompts securely for the password and refuses to bootstrap after the first admin exists. There are **no default production credentials** and no public setup endpoint. `init_local.py` generates ignored local secrets and `.local/livekit.yaml`; it never overwrites an existing `.env`.

Download [LiveKit Server v1.13.7](https://github.com/livekit/livekit/releases/tag/v1.13.7) and [Caddy v2.11.4](https://github.com/caddyserver/caddy/releases/tag/v2.11.4) for your OS from their official releases. Extract the Windows binaries to `.local/livekit/livekit-server.exe` and `.local/caddy/caddy.exe`. In four terminals at the repository root:

```powershell
# Terminal 1 — private local SFU, using the generated development config
.local\livekit\livekit-server.exe --config .local/livekit.yaml
# Terminal 2 — API
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log
# Terminal 3 — media admission gateway
.local\caddy\caddy.exe run --config deploy/media.Caddyfile
# Terminal 4 — frontend
npm run dev
```

Open **http://localhost:5173/skymeet/**. Use `localhost`, not `127.0.0.1`, in the browser: origin/CSRF checks intentionally require the configured origin. Localhost is a browser secure context; plain HTTP on a remote/LAN IP is not an acceptable camera/microphone deployment.

For Linux local development use `.venv/bin/python`, your native `livekit-server`/`caddy`, and the same files and ports. Redis is optional for this single-node native development config; production Compose includes it.

### Disposable browser-test accounts

For local testing only, after migration:

```powershell
$env:PYTHONPATH = 'backend'
.venv\Scripts\python.exe scripts/seed_test_accounts.py
```

This creates an administrator and two employees with randomly generated passwords stored in ignored `.local/test-accounts.json`. The script refuses production configuration. Do not deploy this database, `.local`, `.env`, screenshots or test accounts to the VPS. The production setup starts with a new volume and uses the first-admin CLI.

## Test and build

```powershell
$env:PYTHONPATH = 'backend'
.venv\Scripts\python.exe -m pytest backend/tests -q
.venv\Scripts\python.exe -m alembic -c backend/alembic.ini check
npm run build
npm audit --audit-level=moderate
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.cache\playwright"
npx playwright install chromium
npm run test:e2e
```

Backend tests use a separate temporary database and mock moderation network calls. The browser suite requires the four real local services and test fixtures above, uses the actual self-hosted SFU and gateway, and adds meetings to the development database. There are no fake frontend API responses. Do not run browser fixtures against production.

FastAPI OpenAPI is at `http://localhost:8000/docs` and the schema at `/openapi.json` locally. Production direct port 8000 is private; use an SSH tunnel to access these routes. The interactive docs do not automatically attach CSRF headers; use the product UI or a same-origin client with `X-CSRF-Token`.

## Hostinger Ubuntu VPS deployment

**This VPS already serves another application at `/`. Follow [the existing-site deployment procedure](docs/EXISTING_VPS.md) and preserve Nginx and root routing. The `edge` service is disabled by default and must remain disabled on that host.** The standalone edge instructions below apply only to a dedicated server or a separately reviewed integrated edge.

Use an Ubuntu 24.04+ VPS with a public IPv4 address, Docker Engine and Compose v2, working outbound SMTP (or a company SMTP relay), and enough CPU/bandwidth for your participant count. Start with 4 vCPU / 8 GB for staging and measure real load before sizing production. This is a starting estimate, not a tested capacity promise. Shared web hosting is insufficient for an SFU.

1. Point these **DNS-only** A records at the VPS: `skygreenline-lab.io`, `meet-media.skygreenline-lab.io`, and `meet-turn.skygreenline-lab.io`. Do not enable an HTTP CDN proxy for media/TURN. Set AAAA only if IPv6 routing/firewalls are actually configured.
2. Reserve inbound **80/TCP** (ACME), **443/TCP** (HTTPS/WSS and TURN/TLS via SNI), **7881/TCP** (ICE/TCP), **3478/UDP** (TURN/STUN), and **50000–60000/UDP** (media). Open SSH only for operator IPs. Keep **7880, 7883, 8000, 8080, 5349 and 6379 private**. Because Compose uses Linux host networking, host and Hostinger firewall rules are essential; the raw SFU signaling port must never bypass the admission gateway.
3. Clone your repository after you push this project: `git clone https://github.com/Tabook22/skymeet.git /opt/skymeet`. This implementation did not push or deploy anything remotely.
4. Copy `.env.example` to `.env`. Generate independent random `APP_SECRET` and `LIVEKIT_API_SECRET` (e.g. `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`) and a random API key ID. Set `PRODUCTION=true`, the provided HTTPS origin and WSS URL. Never put the `/skymeet` path in `APP_ORIGIN`; it has its own setting.
5. Copy `deploy/livekit.yaml.example` to `deploy/livekit.yaml`. Replace both key IDs and the API secret with exactly the same values as `.env`. Restrict secret-file permissions (`chmod 600 .env deploy/livekit.yaml`). Configure server-side SMTP if needed. Upload no secrets to GitHub.
6. Review the existing VPS reverse proxy before starting. The included `edge` owns ports 80/443 and `frontend.Caddyfile` serves only `/skymeet/*`; its other paths return 404. **It is a template, not a safe drop-in replacement for another website.** Merge existing root-site routing into the frontend Caddyfile (or proxy its fallback to the existing site on a private port). Do not start a competing proxy on the same ports. The TURN route needs Caddy layer-4 SNI, which an ordinary path-based HTTP proxy cannot provide.
7. Validate and build:

```bash
docker compose config --quiet
docker compose build
docker compose up -d redis livekit api media-gateway frontend
docker compose exec api python -m app.cli create-admin --email you@your-company.com --name 'Your Name'
docker compose --profile standalone-edge up -d edge
docker compose ps
docker compose logs --tail=50 edge api media-gateway
```

8. Wait for ACME certificates for all three hostnames. Visit `https://skygreenline-lab.io/skymeet/`. Enable invitation/reminder email in Settings only after the SMTP environment is configured. Complete [the manual test](docs/MANUAL_TESTS.md) from two networks, including forced TURN/TLS. Do not announce production readiness before that succeeds.

The API container runs as UID 10001, creates/migrates the named SQLite volume, and uses one worker. The media gateway fails closed when authorization is unavailable. Docker container logs rotate. Image versions/digests and npm/Python dependencies are pinned; scheduled dependency review is still required.

## Backups, updates, privacy and troubleshooting

See [OPERATIONS.md](docs/OPERATIONS.md) for online backup/restore, retention/deletion, PostgreSQL growth path, monitoring, secret rotation, common camera/ICE/SMTP problems and update/rollback steps.

## Official references checked during implementation

- [LiveKit React components / PreJoin](https://docs.livekit.io/reference/components/react/component/prejoin/) and [React component reference](https://docs.livekit.io/reference/components/react/).
- [LiveKit VM deployment](https://docs.livekit.io/transport/self-hosting/vm/), [ports/firewalls](https://docs.livekit.io/transport/self-hosting/ports-firewall/), and [official Caddy/Compose generator](https://github.com/livekit/deploy).
- [Token lifecycle and self-hosted revocation limitations](https://docs.livekit.io/frontends/reference/tokens-grants/), [participant management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/), and [signed webhooks](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/).
- [FastAPI password hashing guidance](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/) and [Radix Themes](https://www.radix-ui.com/themes/docs/theme/overview).

Package versions were resolved against official npm/PyPI registries on 26 September 2026 (Asia/Muscat). See lockfiles for exact transitive versions.

## Administrator settings

Sign in as an administrator and open **Settings**. Employees cannot access these controls, and the API checks the administrator role for every change.

- **Brand & identity:** upload or remove the logo and application icon (also used as the browser favicon); set the application title, displayed version, company name, support email and primary color. Click **Save changes** after uploading. The version is a display label, not a software upgrade control.
- **Appearance templates:** choose Garden, Studio or Compact, then save. The saved template applies to the workspace and sign-in screen; other open browsers pick it up when refreshed.
- **People:** add employee or administrator accounts, disable/enable users and reset other users' passwords. The separate People navigation link remains available.
- **Security & policies:** manage meeting policies, notifications and the audit log.
- **My account:** enter the current password and confirm a new password of 12–128 characters. A successful change signs out every session for that account; sign in again with the new password. This does not change the ignored local test-accounts file.

Existing databases receive defaults for the new branding fields automatically. No schema migration is needed because workspace settings are stored as validated JSON.

## Meeting management

Open **Meetings → Manage** as an administrator to manage any meeting. Employees can manage meetings they host.

- **Reschedule meeting** edits a scheduled meeting's date/time and details while keeping its invitation links. Resend invitations to notify guests and send the updated calendar; changes do not automatically send emails.
- **Schedule again** creates a fresh scheduled meeting from a live, completed or cancelled meeting. It preserves the original meeting/history and host and generates fresh meeting credentials for the new occurrence. A live original meeting continues until ended or cancelled.
- **Delete meeting** permanently removes the meeting, invitations, guest sessions and attendance after confirmation. The audit event remains. Active media is disconnected, with automatic retry if the media server is temporarily unavailable.
- Check individual meeting rows, or use **Select all matching meetings**, then **Delete selected**. The confirmation lists exact titles, dates, statuses and count. Selection includes only manageable meetings in the current filtered list and resets when filters change. To delete all manageable meetings, choose **All**, clear filters/search, then select all and confirm. The API validates the entire selection before deleting anything; a database failure rolls back the whole batch. Slow media cleanup is retried without holding the deletion response indefinitely. Deleted rows/counts update immediately after success, and returning to a tab refreshes its list.
- Use **All / Upcoming / Recent**, title search and **Sort by date → Earliest first / Latest first** together. The list no longer silently truncates at 200 meetings.

In **Settings → My account → Change my email**, administrators can change their sign-in email after entering their current password. Addresses must be valid and unique (case-insensitive). Changing the email signs out all sessions; sign in again with the new email and the unchanged password. The account ID, role and hosted meetings remain intact. Existing invitations are not silently retargeted to a different email. Local sample-credentials files are not updated when account credentials change.

The meeting list also supports **Year** and **Month** filters and **Group by → Month / Year / No grouping**. These work with the status tabs, title search and date order. Calendar categories use the browser timezone shown above the results, including month/year boundaries. **Clear filters** resets the year, month and search. Administrators and hosts can use **Delete meeting** directly on a row, including completed meetings; confirmation names the meeting before deletion.

## Inviting people and joining

1. Schedule a meeting. **Invite people** opens automatically. Existing meetings also have an **Invite** button.
2. The link, meeting username and meeting password are already created. No guest email is required. The creator or an administrator can retrieve them; the password is masked until **Show password** is selected.
3. Choose **Copy invitation** to copy the meeting time, link, username, password and joining instructions. Paste it into your preferred messaging or email app. **Copy link only** does not include credentials, so provide them separately. **Open email app** prepares a draft; you send it yourself.
4. Guests open the link, enter the meeting username/password, then choose a display name and camera/microphone settings. **Join meeting** requests admission from the host when the waiting room is enabled. Each browser has its own guest identity, so several people can use the same link concurrently.

The meeting login is separate from staff account credentials. Guests do not gain workspace access. Share credentials only with intended attendees; shared credentials do not verify a person's real identity. Employees-only meetings still reject external guests. Signed-in hosts/admins can use **Open with my account**.

Meeting links stay the same when rescheduled. **Schedule again** creates new credentials. End/cancel/delete blocks new attendance; deleting a meeting also removes its stored credentials and guest sessions. Guests can preview early but cannot join until 15 minutes before the scheduled start. Calendar links return to the meeting sign-in page.

Links in the localhost preview work only on this computer. Guests on other devices need the deployed HTTPS site and reachable media server. SMTP invitations/reminders, if configured for optional email invitees, include the meeting login; copying does not send email.

Existing databases must run `alembic -c backend/alembic.ini upgrade head` before starting the updated API. Migration `3dc2e62bf010` revokes older password-free guest sessions and admission states; startup creates credentials for existing meetings. Staff account sessions are unaffected. Back up first and stop the API while migrating.
