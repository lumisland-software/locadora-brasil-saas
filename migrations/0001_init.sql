PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workshops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cpf_cnpj TEXT,
  phone TEXT,
  email TEXT,
  cnh_number TEXT,
  cnh_expiry TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  risk_score INTEGER NOT NULL DEFAULT 50,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_customers_workshop ON customers(workshop_id, name);

CREATE TABLE IF NOT EXISTS tracker_providers (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  username_enc TEXT,
  password_enc TEXT,
  api_key_enc TEXT,
  devices_endpoint TEXT,
  positions_endpoint TEXT NOT NULL,
  mapping_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'moto',
  plate TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  year INTEGER,
  renavam TEXT,
  chassis TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  odometer_km REAL NOT NULL DEFAULT 0,
  purchase_price REAL NOT NULL DEFAULT 0,
  tracker_provider_id TEXT,
  tracker_external_id TEXT,
  last_lat REAL,
  last_lng REAL,
  last_speed REAL,
  last_ignition INTEGER,
  last_tracker_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workshop_id, plate),
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (tracker_provider_id) REFERENCES tracker_providers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_workshop ON vehicles(workshop_id, status);

CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  start_date TEXT NOT NULL,
  end_date TEXT,
  billing_frequency TEXT NOT NULL DEFAULT 'weekly',
  rate_amount REAL NOT NULL,
  deposit_amount REAL NOT NULL DEFAULT 0,
  contract_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);
CREATE INDEX IF NOT EXISTS idx_rentals_workshop ON rentals(workshop_id, status);

CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  rental_id TEXT,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  paid_at TEXT,
  external_id TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_charges_due ON charges(workshop_id, status, due_date);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  vehicle_id TEXT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  due_date TEXT,
  paid_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS maintenance_plans (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  component TEXT NOT NULL,
  interval_km REAL,
  interval_days INTEGER,
  last_service_km REAL NOT NULL DEFAULT 0,
  last_service_date TEXT,
  next_due_km REAL,
  next_due_date TEXT,
  alert_before_km REAL NOT NULL DEFAULT 500,
  alert_before_days INTEGER NOT NULL DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'ok',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_maintenance_due ON maintenance_plans(workshop_id, status);

CREATE TABLE IF NOT EXISTS maintenance_events (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  plan_id TEXT,
  component TEXT NOT NULL,
  service_date TEXT NOT NULL,
  odometer_km REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  supplier TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES maintenance_plans(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tracker_positions (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  external_device_id TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  speed_kph REAL,
  ignition INTEGER,
  odometer_km REAL,
  recorded_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_id) REFERENCES tracker_providers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tracker_vehicle_time ON tracker_positions(vehicle_id, recorded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tracker_position ON tracker_positions(provider_id, external_device_id, recorded_at);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  rental_id TEXT,
  vehicle_id TEXT NOT NULL,
  type TEXT NOT NULL,
  odometer_km REAL,
  fuel_level TEXT,
  damage_notes TEXT,
  photos_json TEXT,
  signed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE SET NULL,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fines (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  rental_id TEXT,
  customer_id TEXT,
  infraction_date TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (rental_id) REFERENCES rentals(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
