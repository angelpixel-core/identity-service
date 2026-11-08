# Guía de Pruebas Interactivas: US-05 (PostgreSQL Row-Level Security & Multi-Tenant Isolation Engine)

> **Document ID:** `GUIDELINE-06-postgresql-rls-isolation`  
> **Bounded Context:** `identity` / `tenancy`  
> **Historia de Usuario:** `US-05: Database Tenant Session Context & RLS Policies Migration`  
> **Estándar Arquitectónico:** ADR-0005: PostgreSQL Row-Level Security Strategy & Zero-Trust Session Context  
> **Componente Principal:** `TenantAwareTransactionRunner` (`src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner.ts`)

---

## 1. Visión General

Esta guía describe los procedimientos paso a paso para interactuar manualmente y verificar de principio a fin las garantías de seguridad y aislamiento multi-tenant a nivel de base de datos introducidas en **US-05**.

En sistemas multi-tenant SaaS modernos, delegar el aislamiento exclusivamente a cláusulas `WHERE tenant_id = ?` en la capa de aplicación introduce riesgos de divulgación de datos por omisiones humanas o errores en consultas complejas. Para mitigar esto de raíz, el subsistema de persistencia de **AngelPixel Identity Service** aplica una arquitectura **Zero-Trust** con políticas simétricas forzadas de **PostgreSQL Row-Level Security (RLS)**:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   CAPA DE APLICACIÓN / HTTP (Express)                  │
│         X-Tenant-ID / Token JWT Claims -> TenantSessionContext         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 TenantAwareTransactionRunner (Port / Adapter)          │
│               1. BEGIN TRANSACTION                                     │
│               2. SELECT set_config('app.current_tenant_id', $1, true)  │
│               3. [Ejecución Repositorios / Savepoints anidados]        │
│               4. COMMIT / ROLLBACK (Limpieza automática SET LOCAL)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              MOTOR DE BASE DE DATOS: PostgreSQL (RLS Engine)           │
│      USING      (tenant_id = current_setting('app.current_tenant_id')) │
│      WITH CHECK (tenant_id = current_setting('app.current_tenant_id')) │
└────────────────────────────────────────────────────────────────────────┘
```

Esta guía permite verificar en vivo:
1. **Comportamiento Fail-Closed Zero-Trust:** Si una consulta se ejecuta sin haber establecido previamente el contexto de sesión (`app.current_tenant_id`), PostgreSQL devuelve exactamente **0 filas**.
2. **Aislamiento Hermético en Lectura:** Una sesión autenticada para `alpha-corp` no puede observar bajo ninguna circunstancia registros pertenecientes a `beta-corp`.
3. **Bloqueo Defensivo en Escritura (`WITH CHECK` Violation 42501):** Cualquier intento de insertar o actualizar un registro con un `tenant_id` divergente al de la sesión activa es rechazado de inmediato por el motor relacional.
4. **Resiliencia ante Fallos con Savepoints Anidados:** Posibilidad de ejecutar operaciones anidadas con puntos de restauración (`SAVEPOINT`) y recuperar la transacción principal sin abortarla ante errores parciales.
5. **Higiene y Reciclaje de Conexiones del Pool Físico:** Garantía de que el parámetro de sesión tiene ámbito transaccional estricto (`LOCAL`) y se disuelve automáticamente al hacer `COMMIT` o `ROLLBACK`.
6. **Verificación End-to-End vía API HTTP:** Flujo completo de registro y lectura de perfil mediante endpoints REST.

---

## 2. Preparación del Entorno

### Paso 2.1: Levantar los Contenedores en Docker Compose

Asegúrate de que la base de datos PostgreSQL (`identity-db`) y la API (`identity-api`) estén activas y saludables:

```bash
docker compose up -d
```

Verifica el estado de los contenedores:

```bash
docker compose ps
```

---

### Paso 2.2: Sincronización del DDL y Rol de Aplicación (`007`)

> [!IMPORTANT]
> **Superuser Bypass en PostgreSQL:**  
> En PostgreSQL, los usuarios con privilegios de superadministrador (como el usuario por defecto `postgres`) **omiten por diseño las políticas RLS**, incluso cuando la tabla tiene activa la directiva `FORCE ROW LEVEL SECURITY`.  
> 
> Por ello, la migración [`007-enable-postgresql-rls.sql`](../../infrastructure/local/initdb.d/007-enable-postgresql-rls.sql) aprovisiona el rol de aplicación sin privilegios de superusuario:  
> - **Usuario:** `identity_app`  
> - **Contraseña:** `identity_app_pass_2026`  
> - **Atributos:** `NOSUPERUSER NOBYPASSRLS`  
> 
> Todas las pruebas interactivas en `psql` deben realizarse conectándose como `identity_app` o ejecutando `SET ROLE identity_app;`.

Aplica la migración de RLS y creación del rol en caliente sobre la base de datos local:

```bash
docker compose exec -T db psql -U postgres < infrastructure/local/initdb.d/007-enable-postgresql-rls.sql
```

---

## 3. Pruebas Interactivas Paso a Paso vía `psql`

Conéctate a la terminal interactiva de PostgreSQL utilizando el rol de aplicación `identity_app`:

```bash
docker compose exec -it db psql -U identity_app -d identity_db
```

---

### Caso 1: Comportamiento Fail-Closed Zero-Trust (Query sin contexto de sesión)

**Objetivo:** Constatar que sin un tenant contextualizado en la sesión, la política RLS actúa de forma defensiva y no divulga ningún registro.

Ejecuta directamente una consulta de lectura sobre la tabla `users`:

```sql
SELECT id, email, tenant_id FROM users;
```

#### Salida Esperada:
```text
 id | email | tenant_id 
----+-------+-----------
(0 rows)
```

> [!NOTE]
> Aunque existan usuarios registrados en la base de datos, la expresión `current_setting('app.current_tenant_id', true)` evalúa a `NULL`, por lo que ninguna fila cumple la condición `tenant_id = NULL` y el resultado es herméticamente vacío.

---

### Caso 2: Aislamiento Estricto de Lectura Cross-Tenant

**Objetivo:** Verificar que dos organizaciones (`alpha-corp` y `beta-corp`) solo tienen visibilidad sobre sus propios registros.

1. Abre un bloque transaccional para **`alpha-corp`** e inserta un usuario de prueba:

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', 'alpha-corp', true);

INSERT INTO users (id, email, password_hash, tenant_id)
VALUES ('user-alpha-001', 'admin@alpha-corp.com', '$2b$06$mockHashForTesting123456', 'alpha-corp');

SELECT id, email, tenant_id FROM users;
COMMIT;
```

#### Salida Esperada:
```text
BEGIN
 set_config 
------------
 alpha-corp
(1 row)

INSERT 0 1
       id       |        email         | tenant_id  
----------------+----------------------+------------
 user-alpha-001 | admin@alpha-corp.com | alpha-corp
(1 row)

COMMIT
```

2. Abre un nuevo bloque transaccional para **`beta-corp`** e inserta su propio usuario:

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', 'beta-corp', true);

INSERT INTO users (id, email, password_hash, tenant_id)
VALUES ('user-beta-001', 'admin@beta-corp.com', '$2b$06$mockHashForTesting123456', 'beta-corp');

SELECT id, email, tenant_id FROM users;
COMMIT;
```

#### Salida Esperada:
```text
BEGIN
 set_config 
------------
 beta-corp
(1 row)

INSERT 0 1
      id       |        email        | tenant_id 
---------------+---------------------+-----------
 user-beta-001 | admin@beta-corp.com | beta-corp
(1 row)

COMMIT
```

3. Vuelve a consultar como **`alpha-corp`** y comprueba que `user-beta-001` es invisible:

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', 'alpha-corp', true);
SELECT id, email, tenant_id FROM users;
COMMIT;
```

#### Salida Esperada:
```text
       id       |        email         | tenant_id  
----------------+----------------------+------------
 user-alpha-001 | admin@alpha-corp.com | alpha-corp
(1 row)
```

> **Verificación:** Únicamente se retorna `user-alpha-001`. Cero exposición del registro de `beta-corp`.

---

### Caso 3: Rechazo Defensivo en Escritura (`WITH CHECK` Violation 42501)

**Objetivo:** Demostrar que un comando que intente insertar datos asignándoles un `tenant_id` ajeno al contexto autenticado es bloqueado a nivel de motor de base de datos.

Inicia una sesión para `alpha-corp` e intenta insertar un registro forzando `tenant_id = 'beta-corp'`:

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', 'alpha-corp', true);

INSERT INTO users (id, email, password_hash, tenant_id)
VALUES ('user-malicious', 'attacker@evil.com', '$2b$06$mockHashForTesting123456', 'beta-corp');
```

#### Salida Esperada:
```text
ERROR:  new row violates row-level security policy for table "users"
```

Aborta la transacción fallida:

```sql
ROLLBACK;
```

> [!CAUTION]
> El error `42501` se dispara antes de escribir en disco, impidiendo la inyección o alteración de datos de tenants ajenos aún si la capa de aplicación sufriera una vulnerabilidad.

---

### Caso 4: Transacciones Compuestas y Manejo de Savepoints

**Objetivo:** Verificar la capacidad de orquestar operaciones complejas con recuperación ante fallos mediante `SAVEPOINT`, preservando el trabajo válido sin abortar toda la transacción.

Ejecuta el siguiente bloque compuesto:

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', 'alpha-corp', true);

-- Operación primaria válida
INSERT INTO users (id, email, password_hash, tenant_id)
VALUES ('user-alpha-002', 'operator@alpha-corp.com', '$2b$06$mockHashForTesting123456', 'alpha-corp');

-- Punto de guardado
SAVEPOINT audit_step;

-- Operación secundaria defectuosa (intento cross-tenant)
INSERT INTO users (id, email, password_hash, tenant_id)
VALUES ('user-invalid', 'bad@alpha-corp.com', '$2b$06$mockHashForTesting123456', 'gamma-corp');
```

Tras recibir el error de RLS, ejecuta la recuperación hacia el savepoint y consolida:

```sql
ROLLBACK TO SAVEPOINT audit_step;

-- Verificar que user-alpha-002 sigue intacto dentro de la transacción
SELECT id, email, tenant_id FROM users WHERE id = 'user-alpha-002';

COMMIT;
```

#### Salida Esperada:
```text
ROLLBACK TO SAVEPOINT
       id       |          email          | tenant_id  
----------------+-------------------------+------------
 user-alpha-002 | operator@alpha-corp.com | alpha-corp
(1 row)

COMMIT
```

---

### Caso 5: Higiene y Reciclaje de Conexiones del Pool Físico

**Objetivo:** Garantizar que las conexiones físicas reutilizadas por el pool (e.g. `node-pg`) no retienen estado residual del tenant tras finalizar la transacción.

Verifica el valor de `current_setting` fuera de un bloque transaccional:

```sql
SELECT current_setting('app.current_tenant_id', true) AS active_tenant;
```

#### Salida Esperada:
```text
 active_tenant 
---------------
 
(1 row)
```

> [!TIP]
> Debido al tercer parámetro `true` en `set_config('app.current_tenant_id', ..., true)`, la variable tiene ámbito exclusivamente transaccional (`is_local = true`). Al emitir `COMMIT` o `ROLLBACK`, PostgreSQL disuelve automáticamente la configuración.

---

### Limpieza de Datos de Prueba en `psql`

Para mantener la base de datos limpia tras las pruebas manuales:

```sql
BEGIN;
SELECT set_config('app.current_tenant_id', 'alpha-corp', true);
DELETE FROM users WHERE id IN ('user-alpha-001', 'user-alpha-002');
COMMIT;

BEGIN;
SELECT set_config('app.current_tenant_id', 'beta-corp', true);
DELETE FROM users WHERE id IN ('user-beta-001');
COMMIT;

\q
```

---

## 4. Verificación End-to-End vía API HTTP (cURL)

Las garantías de RLS operan de forma transparente a través de los endpoints REST del Identity Service:

### Paso 4.1: Registro de Usuario bajo `alpha-corp`

```bash
curl -i -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: alpha-corp" \
  -d '{
    "email": "chief@alpha.com",
    "password": "SecurePassword123!",
    "name": "Alpha Chief"
  }'
```

#### Respuesta Esperada (`201 Created`):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "userId": "5a001d08-4c3d-4815-823e-1b626f5c0bbb",
  "email": "chief@alpha.com",
  "tenantId": "alpha-corp",
  "createdAt": "2026-11-08T17:24:37.371Z"
}
```

---

### Paso 4.2: Consulta de Perfil Autenticado (`GET /api/v1/auth/me`)

Utiliza el token obtenido en el paso anterior:

```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer <TOKEN_DE_ALPHA>" \
  -H "X-Tenant-ID: alpha-corp"
```

#### Respuesta Esperada (`200 OK`):
```json
{
  "id": "5a001d08-4c3d-4815-823e-1b626f5c0bbb",
  "email": "chief@alpha.com",
  "tenantId": "alpha-corp",
  "createdAt": "2026-11-08T17:24:37.359Z",
  "updatedAt": "2026-11-08T17:24:37.359Z"
}
```

---

### Paso 4.3: Intento de Suplantación Cross-Tenant (403 Forbidden)

Intenta enviar el token de `alpha-corp` solicitando el contexto de `beta-corp`:

```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer <TOKEN_DE_ALPHA>" \
  -H "X-Tenant-ID: beta-corp"
```

#### Respuesta Esperada (`403 Forbidden`):
```json
{
  "error": "Forbidden: Token does not belong to the requested tenant context"
}
```

---

## 5. Verificación Automatizada

Para ejecutar la batería completa de pruebas automatizadas que validan RLS y concurrencia:

```bash
# 1. Pruebas E2E de concurrencia (50 transacciones paralelas en pool físico simulado)
npm run test:e2e -- tests/e2e/security/tenant_rls_isolation.spec.ts

# 2. Pruebas de aceptación BDD (Living Documentation de RLS)
npm run test:acceptance -- tests/acceptance/step_defs/test_tenant_rls_isolation_steps.ts

# 3. Pruebas de integración del motor de políticas RLS
npm run test:integration -- tests/integration/security/test_rls_policies.ts

# 4. Verificación de la pirámide completa
npm test && npm run test:acceptance && npm run test:e2e && npm run test:sdk
```

---

## 6. Troubleshooting y Diagnóstico Común

### 1. `SELECT * FROM users` muestra todas las filas sin importar el tenant
- **Causa:** Te conectaste con el usuario superadministrador `postgres` (`BYPASSRLS`).
- **Solución:** Conéctate con `psql -U identity_app -d identity_db` o ejecuta `SET ROLE identity_app;` antes de tus consultas.

### 2. Error: `relation "users" does not exist`
- **Causa:** El volumen de PostgreSQL no fue inicializado con los scripts del directorio `initdb.d`.
- **Solución:** Sincroniza las migraciones ejecutando:
  ```bash
  docker compose exec -T db psql -U postgres < infrastructure/local/initdb.d/005-create-identity-schema.sql
  docker compose exec -T db psql -U postgres < infrastructure/local/initdb.d/007-enable-postgresql-rls.sql
  ```

### 3. Verificar las políticas RLS activas en el catálogo de PostgreSQL
Ejecuta la siguiente consulta para constatar la definición exacta de la política:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'users';
```