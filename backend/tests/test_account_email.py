from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.db import SessionLocal
from app.models import User, Meeting, Audit
from conftest import login, PASSWORD
from test_security import create


def test_change_email_requires_password_and_revokes_sessions(client):
    login(client, 'admin')
    m = create(client)
    other = TestClient(app, headers={'Origin': 'http://testserver'})
    login(other, 'admin')
    body = {'email': 'NEW.ADMIN@example.com', 'current_password': PASSWORD}
    path = '/api/admin/account/email'
    assert client.post(path, json=body, headers={'X-CSRF-Token': 'wrong'}).status_code == 403
    assert client.post(path, json={**body, 'current_password': 'wrong'}).status_code == 400
    assert client.post(path, json=body).status_code == 200
    assert client.get('/api/auth/me').json()['user'] is None
    assert other.get('/api/admin/users').status_code == 401
    assert client.post('/api/auth/login', json={'email': 'admin@example.com', 'password': PASSWORD}).status_code == 401
    result = client.post('/api/auth/login', json={'email': 'new.admin@example.com', 'password': PASSWORD})
    assert result.status_code == 200 and result.json()['user']['id'] == 'admin'
    with SessionLocal() as db:
        assert db.get(User, 'admin').email == 'new.admin@example.com'
        assert db.get(Meeting, m['id']).host_id == 'admin'
        assert db.scalar(select(Audit).where(Audit.action == 'account.email_changed', Audit.actor == 'admin'))
    other.close()


def test_email_change_validation_and_authorization(client):
    login(client)
    path = '/api/admin/account/email'
    body = {'email': 'new@example.com', 'current_password': PASSWORD}
    assert client.post(path, json=body).status_code == 403
    login(client, 'admin')
    for email, status in [('HOST@example.com', 409), ('ADMIN@example.com', 422), ('bad-address', 422)]:
        assert client.post(path, json={**body, 'email': email}).status_code == status
    assert client.get('/api/auth/me').json()['user']['email'] == 'admin@example.com'


def test_email_change_password_guessing_is_limited(client):
    login(client, 'admin')
    body = {'email': 'new@example.com', 'current_password': 'wrong'}
    for _ in range(5):
        assert client.post('/api/admin/account/email', json=body).status_code == 400
    assert client.post('/api/admin/account/email', json=body).status_code == 429
