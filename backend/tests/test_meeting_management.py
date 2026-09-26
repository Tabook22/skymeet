import asyncio
import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Meeting, Invitation, Participant, GuestSession, Audit
from app.main import reconcile_once
from app import media
from conftest import login
from test_security import create, guest


@pytest.mark.parametrize('status', ['scheduled', 'active', 'ended', 'cancelled'])
def test_admin_deletes_any_meeting_and_invalidates_access(client, monkeypatch, status):
    login(client)
    m = create(client)
    path = '/api/meetings/' + m['id']
    g, inv, raw = guest(client, m['id'])
    participant = g.post(path + '/join', json={'name': 'Guest'}).json()
    client.post(path + f'/participants/{participant["participant_id"]}/decision', json={'decision': 'admitted'})
    token = g.post(path + '/token').json()['token']
    with SessionLocal() as db:
        db.get(Meeting, m['id']).status = status
        db.commit()
    calls = []
    async def end(mid):
        calls.append(mid)
    monkeypatch.setattr(media, 'end', end)
    login(client, 'other')
    assert client.delete(path).status_code == 403
    login(client, 'admin')
    assert client.delete(path, headers={'X-CSRF-Token': 'bad'}).status_code == 403
    result = client.delete(path)
    assert result.status_code == 200 and result.json()['media_cleanup_pending'] is False
    assert calls == [m['id']]
    assert g.get(path).status_code == 404
    assert g.post('/api/guest/exchange', json={'token': raw}).status_code == 403
    assert client.get('/api/media/authorize', headers={'X-Forwarded-Uri': '/rtc?access_token=' + token}).status_code == 404
    with SessionLocal() as db:
        assert db.get(Meeting, m['id']) is None
        assert db.get(Invitation, inv['id']) is None
        assert db.get(Participant, participant['participant_id']) is None
        assert db.scalar(select(GuestSession)) is None
        assert db.scalar(select(Audit).where(Audit.action == 'meeting.deleted', Audit.target == m['id']))
    g.close()


def test_host_delete_retries_media_cleanup(client, monkeypatch):
    login(client)
    m = create(client)
    async def fail(mid):
        raise RuntimeError('offline')
    monkeypatch.setattr(media, 'end', fail)
    assert client.delete('/api/meetings/' + m['id']).json()['media_cleanup_pending'] is True
    async def snapshot():
        return [(m['id'], ['u-host'])]
    calls = []
    async def end(mid):
        calls.append(mid)
    monkeypatch.setattr(media, 'snapshot', snapshot)
    monkeypatch.setattr(media, 'end', end)
    asyncio.run(reconcile_once())
    assert calls == [m['id']]


def test_reschedule_permissions_and_invitation_expiry(client):
    login(client)
    m = create(client)
    g, inv, raw = guest(client, m['id'])
    start = datetime.now(timezone.utc) + timedelta(days=3)
    body = {'title': m['title'], 'starts_at': start.isoformat(), 'ends_at': (start + timedelta(hours=1)).isoformat(), 'timezone': 'Asia/Muscat'}
    path = '/api/meetings/' + m['id']
    login(client, 'other')
    assert client.put(path, json=body).status_code == 403
    login(client, 'admin')
    changed = client.put(path, json=body)
    assert changed.status_code == 200
    assert changed.json()['starts'] == int(start.timestamp())
    with SessionLocal() as db:
        invitation = db.get(Invitation, inv['id'])
        assert invitation.expires == int((start + timedelta(hours=1)).timestamp()) + 1800
        assert not invitation.reminder_sent
    assert g.post('/api/guest/exchange', json={'token': raw}).status_code == 200
    assert 'DTSTART:' + start.strftime('%Y%m%dT%H%M%SZ') in client.get(path + '/calendar').text
    g.close()


def test_meeting_list_does_not_hide_older_records(client):
    login(client, 'admin')
    with SessionLocal() as db:
        for index in range(205):
            db.add(Meeting(host_id='host', title=f'Meeting {index}', starts=index, ends=index + 3600))
        db.commit()
    assert len(client.get('/api/meetings').json()) == 205

