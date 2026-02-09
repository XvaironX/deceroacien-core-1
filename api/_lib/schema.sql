-- Schema inicial híbrido Firebase Auth + Postgres
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- para gen_random_uuid en algunas plataformas

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE CASCADE,
  granted_at timestamptz DEFAULT now(),
  source TEXT,
  UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  mp_payment_id TEXT UNIQUE,
  external_reference TEXT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payer_email TEXT,
  status TEXT,
  amount NUMERIC(12,2),
  currency TEXT,
  raw_payload JSONB,
  created_at timestamptz DEFAULT now()
);

-- Índices auxiliares
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_external_ref ON payments(external_reference);
