"""Operator-only import of one administrator and branding into an empty database.

Read a private JSON export from stdin; never emit its contents. No meetings,
sample users, sessions or application secrets are imported.
"""
import base64
import json
from pathlib import Path
import re
import sys
from sqlalchemy import select
from pydantic import TypeAdapter, EmailStr
from app.config import config
from app.db import SessionLocal
from app.models import User, Company, Meeting, Audit
from app.schemas import SettingsIn


def main():
    payload = json.load(sys.stdin)
    account = payload['administrator']
    email = str(TypeAdapter(EmailStr).validate_python(account['email'])).lower()
    if not account['password_hash'].startswith('$argon2id$'):
        raise SystemExit('Expected an existing Argon2id password hash.')
    if not 1 <= len(account['name']) <= 80:
        raise SystemExit('Invalid administrator name.')
    settings = SettingsIn(**payload['settings']).model_dump(mode='json')
    assets = {}
    for name, value in payload.get('assets', {}).items():
        if not re.fullmatch(r'[a-f0-9]{32}\.png', name):
            raise SystemExit('Invalid branding asset filename.')
        data = base64.b64decode(value, validate=True)
        if len(data) > 3 * 1024 * 1024 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise SystemExit('Invalid branding image.')
        assets[name] = data
    for field in ('logo_url', 'favicon_url'):
        value = settings[field]
        if value and (not value.startswith('/api/assets/') or value.removeprefix('/api/assets/') not in assets):
            raise SystemExit('A referenced branding image is missing.')
    with SessionLocal() as db:
        if db.scalar(select(User)) or db.scalar(select(Meeting)) or db.get(Company, 1):
            raise SystemExit('Refusing to overwrite an initialized workspace.')
        folder = Path(config().asset_dir)
        folder.mkdir(parents=True, exist_ok=True)
        for name, data in assets.items():
            target = folder / name
            if target.exists() and target.read_bytes() != data:
                raise SystemExit('Refusing to overwrite an existing branding image.')
            target.write_bytes(data)
        user = User(name=account['name'], email=email, password_hash=account['password_hash'], role='admin', active=True)
        db.add(user)
        db.flush()
        db.add(Company(id=1, settings=settings))
        db.add(Audit(actor='operator', action='workspace.imported', target=user.id))
        db.commit()
    print('Administrator and branding imported. No meetings, sample users or sessions copied.')


if __name__ == '__main__':
    main()
