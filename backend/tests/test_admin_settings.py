from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal
from app.models import Company
from app.schemas import SettingsIn
from conftest import login, PASSWORD


def test_settings_permissions_and_persistence(client):
    body = SettingsIn().model_dump()
    login(client)
    assert client.put('/api/admin/settings', json=body).status_code == 403
    assert client.post('/api/admin/assets', files={'file': ('x.png', b'x', 'image/png')}).status_code == 403
    assert client.post('/api/admin/account/password', json={'current_password': PASSWORD, 'password': 'new-secure-password'}).status_code == 403
    login(client, 'admin')
    body.update(application_title='Our Meetings', application_version='2.4 beta', appearance_template='studio')
    assert client.put('/api/admin/settings', json=body).status_code == 200
    assert client.get('/api/branding').json()['application_title'] == 'Our Meetings'
    with SessionLocal() as db:
        assert db.get(Company, 1).settings['appearance_template'] == 'studio'
    for extra in ({'appearance_template': 'script'}, {'application_title': '   '}, {'application_version': ''}):
        assert client.put('/api/admin/settings', json={**body, **extra}).status_code == 422


def test_existing_settings_get_new_defaults(client):
    with SessionLocal() as db:
        db.get(Company, 1).settings = {'company_name': 'Existing company'}
        db.commit()
    brand = client.get('/api/branding').json()
    assert brand['company_name'] == 'Existing company'
    assert brand['application_title'] == 'Sky Meet'
    assert brand['appearance_template'] == 'garden'


def test_change_password_requires_current_and_revokes_all_sessions(client):
    login(client, 'admin')
    other = TestClient(app, headers={'Origin': 'http://testserver'})
    login(other, 'admin')
    path = '/api/admin/account/password'
    new = 'a-completely-new-password-123'
    body = {'current_password': PASSWORD, 'password': new}
    assert client.post(path, json=body, headers={'X-CSRF-Token': 'bad'}).status_code == 403
    assert client.post(path, json={**body, 'current_password': 'wrong'}).status_code == 400
    assert client.post(path, json={**body, 'password': PASSWORD}).status_code == 422
    assert client.post(path, json={**body, 'password': 'short'}).status_code == 422
    assert client.post('/api/admin/users/admin/password', json={'password': new}).status_code == 409
    assert client.post(path, json=body).status_code == 200
    assert client.get('/api/auth/me').json()['user'] is None
    assert other.get('/api/admin/users').status_code == 401
    assert client.post('/api/auth/login', json={'email': 'admin@example.com', 'password': PASSWORD}).status_code == 401
    assert client.post('/api/auth/login', json={'email': 'admin@example.com', 'password': new}).status_code == 200
    other.close()


def test_current_password_attempts_are_limited(client):
    login(client, 'admin')
    body = {'current_password': 'wrong', 'password': 'a-new-long-password'}
    for _ in range(5):
        assert client.post('/api/admin/account/password', json=body).status_code == 400
    assert client.post('/api/admin/account/password', json=body).status_code == 429
