-- Landscape artwork for wide cards: TMDB backdrops for films and series, Steam
-- heroes for games. Looked up once (backdrop_checked_at), stored in R2 like covers.
ALTER TABLE items ADD COLUMN backdrop_url TEXT;
ALTER TABLE items ADD COLUMN backdrop_key TEXT;
ALTER TABLE items ADD COLUMN backdrop_checked_at TEXT;
