#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 --set=app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
CREATE ROLE personamarket_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE personamarket TO personamarket_app;
GRANT USAGE ON SCHEMA public TO personamarket_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO personamarket_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO personamarket_app;
SQL
