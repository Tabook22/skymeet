import base64
import hashlib
import hmac
import secrets
from collections import defaultdict, deque
from threading import Lock
from fastapi import HTTPException, Request, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select
from pwdlib import PasswordHash
from cryptography.fernet import Fernet
from .config import config
from .db import db_session
from .models import User, LoginSession, GuestSession, SharedGuestSession, Invitation, now

passwords = PasswordHash.recommended()
DUMMY_HASH = passwords.hash('timing-defense-dummy-password')
_buckets = defaultdict(deque)
_lock = Lock()


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


def opaque():
    return secrets.token_urlsafe(32)


def cipher():
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(config().app_secret.encode()).digest()))


def csrf(raw):
    return hmac.new(config().app_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()


def limit(request: Request, scope: str, count=20, seconds=60):
    key = (request.client.host if request.client else 'unknown', scope)
    with _lock:
        t = now()
        for k in list(_buckets):
            if not _buckets[k] or _buckets[k][-1] <= t - seconds:
                del _buckets[k]
        q = _buckets[key]
        while q and q[0] <= t - seconds:
            q.popleft()
        if len(q) >= count:
            raise HTTPException(429, 'Too many attempts. Try again in a minute.', headers={'Retry-After': '60'})
        q.append(t)


def user_optional(request: Request, db: Session):
    raw = request.cookies.get('sky_session', '')
    session = db.get(LoginSession, digest(raw)) if raw else None
    user = db.get(User, session.user_id) if session and session.expires > now() else None
    return user if user and user.active else None


def current_user(request: Request, db: Session = Depends(db_session)):
    user = user_optional(request, db)
    if not user:
        raise HTTPException(401, 'Sign in to continue.')
    return user


def admin(user: User = Depends(current_user)):
    if user.role != 'admin':
        raise HTTPException(403, 'Administrator access required.')
    return user


def guest_invitation(request, db):
    raw = request.cookies.get('sky_guest', '')
    session = db.get(GuestSession, digest(raw)) if raw else None
    invitation = db.get(Invitation, session.invitation_id) if session and session.expires > now() else None
    if invitation and not invitation.revoked and invitation.expires > now():
        return invitation
    return None


def shared_guest(request, db):
    raw = request.cookies.get('sky_shared', '')
    session = db.get(SharedGuestSession, digest(raw)) if raw else None
    return session if session and session.expires > now() else None


def set_cookie(response, name, raw, max_age):
    response.set_cookie(name, raw, max_age=max_age, httponly=True, secure=config().production, samesite='strict', path='/')
