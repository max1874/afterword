-- Games whose artwork came from SteamGridDB's community heroes are looked up again,
-- so IGDB's official key art can take their place where it exists. Their summaries
-- and facts are kept, and the next visit to each looks the artwork up again.
UPDATE items
SET backdrop_url = NULL, backdrop_key = NULL, details_checked_at = NULL
WHERE kind = 'game' AND backdrop_url LIKE 'https://cdn2.steamgriddb.com/%';
