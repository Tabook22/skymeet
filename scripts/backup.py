"""Consistent SQLite online backup; run inside api container or from the project."""
import argparse
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('destination', help='New backup file path; existing backups are never overwritten')
args = parser.parse_args()
url = os.environ.get('DATABASE_URL', 'sqlite:///./data/skymeet.db')
if not url.startswith('sqlite:///'):
    raise SystemExit('For PostgreSQL use pg_dump instead.')
source = Path(url.removeprefix('sqlite:///')).resolve()
target = Path(args.destination).resolve()
if target.exists() or target == source or not source.exists():
    raise SystemExit('Source must exist and destination must be a new file.')
target.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src, sqlite3.connect(target) as dst:
    src.backup(dst)
    assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
print('Consistent, verified backup created:', target)
