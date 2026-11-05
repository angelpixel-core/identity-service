#!/usr/bin/env sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"

DB_NAME="${POSTGRES_DB:-identity_db}"
TEST_DB_NAME="${POSTGRES_TEST_DB:-identity_test_db}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
SELECT 'CREATE DATABASE ${DB_NAME}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SELECT 'CREATE DATABASE ${TEST_DB_NAME}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${TEST_DB_NAME}')\gexec
EOSQL

