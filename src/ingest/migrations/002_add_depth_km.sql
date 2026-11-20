-- Migración 002: agregar columna depth_km (profundidad en km)
-- Se aplica a pulso_local y pulso_test con psql
ALTER TABLE earthquakes ADD COLUMN IF NOT EXISTS depth_km REAL NULL;
