"""One sudo-authenticated activation for the inspected Hostinger VPS.

Adds only Sky Meet routing/certificate copies/firewall allowances. Never replaces
the existing applications, certificates, coturn service or root-site locations.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone
from urllib.request import urlopen

ROOT = Path('/home/nasser/skymeet')
SITE = Path('/etc/nginx/sites-available/insulator-inspector')
SNIPPET = Path('/etc/nginx/snippets/skymeet.conf')
EXPECTED_SITE = '77f7465abba75b777bda52781f371f8773f64e58c78631c08d5d5e7423c4b761'
EXPECTED_PAGES = {
    'https://skygreenline-lab.io/': 'b4ef0179639b0ba4bc83787f4149435dd8bdb7f288a7868779a892367d4cdb25',
    'https://skygreenline-lab.io/thermal/': 'd35b25e85b3cb439e1cc4f68eb66fec127244a2c85d35dd6f956132a87ac5d17',
}
INCLUDE = '    include /etc/nginx/snippets/skymeet.conf;\n'


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True)


def verify_existing_pages():
    for url, checksum in EXPECTED_PAGES.items():
        with urlopen(url, timeout=20) as response:
            if response.status != 200 or hashlib.sha256(response.read()).hexdigest() != checksum:
                raise RuntimeError('Existing page changed; review before continuing: ' + url)


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo in your SSH terminal; do not share the password in chat.')
    os.umask(0o077)
    original = SITE.read_bytes()
    current = original.decode()
    already = INCLUDE in current
    if not already and hashlib.sha256(original).hexdigest() != EXPECTED_SITE:
        raise SystemExit('Nginx configuration changed since inspection; no changes made.')
    expected_snippet = (ROOT / 'deploy/nginx-skymeet.locations.conf.example').read_bytes()
    if SNIPPET.exists() and SNIPPET.read_bytes() != expected_snippet:
        raise SystemExit('An unexpected Sky Meet snippet already exists; review it first.')
    run('nginx', '-t')
    verify_existing_pages()
    with urlopen('http://127.0.0.1:8080/skymeet/api/health', timeout=10) as response:
        if response.status != 200:
            raise SystemExit('Sky Meet private health check failed.')
    backup = Path('/etc/nginx/skymeet-backups') / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(SITE, backup / SITE.name)
    if SNIPPET.exists():
        shutil.copy2(SNIPPET, backup / 'skymeet.conf')
    tls = Path('/etc/skymeet/tls')
    tls.mkdir(parents=True, exist_ok=True, mode=0o700)
    lineage = Path('/etc/letsencrypt/live/skygreenline-lab.io')
    for name in ('fullchain.pem', 'privkey.pem'):
        shutil.copyfile(lineage / name, tls / name)
        (tls / name).chmod(0o600)
    hook = Path('/etc/letsencrypt/renewal-hooks/deploy/skymeet-turn')
    hook_text = '''#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/skygreenline-lab.io ] || exit 0
install -m 600 "$RENEWED_LINEAGE/fullchain.pem" /etc/skymeet/tls/fullchain.pem
install -m 600 "$RENEWED_LINEAGE/privkey.pem" /etc/skymeet/tls/privkey.pem
docker restart skymeet-turn-1 >/dev/null
'''
    if hook.exists() and hook.read_text() != hook_text:
        raise SystemExit('An unexpected certificate-renewal hook exists; review it first.')
    hook.parent.mkdir(parents=True, exist_ok=True)
    hook.write_text(hook_text)
    hook.chmod(0o700)
    run('sudo', '-u', 'nasser', 'docker', 'compose', '--project-directory', str(ROOT), '-p', 'skymeet', '-f', str(ROOT / 'compose.yaml'), '-f', str(ROOT / 'compose.vps.yaml'), 'up', '-d', 'turn')
    if shutil.which('ufw') and 'Status: active' in run('ufw', 'status').stdout:
        for port in ('7881/tcp', '7882/udp', '34790/udp', '53490/tcp', '52000:52100/udp'):
            run('ufw', 'allow', port, 'comment', 'Sky Meet media')
    created_snippet = not SNIPPET.exists()
    try:
        SNIPPET.write_bytes(expected_snippet)
        SNIPPET.chmod(0o644)
        if not already:
            anchor = '    include /etc/nginx/snippets/thermal-inspector.conf;\n'
            if current.count(anchor) != 1:
                raise RuntimeError('Expected HTTPS include anchor is missing or ambiguous.')
            SITE.write_text(current.replace(anchor, anchor + INCLUDE, 1))
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        verify_existing_pages()
        with urlopen('https://skygreenline-lab.io/skymeet/api/health', timeout=20) as response:
            if response.status != 200:
                raise RuntimeError('Public Sky Meet health check failed.')
    except Exception:
        SITE.write_bytes(original)
        if created_snippet:
            SNIPPET.unlink(missing_ok=True)
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        raise
    print('Sky Meet HTTPS routing is active. Existing root and thermal page checksums are unchanged.')
    print('Nginx backup:', backup)
    print('Next: verify real media and TURN from an external browser.')


if __name__ == '__main__':
    main()
