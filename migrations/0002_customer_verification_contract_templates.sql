PRAGMA foreign_keys = ON;

ALTER TABLE customers ADD COLUMN person_type TEXT NOT NULL DEFAULT 'individual';
ALTER TABLE customers ADD COLUMN birth_date TEXT;
ALTER TABLE customers ADD COLUMN rg_number TEXT;
ALTER TABLE customers ADD COLUMN cnh_category TEXT;
ALTER TABLE customers ADD COLUMN consent_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE customers ADD COLUMN consent_at TEXT;
ALTER TABLE customers ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS customer_verifications (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  verification_type TEXT NOT NULL,
  provider TEXT,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  result_summary TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  reviewed_by TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_verifications
  ON customer_verifications(workshop_id, customer_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS contract_templates (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  document_type TEXT NOT NULL DEFAULT 'rental',
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES contract_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_templates
  ON contract_templates(workshop_id, status, name);
