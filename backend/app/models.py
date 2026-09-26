import time
import uuid
from sqlalchemy import String, Integer, Boolean, ForeignKey, JSON, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def uid():
    return str(uuid.uuid4())


def now():
    return int(time.time())


class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(16), default='employee')
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class LoginSession(Base):
    __tablename__ = 'sessions'
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    expires: Mapped[int] = mapped_column(Integer)


class Company(Base):
    __tablename__ = 'company'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    settings: Mapped[dict] = mapped_column(JSON)


class Meeting(Base):
    __tablename__ = 'meetings'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    host_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default='')
    starts: Mapped[int] = mapped_column(Integer, index=True)
    ends: Mapped[int] = mapped_column(Integer)
    timezone: Mapped[str] = mapped_column(String(80), default='UTC')
    status: Mapped[str] = mapped_column(String(20), default='scheduled')
    guest_policy: Mapped[str] = mapped_column(String(16), default='invited')
    waiting_room: Mapped[bool] = mapped_column(Boolean, default=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ended_at: Mapped[int | None] = mapped_column(Integer, nullable=True)


class MeetingCredentials(Base):
    __tablename__ = 'meeting_credentials'
    meeting_id: Mapped[str] = mapped_column(ForeignKey('meetings.id', ondelete='CASCADE'), primary_key=True)
    username: Mapped[str] = mapped_column(String(32))
    password_hash: Mapped[str] = mapped_column(Text)
    encrypted_password: Mapped[str] = mapped_column(Text)


class SharedGuestSession(Base):
    __tablename__ = 'shared_guest_sessions'
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    meeting_id: Mapped[str] = mapped_column(ForeignKey('meetings.id', ondelete='CASCADE'), index=True)
    identity: Mapped[str] = mapped_column(String(80), unique=True)
    expires: Mapped[int] = mapped_column(Integer)


class Invitation(Base):
    __tablename__ = 'invitations'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    meeting_id: Mapped[str] = mapped_column(ForeignKey('meetings.id', ondelete='CASCADE'), index=True)
    email: Mapped[str] = mapped_column(String(254))
    digest: Mapped[str] = mapped_column(String(64), unique=True)
    encrypted_token: Mapped[str] = mapped_column(Text)
    expires: Mapped[int] = mapped_column(Integer)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)


class GuestSession(Base):
    __tablename__ = 'guest_sessions'
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    invitation_id: Mapped[str] = mapped_column(ForeignKey('invitations.id', ondelete='CASCADE'))
    expires: Mapped[int] = mapped_column(Integer)


class Participant(Base):
    __tablename__ = 'participants'
    __table_args__ = (UniqueConstraint('meeting_id', 'identity'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    meeting_id: Mapped[str] = mapped_column(ForeignKey('meetings.id', ondelete='CASCADE'), index=True)
    identity: Mapped[str] = mapped_column(String(80))
    user_id: Mapped[str | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    invitation_id: Mapped[str | None] = mapped_column(ForeignKey('invitations.id'), nullable=True)
    name: Mapped[str] = mapped_column(String(80))
    decision: Mapped[str] = mapped_column(String(20), default='waiting')
    connected: Mapped[bool] = mapped_column(Boolean, default=False)
    raised: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    left_at: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Audit(Base):
    __tablename__ = 'audit_events'
    id: Mapped[str] = mapped_column(String(100), primary_key=True, default=uid)
    at: Mapped[int] = mapped_column(Integer, default=now, index=True)
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str] = mapped_column(String(100), default='')
