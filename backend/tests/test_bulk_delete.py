import asyncio
from uuid import uuid4
import pytest
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Meeting, MeetingCredentials, SharedGuestSession, Invitation, GuestSession, Participant, Audit
from app import media, main
from conftest import login
from test_security import create, guest
from test_shared_invitations import details, visitor


def test_bulk_delete_atomic_permissions_csrf_and_validation(client):
    login(client)
    own = create(client)['id']
    login(client, 'other')
    other = create(client)['id']
    login(client)
    path = '/api/meetings/bulk-delete'
    assert client.post(path,json={'meeting_ids':[]}).status_code == 422
    assert client.post(path,json={'meeting_ids':['bad-id']}).status_code == 422
    assert client.post(path,json={'meeting_ids':[own]},headers={'X-CSRF-Token':'bad'}).status_code == 403
    assert client.post(path,json={'meeting_ids':[own]},headers={'Origin':'https://evil.example'}).status_code == 403
    assert client.post(path,json={'meeting_ids':[own,other]}).status_code == 403
    with SessionLocal() as db:
        assert db.get(Meeting,own) and db.get(Meeting,other)
    assert client.post(path,json={'meeting_ids':[own]}).json()['deleted_ids'] == [own]
    with SessionLocal() as db:
        assert db.get(Meeting,other)


def test_bulk_admin_deletes_mixed_states_and_all_dependencies(client):
    login(client)
    ids = [create(client)['id'] for _ in range(4)]
    g, invitation, raw = guest(client,ids[0])
    g.post('/api/meetings/'+ids[0]+'/join',json={'name':'Personal guest'})
    shared = visitor(ids[1],details(client,ids[1]))
    shared.post('/api/meetings/'+ids[1]+'/join',json={'name':'Shared guest'})
    with SessionLocal() as db:
        for mid,status in zip(ids,['scheduled','active','ended','cancelled']):
            db.get(Meeting,mid).status=status
        db.commit()
    login(client,'admin')
    missing = str(uuid4())
    result = client.post('/api/meetings/bulk-delete',json={'meeting_ids':[*ids,ids[0],missing]})
    assert result.status_code == 200
    assert set(result.json()['deleted_ids']) == set(ids)
    assert result.json()['already_deleted_ids'] == [missing]
    assert result.json()['media_cleanup_pending'] is False
    with SessionLocal() as db:
        for model in (Meeting,MeetingCredentials,SharedGuestSession,Invitation,GuestSession,Participant):
            assert db.scalar(select(model)) is None
        assert len(db.scalars(select(Audit).where(Audit.action=='meeting.deleted')).all()) == 4
    assert g.get('/api/meetings/'+ids[0]).status_code == 404
    assert shared.get('/api/meetings/'+ids[1]).status_code == 404
    retry = client.post('/api/meetings/bulk-delete',json={'meeting_ids':ids}).json()
    assert retry['deleted_ids'] == [] and set(retry['already_deleted_ids']) == set(ids)


def test_bulk_database_failure_rolls_back_whole_selection(client,monkeypatch):
    login(client)
    ids=[create(client)['id'] for _ in range(2)]
    original=main.audit
    def fail_second(db,actor,action,target=''):
        if action=='meeting.deleted' and target==ids[1]:
            raise RuntimeError('simulated transaction failure')
        original(db,actor,action,target)
    monkeypatch.setattr(main,'audit',fail_second)
    with pytest.raises(RuntimeError):
        client.post('/api/meetings/bulk-delete',json={'meeting_ids':ids})
    with SessionLocal() as db:
        assert all(db.get(Meeting,mid) and db.get(MeetingCredentials,mid) for mid in ids)
        assert not db.scalar(select(Audit).where(Audit.action=='meeting.deleted'))


def test_slow_media_cleanup_does_not_block_deletion(client,monkeypatch):
    login(client)
    mid=create(client)['id']
    async def slow(_):
        await asyncio.sleep(30)
    monkeypatch.setattr(media,'end',slow)
    result=client.delete('/api/meetings/'+mid)
    assert result.status_code == 200 and result.json()['media_cleanup_pending'] is True
    with SessionLocal() as db:
        assert db.get(Meeting,mid) is None


def test_bulk_cleanup_failure_still_commits_and_retries(client,monkeypatch):
    login(client)
    ids=[create(client)['id'] for _ in range(2)]
    async def fail(_):
        raise RuntimeError('media unavailable')
    monkeypatch.setattr(media,'end',fail)
    result=client.post('/api/meetings/bulk-delete',json={'meeting_ids':ids})
    assert result.status_code==200 and result.json()['media_cleanup_pending'] is True
    calls=[]
    async def snapshot(): return [(mid,[]) for mid in ids]
    async def end(mid): calls.append(mid)
    monkeypatch.setattr(media,'snapshot',snapshot)
    monkeypatch.setattr(media,'end',end)
    asyncio.run(main.reconcile_once())
    assert set(calls)==set(ids)
