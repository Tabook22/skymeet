"""Password-protected shared meeting invitations."""
from alembic import op
import sqlalchemy as sa

revision = '3dc2e62bf010'
down_revision = '9e1c02ec8729'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('meeting_credentials',
        sa.Column('meeting_id', sa.String(36), sa.ForeignKey('meetings.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('username', sa.String(32), nullable=False),
        sa.Column('password_hash', sa.Text(), nullable=False),
        sa.Column('encrypted_password', sa.Text(), nullable=False))
    op.create_table('shared_guest_sessions',
        sa.Column('digest', sa.String(64), primary_key=True),
        sa.Column('meeting_id', sa.String(36), sa.ForeignKey('meetings.id', ondelete='CASCADE'), nullable=False),
        sa.Column('identity', sa.String(80), nullable=False, unique=True),
        sa.Column('expires', sa.Integer(), nullable=False))
    op.create_index('ix_shared_guest_sessions_meeting_id', 'shared_guest_sessions', ['meeting_id'])
    # Previously issued bearer-only guest sessions must not bypass the new password gate.
    op.execute("DELETE FROM guest_sessions")
    op.execute("UPDATE participants SET decision = 'removed', connected = 0 WHERE user_id IS NULL")


def downgrade():
    op.drop_table('shared_guest_sessions')
    op.drop_table('meeting_credentials')
