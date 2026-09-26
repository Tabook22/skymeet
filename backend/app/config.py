from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    database_url: str = 'sqlite:///./data/skymeet.db'
    app_origin: str = 'http://localhost:5173'
    app_base_path: str = '/skymeet'
    production: bool = False
    app_secret: str
    livekit_url: str = 'ws://localhost:7880'
    livekit_internal_url: str = 'http://localhost:7880'
    livekit_api_key: str
    livekit_api_secret: str
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_user: str = ''
    smtp_password: str = ''
    smtp_from: str = 'Sky Meet <meet@example.com>'
    smtp_starttls: bool = True
    asset_dir: str = './data/assets'

    @model_validator(mode='after')
    def secure_config(self):
        if any('REPLACE_' in x for x in (self.app_secret, self.livekit_api_key, self.livekit_api_secret)):
            raise ValueError('Replace placeholder credentials before starting Sky Meet')
        if len(self.app_secret) < 32 or len(self.livekit_api_secret) < 32:
            raise ValueError('APP_SECRET and LIVEKIT_API_SECRET must contain at least 32 characters')
        if self.production and (not self.app_origin.startswith('https://') or not self.livekit_url.startswith('wss://')):
            raise ValueError('Production requires HTTPS APP_ORIGIN and WSS LIVEKIT_URL')
        return self


@lru_cache
def config():
    return Config()
