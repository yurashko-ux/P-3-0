-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS salons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT UNIQUE,
    name TEXT NOT NULL,
    address TEXT,
    timezone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT UNIQUE,
    salon_id UUID REFERENCES salons(id) ON DELETE SET NULL,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT UNIQUE,
    salon_id UUID REFERENCES salons(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    role TEXT,
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT UNIQUE,
    salon_id UUID REFERENCES salons(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER,
    price_cents INTEGER,
    currency TEXT DEFAULT 'USD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id TEXT UNIQUE,
    salon_id UUID REFERENCES salons(id) ON DELETE SET NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    status TEXT,
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    external_id TEXT UNIQUE,
    amount_cents INTEGER NOT NULL,
    currency TEXT DEFAULT 'USD',
    method TEXT,
    status TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload JSONB,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_clients_salon ON clients (salon_id);
CREATE INDEX IF NOT EXISTS idx_employees_salon ON employees (salon_id);
CREATE INDEX IF NOT EXISTS idx_services_salon ON services (salon_id);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments (client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_employee ON appointments (employee_id);
CREATE INDEX IF NOT EXISTS idx_appointments_service ON appointments (service_id);
CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments (appointment_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON sync_runs (source, started_at DESC);
