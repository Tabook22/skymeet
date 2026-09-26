"""Explicit local test fixture, refused in production. Credentials stay in .local/."""
import json
import secrets
from pathlib import Path
from sqlalchemy import select
from app.config import config
from app.db import SessionLocal
from app.models import User, Company
from app.schemas import SettingsIn
from app.security import passwords

if config().production or config().app_origin != 'http://localhost:5173':
    raise SystemExit('Test fixtures require the local development configuration.')
path = Path('.local/test-accounts.json')
accounts = json.loads(path.read_text()) if path.exists() else [
    {'name': name, 'email': email, 'password': secrets.token_urlsafe(20), 'role': role}
    for name,email,role in [('Sky Admin','admin@example.com','admin'),('Sara Ahmed','sara@example.com','employee'),('Omar Ali','omar@example.com','employee')]
]
with SessionLocal() as db:
    for item in accounts:
        if not db.scalar(select(User).where(User.email == item['email'])):
            db.add(User(name=item['name'], email=item['email'], role=item['role'], password_hash=passwords.hash(item['password'])))
    if not db.get(Company,1):
        db.add(Company(id=1,settings=SettingsIn().model_dump(mode='json')))
    db.commit()
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(accounts,indent=2))
print('Local test accounts are ready. Credentials: .local/test-accounts.json (ignored by Git).')
