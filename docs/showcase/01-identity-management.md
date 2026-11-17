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

---

### 2. Evidencia Visual: Portal Web de Registro

La captura de pantalla a continuación fue generada de manera automatizada mediante el motor **Playwright** apuntando al contenedor en vivo `identity-web` (`http://localhost:3000/`):

![Multi-Tenant Registration Form](./assets/screenshots/us01_registration_form.png)

---

### 3. Ejecución en Vivo & Receta Interactiva cURL

Puedes probar el endpoint de registro inmediatamente contra el stack local ejecutando el siguiente comando en tu terminal:

```bash
curl -i -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme-corp" \
  -d '{
    "email": "lead.architect@acme-corp.com",
    "password": "EnterprisePassword2026!",
    "name": "Sofia Valenzuela"
  }'
```

#### Respuesta Real Obtenida (HTTP 200 / 201 OK):

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJlMjU4Y2I5ZC00YmVkLTQ3ZTItYmMzNy1jMzM3Zjc4Yjc2NWUiLCJlbWFpbCI6InNob3djYXNlLnZlcmlmeS4xNzk0OTE5OTg2QGFjbWUtY29ycC5jb20iLCJ0ZW5hbnRJZCI6ImFjbWUtY29ycCIsImlhdCI6MTc5NDkxOTk4NiwiZXhwIjoxNzk0OTIzNTg2fQ.cPMHpuLqAd5ypi42rwHEzgr0ooKKnpQl74PyEV1irzY",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJlMjU4Y2I5ZC00YmVkLTQ3ZTItYmMzNy1jMzM3Zjc4Yjc2NWUiLCJlbWFpbCI6InNob3djYXNlLnZlcmlmeS4xNzk0OTE5OTg2QGFjbWUtY29ycC5jb20iLCJ0ZW5hbnRJZCI6ImFjbWUtY29ycCIsImlhdCI6MTc5NDkxOTk4NiwiZXhwIjoxNzk0OTIzNTg2fQ.cPMHpuLqAd5ypi42rwHEzgr0ooKKnpQl74PyEV1irzY",
  "userId": "e258cb9d-4bed-47e2-bc37-c337f78b765e",
  "email": "lead.architect@acme-corp.com",
  "tenantId": "acme-corp",
  "createdAt": "2026-11-17T12:53:06.953Z"
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

---

### 2. Evidencia Visual: Perfil de Sesión y Detalle de Inquilino

Captura generada por Playwright que demuestra el perfil autenticado en la SPA React (`http://localhost:3000/`):

![Authenticated User Profile](./assets/screenshots/us02_user_profile.png)

---

### 3. Receta Interactiva cURL Paso a Paso

#### Paso 1: Registrar o Iniciar Sesión para Obtener el Token Bearer

```bash
# Registrar usuario temporal para la prueba
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme-corp" \
  -d '{
    "email": "sofia.valenzuela@acme-corp.com",
    "password": "EnterprisePassword2026!",
    "name": "Sofia Valenzuela"
  }' | jq -r .accessToken)

echo "Bearer Token Obtenido: $TOKEN"
```

#### Paso 2: Consulta Autenticada al Perfil (`GET /api/v1/auth/me`)

```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: acme-corp"
```

#### Respuesta Real Obtenida (HTTP 200 OK):

```json
{
  "id": "0333e7fc-d137-42ad-b956-d0cd7b9c08da",
  "email": "sofia.valenzuela@acme-corp.com",
  "tenantId": "acme-corp",
  "createdAt": "2026-11-17T14:32:34.814Z",
  "updatedAt": "2026-11-17T14:32:34.814Z"
}
```

#### Paso 3: Demostración de Barrera Anti-Suplantación (Tenant Boundary Defense)

Si un actor malicioso o un cliente desalineado intenta consultar el perfil enviando un `X-Tenant-ID` ajeno con el token de `acme-corp`:

```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: malicious-hacker-tenant"
```

#### Respuesta de Seguridad Obtenida (HTTP 403 Forbidden):

```json
{
  "error": "Forbidden: Token tenant does not match requested tenant context"
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
