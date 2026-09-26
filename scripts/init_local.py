"""Create ignored local secrets/config. Does not overwrite an existing .env."""
from pathlib import Path
import secrets
import re

root = Path(__file__).resolve().parents[1]
env = root / '.env'
if not env.exists():
    env.write_text('APP_SECRET=' + secrets.token_urlsafe(48) + '\nLIVEKIT_API_KEY=' + secrets.token_hex(12) + '\nLIVEKIT_API_SECRET=' + secrets.token_urlsafe(48) + '\nAPP_ORIGIN=http://localhost:5173\nAPP_BASE_PATH=/skymeet\nPRODUCTION=false\nDATABASE_URL=sqlite:///./data/skymeet.db\nLIVEKIT_URL=ws://localhost:7883\nLIVEKIT_INTERNAL_URL=http://localhost:7880\n', encoding='utf-8')
values = dict(line.split('=', 1) for line in env.read_text().splitlines() if '=' in line and not line.startswith('#'))
local = root / '.local'
local.mkdir(exist_ok=True)
(root / 'data').mkdir(exist_ok=True)
(local / 'livekit.yaml').write_text(f'''port: 7880
bind_addresses: ["127.0.0.1"]
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  node_ip: 127.0.0.1
keys:
  {values['LIVEKIT_API_KEY']}: {values['LIVEKIT_API_SECRET']}
webhook:
  api_key: {values['LIVEKIT_API_KEY']}
  urls: ["http://127.0.0.1:8000/api/livekit/webhook"]
room:
  empty_timeout: 300
  departure_timeout: 60
''', encoding='utf-8')
print('Local secrets and LiveKit configuration ready. No credentials were printed.')
