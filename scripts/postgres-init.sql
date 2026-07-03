-- Runs once when the postgres volume is first initialized (docker-compose).
-- The main database (quickdraw_chat) is created by POSTGRES_DB; these two are
-- needed by `prisma migrate dev` (shadow) and TEST_DATABASE_URL integration
-- runs. If your volume predates this script, create them manually:
--   docker exec <container> psql -U dev -d quickdraw_chat \
--     -c "CREATE DATABASE quickdraw_chat_shadow" -c "CREATE DATABASE quickdraw_chat_test"
CREATE DATABASE quickdraw_chat_shadow;
CREATE DATABASE quickdraw_chat_test;
