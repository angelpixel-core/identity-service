# Guía de Pruebas Interactivas: US-06 (Cross-Tenant Zero-Trust Guard & Anti-Enumeration Engine)

> **Document ID:** `GUIDELINE-07-cross-tenant-zero-trust-guard`  
> **Bounded Context:** `identity` / `security` / `users`  
> **Historia de Usuario:** [US-06: Cross-Tenant Zero-Trust Data Access Guard & Security Audit Logger](../epics/EPIC-03-rls-isolation/stories/US-06-cross-tenant-zero-trust-guard.md)  
> **Estándar Arquitectónico:** [ADR-0005: PostgreSQL Row-Level Security Strategy](../../docs/adr/0005-postgresql-rls-strategy.md)  
> **Componentes Principales:**
> - `createCrossTenantGuard` ([`interfaces/http/middlewares/security_audit_logger.ts`](../../interfaces/http/middlewares/security_audit_logger.ts))
> - `UserController` ([`interfaces/http/rest/v1/identity/user_controller.ts`](../../interfaces/http/rest/v1/identity/user_controller.ts))
> - `UpdateUserProfileCommandHandler` ([`src/contexts/identity/application/commands/update_user_profile/handler.ts`](../../src/contexts/identity/application/commands/update_user_profile/handler.ts))
> - `GetUserProfileQueryHandler` ([`src/contexts/identity/application/queries/get_user_profile/handler.ts`](../../src/contexts/identity/application/queries/get_user_profile/handler.ts))

---

## 1. Visión General

Esta guía detalla los procedimientos paso a paso para interactuar manualmente y verificar en un entorno real las garantías de seguridad **Zero-Trust**, **Anti-Enumeration** y **Auditoría de Seguridad** introducidas en **US-06**.

En plataformas SaaS multi-inquilino (multi-tenant), las vulnerabilidades de tipo **BOLA / IDOR (Broken Object Level Authorization)** y **User Enumeration** constituyen uno de los mayores vectores de ataque según el OWASP API Security Top 10. Para neutralizar estos riesgos de forma exhaustiva, **AngelPixel Identity Service** implementa un modelo de **Defensa en Profundidad (Defense in Depth)** en múltiples capas:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 1: Tenant Context Middleware                                            │
│ Validación estricta de formato por Regex -> Sanitización contra Inyección SQL │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 2: Authentication Middleware                                            │
│ Verificación de firma JWT -> Validación estricta Token Claims == X-Tenant-ID │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 3: Cross-Tenant Zero-Trust Guard & Audit Logger                         │
│ Compara req.tenantId con params.tenantId, body.tenantId y query.tenantId     │
│ Si diverge -> Emite CROSS_TENANT_VIOLATION y aborta con 403 Forbidden        │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 4: Application Handlers & PostgreSQL RLS Engine                         │
│ Consultas acotadas al tenant activo -> Repositorio devuelve null             │
│ Anti-Enumeration: HTTP 404 Not Found idéntico ante usuarios de otros tenants │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 5: Cache-Aside Invalidation & Consistency                               │
│ Mutación atómica en DB -> Invalidación inmediata de la clave en Redis/Caché  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Esta guía permite verificar en vivo:
1. **Prevención de Enumeración Cross-Tenant (Anti-Enumeration 404 Not Found):** Un atacante de `alpha-corp` no puede deducir la existencia ni el estado de cuentas pertenecientes a `beta-corp`.
2. **Bloqueo de Mutación Cross-Tenant en Payload (403 Forbidden):** Intentos de inyectar o modificar datos dirigidos a un tenant distinto al token autenticado son interceptados inmediatamente.
3. **Detección de Suplantación de Cabeceras (Header Spoofing 403 Forbidden):** Se bloquea cualquier discrepancia entre el `X-Tenant-ID` enviado en cabecera y el claim `tenantId` firmado criptográficamente en el JWT.
4. **Defensa Preventiva ante Payloads Maliciosos e Inyección SQL (400 Bad Request):** Payloads con comillas, caracteres de escape o comandos SQL son rechazados en el perímetro HTTP.
5. **Actualización Legítima dentro del Tenant e Invalidación de Caché (200 OK):** Mutación exitosa de perfil y verificación de frescura inmediata en consultas subsiguientes.

---

## 2. Preparación del Entorno

### Paso 2.1: Verificar Contenedores en Docker Compose

Asegúrate de que la base de datos PostgreSQL (`identity-db`), la caché (`identity-cache`) y el servicio de API (`identity-api`) estén activos y en estado saludable:

```bash
docker compose ps
```

Salida esperada:
```text
NAME             IMAGE                STATUS                 PORTS
identity-api     identity-api         Up                     0.0.0.0:4000->4000/tcp
identity-cache   redis:7-alpine       Up (healthy)           0.0.0.0:6379->6379/tcp
identity-db      postgres:16-alpine   Up (healthy)           0.0.0.0:5432->5432/tcp
```

Si los contenedores no están levantados:
```bash
docker compose up -d
```

---

## 3. Procedimiento de Pruebas Interactivas

### Paso 3.1: Configuración Inicial de Tenants y Usuarios de Prueba

Para ejecutar las pruebas en aislamiento, registraremos dos usuarios pertenecientes a dos organizaciones completamente diferentes:
- **Tenant A:** `alpha-corp` con usuaria `alice.guide@alpha-corp.io`
- **Tenant B:** `beta-corp` con usuario `bob.guide@beta-corp.io`

#### 1. Registro de Alice en `alpha-corp`:

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: alpha-corp" \
  -d '{
    "email": "alice.guide@alpha-corp.io",
    "password": "SuperSecretPassword2026!"
  }'
```

**Respuesta esperada (HTTP 201 Created):**
```json
{
  "token": "<ALICE_JWT_TOKEN>",
  "accessToken": "<ALICE_JWT_TOKEN>",
  "userId": "a47f5c40-e1e3-41e3-951c-6d5ed41397ac",
  "email": "alice.guide@alpha-corp.io",
  "tenantId": "alpha-corp",
  "createdAt": "2026-11-08T21:40:18.701Z"
}
```

> [!TIP]
> Exporta el token y el ID de Alice para los siguientes pasos:
> ```bash
> export ALICE_TOKEN="<ALICE_JWT_TOKEN>"
> export ALICE_USER_ID="<ALICE_USER_ID>"
> ```

#### 2. Registro de Bob en `beta-corp`:

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: beta-corp" \
  -d '{
    "email": "bob.guide@beta-corp.io",
    "password": "SuperSecretPassword2026!"
  }'
```

**Respuesta esperada (HTTP 201 Created):**
```json
{
  "token": "<BOB_JWT_TOKEN>",
  "accessToken": "<BOB_JWT_TOKEN>",
  "userId": "776fc52a-d975-4f60-868b-b47281abd877",
  "email": "bob.guide@beta-corp.io",
  "tenantId": "beta-corp",
  "createdAt": "2026-11-08T21:41:33.459Z"
}
```

> [!TIP]
> Exporta el ID de Bob para simular el objetivo del atacante:
> ```bash
> export BOB_USER_ID="<BOB_USER_ID>"
> ```

---

### Caso 1: Prevención de Enumeración Cross-Tenant (Anti-Enumeration 404 Not Found)

**Objetivo:** Verificar que un usuario autenticado en `alpha-corp` no puede enumerar ni saber si un ID de usuario existe en otra organización (`beta-corp`).

**Vector de Prueba:** Alice (`alpha-corp`) intenta consultar directamente el perfil de Bob (`BOB_USER_ID`) utilizando su propio token legítimo:

```bash
curl -s -i -X GET "http://localhost:4000/api/v1/users/$BOB_USER_ID" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "X-Tenant-ID: alpha-corp"
```

**Respuesta Verificada:**
```http
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8

{"error":"User not found"}
```

**Resultado Esperado y Análisis de Seguridad:**
- El sistema responde estrictamente con **HTTP 404 Not Found** con el payload neutro `{"error":"User not found"}`.
- El repositorio PostgreSQL filtra la consulta con la cláusula `WHERE id = $1 AND tenant_id = 'alpha-corp'` (respaldado por PostgreSQL RLS).
- La respuesta es **indistinguible** de consultar un identificador aleatorio inexistente (`00000000-0000-0000-0000-000000000000`), impidiendo la enumeración de identificadores de usuarios entre clientes del SaaS.

---

### Caso 2: Bloqueo de Mutación Cross-Tenant en Payload (403 Forbidden & Security Audit)

**Objetivo:** Verificar que el middleware `createCrossTenantGuard` intercepta cualquier intento de alterar el contexto de tenant a través del cuerpo de la petición (`req.body.tenantId`) y emite una alerta estructurada de auditoría de seguridad.

**Vector de Prueba:** Alice intenta modificar un recurso enviando un payload que especifica explícitamente `tenantId: "beta-corp"`:

```bash
curl -s -i -X PATCH "http://localhost:4000/api/v1/users/$ALICE_USER_ID" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "X-Tenant-ID: alpha-corp" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "beta-corp",
    "email": "malicious.tamper@beta-corp.io"
  }'
```

**Respuesta Verificada:**
```http
HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8

{"error":"Forbidden: Cross-tenant access violation detected"}
```

**Auditoría de Seguridad Generada:**
El componente `SecurityAuditLoggerPort` registra el incidente en el registro centralizado con la siguiente estructura:
```json
{
  "eventType": "cross_tenant_violation",
  "reason": "CROSS_TENANT_VIOLATION",
  "ip": "127.0.0.1",
  "metadata": {
    "activeTenantId": "alpha-corp",
    "attemptedTenantId": "beta-corp",
    "userId": "a47f5c40-e1e3-41e3-951c-6d5ed41397ac",
    "path": "/api/v1/users/a47f5c40-e1e3-41e3-951c-6d5ed41397ac",
    "method": "PATCH"
  }
}
```

---

### Caso 3: Detección de Suplantación de Cabeceras (Header Spoofing 403 Forbidden)

**Objetivo:** Verificar que el middleware de autenticación valida que el claim `tenantId` encriptado en el JWT coincida de forma unívoca con la cabecera `X-Tenant-ID`.

**Vector de Prueba:** Un atacante intercepta o posee un token válido de `alpha-corp`, pero adultera la cabecera HTTP enviando `X-Tenant-ID: beta-corp`:

```bash
curl -s -i -X GET "http://localhost:4000/api/v1/auth/me" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "X-Tenant-ID: beta-corp"
```

**Respuesta Verificada:**
```http
HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8

{"error":"Forbidden: Token does not belong to the requested tenant context"}
```

**Resultado:** Se frustra cualquier intento de engañar a middlewares subsiguientes o proxys inversos mediante desalineación entre cabeceras y claims del token de acceso.

---

### Caso 4: Defensa Preventiva ante Payloads Maliciosos e Inyección SQL (400 Bad Request)

**Objetivo:** Demostrar que el formato del identificador de tenant está fuertemente acotado mediante expresiones regulares y validación en el Value Object `TenantId`, bloqueando cualquier vector de inyección SQL antes de que alcance el pool o el motor relacional.

#### Prueba 4.1: Intento de Inyección SQL clásica (`DROP TABLE`):
```bash
curl -s -i -X GET "http://localhost:4000/api/v1/auth/me" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "X-Tenant-ID: alpha-corp'; DROP TABLE users; --"
```

**Respuesta Verificada:**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"error":"Invalid tenantId format in x-tenant-id header"}
```

#### Prueba 4.2: Intento de Bypass Booleano (`' OR '1'='1`):
```bash
curl -s -i -X GET "http://localhost:4000/api/v1/auth/me" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "X-Tenant-ID: ' OR '1'='1"
```

**Respuesta Verificada:**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"error":"Invalid tenantId format in x-tenant-id header"}
```

#### Prueba 4.3: Intento de manipular `set_config` en PostgreSQL:
```bash
curl -s -i -X GET "http://localhost:4000/api/v1/auth/me" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "X-Tenant-ID: alpha-corp'); SELECT set_config('app.current_tenant_id', 'beta-corp', false); --"
```

**Respuesta Verificada:**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"error":"Invalid tenantId format in x-tenant-id header"}
```

---

### Caso 5: Actualización Legítima dentro del Tenant e Invalidación de Caché (200 OK)

**Objetivo:** Verificar el flujo completo del Write Slice:
1. Mutación legítima del email de Alice a través de `PATCH /api/v1/users/:userId`.
2. Persistencia en la tabla `users` mediante `PostgresUserRepository.save`.
3. Invalidación atómica de la clave de caché `user_profile:alpha-corp:<userId>`.
4. Comprobación de que la siguiente lectura refleja los datos frescos.

#### Paso 1: Ejecutar la actualización de perfil:
```bash
curl -s -i -X PATCH "http://localhost:4000/api/v1/users/$ALICE_USER_ID" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "X-Tenant-ID: alpha-corp" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice.updated@alpha-corp.io"
  }'
```

**Respuesta Verificada (HTTP 200 OK):**
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "a47f5c40-e1e3-41e3-951c-6d5ed41397ac",
  "email": "alice.updated@alpha-corp.io",
  "tenantId": "alpha-corp",
  "createdAt": "2026-11-08T21:40:18.601Z",
  "updatedAt": "2026-11-08T22:00:26.666Z"
}
```

#### Paso 2: Lectura inmediata del perfil para certificar frescura e invalidación de caché:
```bash
curl -s -i -X GET "http://localhost:4000/api/v1/users/$ALICE_USER_ID" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H "X-Tenant-ID: alpha-corp"
```

**Respuesta Verificada (HTTP 200 OK):**
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "a47f5c40-e1e3-41e3-951c-6d5ed41397ac",
  "email": "alice.updated@alpha-corp.io",
  "tenantId": "alpha-corp",
  "createdAt": "2026-11-08T21:40:18.601Z",
  "updatedAt": "2026-11-08T22:00:26.666Z"
}
```

**Resultado:**
- El aggregate de dominio actualizó su propiedad interna `email` y refrescó el timestamp `updatedAt`.
- La persistencia ejecutó la cláusula de actualización simétrica (`ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, ...`).
- La caché en memoria o Redis eliminó la entrada anterior, garantizando que el patrón Cache-Aside retorne los datos modificados sin lecturas sucias (*stale reads*).

---

## 4. Matriz de Códigos de Respuesta HTTP y Comportamiento Esperado

| Escenario de Prueba | Endpoint | Cabeceras / Payload | Código HTTP | Mensaje / Detalle |
| :--- | :--- | :--- | :--- | :--- |
| **Caso 1: Anti-Enumeración** | `GET /api/v1/users/:userId` | Token `alpha-corp`, target ID de `beta-corp` | **404 Not Found** | `{"error":"User not found"}` |
| **Caso 2: Mutación Cross-Tenant** | `PATCH /api/v1/users/:userId` | Token `alpha-corp`, payload `{"tenantId":"beta-corp"}` | **403 Forbidden** | `{"error":"Forbidden: Cross-tenant access violation detected"}` |
| **Caso 3: Header Spoofing** | `GET /api/v1/auth/me` | Token `alpha-corp`, header `X-Tenant-ID: beta-corp` | **403 Forbidden** | `{"error":"Forbidden: Token does not belong to the requested tenant context"}` |
| **Caso 4: Inyección SQL** | Cualquier endpoint protegido | Header `X-Tenant-ID: alpha-corp'; DROP...` | **400 Bad Request** | `{"error":"Invalid tenantId format in x-tenant-id header"}` |
| **Caso 5: Actualización Legítima** | `PATCH /api/v1/users/:userId` | Token `alpha-corp`, header `X-Tenant-ID: alpha-corp` | **200 OK** | Perfil actualizado con nuevo `email` y `updatedAt` |

---

## 5. Checklist de Verificación y Cierre

- [x] **Caso 1:** Intento de consulta de un usuario de otro tenant responde con `404 Not Found` idéntico a usuario inexistente.
- [x] **Caso 2:** Discrepancia en body/query/params es bloqueada con `403 Forbidden` y registrada en auditoría de seguridad.
- [x] **Caso 3:** Discrepancia entre token firmado y cabecera `X-Tenant-ID` es rechazada con `403 Forbidden`.
- [x] **Caso 4:** Payloads maliciosos o caracteres no alfanuméricos en `X-Tenant-ID` son repelidos con `400 Bad Request`.
- [x] **Caso 5:** Mutación legítima persiste correctamente en PostgreSQL y asegura consistencia de caché.
