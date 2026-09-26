import asyncio
import contextlib
import io
import logging
import secrets
from urllib.parse import urlparse, parse_qs
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from sqlalchemy import select, or_, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from livekit import api
from PIL import Image, UnidentifiedImageError
from .config import config
from .db import db_session, SessionLocal
from .models import User, LoginSession, Company, Meeting, Invitation, GuestSession, SharedGuestSession, MeetingCredentials, Participant, Audit, now, uid
from .schemas import LoginIn, UserIn, UserUpdate, PasswordIn, ChangePasswordIn, ChangeEmailIn, SettingsIn, MeetingIn, DeleteMeetingsIn, InviteIn, ExchangeIn, MeetingLoginIn, JoinIn, DecisionIn, LockIn, HandIn
from .security import passwords, DUMMY_HASH, digest, opaque, cipher, csrf, limit, current_user, user_optional, admin, guest_invitation, shared_guest, set_cookie
from . import media, mail

logger = logging.getLogger('skymeet')


def settings(db):
    company = db.get(Company, 1)
    return SettingsIn(**(company.settings if company else {})).model_dump(mode='json')


def audit(db, actor, action, target=''):
    db.add(Audit(actor=actor, action=action, target=target))


def user_json(user):
    return {'id': user.id, 'name': user.name, 'email': user.email, 'role': user.role, 'active': user.active}


def meeting_json(m):
    return {key: getattr(m, key) for key in ['id', 'host_id', 'title', 'description', 'starts', 'ends', 'timezone', 'status', 'guest_policy', 'waiting_room', 'locked', 'started_at', 'ended_at']}


def get_meeting(db, mid):
    meeting = db.get(Meeting, mid)
    if not meeting:
        raise HTTPException(404, 'Meeting not found.')
    return meeting


def require_host(user, meeting):
    if user.role != 'admin' and user.id != meeting.host_id:
        raise HTTPException(403, 'Only the host or an administrator can manage this meeting.')


def ensure_meeting_credentials(db, meeting):
    credentials = db.get(MeetingCredentials, meeting.id)
    if not credentials:
        password = secrets.token_urlsafe(12)
        credentials = MeetingCredentials(meeting_id=meeting.id, username='guest-' + secrets.token_hex(3),
            password_hash=passwords.hash(password), encrypted_password=cipher().encrypt(password.encode()).decode())
        db.add(credentials)
        db.flush()
    return credentials


def meeting_login_details(db, meeting):
    credentials = ensure_meeting_credentials(db, meeting)
    return {'join_url': config().app_origin + config().app_base_path + '/join/' + meeting.id,
            'username': credentials.username, 'password': cipher().decrypt(credentials.encrypted_password.encode()).decode()}


def verify_meeting_password(db, meeting, username, password):
    credentials = db.get(MeetingCredentials, meeting.id)
    valid = passwords.verify(password, credentials.password_hash if credentials else DUMMY_HASH)
    if not valid or not credentials or not secrets.compare_digest(username.strip().encode(), credentials.username.encode()):
        raise HTTPException(401, 'Meeting username or password is incorrect.')


def shared_participant_valid(db, participant):
    if participant.user_id or participant.invitation_id:
        return True
    return bool(db.scalar(select(SharedGuestSession).where(SharedGuestSession.meeting_id == participant.meeting_id,
        SharedGuestSession.identity == participant.identity, SharedGuestSession.expires > now())))


def access(request, db, meeting):
    # Guest sessions are scoped to one meeting and never inherit an employee role.
    inv = guest_invitation(request, db)
    user = user_optional(request, db)
    if user and (user.role == 'admin' or user.id == meeting.host_id):
        return user, None, 'u-' + user.id
    shared = shared_guest(request, db)
    if shared and shared.meeting_id == meeting.id:
        if not settings(db)['external_guests'] or meeting.guest_policy == 'disabled':
            raise HTTPException(403, 'External guests are disabled for this meeting.')
        return None, None, shared.identity
    if inv and inv.meeting_id == meeting.id:
        if not settings(db)['external_guests'] or meeting.guest_policy == 'disabled':
            raise HTTPException(403, 'External guests are disabled for this meeting.')
        return None, inv, 'g-' + inv.id
    if user:
        invited = db.scalar(select(Invitation).where(Invitation.meeting_id == meeting.id, Invitation.email == user.email, Invitation.revoked == False, Invitation.expires > now()))
        if invited:
            return user, invited, 'u-' + user.id
    raise HTTPException(403, 'Open your invitation link and enter the meeting login to continue.')


def check_time(m):
    if m.status in ('ended', 'cancelled') or now() >= m.ends + 1800:
        raise HTTPException(410, 'This meeting has ended or was cancelled.')
    if now() < m.starts - 900:
        raise HTTPException(403, 'The meeting opens 15 minutes before its scheduled start.')


def invitation_url(inv):
    raw = cipher().decrypt(inv.encrypted_token.encode()).decode()
    return config().app_origin + config().app_base_path + '/join#invite=' + raw


def new_invitation(db, meeting, email):
    raw = opaque()
    inv = Invitation(meeting_id=meeting.id, email=email.lower(), digest=digest(raw), encrypted_token=cipher().encrypt(raw.encode()).decode(), expires=meeting.ends + 1800)
    db.add(inv)
    db.flush()
    return inv


async def deliver(db, m, inv, reminder=False):
    try:
        details = meeting_login_details(db, m)
        mail_settings = {**settings(db), 'meeting_username': details['username'], 'meeting_password': details['password']}
        url = details['join_url'] if mail_settings['external_guests'] and m.guest_policy != 'disabled' else invitation_url(inv)
        status = await asyncio.to_thread(mail.send_invitation, m, inv, url, mail_settings, reminder)
    except Exception:
        logger.warning('SMTP delivery failed for invitation %s', inv.id)
        status = 'failed'
    audit(db, 'system', 'email.' + status, inv.id)
    db.commit()
    return {'id': inv.id, 'email': inv.email, 'join_url': invitation_url(inv), 'delivery': status}


async def reconcile_once():
    with SessionLocal() as db:
        for m in db.scalars(select(Meeting).where(Meeting.status.in_(['scheduled', 'active']))).all():
            if m.status in ('scheduled', 'active') and now() >= m.ends + 1800:
                m.status, m.ended_at = 'ended', now()
                audit(db, 'system', 'meeting.timeout', m.id)
                db.commit()
        # Keep reconciling actual SFU rooms indefinitely after an API outage.
        # A fixed retry window could otherwise leave an ended room running.
        try:
            for mid, identities in await media.snapshot():
                m = db.get(Meeting, mid)
                if not m or m.status in ('ended', 'cancelled') or now() >= m.ends + 1800:
                    await media.end(mid)
                    continue
                for identity in identities:
                    p = db.scalar(select(Participant).where(Participant.meeting_id == mid, Participant.identity == identity))
                    invalid = not p or p.decision != 'admitted' or not shared_participant_valid(db, p)
                    if p and p.user_id:
                        u = db.get(User, p.user_id)
                        invalid |= not u or not u.active
                    if p and p.invitation_id:
                        inv = db.get(Invitation, p.invitation_id)
                        invalid |= not inv or inv.revoked or inv.expires <= now()
                    if p and not p.user_id:
                        invalid |= not settings(db)['external_guests'] or m.guest_policy == 'disabled'
                    if invalid:
                        await media.remove(mid, identity)
                        if p:
                            p.connected = False
        except Exception:
            logger.warning('Media reconciliation unavailable; retrying in 15 seconds')
        cfg = settings(db)
        if cfg['reminders_enabled'] and cfg['email_enabled']:
            due = db.scalars(select(Invitation).join(Meeting).where(Invitation.revoked == False, Invitation.reminder_sent == False, Meeting.status == 'scheduled', Meeting.starts > now(), Meeting.starts <= now() + cfg['reminder_minutes'] * 60)).all()
            for inv in due:
                result = await deliver(db, db.get(Meeting, inv.meeting_id), inv, True)
                inv.reminder_sent = result['delivery'] == 'sent'
        db.execute(delete(LoginSession).where(LoginSession.expires < now()))
        db.execute(delete(GuestSession).where(GuestSession.expires < now()))
        db.execute(delete(SharedGuestSession).where(SharedGuestSession.expires < now()))
        db.commit()


async def worker():
    while True:
        try:
            await reconcile_once()
        except Exception:
            logger.warning('Meeting reconciliation failed; retrying in 15 seconds', exc_info=True)
        await asyncio.sleep(15)


@asynccontextmanager
async def lifespan(app):
    with SessionLocal() as db:
        for meeting in db.scalars(select(Meeting).outerjoin(MeetingCredentials).where(MeetingCredentials.meeting_id == None)).all():
            ensure_meeting_credentials(db, meeting)
        db.commit()
    task = asyncio.create_task(worker())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title='Sky Meet API', version='1.0.0', lifespan=lifespan)


@app.get('/api/media/authorize', include_in_schema=False)
def media_authorize(request: Request, db: Session = Depends(db_session)):
    """Caddy forward_auth gates every fresh signaling connection, including replayed SDK refresh tokens."""
    original = request.headers.get('x-forwarded-uri', '')
    query = parse_qs(urlparse(original).query)
    auth = request.headers.get('authorization', '')
    raw = query.get('access_token', [''])[0] or auth.removeprefix('Bearer ')
    try:
        claims = api.TokenVerifier(config().livekit_api_key, config().livekit_api_secret).verify(raw)
        room = claims.video.room
        identity = claims.identity
    except Exception:
        raise HTTPException(401, 'A valid media token is required.')
    if not room or not room.startswith('sky-'):
        raise HTTPException(403, 'Invalid meeting scope.')
    m = get_meeting(db, room.removeprefix('sky-'))
    check_time(m)
    p = db.scalar(select(Participant).where(Participant.meeting_id == m.id, Participant.identity == identity))
    if not p or p.decision != 'admitted':
        raise HTTPException(403, 'Media admission was revoked.')
    if not shared_participant_valid(db, p):
        raise HTTPException(403, 'Meeting login expired. Enter the meeting credentials again.')
    u = db.get(User, p.user_id) if p.user_id else None
    host = bool(u and u.active and (u.id == m.host_id or u.role == 'admin'))
    if m.locked and not host and not p.connected:
        raise HTTPException(403, 'The room is locked.')
    if p.user_id and (not u or not u.active):
        raise HTTPException(403, 'This account is disabled.')
    if p.invitation_id:
        inv = db.get(Invitation, p.invitation_id)
        if not inv or inv.revoked or inv.expires <= now():
            raise HTTPException(403, 'Invitation revoked or expired.')
    if not p.user_id and (not settings(db)['external_guests'] or m.guest_policy == 'disabled'):
        raise HTTPException(403, 'Guest access is disabled.')
    return Response(status_code=200)


@app.middleware('http')
async def security_headers(request: Request, call_next):
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.url.path != '/api/livekit/webhook':
        if request.headers.get('origin') != config().app_origin:
            return JSONResponse({'error': 'Untrusted request origin.'}, 403)
        meeting_login = request.url.path.startswith('/api/guest/meeting/') and request.url.path.endswith('/login')
        if request.url.path not in ('/api/auth/login', '/api/guest/exchange') and not meeting_login:
            raw = request.cookies.get('sky_session') or request.cookies.get('sky_shared') or request.cookies.get('sky_guest')
            # Either currently held session can authorize the CSRF proof; access checks are separate.
            cookies = [request.cookies.get(n, '') for n in ('sky_session', 'sky_shared', 'sky_guest')]
            proof = request.headers.get('x-csrf-token', '')
            if not raw or not any(c and secrets.compare_digest(csrf(c), proof) for c in cookies):
                return JSONResponse({'error': 'Session security check failed. Reload and try again.'}, 403)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Frame-Options'] = 'DENY'
    return response


@app.exception_handler(HTTPException)
async def http_error(_, exc):
    return JSONResponse({'error': exc.detail}, exc.status_code, headers=exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(_, exc):
    return JSONResponse({'error': '; '.join('.'.join(str(x) for x in e['loc'][1:]) + ': ' + e['msg'] for e in exc.errors())}, 422)


@app.exception_handler(IntegrityError)
async def conflict(_, exc):
    return JSONResponse({'error': 'This item already exists or conflicts with another update.'}, 409)


@app.get('/api/health')
def health(db: Session = Depends(db_session)):
    db.execute(select(Company.id)).first()
    return {'status': 'ok', 'recording': 'disabled'}


@app.get('/api/branding')
def branding(db: Session = Depends(db_session)):
    return settings(db)


@app.post('/api/auth/login')
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(db_session)):
    limit(request, 'login', 8)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    valid = passwords.verify(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid or not user.active:
        audit(db, 'anonymous', 'login.failed')
        db.commit()
        raise HTTPException(401, 'Email or password is incorrect.')
    raw = opaque()
    db.add(LoginSession(digest=digest(raw), user_id=user.id, expires=now() + 43200))
    audit(db, user.id, 'login.success')
    db.commit()
    set_cookie(response, 'sky_session', raw, 43200)
    return {'user': user_json(user), 'csrf': csrf(raw)}


@app.get('/api/auth/me')
def me(request: Request, db: Session = Depends(db_session)):
    user = user_optional(request, db)
    raw = request.cookies.get('sky_session', '') if user else request.cookies.get('sky_shared', '') or request.cookies.get('sky_guest', '')
    return {'user': user_json(user) if user else None, 'csrf': csrf(raw) if raw else ''}


@app.post('/api/auth/logout')
def logout(request: Request, response: Response, db: Session = Depends(db_session)):
    db.execute(delete(LoginSession).where(LoginSession.digest == digest(request.cookies.get('sky_session', ''))))
    db.execute(delete(GuestSession).where(GuestSession.digest == digest(request.cookies.get('sky_guest', ''))))
    db.execute(delete(SharedGuestSession).where(SharedGuestSession.digest == digest(request.cookies.get('sky_shared', ''))))
    db.commit()
    response.delete_cookie('sky_session')
    response.delete_cookie('sky_guest')
    response.delete_cookie('sky_shared')
    return {'ok': True}


@app.get('/api/admin/users')
def users(_: User = Depends(admin), db: Session = Depends(db_session)):
    return [user_json(u) for u in db.scalars(select(User).order_by(User.name))]


@app.post('/api/admin/account/email')
def change_email(body: ChangeEmailIn, request: Request, response: Response, actor: User = Depends(admin), db: Session = Depends(db_session)):
    limit(request, 'change-email', 5)
    if not passwords.verify(body.current_password, actor.password_hash):
        raise HTTPException(400, 'Current password is incorrect.')
    email = str(body.email).lower()
    if email == actor.email:
        raise HTTPException(422, 'Enter a different email address.')
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, 'This email address is already in use.')
    actor.email = email
    db.execute(delete(LoginSession).where(LoginSession.user_id == actor.id))
    audit(db, actor.id, 'account.email_changed', actor.id)
    db.commit()
    response.delete_cookie('sky_session', path='/')
    return {'ok': True}


@app.post('/api/admin/account/password')
def change_password(body: ChangePasswordIn, request: Request, response: Response, actor: User = Depends(admin), db: Session = Depends(db_session)):
    limit(request, 'change-password', 5)
    if not passwords.verify(body.current_password, actor.password_hash):
        raise HTTPException(400, 'Current password is incorrect.')
    if body.password == body.current_password:
        raise HTTPException(422, 'Choose a different new password.')
    actor.password_hash = passwords.hash(body.password)
    db.execute(delete(LoginSession).where(LoginSession.user_id == actor.id))
    audit(db, actor.id, 'account.password_changed', actor.id)
    db.commit()
    response.delete_cookie('sky_session', path='/')
    return {'ok': True}


@app.post('/api/admin/users', status_code=201)
def create_user(body: UserIn, actor: User = Depends(admin), db: Session = Depends(db_session)):
    user = User(email=body.email.lower(), name=body.name, role=body.role, password_hash=passwords.hash(body.password))
    db.add(user)
    db.flush()
    audit(db, actor.id, 'user.created', user.id)
    db.commit()
    return user_json(user)


@app.patch('/api/admin/users/{uid}')
async def update_user(uid: str, body: UserUpdate, actor: User = Depends(admin), db: Session = Depends(db_session)):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, 'User not found.')
    if uid == actor.id:
        raise HTTPException(409, 'You cannot disable your own administrator account.')
    u.active = body.active
    if not u.active:
        db.execute(delete(LoginSession).where(LoginSession.user_id == uid))
        for p in db.scalars(select(Participant).where(Participant.user_id == uid)):
            p.decision = 'removed'
    audit(db, actor.id, 'user.enabled' if body.active else 'user.disabled', uid)
    db.commit()
    return user_json(u)


@app.post('/api/admin/users/{uid}/password')
def reset_password(uid: str, body: PasswordIn, actor: User = Depends(admin), db: Session = Depends(db_session)):
    if uid == actor.id:
        raise HTTPException(409, 'Use Settings → My account to change your own password.')
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, 'User not found.')
    u.password_hash = passwords.hash(body.password)
    db.execute(delete(LoginSession).where(LoginSession.user_id == uid))
    audit(db, actor.id, 'user.password_reset', uid)
    db.commit()
    return {'ok': True}


@app.put('/api/admin/settings')
def save_settings(body: SettingsIn, actor: User = Depends(admin), db: Session = Depends(db_session)):
    if body.email_enabled and not config().smtp_host:
        raise HTTPException(422, 'Configure server-side SMTP_HOST before enabling invitations.')
    company = db.get(Company, 1)
    if not company:
        company = Company(id=1)
        db.add(company)
    company.settings = body.model_dump(mode='json')
    audit(db, actor.id, 'settings.updated')
    db.commit()
    return company.settings


@app.get('/api/admin/audit')
def audit_list(_: User = Depends(admin), db: Session = Depends(db_session)):
    return [{'at': x.at, 'actor': x.actor, 'action': x.action, 'target': x.target} for x in db.scalars(select(Audit).order_by(Audit.at.desc()).limit(100))]


@app.post('/api/admin/assets')
async def upload_asset(file: UploadFile, actor: User = Depends(admin), db: Session = Depends(db_session)):
    raw = await file.read(2_000_001)
    if len(raw) > 2_000_000:
        raise HTTPException(413, 'Choose an image smaller than 2 MB.')
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if im.format not in ('PNG', 'JPEG', 'WEBP') or im.width * im.height > 4_000_000:
                raise ValueError()
            im.load()
            im.thumbnail((1024, 1024))
            image = im.convert('RGBA')
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(422, 'Use a PNG, JPEG or WebP image up to 4 megapixels.')
    folder = Path(config().asset_dir)
    folder.mkdir(parents=True, exist_ok=True)
    filename = secrets.token_hex(16) + '.png'
    image.save(folder / filename, 'PNG')
    audit(db, actor.id, 'asset.uploaded', filename)
    db.commit()
    return {'url': '/api/assets/' + filename}


@app.get('/api/assets/{filename}')
def asset(filename: str):
    import re
    if not re.fullmatch(r'[a-f0-9]{32}\.png', filename):
        raise HTTPException(404, 'Asset not found.')
    path = Path(config().asset_dir) / filename
    if not path.is_file():
        raise HTTPException(404, 'Asset not found.')
    return FileResponse(path, media_type='image/png')


@app.get('/api/meetings')
def meetings(user: User = Depends(current_user), db: Session = Depends(db_session)):
    query = select(Meeting)
    if user.role != 'admin':
        invited = select(Invitation.meeting_id).where(Invitation.email == user.email, Invitation.revoked == False, Invitation.expires > now())
        query = query.where(or_(Meeting.host_id == user.id, Meeting.id.in_(invited)))
    return [meeting_json(m) for m in db.scalars(query.order_by(Meeting.starts.desc(), Meeting.id))]


@app.post('/api/meetings', status_code=201)
async def create_meeting(body: MeetingIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    cfg = settings(db)
    if user.role != 'admin' and not cfg['employees_can_create']:
        raise HTTPException(403, 'Employees cannot create meetings under the current policy.')
    host_id = body.host_id or user.id
    if host_id != user.id and user.role != 'admin':
        raise HTTPException(403, 'Only administrators can assign another host.')
    host = db.get(User, host_id)
    if not host or not host.active:
        raise HTTPException(422, 'Choose an active employee as host.')
    if body.ends_at.timestamp() <= now():
        raise HTTPException(422, 'Meeting end time must be in the future.')
    m = Meeting(host_id=host_id, title=body.title, description=body.description, starts=int(body.starts_at.timestamp()), ends=int(body.ends_at.timestamp()), timezone=body.timezone, guest_policy=body.guest_policy, waiting_room=body.waiting_room or cfg['waiting_room'])
    db.add(m)
    db.flush()
    ensure_meeting_credentials(db, m)
    invites = [new_invitation(db, m, str(email)) for email in dict.fromkeys(body.invited_emails)]
    audit(db, user.id, 'meeting.created', m.id)
    db.commit()
    deliveries = [await deliver(db, m, inv) for inv in invites]
    return {**meeting_json(m), 'invitations': deliveries}


@app.get('/api/meetings/{mid}')
def meeting_detail(mid: str, request: Request, db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    u, _, identity = access(request, db, m)
    return {**meeting_json(m), 'is_host': bool(u and (u.id == m.host_id or u.role == 'admin')), 'identity': identity}


@app.put('/api/meetings/{mid}')
async def edit_meeting(mid: str, body: MeetingIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    require_host(user, m)
    if m.status != 'scheduled':
        raise HTTPException(409, 'Only scheduled meetings can be edited.')
    if body.ends_at.timestamp() <= now():
        raise HTTPException(422, 'Meeting end time must be in the future.')
    if body.host_id and body.host_id != m.host_id:
        raise HTTPException(422, 'Host reassignment is only supported when creating a meeting.')
    m.title, m.description, m.timezone = body.title, body.description, body.timezone
    m.starts, m.ends = int(body.starts_at.timestamp()), int(body.ends_at.timestamp())
    m.guest_policy, m.waiting_room = body.guest_policy, body.waiting_room or settings(db)['waiting_room']
    for inv in db.scalars(select(Invitation).where(Invitation.meeting_id == mid, Invitation.revoked == False)):
        inv.expires, inv.reminder_sent = m.ends + 1800, False
    audit(db, user.id, 'meeting.updated', mid)
    db.commit()
    return meeting_json(m)


def erase_meetings(db, ids, actor):
    # One transaction, including audit records; chunks stay below SQLite bind limits.
    for offset in range(0, len(ids), 500):
        chunk = ids[offset:offset + 500]
        invitations = select(Invitation.id).where(Invitation.meeting_id.in_(chunk))
        db.execute(delete(Participant).where(Participant.meeting_id.in_(chunk)))
        db.execute(delete(SharedGuestSession).where(SharedGuestSession.meeting_id.in_(chunk)))
        db.execute(delete(MeetingCredentials).where(MeetingCredentials.meeting_id.in_(chunk)))
        db.execute(delete(GuestSession).where(GuestSession.invitation_id.in_(invitations)))
        db.execute(delete(Invitation).where(Invitation.meeting_id.in_(chunk)))
        db.execute(delete(Meeting).where(Meeting.id.in_(chunk)))
        for mid in chunk:
            audit(db, actor, 'meeting.deleted', mid)
    db.commit()


async def cleanup_deleted_rooms(ids):
    # A slow SFU must not leave the UI waiting indefinitely after the DB commit.
    # The reconciler keeps retrying any orphaned rooms after failure or timeout.
    semaphore = asyncio.Semaphore(8)
    async def cleanup(mid):
        async with semaphore:
            try:
                await media.end(mid)
                return False
            except Exception:
                logger.warning('Deleted meeting media cleanup queued for %s', mid)
                return True
    try:
        async with asyncio.timeout(3):
            return any(await asyncio.gather(*(cleanup(mid) for mid in ids)))
    except TimeoutError:
        return True


@app.post('/api/meetings/bulk-delete')
async def delete_meetings(body: DeleteMeetingsIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    requested = list(dict.fromkeys(str(mid) for mid in body.meeting_ids))
    found = []
    for offset in range(0, len(requested), 500):
        found.extend(db.scalars(select(Meeting).where(Meeting.id.in_(requested[offset:offset + 500]))).all())
    # Validate the entire selection before deleting anything.
    for meeting in found:
        require_host(user, meeting)
    ids = [m.id for m in found]
    erase_meetings(db, ids, user.id)
    pending = await cleanup_deleted_rooms(ids)
    return {'deleted_ids': ids, 'already_deleted_ids': sorted(set(requested) - set(ids)), 'media_cleanup_pending': pending}


@app.delete('/api/meetings/{mid}')
async def delete_meeting(mid: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    require_host(user, m)
    erase_meetings(db, [mid], user.id)
    return {'ok': True, 'media_cleanup_pending': await cleanup_deleted_rooms([mid])}


@app.get('/api/meetings/{mid}/calendar')
def download_calendar(mid: str, request: Request, db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    user, inv, _ = access(request, db, m)
    link = invitation_url(inv) if inv and not user else config().app_origin + config().app_base_path + '/join/' + mid
    return Response(mail.calendar(m, link), media_type='text/calendar', headers={'Content-Disposition': 'attachment; filename="meeting.ics"'})


@app.get('/api/meetings/{mid}/invitations')
def invitations(mid: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
    require_host(user, get_meeting(db, mid))
    return [{'id': i.id, 'email': i.email, 'revoked': i.revoked, 'expires': i.expires} for i in db.scalars(select(Invitation).where(Invitation.meeting_id == mid))]


@app.get('/api/meetings/{mid}/sharing')
def sharing(mid: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    require_host(user, m)
    cfg = settings(db)
    login_details = meeting_login_details(db, m)
    db.commit()
    return {
        **login_details,
        'meeting': meeting_json(m),
        'email_ready': bool(cfg['email_enabled'] and config().smtp_host),
        'local_only': urlparse(config().app_origin).hostname in ('localhost', '127.0.0.1', '::1'),
        'guests_allowed': cfg['external_guests'] and m.guest_policy != 'disabled',
        'waiting_room': m.waiting_room or cfg['waiting_room'],
        'closed': m.status in ('ended', 'cancelled') or now() >= m.ends + 1800,
    }


@app.get('/api/meetings/{mid}/invitations/{iid}/link')
def invitation_link(mid: str, iid: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    require_host(user, m)
    inv = db.get(Invitation, iid)
    if m.status in ('ended', 'cancelled') or now() >= m.ends + 1800:
        raise HTTPException(410, 'This meeting is closed.')
    if not inv or inv.meeting_id != mid or inv.revoked or inv.expires <= now():
        raise HTTPException(404, 'Active invitation not found.')
    return {'id': inv.id, 'email': inv.email, 'join_url': invitation_url(inv)}


@app.post('/api/meetings/{mid}/invitations')
async def invite(mid: str, body: InviteIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    require_host(user, m)
    if m.status in ('ended', 'cancelled') or now() >= m.ends + 1800:
        raise HTTPException(410, 'This meeting is closed.')
    inv = new_invitation(db, m, str(body.email))
    audit(db, user.id, 'invitation.created', inv.id)
    db.commit()
    if not body.send_email:
        return {'id': inv.id, 'email': inv.email, 'join_url': invitation_url(inv), 'delivery': 'not_requested'}
    return await deliver(db, m, inv)


@app.post('/api/meetings/{mid}/invitations/{iid}/resend')
async def resend(mid: str, iid: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    require_host(user, m)
    if m.status in ('ended', 'cancelled') or now() >= m.ends + 1800:
        raise HTTPException(410, 'This meeting is closed.')
    inv = db.get(Invitation, iid)
    if not inv or inv.meeting_id != mid or inv.revoked or inv.expires <= now():
        raise HTTPException(404, 'Active invitation not found.')
    return await deliver(db, m, inv)


@app.delete('/api/meetings/{mid}/invitations/{iid}')
async def revoke(mid: str, iid: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
    require_host(user, get_meeting(db, mid))
    inv = db.get(Invitation, iid)
    if not inv or inv.meeting_id != mid:
        raise HTTPException(404, 'Invitation not found.')
    inv.revoked = True
    people = db.scalars(select(Participant).where(Participant.invitation_id == iid)).all()
    for p in people:
        p.decision = 'removed'
    audit(db, user.id, 'invitation.revoked', iid)
    db.commit()
    for p in people:
        try:
            await media.remove(mid, p.identity)
        except Exception:
            logger.warning('Revocation cleanup queued for %s', p.id)
    return {'ok': True}


@app.post('/api/guest/exchange')
def exchange(body: ExchangeIn, request: Request, response: Response, db: Session = Depends(db_session)):
    limit(request, 'exchange', 15)
    inv = db.scalar(select(Invitation).where(Invitation.digest == digest(body.token)))
    if not inv or inv.revoked or inv.expires <= now():
        raise HTTPException(403, 'This invitation is invalid, expired or revoked. Contact your host.')
    m = get_meeting(db, inv.meeting_id)
    user = user_optional(request, db)
    if user and user.email == inv.email and m.status not in ('ended', 'cancelled'):
        return {'meeting_id': m.id, 'csrf': csrf(request.cookies['sky_session'])}
    if m.status in ('ended', 'cancelled') or not settings(db)['external_guests'] or m.guest_policy == 'disabled':
        raise HTTPException(403, 'This meeting is not accepting external guests.')
    if not body.username or not body.password:
        return {'requires_credentials': True, 'meeting_id': m.id}
    verify_meeting_password(db, m, body.username, body.password)
    raw = opaque()
    db.add(GuestSession(digest=digest(raw), invitation_id=inv.id, expires=inv.expires))
    audit(db, 'guest', 'invitation.exchanged', inv.id)
    db.commit()
    set_cookie(response, 'sky_guest', raw, max(1, inv.expires - now()))
    return {'meeting_id': m.id, 'csrf': csrf(raw)}


@app.get('/api/guest/meeting/{mid}')
def meeting_entry(mid: str, db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    return {'id': m.id, 'title': m.title, 'starts': m.starts, 'ends': m.ends,
        'closed': m.status in ('ended', 'cancelled') or now() >= m.ends + 1800,
        'guests_allowed': settings(db)['external_guests'] and m.guest_policy != 'disabled'}


@app.post('/api/guest/meeting/{mid}/login')
def shared_meeting_login(mid: str, body: MeetingLoginIn, request: Request, response: Response, db: Session = Depends(db_session)):
    limit(request, 'meeting-login', 30)
    limit(request, 'meeting-login-' + mid, 10)
    m = get_meeting(db, mid)
    if m.status in ('ended', 'cancelled') or now() >= m.ends + 1800:
        raise HTTPException(410, 'This meeting is closed.')
    if not settings(db)['external_guests'] or m.guest_policy == 'disabled':
        raise HTTPException(403, 'External guests are disabled for this meeting.')
    verify_meeting_password(db, m, body.username, body.password)
    if m.locked:
        raise HTTPException(403, 'The room is locked. Ask the host to unlock it.')
    session = shared_guest(request, db)
    if session and session.meeting_id == mid:
        p = db.scalar(select(Participant).where(Participant.meeting_id == mid, Participant.identity == session.identity))
        if p and p.decision in ('denied', 'removed'):
            raise HTTPException(403, 'The host has denied or removed your access.')
        raw = request.cookies['sky_shared']
    else:
        raw = opaque()
        session = SharedGuestSession(digest=digest(raw), meeting_id=mid, identity='s-' + uid(), expires=min(m.ends + 1800, now() + 43200))
        db.add(session)
    audit(db, session.identity, 'meeting.guest_login', mid)
    db.commit()
    set_cookie(response, 'sky_shared', raw, session.expires - now())
    return {'meeting_id': mid, 'csrf': csrf(raw)}


@app.post('/api/meetings/{mid}/join')
def join(mid: str, body: JoinIn, request: Request, db: Session = Depends(db_session)):
    limit(request, 'join', 60)
    m = get_meeting(db, mid)
    u, inv, identity = access(request, db, m)
    check_time(m)
    host = bool(u and (u.id == m.host_id or u.role == 'admin'))
    p = db.scalar(select(Participant).where(Participant.meeting_id == mid, Participant.identity == identity))
    if p and p.decision in ('denied', 'removed'):
        raise HTTPException(403, 'The host has denied or removed your access.')
    if m.locked and not host:
        raise HTTPException(403, 'The room is locked. Ask the host to unlock it.')
    if not p:
        p = Participant(meeting_id=mid, identity=identity, user_id=u.id if u else None, invitation_id=inv.id if inv else None, name=body.name.strip() or 'Guest', decision='admitted' if host or not (m.waiting_room or settings(db)['waiting_room']) else 'waiting')
        db.add(p)
        db.flush()
        audit(db, identity, 'participant.requested', mid)
    else:
        p.name = body.name.strip() or p.name
    db.commit()
    return {'decision': p.decision, 'participant_id': p.id}


@app.post('/api/meetings/{mid}/token')
def issue_token(mid: str, request: Request, db: Session = Depends(db_session)):
    limit(request, 'token', 60)
    m = get_meeting(db, mid)
    u, _, identity = access(request, db, m)
    check_time(m)
    host = bool(u and (u.id == m.host_id or u.role == 'admin'))
    if m.locked and not host:
        raise HTTPException(403, 'The room is locked.')
    p = db.scalar(select(Participant).where(Participant.meeting_id == mid, Participant.identity == identity))
    if not p or p.decision != 'admitted':
        raise HTTPException(403, 'Wait for the host to admit you.')
    audit(db, identity, 'token.issued', mid)
    db.commit()
    return {'token': media.token(m, p), 'url': config().livekit_url}


@app.get('/api/meetings/{mid}/participants')
def participants(mid: str, request: Request, db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    u, _, identity = access(request, db, m)
    host = bool(u and (u.id == m.host_id or u.role == 'admin'))
    people = db.scalars(select(Participant).where(Participant.meeting_id == mid)).all()
    own = next((p for p in people if p.identity == identity), None)
    return [{'id': p.id, 'identity': p.identity, 'name': p.name, 'decision': p.decision, 'connected': p.connected, 'raised': p.raised} for p in people if host or p.identity == identity or (own and own.decision == 'admitted' and p.decision == 'admitted')]


@app.post('/api/meetings/{mid}/participants/{pid}/decision')
async def decide(mid: str, pid: str, body: DecisionIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    require_host(user, m)
    check_time(m)
    p = db.get(Participant, pid)
    if not p or p.meeting_id != mid:
        raise HTTPException(404, 'Participant not found.')
    if p.user_id == m.host_id:
        raise HTTPException(409, 'The host cannot be removed from their meeting.')
    p.decision = body.decision
    audit(db, user.id, 'participant.' + body.decision, pid)
    db.commit()
    if body.decision in ('denied', 'removed'):
        try:
            await media.remove(mid, p.identity)
        except Exception:
            raise HTTPException(503, 'Access revoked; media removal will retry within 15 seconds.')
    return {'ok': True}


@app.post('/api/meetings/{mid}/participants/{pid}/mute')
async def mute(mid: str, pid: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
    require_host(user, get_meeting(db, mid))
    p = db.get(Participant, pid)
    if not p or p.meeting_id != mid:
        raise HTTPException(404, 'Participant not found.')
    try:
        await media.mute(mid, p.identity)
    except Exception:
        raise HTTPException(503, 'Unable to mute. The participant may have disconnected.')
    audit(db, user.id, 'participant.muted', pid)
    db.commit()
    return {'ok': True}


@app.post('/api/meetings/{mid}/hand')
def hand(mid: str, body: HandIn, request: Request, db: Session = Depends(db_session)):
    _, _, identity = access(request, db, get_meeting(db, mid))
    p = db.scalar(select(Participant).where(Participant.meeting_id == mid, Participant.identity == identity, Participant.decision == 'admitted'))
    if not p:
        raise HTTPException(403, 'Join the meeting first.')
    p.raised = body.raised
    db.commit()
    return {'ok': True}


@app.post('/api/meetings/{mid}/lock')
def lock(mid: str, body: LockIn, user: User = Depends(current_user), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    require_host(user, m)
    m.locked = body.locked
    audit(db, user.id, 'meeting.locked' if body.locked else 'meeting.unlocked', mid)
    db.commit()
    return meeting_json(m)


@app.post('/api/meetings/{mid}/open')
async def open_meeting(mid: str, user: User = Depends(admin), db: Session = Depends(db_session)):
    m = get_meeting(db, mid)
    stamp = now()
    # Do not reset participants or the clock when an already-running call is opened.
    if m.status == 'active' and m.starts - 900 <= stamp < m.ends + 1800:
        m.waiting_room = True
        db.commit()
        return meeting_json(m)
    closed = m.status in ('ended', 'cancelled') or stamp >= m.ends + 1800
    if closed:
        try:
            await asyncio.wait_for(media.end(mid), timeout=3)
        except Exception:
            raise HTTPException(503, 'Unable to close the previous call. Try opening the meeting again.')
        # Reopening requires fresh guest authentication and fresh admission.
        invitations = select(Invitation.id).where(Invitation.meeting_id == mid)
        db.execute(delete(GuestSession).where(GuestSession.invitation_id.in_(invitations)))
        db.execute(delete(SharedGuestSession).where(SharedGuestSession.meeting_id == mid))
        db.execute(delete(Participant).where(Participant.meeting_id == mid))
    duration = max(60, min(m.ends - m.starts, 8 * 3600))
    m.starts, m.ends = stamp, stamp + duration
    m.status, m.started_at, m.ended_at = 'scheduled', None, None
    m.locked, m.waiting_room = False, True
    for inv in db.scalars(select(Invitation).where(Invitation.meeting_id == mid, Invitation.revoked == False)):
        inv.expires, inv.reminder_sent = m.ends + 1800, False
    for session in db.scalars(select(SharedGuestSession).where(SharedGuestSession.meeting_id == mid)):
        session.expires = min(m.ends + 1800, stamp + 43200)
    audit(db, user.id, 'meeting.reopened' if closed else 'meeting.opened', mid)
    db.commit()
    return meeting_json(m)


@app.post('/api/meetings/{mid}/{action}')
async def close_meeting(mid: str, action: str, user: User = Depends(current_user), db: Session = Depends(db_session)):
    if action not in ('end', 'cancel'):
        raise HTTPException(404, 'Unknown action.')
    m = get_meeting(db, mid)
    require_host(user, m)
    m.status, m.ended_at = ('ended' if action == 'end' else 'cancelled'), now()
    audit(db, user.id, 'meeting.' + m.status, mid)
    db.commit()
    try:
        await media.end(mid)
    except Exception:
        raise HTTPException(503, 'Meeting closed; disconnecting media will retry within 15 seconds.')
    return meeting_json(m)


@app.post('/api/livekit/webhook')
async def webhook(request: Request, db: Session = Depends(db_session)):
    body = await request.body()
    if len(body) > 1_000_000:
        raise HTTPException(413, 'Webhook too large.')
    cfg = config()
    try:
        event = api.WebhookReceiver(api.TokenVerifier(cfg.livekit_api_key, cfg.livekit_api_secret)).receive(body.decode(), request.headers.get('authorization', ''))
    except Exception:
        raise HTTPException(401, 'Invalid webhook signature.')
    event_id = 'webhook-' + (event.id or digest(body.decode()))
    if db.get(Audit, event_id):
        return {'ok': True}
    mid = event.room.name.removeprefix('sky-')
    m = db.get(Meeting, mid)
    p = db.scalar(select(Participant).where(Participant.meeting_id == mid, Participant.identity == event.participant.identity)) if m else None
    if event.event == 'participant_joined':
        invalid = not m or m.status in ('ended', 'cancelled') or now() >= m.ends + 1800 or not p or p.decision != 'admitted'
        if p:
            invalid |= not shared_participant_valid(db, p)
        if p and p.invitation_id:
            inv = db.get(Invitation, p.invitation_id)
            invalid |= not inv or inv.revoked or inv.expires <= now()
        if p and p.user_id:
            u = db.get(User, p.user_id)
            invalid |= not u or not u.active
        if p and not p.user_id and m:
            invalid |= not settings(db)['external_guests'] or m.guest_policy == 'disabled'
        if invalid:
            await media.remove(mid, event.participant.identity)
        elif p:
            p.connected, p.joined_at = True, p.joined_at or now()
            m.status, m.started_at = 'active', m.started_at or now()
    elif event.event == 'participant_left' and p:
        p.connected, p.left_at = False, now()
    # An empty room is not the end of the meeting. Reconnects remain possible.
    db.add(Audit(id=event_id, actor='livekit', action=event.event, target=mid))
    db.commit()
    return {'ok': True}
