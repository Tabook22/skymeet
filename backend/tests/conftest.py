import os
import tempfile
from pathlib import Path
import pytest

_temp = tempfile.TemporaryDirectory(prefix='skymeet-tests-')
os.environ.update(DATABASE_URL='sqlite:///' + str(Path(_temp.name) / 'test.db').replace('\\', '/'), APP_SECRET='test-app-secret-' * 4, LIVEKIT_API_KEY='test-key', LIVEKIT_API_SECRET='test-livekit-secret-' * 4, APP_ORIGIN='http://testserver', PRODUCTION='false', ASSET_DIR=str(Path(_temp.name) / 'assets'))

from fastapi.testclient import TestClient
from app.main import app
from app.db import Base, engine, SessionLocal
from app.models import User, Company
from app.schemas import SettingsIn
from app.security import passwords, _buckets
from app import media

PASSWORD = 'a-good-test-password-123'


def pytest_sessionfinish(session, exitstatus):
    engine.dispose()
    _temp.cleanup()


@pytest.fixture(autouse=True)
def database(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    _buckets.clear()
    with SessionLocal() as db:
        db.add(Company(id=1, settings=SettingsIn().model_dump(mode='json')))
        for name, role in [('admin', 'admin'), ('host', 'employee'), ('other', 'employee')]:
            db.add(User(id=name, name=name.title(), email=name+'@example.com', role=role, password_hash=passwords.hash(PASSWORD)))
        db.commit()
    async def noop(*args):
        pass
    monkeypatch.setattr(media, 'remove', noop)
    monkeypatch.setattr(media, 'end', noop)
    monkeypatch.setattr(media, 'mute', noop)
    async def empty_snapshot():
        return []
    monkeypatch.setattr(media, 'snapshot', empty_snapshot)


@pytest.fixture
def client():
    c = TestClient(app)
    c.headers['Origin'] = 'http://testserver'
    yield c
    c.close()


def login(client, name='host'):
    r = client.post('/api/auth/login', json={'email': name+'@example.com', 'password': PASSWORD})
    assert r.status_code == 200, r.text
    client.headers['X-CSRF-Token'] = r.json()['csrf']
    return r
