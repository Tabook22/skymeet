from datetime import datetime, timezone
from app import mail
from app.db import SessionLocal
from app.models import Meeting, Invitation
from app.schemas import SettingsIn
from conftest import login
from test_security import create


def test_copy_invitation_does_not_send_email_and_enforces_scope(client, monkeypatch):
    login(client)
    first, second = create(client), create(client)
    calls = []
    def send(*args):
        calls.append(args)
        return 'sent'
    monkeypatch.setattr(mail, 'send_invitation', send)
    path = '/api/meetings/' + first['id']
    ready = client.post(path+'/invitations', json={'email':'guest@example.com','send_email':False}).json()
    assert ready['delivery'] == 'not_requested' and calls == []
    link = path+'/invitations/'+ready['id']+'/link'
    assert client.get(link).json()['join_url'] == ready['join_url'] and calls == []
    assert client.get('/api/meetings/'+second['id']+'/invitations/'+ready['id']+'/link').status_code == 404
    login(client, 'other')
    assert client.get(link).status_code == 403
    assert client.get(path+'/sharing').status_code == 403
    login(client)
    assert client.post(path+'/invitations/'+ready['id']+'/resend').json()['delivery'] == 'sent'
    assert len(calls) == 1
    client.delete(path+'/invitations/'+ready['id'])
    assert client.get(link).status_code == 404


def test_sharing_status_and_closed_invitation_actions(client):
    login(client)
    m = create(client)
    path = '/api/meetings/'+m['id']
    info = client.get(path+'/sharing').json()
    assert info['email_ready'] is False and info['guests_allowed'] is True
    assert 'smtp_password' not in info
    ready = client.post(path+'/invitations', json={'email':'guest@example.com','send_email':False}).json()
    client.post(path+'/end')
    assert client.get(path+'/sharing').json()['closed'] is True
    assert client.get(path+'/invitations/'+ready['id']+'/link').status_code == 410
    assert client.post(path+'/invitations/'+ready['id']+'/resend').status_code == 410


def test_professional_email_has_safe_markup_local_time_and_calendar(client):
    login(client)
    m = create(client, title='Planning <script>alert(1)</script>', description='<img src=x onerror=evil()>', timezone='Asia/Muscat')
    path = '/api/meetings/'+m['id']
    ready = client.post(path+'/invitations',json={'email':'guest@example.com','send_email':False}).json()
    with SessionLocal() as db:
        meeting = db.get(Meeting,m['id'])
        meeting.starts = int(datetime(2030,1,1,8,0,tzinfo=timezone.utc).timestamp())
        meeting.ends = meeting.starts + 3600
        msg = mail.build_invitation(meeting,db.get(Invitation,ready['id']),ready['join_url'],SettingsIn(application_title='Team Connect').model_dump())
    plain = msg.get_body(preferencelist=('plain',)).get_content()
    html = msg.get_body(preferencelist=('html',)).get_content()
    assert 'Team Connect' in plain and '12:00' in plain and 'Asia/Muscat' in plain
    assert 'meeting username and password' in plain and 'waiting room' in plain
    assert '<script>' not in html and '<img src=x' not in html
    assert '&lt;script&gt;' in html and 'Join meeting' in html
    calendar = list(msg.iter_attachments())[0]
    assert calendar.get_filename() == 'meeting.ics'
    assert b'DTSTART:20300101T080000Z' in calendar.get_payload(decode=True)
