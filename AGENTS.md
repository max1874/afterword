# Afterword — agent notes

## Production database

Agents may apply D1 migrations and run data writes against the production
database themselves (`npx wrangler d1 migrations apply afterword --remote`,
`npx wrangler d1 execute afterword --remote …`). Max approved this exception to
his global "prepare SQL for Max" rule for this repository on 2026-10-08.

- Put schema and backfill changes in `migrations/` rather than one-off commands.
- Before a data write, run a read-only query that shows what it will touch.
- Deploy code that tolerates the old schema first, then apply the migration.
