-- Add English name/tagline fields to companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS name_en TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tagline TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_en TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_en2 TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS terms_en TEXT;

-- Add English name/address fields to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name_en TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_en TEXT;
