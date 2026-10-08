-- The artwork lookup now also fills in what Douban imports leave out: the summary
-- and a few facts (genres, episodes, publisher, platforms…) as JSON label/value pairs.
-- Every item is looked up again for whatever it is missing; artwork already stored is kept.
ALTER TABLE items ADD COLUMN facts TEXT;
ALTER TABLE items RENAME COLUMN backdrop_checked_at TO details_checked_at;
UPDATE items SET details_checked_at = NULL;
