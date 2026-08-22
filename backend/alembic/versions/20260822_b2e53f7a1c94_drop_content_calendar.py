"""drop content_item (Content Calendar removed)

Revision ID: b2e53f7a1c94
Revises: a1f42c9d8b3e
Create Date: 2026-08-22 15:00:00.000000

The owner's explicit instruction: remove Content Calendar entirely — route, components, backend
API, model, and data. `content_item` had exactly one real row at the time of this migration
(backed up to `backend/content_item_backup_20260822.csv` before this ran, as a precaution rather
than an expectation of needing it).

`DROP TABLE` takes its own indexes and CHECK constraints with it
(`ix_content_item_backlog`, `ck_content_item_platform_required_past_idea`,
`ck_content_item_title_not_blank`) — nothing to drop explicitly. The two enum types
(`status`, `platform`) were created implicitly by the original migration's inline `sa.Enum(...)`,
so — per this project's own standing rule for enum columns — they are dropped explicitly here,
`create_type=False` on the recreated columns in `downgrade()` so a rollback does not double-create
them.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b2e53f7a1c94"
down_revision: str | None = "a1f42c9d8b3e"
branch_labels: str | None = None
depends_on: str | None = None

status_enum = postgresql.ENUM("idea", "draft", "posted", name="status", create_type=False)
platform_enum = postgresql.ENUM("tiktok", "instagram", "youtube", name="platform", create_type=False)


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table("content_item")

    bind = op.get_bind()
    status_enum.drop(bind, checkfirst=False)
    platform_enum.drop(bind, checkfirst=False)


def downgrade() -> None:
    """Downgrade schema. Recreates the table and its constraints; does not restore data —
    see `backend/content_item_backup_20260822.csv` for the one row that existed."""
    bind = op.get_bind()
    status_enum.create(bind, checkfirst=False)
    platform_enum.create(bind, checkfirst=False)

    op.create_table(
        "content_item",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("hook", sa.String(length=500), nullable=True),
        sa.Column("platform", platform_enum, nullable=True),
        sa.Column("scheduled_date", sa.Date(), nullable=True),
        sa.Column("status", status_enum, server_default="idea", nullable=False),
        sa.Column("published_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status = 'idea' OR platform IS NOT NULL",
            name="ck_content_item_platform_required_past_idea",
        ),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_content_item_title_not_blank"),
    )
    op.create_index(
        "ix_content_item_backlog",
        "content_item",
        [sa.text("created_at DESC")],
        unique=False,
        postgresql_where=sa.text("scheduled_date IS NULL"),
    )
    op.create_index(
        op.f("ix_content_item_scheduled_date"), "content_item", ["scheduled_date"], unique=False
    )
    op.create_index(op.f("ix_content_item_status"), "content_item", ["status"], unique=False)
