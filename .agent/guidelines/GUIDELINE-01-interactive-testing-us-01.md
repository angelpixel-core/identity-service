# Guía de Pruebas Interactivas: US-01 (Multi-Tenant User Registration)

> **Document ID:** `GUIDELINE-01-interactive-testing-us-01`  
> **Bounded Context:** `identity`  
> **Historia de Usuario:** `US-01: Multi-Tenant User Registration`  
> **Arquitectura:** Vertical Slice + Hexagonal (DDD) + Multi-Tenant Isolation (ADR-0003)

---

## 1. Visión General

Esta guía detalla los procedimientos paso a paso para interactuar manualmente y validar de principio a fin las implementaciones de **US-01: Multi-Tenant User Registration**.

> [!TIP]
> **¿Prefieres pruebas visuales en el navegador?**  
> Para interactuar directamente con la interfaz visual en React (`RegisterForm`) o explorar todos los estados visuales en Storybook, consulta [GUIDELINE-03: Pruebas Visuales en Navegador](GUIDELINE-03-visual-browser-testing.md).

Permite probar el slice completo bajo dos modalidades:
1. **Modo Infraestructura Real:** Con contenedores Docker Alpine (PostgreSQL 16 y Redis 7) e inicialización automática de esquemas.
2. **Modo Aislado In-Memory:** Sin dependencias externas para desarrollo rápido y pruebas desconectadas.

---

## 2. Opción 1: Pruebas con PostgreSQL Real (Docker Compose)

### Paso 2.1: Levantar la Infraestructura Local

Ejecuta desde la raíz del proyecto:

```bash
npm run docker:up
# o alternativamente en background: docker compose up -d
```

> **Importante (Volúmenes Existentes de Docker):**
> La imagen oficial de PostgreSQL **solo** ejecuta los scripts de `/docker-entrypoint-initdb.d/` cuando el volumen de datos está vacío (en la primera inicialización del cluster).
> Si el volumen `identity_db_data` ya existía previamente antes de agregar los scripts, PostgreSQL omite la inicialización imprimiendo:
> `PostgreSQL Database directory appears to contain a database; Skipping initialization`
> 
> En ese caso, para reiniciar la base de datos limpia y forzar la ejecución automática de los scripts:
> ```bash
> docker compose down -v
> docker compose up -d
> ```

Verifica el estado de los contenedores:
```bash
docker compose ps
```

Ambos contenedores (`identity-db` y `identity-cache`) deben encontrarse en estado `healthy` o `Up`.

### Paso 2.2: Verificar Inicialización Automática de Base de Datos

Los scripts ubicados en `../../infrastructure/local/initdb.d/` se ejecutan en el primer arranque del contenedor:
* `001-create-user.sh`: Crea el rol configurado en `POSTGRES_USER`.
* `002-create-databases.sh`: Crea `identity_db` e `identity_test_db`.
* `003-grant-permissions.sh`: Otorga privilegios sobre ambas bases.
* `004-enable-extensions.sh`: Activa extensiones `uuid-ossp` y `pgcrypto`.
* `005-create-identity-schema.sql`: Crea la tabla `users` y los índices multi-tenant.

Para comprobar la creación de tablas:
```bash
docker exec -it identity-db psql -U postgres -d identity_db -c "\dt"
```

*Salida esperada:*
```text
        List of relations
 Schema | Name  | Type  |  Owner   
--------+-------+-------+----------
 public | users | table | postgres
```

### Paso 2.3: Configuración de Entorno (.env)

Verifica que el archivo `../../.env` apunte a la base de datos PostgreSQL local:

```env
PORT=4000
NODE_ENV=development
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=identity_db
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/identity_db
JWT_SECRET=super-secret-tenant-key-minimum-32-characters
JWT_EXPIRATION_SECONDS=3600
CACHE_TTL_SECONDS=300
```

> **Nota de Conectividad:**
> * Al ejecutar la aplicación desde la máquina host (ej. `npm run dev:api`), la conexión se realiza a `localhost:5432`.
> * Si la aplicación se ejecutara dentro de la red interna de Docker Compose, el host sería el nombre de servicio agnóstico `db:5432`.

### Paso 2.4: Iniciar el Servidor API

```bash
npm run dev:api
```

*Salida esperada en terminal:*
```text
Identity Service HTTP Server listening on port 4000
Connected to PostgreSQL: postgresql://postgres:postgres@localhost:5432/identity_db
```

---

## 3. Pruebas Manuales de Casos de Uso (HTTP / REST)

Abre una segunda terminal o tu cliente HTTP preferido (cURL, Postman, Bruno).

### Caso 3.1: Registro Exitoso de Usuario (HTTP 201 Created)

Registra un nuevo usuario en el tenant `acme-corp`:

```bash
curl -i -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: acme-corp" \
  -d '{
    "email": "alice@acme.com",
    "password": "Password123!"
  }'
```

*Respuesta esperada:*
```json
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{
  "user": {
    "id": "e93cb530-9bbf-4d89-9a7d-b6311e9a2631",
    "email": "alice@acme.com",
    "tenantId": "acme-corp",
    "createdAt": "2026-11-04T22:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### Caso 3.2: Conflicto por Email Duplicado en el Mismo Tenant (HTTP 409 Conflict)

Reintenta el registro con el mismo email y tenant:

```bash
curl -i -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: acme-corp" \
  -d '{
    "email": "alice@acme.com",
    "password": "Password123!"
  }'
```

*Respuesta esperada:*
```json
HTTP/1.1 409 Conflict
Content-Type: application/json; charset=utf-8

{
  "error": "User with email alice@acme.com already exists in tenant acme-corp"
}
```

---

### Caso 3.3: Aislamiento Multi-Tenant (Mismo Email, Distinto Tenant) (HTTP 201 Created)

Registra el **mismo email** (`alice@acme.com`), pero bajo un tenant diferente (`beta-corp`):

```bash
curl -i -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: beta-corp" \
  -d '{
    "email": "alice@acme.com",
    "password": "Password123!"
  }'
```

*Respuesta esperada:*
```json
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{
  "user": {
    "id": "14f2a74c-8472-4660-8430-80252ff2ef78",
    "email": "alice@acme.com",
    "tenantId": "beta-corp",
    "createdAt": "2026-11-04T22:01:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

> **Verificación de Invariante:** Se confirma que la unicidad del email está estrictamente acotada a la tupla `(email, tenant_id)`, garantizando el aislamiento según ADR-0003.

---

### Caso 3.4: Validaciones Defensivas (HTTP 400 Bad Request)

#### A. Ausencia del Header de Tenant (`x-tenant-id`)
```bash
curl -i -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "valid@email.com", "password": "Password123!"}'
```
*Respuesta:* `400 Bad Request` -> `{"error":"x-tenant-id header is required"}`

#### B. Contraseña Corta (< 8 Caracteres)
```bash
curl -i -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: acme-corp" \
  -d '{"email": "valid@email.com", "password": "123"}'
```
*Respuesta:* `400 Bad Request` -> `{"error":"Validation Error","details":[...]}`

#### C. Formato de Email Inválido
```bash
curl -i -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: acme-corp" \
  -d '{"email": "not-an-email", "password": "Password123!"}'
```
*Respuesta:* `400 Bad Request`

---

## 4. Inspección Directa en PostgreSQL

Para verificar la persistencia real, las fechas de auditoría y el hashing con Bcrypt:

```bash
docker exec -it identity-db psql -U postgres -d identity_db -c "
SELECT 
    id, 
    email, 
    tenant_id, 
    LEFT(password_hash, 15) AS hash_prefix, 
    created_at 
FROM users;
"
```

*Salida esperada:*
```text
                  id                  |     email      | tenant_id |   hash_prefix   |          created_at           
--------------------------------------+----------------+-----------+-----------------+-------------------------------
 e93cb530-9bbf-4d89-9a7d-b6311e9a2631 | alice@acme.com | acme-corp | $2b$06$gY9tK8...| 2026-11-04 22:00:00.000000+00
 14f2a74c-8472-4660-8430-80252ff2ef78 | alice@acme.com | beta-corp | $2b$06$jZ3kL2...| 2026-11-04 22:01:00.000000+00
```

---

## 5. Opción 2: Modo Aislado In-Memory (Zero Dependencies)

Si no dispones de Docker o deseas una ejecución puramente volátil:

1. Modifica temporalmente `../../.env` o inicia la aplicación sin `DATABASE_URL`:
   ```bash
   DATABASE_URL="" npm run dev:api
   ```
2. La consola notificará:
   ```text
   Identity Service HTTP Server listening on port 4000
   Running in isolated in-memory storage mode
   ```
3. Todas las pruebas cURL descritas en la Sección 3 funcionarán idénticamente. Al reiniciar el proceso, el almacenamiento volátil se restablecerá.

---

## 6. Ejecución de la Pirámide de Pruebas Automatizadas

Para validar las 4 capas de pruebas del slice:

```bash
# Nivel 1: Unit Tests (Dominio y Casos de Uso en memoria)
npm run test:unit

# Nivel 2: Integration Tests (Repositorios Postgres y APIs Express)
npm run test:integration

# Nivel 3: Acceptance Tests (Escenarios BDD Gherkin / Cucumber)
npm run test:acceptance

# Nivel 4: E2E Tests (Formulario React RegisterForm)
npm run test:e2e

# Ejecución Completa de la Suite
npm test
```

---

## 7. Comandos de Gestión de Infraestructura

| Comando | Acción |
| :--- | :--- |
| `npm run docker:up` | Levanta contenedores PostgreSQL y Redis en background |
| `npm run docker:down` | Detiene y remueve contenedores de la infraestructura |
| `npm run docker:logs` | Sigue en tiempo real los logs de los contenedores |
| `docker compose down -v` | Detiene contenedores y elimina volúmenes de datos (`db_data`, `cache_data`) |

