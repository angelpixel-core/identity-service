#!/usr/bin/env sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"

DB_NAME="${POSTGRES_DB:-identity_db}"
TEST_DB_NAME="${POSTGRES_TEST_DB:-identity_test_db}"

for db_name in "$DB_NAME" "$TEST_DB_NAME"; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db_name" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOSQL
done

