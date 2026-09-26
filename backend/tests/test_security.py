import base64
import hashlib
import io
import json
import time
from datetime import datetime, timezone, timedelta
import jwt
from PIL import Image
from sqlalchemy import select
from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal
from app.models import Invitation, Meeting, Participant, Audit, User
from app.config import config
from app.security import digest, _buckets
from conftest import login, PASSWORD


def create(client, **extra):
    t = datetime.now(timezone.utc)
    payload = {'title': 'Security review', 'starts_at': t.isoformat(), 'ends_at': (t + timedelta(hours=1)).isoformat(), 'timezone': 'Asia/Muscat', **extra}
    r = client.post('/api/meetings', json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def guest(client, mid):
    r = client.post(f'/api/meetings/{mid}/invitations', json={'email': 'guest@example.com'})
    assert r.status_code == 200, r.text
    invitation = r.json()
    raw = invitation['join_url'].split('#invite=')[1]
    g = TestClient(app, headers={'Origin': 'http://testserver'})
    credentials = client.get(f'/api/meetings/{mid}/sharing').json()
    x = g.post('/api/guest/exchange', json={'token': raw, 'username': credentials['username'], 'password': credentials['password']})
    assert x.status_code == 200, x.text
    g.headers['X-CSRF-Token'] = x.json()['csrf']
    return g, invitation, raw


def test_password_and_session(client):
    bad = client.post('/api/auth/login', json={'email':'host@example.com','password':'bad'})
    assert bad.status_code == 401
    r = login(client)
    assert 'HttpOnly' in r.headers['set-cookie'] and 'SameSite=strict' in r.headers['set-cookie']
    assert client.get('/api/auth/me').json()['user']['role'] == 'employee'
    with SessionLocal() as db:
        assert db.get(User, 'host').password_hash.startswith('$argon2id$')
    client.post('/api/auth/logout')
    assert client.get('/api/meetings').status_code == 401


def test_csrf_and_origin(client):
    login(client)
    assert client.post('/api/auth/logout', headers={'X-CSRF-Token':'wrong'}).status_code == 403
    assert client.post('/api/auth/logout', headers={'Origin':'https://evil.example'}).status_code == 403


def test_login_rate_limit(client):
    for _ in range(8):
        assert client.post('/api/auth/login', json={'email':'no@example.com','password':'bad'}).status_code == 401
    assert client.post('/api/auth/login', json={'email':'no@example.com','password':'bad'}).status_code == 429


def test_roles_and_host_ownership(client):
    login(client)
    m = create(client)
    assert client.get('/api/admin/users').status_code == 403
    assert client.post('/api/admin/users', json={'name':'E','email':'e@example.com','password':PASSWORD}).status_code == 403
    login(client, 'other')
    assert client.get(f'/api/meetings/{m["id"]}').status_code == 403
    assert client.post(f'/api/meetings/{m["id"]}/end').status_code == 403
    assert client.get('/api/meetings').json() == []


def test_invitation_hash_expiry_revocation(client):
    login(client)
    m = create(client)
    g, inv, raw = guest(client, m['id'])
    with SessionLocal() as db:
        row = db.get(Invitation, inv['id'])
        assert row.digest == digest(raw) and raw not in row.encrypted_token
        row.expires = int(time.time()) - 1
        db.commit()
    assert g.post('/api/guest/exchange', json={'token':raw}).status_code == 403
    assert g.get(f'/api/meetings/{m["id"]}').status_code == 403
    g, inv, raw = guest(client, m['id'])
    assert client.delete(f'/api/meetings/{m["id"]}/invitations/{inv["id"]}').status_code == 200
    assert g.post('/api/guest/exchange', json={'token':raw}).status_code == 403


def test_waiting_room_and_narrow_token(client):
    login(client)
    m = create(client)
    g, inv, raw = guest(client, m['id'])
    path = f'/api/meetings/{m["id"]}'
    assert g.post(path+'/token').status_code == 403
    p = g.post(path+'/join', json={'name':'External guest'}).json()
    assert p['decision'] == 'waiting'
    assert g.post(path+'/token').status_code == 403
    assert g.post(path+f'/participants/{p["participant_id"]}/decision', json={'decision':'admitted'}).status_code == 401
    assert client.post(path+f'/participants/{p["participant_id"]}/decision', json={'decision':'admitted'}).status_code == 200
    issued = g.post(path+'/token')
    assert issued.status_code == 200
    token = jwt.decode(issued.json()['token'], config().livekit_api_secret, algorithms=['HS256'])
    assert token['video']['room'] == 'sky-' + m['id']
    assert token['video']['roomJoin'] and not token['video']['roomAdmin']
    assert token['exp'] - token['nbf'] <= 60
    assert token['sub'] == 'g-' + inv['id']
    assert not token['video']['canUpdateOwnMetadata']
    # Refresh preserves the identity and admission decision.
    assert g.post(path+'/join', json={'name':'Guest again'}).json()['participant_id'] == p['participant_id']


def test_lock_end_and_removed_guest(client):
    login(client)
    m = create(client)
    path = f'/api/meetings/{m["id"]}'
    g, _, _ = guest(client, m['id'])
    p = g.post(path+'/join',json={'name':'Guest'}).json()
    client.post(path+f'/participants/{p["participant_id"]}/decision',json={'decision':'admitted'})
    client.post(path+'/lock',json={'locked':True})
    assert g.post(path+'/token').status_code == 403
    assert client.post(path+'/join',json={'name':'Host'}).status_code == 200
    assert client.post(path+'/token').status_code == 200
    client.post(path+'/lock',json={'locked':False})
    client.post(path+f'/participants/{p["participant_id"]}/decision',json={'decision':'removed'})
    assert g.post(path+'/token').status_code == 403
    assert g.post(path+'/join',json={'name':'Guest'}).status_code == 403
    assert client.post(path+'/end').status_code == 200
    assert client.post(path+'/token').status_code == 410


def test_invitation_cannot_access_another_meeting(client):
    login(client)
    first, second = create(client), create(client)
    g, _, _ = guest(client, first['id'])
    assert g.get(f'/api/meetings/{second["id"]}').status_code == 403
    assert g.post(f'/api/meetings/{second["id"]}/join',json={'name':'Guest'}).status_code == 403


def test_time_window_and_timezone_validation(client):
    login(client)
    t = datetime.now(timezone.utc)
    m = create(client, starts_at=(t+timedelta(hours=2)).isoformat(), ends_at=(t+timedelta(hours=3)).isoformat())
    assert client.post(f'/api/meetings/{m["id"]}/join', json={'name':'Host'}).status_code == 403
    with SessionLocal() as db:
        row = db.get(Meeting,m['id']); row.ends = int(time.time())-1801; db.commit()
    assert client.post(f'/api/meetings/{m["id"]}/join', json={'name':'Host'}).status_code == 410
    assert client.post('/api/meetings',json={'title':'Bad','starts_at':'2026-12-01T12:00:00','ends_at':'2026-12-01T13:00:00','timezone':'bad/zone'}).status_code == 422


def test_admin_policies_and_disabled_account(client):
    login(client,'admin')
    settings = client.get('/api/branding').json()
    settings.update(employees_can_create=False, external_guests=False)
    assert client.put('/api/admin/settings',json=settings).status_code == 200
    assert client.patch('/api/admin/users/admin',json={'active':False}).status_code == 409
    login(client)
    t=datetime.now(timezone.utc)
    assert client.post('/api/meetings',json={'title':'Blocked','starts_at':t.isoformat(),'ends_at':(t+timedelta(hours=1)).isoformat()}).status_code == 403
    login(client,'admin')
    client.patch('/api/admin/users/host',json={'active':False})
    assert client.post('/api/auth/login',json={'email':'host@example.com','password':PASSWORD}).status_code == 401


def test_calendar_and_safe_upload(client):
    login(client,'admin')
    m = create(client, title='مرحبا, hello')
    calendar = client.get(f'/api/meetings/{m["id"]}/calendar')
    assert calendar.status_code == 200 and 'BEGIN:VCALENDAR' in calendar.text and 'DTSTART:' in calendar.text
    assert client.post('/api/admin/assets',files={'file':('bad.svg',b'<svg onload="alert(1)"/>','image/svg+xml')}).status_code == 422
    buf=io.BytesIO();Image.new('RGB',(2,2)).save(buf,'PNG')
    uploaded=client.post('/api/admin/assets',files={'file':('logo.png',buf.getvalue(),'image/png')})
    assert uploaded.status_code == 200
    assert client.get(uploaded.json()['url']).headers['content-type']=='image/png'


def test_webhook_signature_idempotency_and_attendance(client):
    login(client)
    m=create(client)
    path=f'/api/meetings/{m["id"]}'
    p=client.post(path+'/join',json={'name':'Host'}).json()
    payload={'id':'evt-one','event':'participant_joined','room':{'name':'sky-'+m['id']},'participant':{'identity':'u-host'}}
    body=json.dumps(payload)
    assert client.post('/api/livekit/webhook',content=body).status_code == 401
    def signed(data):
        token=jwt.encode({'iss':config().livekit_api_key,'exp':int(time.time())+60,'nbf':int(time.time())-1,'sha256':base64.b64encode(hashlib.sha256(data.encode()).digest()).decode()},config().livekit_api_secret,algorithm='HS256')
        return {'Authorization':token,'Content-Type':'application/webhook+json'}
    headers=signed(body)
    for _ in range(2):
        assert client.post('/api/livekit/webhook',content=body,headers=headers).status_code == 200
    with SessionLocal() as db:
        assert db.get(Participant,p['participant_id']).connected
        assert db.get(Meeting,m['id']).status=='active'
        assert len(db.scalars(select(Audit).where(Audit.id=='webhook-evt-one')).all())==1
    assert client.post('/api/livekit/webhook',content=body+' ',headers=headers).status_code == 401
    payload.update(id='evt-two',event='room_finished')
    body=json.dumps(payload)
    assert client.post('/api/livekit/webhook',content=body,headers=signed(body)).status_code==200
    assert client.get(path).json()['status']=='active'


def test_password_reset_invalidates_sessions(client):
    login(client)
    admin=TestClient(app,headers={'Origin':'http://testserver'})
    login(admin,'admin')
    assert admin.post('/api/admin/users/host/password',json={'password':'another-password-123'}).status_code==200
    assert client.get('/api/meetings').status_code==401


def test_recording_cannot_be_enabled(client):
    login(client,'admin')
    data=client.get('/api/branding').json();data['recording_policy']='enabled'
    assert client.put('/api/admin/settings',json=data).status_code==422


def test_media_gateway_blocks_previously_issued_tokens(client):
    login(client)
    m = create(client)
    g, inv, _ = guest(client, m['id'])
    path = '/api/meetings/' + m['id']
    p = g.post(path+'/join', json={'name':'Guest'}).json()
    client.post(path+f'/participants/{p["participant_id"]}/decision',json={'decision':'admitted'})
    token = g.post(path+'/token').json()['token']
    headers = {'X-Forwarded-Uri': '/rtc?access_token='+token}
    assert client.get('/api/media/authorize', headers=headers).status_code == 200
    client.post(path+'/lock', json={'locked':True})
    assert client.get('/api/media/authorize', headers=headers).status_code == 403
    client.post(path+'/lock', json={'locked':False})
    client.delete(path+'/invitations/'+inv['id'])
    assert client.get('/api/media/authorize', headers=headers).status_code == 403
    assert client.get('/api/media/authorize', headers={'X-Forwarded-Uri':'/rtc?access_token=forged'}).status_code == 401


def test_deadline_reconciliation_retries_old_ended_rooms(client, monkeypatch):
    import asyncio
    from app import media
    from app.main import reconcile_once
    login(client)
    m = create(client)
    with SessionLocal() as db:
        row = db.get(Meeting, m['id'])
        row.ends = int(time.time()) - 1801
        db.commit()
    deleted = []
    async def snapshot():
        return [(m['id'], [])]
    async def end(mid):
        deleted.append(mid)
    monkeypatch.setattr(media, 'snapshot', snapshot)
    monkeypatch.setattr(media, 'end', end)
    asyncio.run(reconcile_once())
    with SessionLocal() as db:
        row = db.get(Meeting, m['id'])
        assert row.status == 'ended'
        row.ended_at = int(time.time()) - 3600
        db.commit()
    asyncio.run(reconcile_once())
    assert deleted == [m['id'], m['id']]


def test_employee_can_open_invitation_when_external_guests_disabled(client):
    login(client)
    m = create(client, guest_policy='disabled', invited_emails=['other@example.com'])
    raw = m['invitations'][0]['join_url'].split('#invite=')[1]
    employee = TestClient(app, headers={'Origin':'http://testserver'})
    assert employee.post('/api/guest/exchange',json={'token':raw}).status_code == 403
    login(employee, 'other')
    assert employee.post('/api/guest/exchange',json={'token':raw}).status_code == 200
    assert employee.get('/api/meetings/'+m['id']).status_code == 200


def test_brand_color_preserves_readable_button_contrast(client):
    login(client, 'admin')
    cfg = client.get('/api/branding').json()
    cfg['primary_color'] = '#ffffff'
    assert client.put('/api/admin/settings',json=cfg).status_code == 422
