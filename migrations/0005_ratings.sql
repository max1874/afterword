-- Whether a person uses star ratings; off hides the stars on their pages and in their forms.
-- Ratings already saved are kept.
ALTER TABLE users ADD COLUMN ratings INTEGER NOT NULL DEFAULT 1;
