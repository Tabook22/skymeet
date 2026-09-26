import html
import smtplib
import ssl
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from email.message import EmailMessage
from .config import config


def calendar(meeting, join_url=''):
    def esc(value):
        return value.replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '').replace(';', '\\;').replace(',', '\\,')
    def stamp(t):
        return datetime.fromtimestamp(t, timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sky Green Line//Sky Meet//EN',
             'BEGIN:VEVENT', f'UID:{meeting.id}@skymeet', f'DTSTAMP:{stamp(meeting.starts)}',
             f'DTSTART:{stamp(meeting.starts)}', f'DTEND:{stamp(meeting.ends)}',
             f'SUMMARY:{esc(meeting.title)}', f'DESCRIPTION:{esc(meeting.description)}',
             f'URL:{join_url}', 'END:VEVENT', 'END:VCALENDAR']
    # RFC 5545 folds lines at 75 octets, preserving UTF-8 codepoints.
    folded = []
    for line in lines:
        part = ''
        for char in line:
            if len((part + char).encode()) > 75:
                folded.append(part)
                part = ' '
            part += char
        folded.append(part)
    return '\r\n'.join(folded) + '\r\n'


def build_invitation(meeting, invitation, join_url, settings, reminder=False):
    cfg = config()
    msg = EmailMessage()
    msg['Subject'] = ('Reminder: ' if reminder else 'Invitation: ') + meeting.title.replace('\r', ' ').replace('\n', ' ')
    msg['From'] = cfg.smtp_from
    msg['To'] = invitation.email
    zone = ZoneInfo(meeting.timezone)
    when = datetime.fromtimestamp(meeting.starts, zone).strftime('%A, %d %B %Y · %H:%M')
    end = datetime.fromtimestamp(meeting.ends, zone).strftime('%H:%M')
    schedule = f'{when} – {end} ({meeting.timezone})'
    guest = settings['external_guests'] and meeting.guest_policy != 'disabled'
    steps = ('Open the link and enter the meeting username and password below. Then enter your name, check your camera and microphone, and select Join meeting.' if guest else 'Sign in with your invited company email, then open the link and select Join meeting.')
    login = f"Meeting username: {settings.get('meeting_username', '')}\nMeeting password: {settings.get('meeting_password', '')}" if guest else ''
    waiting = 'The host will admit you from the waiting room.' if meeting.waiting_room or settings['waiting_room'] else ''
    name = settings.get('application_title', 'Sky Meet')
    msg.set_content(f"{name} · {settings['company_name']}\n\n{meeting.title}\n{schedule}\n{meeting.description}\n\nJoin meeting: {join_url}\n{login}\n\n{steps}\n{waiting}\nYou can join 15 minutes before the scheduled start.\n\nKeep the meeting credentials private.\nAdd the attached calendar invitation to your calendar.")
    esc = html.escape
    msg.add_alternative(f'''<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,sans-serif;color:#203c30;padding:24px">
<div style="max-width:560px;margin:auto;background:white;border:1px solid #dce4dd;border-radius:16px;padding:32px">
<p style="color:{esc(settings['primary_color'])};font-size:15px;font-weight:bold">{esc(name)} · {esc(settings['company_name'])}</p>
<h1 style="font-size:26px;line-height:1.3">{esc(meeting.title)}</h1><p style="line-height:1.6">{esc(schedule)}</p>
<p style="white-space:pre-wrap;line-height:1.6">{esc(meeting.description)}</p>
<p style="margin:28px 0"><a href="{esc(join_url)}" style="display:inline-block;background:{esc(settings['primary_color'])};color:white;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Join meeting / انضم إلى الاجتماع</a></p>
<h2 style="font-size:17px">How to join</h2><p style="line-height:1.7">{esc(steps)}</p><p>{esc(waiting)}</p>
<p style="white-space:pre-wrap;line-height:1.7">{esc(login)}</p>
<p>You can join 15 minutes before the scheduled start.</p><p>Add the attached calendar invitation to your calendar.</p>
<hr style="border:0;border-top:1px solid #e5ebe5;margin:24px 0"><p style="font-size:12px">Keep the meeting credentials private.</p>
<p style="font-size:12px;overflow-wrap:anywhere">Button not working? Open this link:<br><a href="{esc(join_url)}">{esc(join_url)}</a></p>
</div></body></html>''', subtype='html')
    msg.add_attachment(calendar(meeting, join_url).encode(), maintype='text', subtype='calendar', filename='meeting.ics')
    return msg


def send_invitation(meeting, invitation, join_url, settings, reminder=False):
    cfg = config()
    if not settings['email_enabled'] or not cfg.smtp_host:
        return 'disabled'
    msg = build_invitation(meeting, invitation, join_url, settings, reminder)
    with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=10) as smtp:
        if cfg.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if cfg.smtp_user:
            smtp.login(cfg.smtp_user, cfg.smtp_password)
        smtp.send_message(msg)
    return 'sent'
