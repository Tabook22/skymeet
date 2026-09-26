from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Meeting, Invitation, Participant, now
from app import media
from conftest import login
from test_security import create
from test_shared_invitations import details, visitor


def test_admin_opens_future_meeting_and_admits_guest(client):
    login(client)
    start = datetime.now(timezone.utc) + timedelta(days=7)
    m = create(client, starts_at=start.isoformat(), ends_at=(start + timedelta(hours=1)).isoformat())
    path = '/api/meetings/' + m['id']
    credentials = details(client, m['id'])
    guest = visitor(m['id'], credentials)
    assert guest.post(path + '/join', json={'name': 'Guest'}).status_code == 403
    assert client.post(path + '/open').status_code == 403  # employee host cannot override time
    assert guest.post(path + '/open').status_code == 401
    login(client, 'admin')
    assert client.post(path + '/open', headers={'X-CSRF-Token': 'bad'}).status_code == 403
    result = client.post(path + '/open')
    assert result.status_code == 200
    opened = result.json()
    assert abs(opened['starts'] - now()) <= 2
    assert opened['ends'] - opened['starts'] == 3600
    assert opened['waiting_room'] and not opened['locked']
    assert details(client, m['id'])['password'] == credentials['password']
    assert client.post(path + '/join', json={'name': 'Admin'}).json()['decision'] == 'admitted'
    assert client.post(path + '/token').status_code == 200
    waiting = guest.post(path + '/join', json={'name': 'Guest'}).json()
    assert waiting['decision'] == 'waiting'
    assert guest.post(path + '/token').status_code == 403
    assert client.post(path + '/participants/' + waiting['participant_id'] + '/decision', json={'decision': 'admitted'}).status_code == 200
    assert guest.post(path + '/token').status_code == 200
    guest.close()


@pytest.mark.parametrize('status', ['ended', 'cancelled', 'expired'])
def test_reopen_requires_fresh_guest_admission_preserves_link_and_revocations(client, status):
    login(client, 'admin')
    m = create(client)
    path = '/api/meetings/' + m['id']
    credentials = details(client, m['id'])
    guest = visitor(m['id'], credentials)
    participant = guest.post(path + '/join', json={'name': 'Guest'}).json()
    client.post(path + '/participants/' + participant['participant_id'] + '/decision', json={'decision': 'admitted'})
    old_token = guest.post(path + '/token').json()['token']
    with SessionLocal() as db:
        meeting = db.get(Meeting, m['id'])
        meeting.status = 'scheduled' if status == 'expired' else status
        meeting.starts, meeting.ends = now() - 7200, now() - 3600
        meeting.locked = True
        db.add(Invitation(meeting_id=m['id'], email='revoked@example.com', digest='revoked', encrypted_token='unused', expires=1, revoked=True))
        db.add(Invitation(meeting_id=m['id'], email='valid@example.com', digest='valid', encrypted_token='unused', expires=1, revoked=False))
        db.commit()
    assert client.post(path + '/open').status_code == 200
    assert guest.get(path).status_code == 403
    assert client.get('/api/media/authorize', headers={'X-Forwarded-Uri': '/rtc?access_token=' + old_token}).status_code == 403
    current = details(client, m['id'])
    assert current['join_url'] == credentials['join_url'] and current['password'] == credentials['password']
    fresh = visitor(m['id'], credentials)
    assert fresh.post(path + '/join', json={'name': 'Guest'}).json()['decision'] == 'waiting'
    assert fresh.post(path + '/token').status_code == 403
    with SessionLocal() as db:
        revoked = db.scalar(select(Invitation).where(Invitation.digest == 'revoked'))
        valid = db.scalar(select(Invitation).where(Invitation.digest == 'valid'))
        assert revoked.revoked and revoked.expires == 1
        assert not valid.revoked and valid.expires > now()
        assert db.get(Participant, participant['participant_id']) is None
    guest.close()
    fresh.close()


def test_open_preserves_running_call_and_reopen_fails_closed_on_media_error(client, monkeypatch):
    login(client, 'admin')
    m = create(client)
    path = '/api/meetings/' + m['id']
    p = client.post(path + '/join', json={'name': 'Admin'}).json()
    with SessionLocal() as db:
        db.get(Meeting, m['id']).status = 'active'
        db.commit()
    result = client.post(path + '/open').json()
    assert result['starts'] == m['starts'] and result['ends'] == m['ends']
    with SessionLocal() as db:
        assert db.get(Participant, p['participant_id']) is not None
        db.get(Meeting, m['id']).status = 'ended'
        db.commit()
    async def fail(mid):
        raise RuntimeError('Media unavailable')
    monkeypatch.setattr(media, 'end', fail)
    assert client.post(path + '/open').status_code == 503
    assert client.get(path).json()['status'] == 'ended'
