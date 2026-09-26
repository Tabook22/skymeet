"""Operator-only administration. No public bootstrap endpoint or default password."""
import argparse
import getpass
import os
from sqlalchemy import select
from pydantic import TypeAdapter, EmailStr
from .db import SessionLocal
from .models import User, Company, Audit
from .schemas import SettingsIn
from .security import passwords


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['create-admin'])
    parser.add_argument('--email', required=True)
    parser.add_argument('--name', default='Administrator')
    args = parser.parse_args()
    email = str(TypeAdapter(EmailStr).validate_python(args.email)).lower()
    password = getpass.getpass('New password (12+ characters): ')
    if len(password) < 12 or len(password) > 128 or password != getpass.getpass('Confirm password: '):
        raise SystemExit('Passwords must match and contain 12–128 characters.')
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.role == 'admin')):
            raise SystemExit('An administrator already exists. Use the authenticated admin interface.')
        user = User(email=email, name=args.name, password_hash=passwords.hash(password), role='admin')
        db.add(user)
        db.add(Company(id=1, settings=SettingsIn().model_dump(mode='json')))
        db.add(Audit(actor='operator', action='admin.bootstrapped'))
        db.commit()
    print('Administrator created. Sign in through Sky Meet.')


if __name__ == '__main__':
    main()
