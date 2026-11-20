"""Migration system for database schema changes."""

from __future__ import annotations

import logging
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

logger = logging.getLogger("ingest.migrations")

MIGRATIONS_DIR = Path(__file__).parent

MIGRATION_TABLE_DDL = """
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
"""


def get_applied_migrations(dsn: str) -> set[str]:
    """Get set of already applied migration versions."""
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(MIGRATION_TABLE_DDL)
            conn.commit()
            cur.execute("SELECT version FROM schema_migrations ORDER BY version")
            return {row[0] for row in cur.fetchall()}


def apply_migration(dsn: str, version: str, sql: str) -> None:
    """Apply a single migration and record it."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        logger.info("migration.applied", extra={"version": version})


def record_migration(dsn: str, version: str) -> None:
    """Record that a migration was applied."""
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s) ON CONFLICT DO NOTHING",
                (version,),
            )
        conn.commit()


def run_migrations(dsn: str) -> None:
    """Run all pending migrations in order."""
    applied = get_applied_migrations(dsn)
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

    for migration_file in migration_files:
        version = migration_file.stem
        if version in applied:
            logger.info("migration.skipped", extra={"version": version, "reason": "already_applied"})
            continue

        sql = migration_file.read_text(encoding="utf-8")
        apply_migration(dsn, version, sql)
        record_migration(dsn, version)

    logger.info("migrations.completed", extra={"applied_count": len(migration_files) - len(applied)})