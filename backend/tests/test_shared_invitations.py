from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.db import SessionLocal
from app.models import MeetingCredentials, SharedGuestSession, Participant, Company, now
from app.security import passwords, cipher
from conftest import login
from test_security import create


def details(client, mid):
    r = client.get(f'/api/meetings/{mid}/sharing')
    assert r.status_code == 200
    return r.json()


def visitor(mid, credentials):
    guest = TestClient(app, headers={'Origin': 'http://testserver'})
    r = guest.post(f'/api/guest/meeting/{mid}/login', json={k: credentials[k] for k in ('username', 'password')})
    assert r.status_code == 200, r.text
    assert 'HttpOnly' in r.headers['set-cookie'] and 'SameSite=strict' in r.headers['set-cookie']
    guest.headers['X-CSRF-Token'] = r.json()['csrf']
    return guest


def test_automatic_credentials_are_private_encrypted_and_meeting_scoped(client):
    login(client)
    m, other = create(client), create(client)
    a, b = details(client, m['id']), details(client, other['id'])
    assert a['join_url'].endswith('/join/' + m['id'])
    assert a['password'] != b['password'] and a['username'] != b['username']
    assert details(client, m['id'])['password'] == a['password']
    with SessionLocal() as db:
        row = db.get(MeetingCredentials, m['id'])
        assert passwords.verify(a['password'], row.password_hash)
        assert a['password'] not in row.encrypted_password
        assert cipher().decrypt(row.encrypted_password.encode()).decode() == a['password']
    anonymous = TestClient(app, headers={'Origin': 'http://testserver'})
    meta = anonymous.get('/api/guest/meeting/' + m['id'])
    assert meta.status_code == 200 and a['password'] not in meta.text
    assert 'username' not in meta.json() and 'host_id' not in meta.json()
    assert anonymous.get(f'/api/meetings/{m["id"]}').status_code == 403
    assert anonymous.get(f'/api/meetings/{m["id"]}/sharing').status_code == 401
    assert a['password'] not in client.get('/api/meetings').text
    assert anonymous.post(f'/api/guest/meeting/{other["id"]}/login', json={'username':a['username'], 'password':a['password']}).status_code == 401
    login(client, 'other')
    assert client.get(f'/api/meetings/{m["id"]}/sharing').status_code == 403
    login(client, 'admin')
    assert details(client, m['id'])['password'] == a['password']


def test_wrong_credentials_origin_and_rate_limit(client):
    login(client)
    mid = create(client)['id']
    a = details(client, mid)
    g = TestClient(app, headers={'Origin': 'http://testserver'})
    path = f'/api/guest/meeting/{mid}/login'
    good = {'username':a['username'], 'password':a['password']}
    assert g.post(path,json=good,headers={'Origin':'https://evil.example'}).status_code == 403
    assert g.post(path,json={**good,'username':'مستخدم'}).status_code == 401
    for _ in range(9):
        assert g.post(path,json={**good,'password':'wrong'}).status_code == 401
    assert g.post(path,json=good).status_code == 429
    assert 'sky_shared' not in g.cookies


def test_shared_link_separate_guests_admission_refresh_and_expired_media(client):
    login(client)
    mid = create(client)['id']
    a = details(client, mid)
    g, g2 = visitor(mid, a), visitor(mid, a)
    path = f'/api/meetings/{mid}'
    assert g.get('/api/auth/me').json()['user'] is None
    assert g.get('/api/admin/users').status_code == 401
    assert g.get(path+'/sharing').status_code == 401
    assert g.post(path+'/join',json={'name':'First'},headers={'X-CSRF-Token':'wrong'}).status_code == 403
    p = g.post(path+'/join',json={'name':'First'}).json()
    p2 = g2.post(path+'/join',json={'name':'Second'}).json()
    assert p['participant_id'] != p2['participant_id'] and p['decision'] == p2['decision'] == 'waiting'
    assert g.post(path+'/token').status_code == 403
    assert g.post(path+f'/participants/{p["participant_id"]}/decision', json={'decision':'admitted'}).status_code == 401
    assert client.post(path+f'/participants/{p["participant_id"]}/decision', json={'decision':'admitted'}).status_code == 200
    token = g.post(path+'/token').json()['token']
    headers = {'X-Forwarded-Uri':'/rtc?access_token='+token}
    assert client.get('/api/media/authorize',headers=headers).status_code == 200
    assert g2.post(path+'/token').status_code == 403
    assert g.post(f'/api/guest/meeting/{mid}/login',json={'username':a['username'],'password':a['password']}).status_code == 200
    assert g.post(path+'/join',json={'name':'First again'}).json()['participant_id'] == p['participant_id']
    identity = g.get(path).json()['identity']
    with SessionLocal() as db:
        row = db.scalar(select(SharedGuestSession).where(SharedGuestSession.identity == identity))
        row.expires = now() - 1
        db.commit()
    assert g.get(path).status_code == 403
    assert client.get('/api/media/authorize',headers=headers).status_code == 403
    assert client.delete(path).status_code == 200
    assert g2.get(path).status_code == 404
    with SessionLocal() as db:
        assert db.get(MeetingCredentials,mid) is None
        assert db.scalar(select(SharedGuestSession).where(SharedGuestSession.meeting_id == mid)) is None


def test_password_gate_preserves_closed_disabled_locked_and_early_rules(client):
    login(client)
    t = datetime.now(timezone.utc) + timedelta(days=1)
    mid = create(client,starts_at=t.isoformat(),ends_at=(t+timedelta(hours=1)).isoformat())['id']
    a = details(client,mid)
    g = visitor(mid,a)
    path = '/api/meetings/'+mid
    assert g.post(path+'/join',json={'name':'Early'}).status_code == 403
    assert g.post(path+'/token').status_code == 403
    assert client.post(path+'/lock',json={'locked':True}).status_code == 200
    good = {'username':a['username'],'password':a['password']}
    assert g.post(f'/api/guest/meeting/{mid}/login',json=good).status_code == 403
    client.post(path+'/lock',json={'locked':False})
    with SessionLocal() as db:
        company = db.get(Company,1)
        company.settings = {**company.settings,'external_guests':False}
        db.commit()
    assert g.post(f'/api/guest/meeting/{mid}/login',json=good).status_code == 403
    assert g.get(path).status_code == 403
    client.post(path+'/cancel')
    assert g.post(f'/api/guest/meeting/{mid}/login',json=good).status_code == 410


def test_legacy_link_requires_password_and_logout_revokes_shared_media(client):
    login(client)
    mid = create(client)['id']
    path = '/api/meetings/'+mid
    legacy = client.post(path+'/invitations',json={'email':'visitor@example.com','send_email':False}).json()
    g = TestClient(app,headers={'Origin':'http://testserver'})
    result = g.post('/api/guest/exchange',json={'token':legacy['join_url'].split('#invite=')[1]})
    assert result.json() == {'requires_credentials':True,'meeting_id':mid}
    assert not g.cookies and g.get(path).status_code == 403
    a = details(client,mid)
    g = visitor(mid,a)
    p = g.post(path+'/join',json={'name':'First'}).json()
    client.post(path+f'/participants/{p["participant_id"]}/decision',json={'decision':'admitted'})
    token = g.post(path+'/token').json()['token']
    assert g.post('/api/auth/logout').status_code == 200
    assert g.get(path).status_code == 403
    assert client.get('/api/media/authorize',headers={'X-Forwarded-Uri':'/rtc?access_token='+token}).status_code == 403


def test_removed_guest_cannot_reenter_with_same_session(client):
    login(client)
    mid = create(client)['id']
    a = details(client,mid)
    g = visitor(mid,a)
    path = '/api/meetings/'+mid
    p = g.post(path+'/join',json={'name':'Guest'}).json()
    client.post(path+f'/participants/{p["participant_id"]}/decision',json={'decision':'denied'})
    assert g.post(path+'/join',json={'name':'Guest again'}).status_code == 403
    assert g.post(f'/api/guest/meeting/{mid}/login',json={'username':a['username'],'password':a['password']}).status_code == 403
    assert g.post(path+'/token').status_code == 403
