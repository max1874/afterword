-- Games now also get artwork from SteamGridDB (Nintendo and PlayStation games among them);
-- look up the games that found none on Steam again.
UPDATE items SET details_checked_at = NULL WHERE kind = 'game' AND backdrop_key IS NULL;
