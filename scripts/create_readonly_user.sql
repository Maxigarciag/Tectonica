-- Script para crear usuario de solo lectura para la API
-- Ejecutar como superusuario (postgres) en la base de datos pulso

-- 1. Crear el usuario (cambiar la contraseña)
CREATE USER api_readonly WITH PASSWORD 'CHANGE_THIS_PASSWORD';

-- 2. Conceder permisos de solo lectura en la tabla earthquakes
GRANT SELECT ON earthquakes TO api_readonly;

-- 3. Conceder permisos en la secuencia si existe (para version)
-- No hay secuencia auto-generada, version se maneja manualmente en upsert

-- 4. Opcional: Conceder permisos en la tabla schema_migrations si se necesita
-- GRANT SELECT ON schema_migrations TO api_readonly;

-- 5. Verificar permisos
\du api_readonly
\dp earthquakes

-- Notas:
-- - La contraseña debe configurarse via variable de entorno DATABASE_URL_API
--   en el formato: postgresql://api_readonly:PASSWORD@host:5432/pulso
-- - Este usuario NO tiene permisos para INSERT, UPDATE, DELETE, TRUNCATE
-- - Solo puede hacer SELECT en la tabla earthquakes
-- - Para rotar la contraseña: ALTER USER api_readonly WITH PASSWORD 'NEW_PASSWORD';