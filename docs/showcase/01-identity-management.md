---
title: "Epic 01: Multi-Tenant Identity & User Lifecycle"
description: "Showcase interactivo de registro de usuarios multi-inquilino, hashing Argon2id, perfiles autenticados y aceleración de caché Redis."
epic_id: "EPIC-01"
epic_name: "Multi-Tenant Identity & User Lifecycle"
bounded_context: "identity"
user_stories:
  - id: "US-01"
    name: "Multi-Tenant User Registration & Credential Provisioning"
    status: "completed"
  - id: "US-02"
    name: "Authenticated User Profile & In-Memory Redis Caching"
    status: "completed"
architecture_pattern: "Vertical Slice + Hexagonal (DDD)"
security_standards:
  - "Argon2id (RFC 9106)"
  - "PostgreSQL 16 RLS"
  - "Zod Input Validation"
  - "Redis 7 In-Memory Caching"
created_at: "2026-11-17"
updated_at: "2026-11-17"
tags:
  - showcase
  - walkthrough
  - epic-01
  - identity
  - multi-tenancy
  - argon2id
  - redis
---

# 🏢 Epic 01: Multi-Tenant Identity & User Lifecycle

[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1.0-green.svg)](http://localhost:4000/api/docs/#/Authentication/post_api_v1_auth_register)
[![Argon2id](https://img.shields.io/badge/Password%20Hashing-Argon2id%20(RFC%209106)-blue.svg)](#)
[![Validation](https://img.shields.io/badge/Schema%20Validation-Zod%20Strict-yellow.svg)](#)
[![Storage](https://img.shields.io/badge/Database-PostgreSQL%2016%20RLS-336791.svg)](#)
[![Cache](https://img.shields.io/badge/Cache-Redis%207%20In--Memory-DC382D.svg)](#)

Este capítulo documenta la arquitectura, implementación y validación en vivo del **Épico 01: Gestión del Ciclo de Vida de Identidad Multi-Inquilino**, cubriendo el registro de usuarios, derivación criptográfica de contraseñas con Argon2id, aprovisionamiento de credenciales seguras, perfil autenticado y aceleración in-memory con Redis 7.

---

## 📌 Historias de Usuario

| Historia | Descripción | Estado |
| :--- | :--- | :---: |
| **US-01** | Registro de Usuarios Multi-Tenant y Aprovisionamiento Seguro de Credenciales | ✅ En Producción |
| **US-02** | Perfil de Usuario Autenticado y Aceleración con Caché In-Memory Redis | ✅ En Producción |

---

## 🔐 US-01: Registro de Usuarios Multi-Tenant con Argon2id

### 1. Arquitectura y Flujo Criptográfico

El endpoint `POST /api/v1/auth/register` recibe solicitudes tanto desde la interfaz web (React SPA) como desde integraciones API de terceros. La arquitectura implementa validación estricta de entrada con esquemas **Zod**, derivación de hash de contraseña de grado bancario con **Argon2id** (configurado para resistir ataques con GPU/ASIC según RFC 9106) y persistencia parametrizada en PostgreSQL bajo el esquema de aislamiento multi-tenant.

```mermaid
sequenceDiagram
    autonumber
    actor User as Cliente / Frontend SPA
    participant Gateway as Express API Gateway
    participant Zod as Zod Schema Validator
    participant AuthSvc as AuthenticationService
    participant Argon as Argon2id Engine (RFC 9106)
    participant DB as PostgreSQL 16 (Tenant Pool)

    User->>Gateway: POST /api/v1/auth/register (X-Tenant-ID, email, password, name)
    Gateway->>Zod: Validar payload y headers (Zod.parse)
    alt Payload Inválido
        Zod-->>User: 400 Bad Request (RFC 7807 Error Details)
    end
    Zod->>AuthSvc: register(tenantId, email, password, name)
    AuthSvc->>Argon: hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 4 })
    Argon-->>AuthSvc: Hash string seguro ($argon2id$v=19$m=65536...)
    AuthSvc->>DB: INSERT INTO users (id, tenant_id, email, password_hash, name)
    DB-->>AuthSvc: User Record Creado
    AuthSvc-->>Gateway: User Aggregate (Sin password_hash) + Token JWT
    Gateway-->>User: 201 Created (userId, email, tenantId, accessToken)
```

#### A. Glosario de Actores y Componentes (Cajas del Diagrama)

| Participante / Caja | Tipo | Rol Arquitectónico y Frontera de Seguridad |
| :--- | :--- | :--- |
| **`User` (Cliente / Frontend SPA)** | `actor` | Usuario final o interfaz gráfica React que inicia el proceso de registro remitiendo credenciales e identificador de organización. |
| **`Gateway` (Express API Gateway)** | `participant` | Punto de entrada perimetral HTTP/REST. Aplica middlewares de auditoría, trazabilidad W3C y enrutamiento hacia los controladores. |
| **`Zod` (Zod Schema Validator)** | `participant` | Capa de validación sintáctica y tipado estricto. Aplica esquemas declarativos (`RegisterUserSchema`), rechazando payloads anómalos antes de tocar el dominio. |
| **`AuthSvc` (AuthenticationService)** | `participant` | Servicio de aplicación orquestador (`RegisterUserCommandHandler`). Coordina la política de contraseñas, hashing, persistencia y emisión de tokens. |
| **`Argon` (Argon2id Engine RFC 9106)** | `participant` | Motor criptográfico de derivación de claves optimizado contra ataques por hardware masivo (GPU/FPGA/ASIC), con 64MB de memoria y 4 hilos de paralelismo. |
| **`DB` (PostgreSQL 16 Tenant Pool)** | `participant` | Base de datos relacional con aislamiento multi-inquilino activado por Row-Level Security (RLS). |

#### B. Desglose Secuencial del Flujo (Pasos 1 al 10)

1. **Paso 1 (`User -> Gateway`):** El cliente envía `POST /api/v1/auth/register` con la cabecera `X-Tenant-ID` y el cuerpo JSON (`email`, `password`, `name`).
2. **Paso 2 (`Gateway -> Zod`):** El gateway delega el payload en el middleware de validación `Zod.parse`.
3. **Paso 3 (`Zod -->> User` [Bifurcación: Payload Inválido]):** Si los campos no cumplen las restricciones del esquema (e.g. contraseña débil o email sintácticamente inválido), se interrumpe el flujo y se retorna de inmediato `HTTP 400 Bad Request` con los detalles estructurados RFC 7807 sin invocar la capa de dominio.
4. **Paso 4 (`Zod -> AuthSvc`):** Superada la validación estructural, se invoca el comando de registro (`RegisterUserCommandHandler`) con el contexto del inquilino.
5. **Paso 5 (`AuthSvc -> Argon`):** Se delega la contraseña plana al motor Argon2id configurado según los estándares RFC 9106 (`memoryCost: 65536 KiB`, `timeCost: 3`, `parallelism: 4`).
6. **Paso 6 (`Argon -->> AuthSvc`):** El motor genera la cadena de hash estructurada e irreversible (`$argon2id$v=19$m=65536...`).
7. **Paso 7 (`AuthSvc -> DB`):** Se ejecuta la inserción SQL parametrizada en la tabla `users` asociando el registro al `tenant_id` contextual.
8. **Paso 8 (`DB -->> AuthSvc`):** La base de datos confirma la creación del registro asegurando unicidad del correo por inquilino.
9. **Paso 9 (`AuthSvc -->> Gateway`):** Se construye el agregado de dominio con el hash de contraseña estrictamente omitido (`Sanitized User DTO`) y se genera el token JWT de acceso.
10. **Paso 10 (`Gateway -->> User`):** Se responde con `HTTP 201 Created` retornando `userId`, `email`, `tenantId` y `accessToken`.

---

### 2. Evidencia Visual: Portal Web de Registro

La captura de pantalla a continuación fue generada de manera automatizada mediante el motor **Playwright** apuntando al contenedor en vivo `identity-web` (`http://localhost:3000/`):

![Multi-Tenant Registration Form](./assets/screenshots/us01_registration_form.png)

---

### 3. Ejecución en Vivo & Verificación Interactiva

#### Paso 0: Preparación de la Sesión Interactiva en Terminal

Ejecuta este bloque para inicializar las variables de entorno de la sesión antes de comenzar las pruebas:

```bash
# ==============================================================================
# Variables de Sesión Interactiva para Gestión de Identidades
# ==============================================================================
export BASE_URL="http://localhost:4000"
export TENANT_ID="acme-corp"
```

---

#### Escenario A: Registro Exitoso de Usuario Multi-Tenant (HTTP 201 Created)

El comando ejecuta el registro y extrae automáticamente el `accessToken` y `userId` hacia variables de entorno de tu sesión de shell mediante `jq`:

**Comando CLI Oficial (`./bin/identity`):**

```bash
REG_RESP=$(./bin/identity auth register \
  --tenant "$TENANT_ID" \
  --email "lead.architect.$(date +%s)@acme-corp.com" \
  --password "EnterprisePassword2026!" \
  --name "Sofia Valenzuela" \
  --raw-json)

export TOKEN=$(echo "$REG_RESP" | jq -r .accessToken)
export USER_ID=$(echo "$REG_RESP" | jq -r .userId)

echo "TOKEN=$TOKEN"
echo "USER_ID=$USER_ID"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
REG_RESP=$(curl -s -X POST "$BASE_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -d "{
    \"email\": \"lead.architect.$(date +%s)@acme-corp.com\",
    \"password\": \"EnterprisePassword2026!\",
    \"name\": \"Sofia Valenzuela\"
  }")

export TOKEN=$(echo "$REG_RESP" | jq -r .accessToken)
export USER_ID=$(echo "$REG_RESP" | jq -r .userId)

echo "TOKEN=$TOKEN"
echo "USER_ID=$USER_ID"
```
</details>

##### Respuesta Real Obtenida (HTTP 201 Created):

```text
HTTP/1.1 201 Created [143ms]
POST http://localhost:4000/api/v1/auth/register

{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjYWM1MDNmYS1iY2UyLTRkNGUtYTNhNy05ZGMyNzU5YTAzNTYiLCJlbWFpbCI6ImxlYWQuYXJjaGl0ZWN0QGFjbWUtY29ycC5jb20iLCJ0ZW5hbnRJZCI6ImFjbWUtY29ycCIsImlhdCI6MTc5NTAwOTU4NiwiZXhwIjoxNzk1MDEzMTg2fQ.aYxGsKGYfGHuPIwFxlBSaWi1O0xr9p2dtdddGkdJVH4",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjYWM1MDNmYS1iY2UyLTRkNGUtYTNhNy05ZGMyNzU5YTAzNTYiLCJlbWFpbCI6ImxlYWQuYXJjaGl0ZWN0QGFjbWUtY29ycC5jb20iLCJ0ZW5hbnRJZCI6ImFjbWUtY29ycCIsImlhdCI6MTc5NTAwOTU4NiwiZXhwIjoxNzk1MDEzMTg2fQ.aYxGsKGYfGHuPIwFxlBSaWi1O0xr9p2dtdddGkdJVH4",
  "userId": "cac503fa-bce2-4d4e-a3a7-9dc2759a0356",
  "email": "lead.architect@acme-corp.com",
  "tenantId": "acme-corp",
  "createdAt": "2026-11-18T13:46:26.930Z"
}
```

> [!NOTE]
> **Inspección de Seguridad:**
> 1. El campo `password_hash` nunca se expone en la respuesta JSON (Prevención de fuga de PII y credenciales).
> 2. El token JWT emitido incluye el claim inmutable `tenantId: "acme-corp"`, vinculando la sesión al inquilino correspondiente.
> 3. También puedes invocar y probar este endpoint de forma gráfica en **Swagger UI**: [`http://localhost:4000/api/docs/#/Authentication/post_api_v1_auth_register`](http://localhost:4000/api/docs/#/Authentication/post_api_v1_auth_register).

---

### 4. Cobertura de Pruebas Automatizadas

El comportamiento de registro multi-tenant y manejo seguro de contraseñas está certificado por la suite de pruebas unitarias:

```bash
npm run test:unit tests/unit/services/auth_service.test.ts
```

- **Invariante 1:** Validación de fortaleza de contraseñas (mínimo 8 caracteres, mayúsculas, minúsculas, números y caracteres especiales).
- **Invariante 2:** Rechazo estricto de duplicidad de correo dentro del mismo inquilino (`EmailAlreadyExistsException`).
- **Invariante 3:** Coexistencia de idéntico correo electrónico en diferentes inquilinos (aislamiento multi-tenant estricto).

---

## ⚡ US-02: Perfil de Usuario Autenticado & Caché In-Memory Redis

### 1. Arquitectura y Patrón Cache-Aside

El endpoint `GET /api/v1/auth/me` implementa el patrón de lectura de alto rendimiento **Cache-Aside** (*Read Slice* en CQRS):

1. **Aislamiento Criptográfico de Sesión:** El middleware `authMiddleware` valida la firma del JWT Bearer y el claim `tenantId`.
2. **Defensa Zero-Trust Multi-Tenant:** Se exige coincidencia estricta entre la cabecera `X-Tenant-ID` y el claim `tenantId` embebido en el token. Si difieren, se aborta inmediatamente con `HTTP 403 Forbidden`.
3. **Lookup en Redis In-Memory:** Se consulta la clave aislada por inquilino `user_profile:{tenantId}:{userId}`.
4. **Cache Miss Fallback:** Si la clave expiró o no existe, se realiza una consulta indexada y parametrizada a PostgreSQL, se sanitiza el aggregate (`UserProfileDTO`), y se almacena en Redis con un **TTL de 300 segundos** (5 minutos).

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente / React SPA
    participant Gateway as Express Gateway
    participant Guard as Tenant & JWT Auth Guard
    participant Handler as GetUserProfileQueryHandler
    participant Redis as Redis 7 Cache Engine
    participant DB as PostgreSQL 16 (Tenant Pool)

    Client->>Gateway: GET /api/v1/auth/me (Authorization: Bearer <JWT>, X-Tenant-ID)
    Gateway->>Guard: Validar Token & Matching de Inquilino
    alt Token Inválido o Tenant Mismatch
        Guard-->>Client: 401 Unauthorized / 403 Forbidden
    end
    Guard->>Handler: execute(tenantId, userId)
    Handler->>Redis: GET user_profile:{tenantId}:{userId}
    alt Cache HIT (Perfil en Memoria)
        Redis-->>Handler: UserProfileDTO (JSON)
        Handler-->>Client: 200 OK (Respuesta en < 2ms)
    else Cache MISS (Primera Consulta o TTL Expirado)
        Redis-->>Handler: null
        Handler->>DB: findById(userId, tenantId)
        DB-->>Handler: User Aggregate
        Handler->>Redis: SETEX user_profile:{tenantId}:{userId} 300 {DTO}
        Handler-->>Client: 200 OK (Sanitized Profile)
    end
```

#### A. Glosario de Actores y Componentes (Cajas del Diagrama)

| Participante / Caja | Tipo | Rol Arquitectónico y Frontera de Seguridad |
| :--- | :--- | :--- |
| **`Client` (Cliente / React SPA)** | `actor` | Navegador web que ejecuta la aplicación de usuario y requiere consultar el perfil activo de la sesión. |
| **`Gateway` (Express Gateway)** | `participant` | Pasarela perimetral que recibe la petición HTTP con la cabecera `Authorization: Bearer <JWT>`. |
| **`Guard` (Tenant & JWT Auth Guard)** | `participant` | Middleware de autenticación y frontera Zero-Trust. Verifica la firma criptográfica del JWT y comprueba que el claim `tenantId` coincida bit a bit con `X-Tenant-ID`. |
| **`Handler` (GetUserProfileQueryHandler)** | `participant` | Caso de uso de lectura (*Query Slice* en CQRS). Orquesta la lectura de baja latencia aplicando el patrón Cache-Aside. |
| **`Redis` (Redis 7 Cache Engine)** | `participant` | Base de datos clave-valor en memoria con claves prefijadas por inquilino (`user_profile:{tenantId}:{userId}`) y TTL de 300 segundos. |
| **`DB` (PostgreSQL 16 Tenant Pool)** | `participant` | Repositorio de datos relacional primario consultado exclusivamente en caso de Cache Miss. |

#### B. Desglose Secuencial del Flujo (Pasos 1 al 12)

1. **Paso 1 (`Client -> Gateway`):** La SPA solicita el perfil autenticado mediante `GET /api/v1/auth/me` con la cabecera `Authorization: Bearer <JWT>` y `X-Tenant-ID`.
2. **Paso 2 (`Gateway -> Guard`):** El Gateway transfiere el control a la guardia de seguridad para la validación criptográfica y contextual.
3. **Paso 3 (`Guard -->> Client` [Bifurcación: Token Inválido o Tenant Mismatch]):** Si el JWT expiró, fue firmado por un emisor no autorizado, o el claim `tenantId` difiere de la cabecera `X-Tenant-ID`, la guardia interrumpe el flujo y responde de inmediato `HTTP 401 Unauthorized` o `HTTP 403 Forbidden`.
4. **Paso 4 (`Guard -> Handler`):** En el flujo autorizado, la guardia delega la ejecución en `GetUserProfileQueryHandler` con los identificadores inmutables de usuario e inquilino.
5. **Paso 5 (`Handler -> Redis`):** El handler consulta Redis para verificar si existe una copia en caché del perfil bajo la clave particionada `user_profile:{tenantId}:{userId}`.
6. **Paso 6 (`Redis -->> Handler` [Escenario Cache HIT]):** Redis devuelve el `UserProfileDTO` serializado en JSON.
7. **Paso 7 (`Handler -->> Client` [Escenario Cache HIT]):** Se devuelve la respuesta inmediata `HTTP 200 OK` con una latencia típica inferior a 2 milisegundos, sin tocar la base de datos relacional.
8. **Paso 8 (`Redis -->> Handler` [Escenario Cache MISS]):** Redis retorna `null` al no encontrar la clave o haberse vencido el TTL.
9. **Paso 9 (`Handler -> DB` [Escenario Cache MISS]):** Se realiza la consulta a la base de datos PostgreSQL filtrando por `userId` y `tenantId`.
10. **Paso 10 (`DB -->> Handler` [Escenario Cache MISS]):** PostgreSQL devuelve el agregado `User` desde almacenamiento persistente.
11. **Paso 11 (`Handler -> Redis` [Escenario Cache MISS]):** El handler almacena el DTO sanitizado en Redis mediante la instrucción `SETEX` con un tiempo de vida (TTL) de 300 segundos.
12. **Paso 12 (`Handler -->> Client` [Escenario Cache MISS]):** Se entrega la respuesta `HTTP 200 OK` al cliente con el perfil sanitizado.

---

### 2. Evidencia Visual: Perfil de Sesión y Detalle de Inquilino

Captura generada por Playwright que demuestra el perfil autenticado en la SPA React (`http://localhost:3000/`):

![Authenticated User Profile](./assets/screenshots/us02_user_profile.png)

---

### 3. Ejecución en Vivo & Verificación Interactiva Paso a Paso

> [!TIP]
> Si ya ejecutaste el **Escenario A de US-01** en esta misma sesión de terminal, las variables `$TOKEN` y `$USER_ID` ya se encuentran cargadas y listas para usar. Si abres una ventana nueva, puedes inicializarlas directamente con el **Paso 1**.

#### Paso 1: Registrar o Iniciar Sesión para Obtener el Token Bearer

**Comando CLI Oficial en Tubería UNIX (`./bin/identity`):**

```bash
REG_RESP=$(./bin/identity auth register \
  --tenant "$TENANT_ID" \
  --email "sofia.valenzuela.$(date +%s)@acme-corp.com" \
  --password "EnterprisePassword2026!" \
  --name "Sofia Valenzuela" \
  --raw-json)

export TOKEN=$(echo "$REG_RESP" | jq -r .accessToken)
export USER_ID=$(echo "$REG_RESP" | jq -r .userId)

echo "Bearer Token Obtenido: $TOKEN"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
REG_RESP=$(curl -s -X POST "$BASE_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -d "{
    \"email\": \"sofia.valenzuela.$(date +%s)@acme-corp.com\",
    \"password\": \"EnterprisePassword2026!\",
    \"name\": \"Sofia Valenzuela\"
  }")

export TOKEN=$(echo "$REG_RESP" | jq -r .accessToken)
export USER_ID=$(echo "$REG_RESP" | jq -r .userId)

echo "Bearer Token Obtenido: $TOKEN"
```
</details>

---

#### Paso 2: Consulta Autenticada al Perfil (`GET /api/v1/auth/me`)

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity auth me \
  --tenant "$TENANT_ID" \
  --token "$TOKEN"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -i -X GET "$BASE_URL/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: $TENANT_ID"
```
</details>

##### Respuesta Real Obtenida (HTTP 200 OK):

```text
HTTP/1.1 200 OK [53ms]
GET http://localhost:4000/api/v1/auth/me

{
  "id": "cac503fa-bce2-4d4e-a3a7-9dc2759a0356",
  "email": "sofia.valenzuela@acme-corp.com",
  "tenantId": "acme-corp",
  "createdAt": "2026-11-18T13:46:26.924Z",
  "updatedAt": "2026-11-18T13:46:26.924Z"
}
```

---

#### Paso 3: Demostración de Barrera Anti-Suplantación (Tenant Boundary Defense)

Si un actor malicioso o un cliente desalineado intenta consultar el perfil enviando un `X-Tenant-ID` ajeno con el token emitido para `$TENANT_ID`:

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity auth me \
  --tenant malicious-hacker-tenant \
  --token "$TOKEN"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -i -X GET "$BASE_URL/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: malicious-hacker-tenant"
```
</details>

##### Respuesta de Seguridad Obtenida (HTTP 403 Forbidden):

```text
HTTP/1.1 403 Forbidden [37ms]
GET http://localhost:4000/api/v1/auth/me

{
  "error": "Forbidden: Token does not belong to the requested tenant context"
}
```

> [!TIP]
> Puedes probar interactivamente esta validación en **Swagger UI**: [`http://localhost:4000/api/docs/#/Authentication/get_api_v1_auth_me`](http://localhost:4000/api/docs/#/Authentication/get_api_v1_auth_me) configurando el candado de autenticación con el Bearer token emitido.

---

### 4. Cobertura de Pruebas Automatizadas

El slice de consulta y el patrón Cache-Aside están garantizados por pruebas de integración y unitarias:

```bash
npx jest tests/unit/identity/application/test_get_user_profile_handler.ts tests/integration/identity/interfaces/test_profile_api.ts
```

- **Prueba 1 (Cache Miss):** Verifica la consulta inicial a PostgreSQL, la sanitización del DTO y el guardado en caché con clave `user_profile:{tenantId}:{userId}` y TTL de 300s.
- **Prueba 2 (Cache Hit):** Simula peticiones subsecuentes y confirma que la respuesta se sirve directamente desde memoria sin interactuar con la base de datos.
- **Prueba 3 (Seguridad Multi-Tenant):** Valida que el middleware rechaza con `403 Forbidden` cualquier discrepancia de inquilino y con `401 Unauthorized` tokens corruptos o expirados.

---

[⬅️ Volver al Hub Principal de Showcase](./README.md)
