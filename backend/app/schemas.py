from datetime import datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class DeleteMeetingsIn(BaseModel):
    meeting_ids: list[UUID] = Field(min_length=1, max_length=10000)


class UserIn(LoginIn):
    name: str = Field(min_length=1, max_length=80)
    role: Literal['employee', 'admin'] = 'employee'
    password: str = Field(min_length=12, max_length=128)


class UserUpdate(BaseModel):
    active: bool


class PasswordIn(BaseModel):
    password: str = Field(min_length=12, max_length=128)


class ChangePasswordIn(PasswordIn):
    current_password: str = Field(min_length=1, max_length=128)


class ChangeEmailIn(BaseModel):
    email: EmailStr = Field(max_length=254)
    current_password: str = Field(min_length=1, max_length=128)


class SettingsIn(BaseModel):
    application_title: str = Field(default='Sky Meet', min_length=1, max_length=80)
    application_version: str = Field(default='1.0.0', min_length=1, max_length=32)
    appearance_template: Literal['garden', 'studio', 'compact'] = 'garden'
    company_name: str = Field(default='Sky Green Line', min_length=1, max_length=80)
    support_email: EmailStr = 'support@example.com'
    primary_color: str = Field(default='#17694b', pattern=r'^#[0-9a-fA-F]{6}$')
    default_duration: int = Field(default=45, ge=15, le=480)
    employees_can_create: bool = True
    external_guests: bool = True
    waiting_room: bool = True
    default_guest_policy: Literal['invited', 'disabled'] = 'invited'
    email_enabled: bool = False
    reminders_enabled: bool = False
    reminder_minutes: int = Field(default=15, ge=5, le=1440)
    recording_policy: Literal['disabled'] = 'disabled'
    logo_url: str = Field(default='', pattern=r'^(/api/assets/[a-f0-9]{32}\.png)?$')
    favicon_url: str = Field(default='', pattern=r'^(/api/assets/[a-f0-9]{32}\.png)?$')

    @field_validator('application_title', 'application_version', 'company_name')
    @classmethod
    def nonblank_identity(cls, value):
        if not value.strip():
            raise ValueError('Enter a non-empty value')
        return value.strip()

    @field_validator('primary_color')
    @classmethod
    def readable_color(cls, value):
        rgb = [int(value[i:i+2], 16) / 255 for i in (1, 3, 5)]
        linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
        luminance = sum(v * weight for v, weight in zip(linear, (.2126, .7152, .0722)))
        if 1.05 / (luminance + .05) < 4.5:
            raise ValueError('Choose a darker brand color with at least 4.5:1 contrast against white')
        return value


class MeetingIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default='', max_length=4000)
    starts_at: datetime
    ends_at: datetime
    timezone: str = 'UTC'
    host_id: str | None = None
    guest_policy: Literal['invited', 'disabled'] = 'invited'
    waiting_room: bool = True
    invited_emails: list[EmailStr] = Field(default_factory=list, max_length=100)

    @field_validator('timezone')
    @classmethod
    def valid_zone(cls, v):
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('Use an IANA timezone such as Asia/Muscat')
        return v

    @model_validator(mode='after')
    def valid_dates(self):
        if self.starts_at.tzinfo is None or self.ends_at.tzinfo is None:
            raise ValueError('Times must include a UTC offset')
        duration = (self.ends_at - self.starts_at).total_seconds()
        if not 60 <= duration <= 8 * 3600:
            raise ValueError('Meeting duration must be between 1 minute and 8 hours')
        return self


class InviteIn(BaseModel):
    email: EmailStr
    send_email: bool = True


class ExchangeIn(BaseModel):
    token: str = Field(min_length=32, max_length=128)
    username: str = Field(default='', max_length=32)
    password: str = Field(default='', max_length=128)


class MeetingLoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class JoinIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class DecisionIn(BaseModel):
    decision: Literal['admitted', 'denied', 'removed']


class LockIn(BaseModel):
    locked: bool


class HandIn(BaseModel):
    raised: bool
