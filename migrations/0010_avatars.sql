-- A photo chosen as a person's avatar, in R2 beside the covers; without one the
-- initial of their name stands in.
ALTER TABLE users ADD COLUMN avatar_key TEXT;
