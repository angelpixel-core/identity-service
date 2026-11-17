---
title: "Epic 02: Dynamic Client Registry & M2M Authentication"
description: "Showcase interactivo del Registro Dinámico de Clientes OAuth2, validación en tiempo real de orígenes CORS sin reinicio y autenticación Machine-to-Machine (M2M)."
epic_id: "EPIC-02"
epic_name: "Dynamic Client Registry & M2M Authentication"
bounded_context: "identity"
user_stories:
  - id: "US-03"
    name: "Dynamic Client Registration & Dynamic CORS Origin Validation"
    status: "completed"
  - id: "US-04"
    name: "Machine-to-Machine (M2M) Authentication via Client Credentials"
    status: "completed"
architecture_pattern: "Vertical Slice + Hexagonal (DDD) + ADR-0004"
security_standards:
  - "RFC 6749 (OAuth 2.0)"
  - "RFC 7636 (PKCE)"
  - "W3C Cross-Origin Resource Sharing (CORS)"
  - "Zero-Downtime Dynamic Configuration"
  - "Confidential Client Secret Entropy"
created_at: "2026-11-17"
updated_at: "2026-11-17"
tags:
  - showcase
  - walkthrough
  - epic-02
  - oauth2
  - client-registry
  - cors
  - m2m
---

# 🌐 Epic 02: Dynamic Client Registry & Machine-to-Machine (M2M) Auth

[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1.0-green.svg)](http://localhost:4000/api/docs/#/OAuth2/post_api_v1_oauth2_token)
[![OAuth2 RFC 6749](https://img.shields.io/badge/OAuth%202.0-RFC%206749-orange.svg)](#)
[![Dynamic CORS](https://img.shields.io/badge/Security-Dynamic%20CORS%20Guard-blue.svg)](#)
[![M2M Client Credentials](https://img.shields.io/badge/Auth-Client%20Credentials%20(M2M)-success.svg)](#)
[![Status](https://img.shields.io/badge/Status-Completed-success.svg)](#)

Este capítulo documenta y demuestra el funcionamiento del **Épico 02: Registro Dinámico de Clientes y Autenticación Máquina a Máquina (M2M)**. En arquitecturas modernas de microservicios y SaaS distribuidos, registrar nuevas aplicaciones cliente (SPAs, apps móviles, microservicios satélite) no debe requerir redespliegues del clúster ni reiniciar servicios para autorizar nuevos dominios CORS o secretos de cliente.

---

## 📌 Historias de Usuario

| Historia | Descripción | Estado |
| :--- | :--- | :---: |
| **US-03** | Registro Dinámico de Clientes y Validación en Tiempo Real de Orígenes CORS | ✅ En Producción |
| **US-04** | Autenticación Machine-to-Machine (M2M) con OAuth2 Client Credentials | ✅ En Producción |

---

## 🛡️ US-03: Registro Dinámico de Clientes & Validación Dinámica de CORS

### 1. Arquitectura y Gobernanza de Orígenes en Tiempo Real

El endpoint `POST /api/v1/oauth2/clients/validate` y el middleware `clientAuthorizationMiddleware` implementan la directriz de arquitectura **ADR-0004 (Dynamic Client Registry)**:

1. **Catálogo de Clientes como Agregados de Dominio:** Cada cliente registrado (`ClientApplication`) encapsula sus orígenes autorizados (`allowedOrigins: OriginDomain[]`), URIs de redirección (`redirectUris`), tipos de flujo permitidos (`allowedGrantTypes`) y scopes.
2. **Cero Redespliegues (Zero-Downtime):** Las políticas CORS no se definen estáticamente en variables de entorno o archivos de configuración de Express. Cada petición valida dinámicamente la cabecera `Origin` o `Referer` contra el repositorio en base de datos PostgreSQL con aceleración por caché de segundo nivel en Redis.
3. **Mapeo Estricto de Códigos HTTP según RFCs:**
   - Origen permitido y cliente activo: **HTTP 200 OK**
   - Origen no autorizado: **HTTP 403 Forbidden** (`unauthorized_client_origin`)
   - Cliente desactivado por gobernanza: **HTTP 401 Unauthorized** (`client_deactivated`)
   - Cliente inexistente: **HTTP 404 Not Found** (`client_not_found`)
   - Ausencia de identificador: **HTTP 400 Bad Request** (`missing_client_id`)

```mermaid
sequenceDiagram
    autonumber
    actor Browser as Frontend SPA (e.g. portal.angelpixel.io)
    participant Gateway as Express API Gateway
    participant Middleware as clientAuthorizationMiddleware
    participant Cache as Redis 7 Cache Engine
    participant DB as PostgreSQL 16 (Client Registry)

    Browser->>Gateway: POST /api/v1/oauth2/clients/validate (Origin, X-Client-ID)
    Gateway->>Middleware: Interceptar petición
    Middleware->>Middleware: Extraer clientId y Origin
    Middleware->>Cache: GET client_origin:{clientId}:{origin}
    alt Cache HIT (Origen Previamente Verificado)
        Cache-->>Middleware: ClientValidationResult (Aprobado)
    else Cache MISS
        Middleware->>DB: findByClientId(clientId)
        DB-->>Middleware: ClientApplication Aggregate
        Middleware->>Middleware: Validar isActive && allowedOrigins.includes(origin)
        Middleware->>Cache: SETEX client_origin:{clientId}:{origin} 300 {Result}
    end

    alt Validación Aprobada
        Middleware-->>Gateway: next()
        Gateway-->>Browser: 200 OK (authorized: true, clientName, scopes)
    else Origen No Autorizado
        Middleware-->>Browser: 403 Forbidden (unauthorized_client_origin)
    else Cliente Desactivado
        Middleware-->>Browser: 401 Unauthorized (client_deactivated)
    end
```

---

### 2. Recetas Interactivas cURL Paso a Paso

Puedes probar cada una de las bifurcaciones de validación de seguridad directamente contra el entorno en ejecución:

#### Escenario A: Origen Autorizado y Cliente Activo (HTTP 200 OK)

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://portal.angelpixel.io" \
  -H "X-Client-ID: portal-web" \
  -d '{"clientId": "portal-web"}'
```

##### Respuesta Real Obtenida:
```json
{
  "authorized": true,
  "clientId": "portal-web",
  "clientName": "AngelPixel Web Portal",
  "clientType": "public",
  "allowedOrigins": [
    "https://portal.angelpixel.io"
  ],
  "scopes": [
    "openid",
    "profile",
    "email"
  ]
}
```

---

#### Escenario B: Intento de Suplantación desde Origen No Autorizado (HTTP 403 Forbidden)

Si un atacante aloja una aplicación maliciosa en otro dominio e intenta utilizar el `client_id` legítimo de la organización:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://malicious-phishing-site.com" \
  -H "X-Client-ID: portal-web" \
  -d '{"clientId": "portal-web"}'
```

##### Respuesta de Seguridad Obtenida:
```json
{
  "error": "unauthorized_client_origin",
  "message": "Origin https://malicious-phishing-site.com is not authorized for client portal-web."
}
```

---

#### Escenario C: Intento de Uso de Cliente Revocado / Desactivado (HTTP 401 Unauthorized)

Cuando una aplicación cliente es desactivada por el equipo de seguridad o fin de ciclo de vida (`legacy-app`):

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://legacy.angelpixel.io" \
  -H "X-Client-ID: legacy-app" \
  -d '{"clientId": "legacy-app"}'
```

##### Respuesta de Seguridad Obtenida:
```json
{
  "error": "client_deactivated",
  "message": "Client application \"legacy-app\" is currently deactivated."
}
```

---

#### Escenario D: Identificador de Cliente Inexistente (HTTP 404 Not Found)

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://portal.angelpixel.io" \
  -H "X-Client-ID: cliente-fantasma" \
  -d '{"clientId": "cliente-fantasma"}'
```

##### Respuesta de Seguridad Obtenida:
```json
{
  "error": "client_not_found",
  "message": "Client application \"cliente-fantasma\" was not found in registered_clients."
}
```

> [!TIP]
> **Exploración en Swagger UI:**
> Puedes probar interactivamente este endpoint en la consola de OpenAPI:
> [`http://localhost:4000/api/docs/#/OAuth2/post_api_v1_oauth2_clients_validate`](http://localhost:4000/api/docs/#/OAuth2/post_api_v1_oauth2_clients_validate).

---

### 3. Cobertura de Pruebas Automatizadas

El middleware y el caso de uso de validación de orígenes dinámicos están certificados al 100%:

```bash
npx jest tests/integration/identity/interfaces/test_client_authorization_middleware.ts
```

- **Prueba 1:** Permite el paso cuando el cliente existe, está activo y el origen coincide.
- **Prueba 2:** Rechaza con `403 Forbidden` ante orígenes no registrados.
- **Prueba 3:** Rechaza con `401 Unauthorized` si el cliente está desactivado.
- **Prueba 4:** Retorna `404 Not Found` si el `client_id` no existe en la base de datos.
- **Prueba 5:** Retorna `400 Bad Request` ante la ausencia de `client_id`.

---

## 🤖 US-04: Autenticación Machine-to-Machine (M2M) con Client Credentials

### 1. Arquitectura y Protocolo RFC 6749 Section 4.4

Para la comunicación segura entre microservicios, daemons de backend y tareas programadas sin intervención de un usuario final, el servicio implementa el flujo canónico **OAuth 2.0 Client Credentials Grant** expuesto en `POST /api/v1/oauth2/token` y `POST /oauth2/token`:

1. **Restricción Exclusiva a Clientes Confidenciales:** Solo clientes declarados como `clientType: 'confidential'` tienen permitido el flujo `client_credentials`. Cualquier intento por parte de un cliente público (como una SPA o app móvil) es rechazado inmediatamente con `HTTP 401 Unauthorized` o `HTTP 400 Bad Request`.
2. **Derivación de Hash Bcrypt & Protección de Secretos:** Los secretos de los clientes se almacenan como hashes Bcrypt irreversibles. En el dominio, el Value Object `ClientSecret` fuerza entropía mínima (32 caracteres) y sobrescribe `toString()` devolviendo inmutablemente `"[REDACTED]"` para evitar fugas accidentales en logs de aplicación o trazas de APM.
3. **Validación Estricta de Scopes:** El cliente puede solicitar scopes específicos o recibir todos los scopes pre-autorizados por omisión. Si solicita un scope que excede su perfil, se aborta con `HTTP 400 Bad Request` (`invalid_scope`).

```mermaid
sequenceDiagram
    autonumber
    actor Daemon as Microservicio Satélite / Backend Daemon
    participant Gateway as Express Gateway (/api/v1/oauth2/token)
    participant AuthHandler as AuthenticateClientM2MCommandHandler
    participant Repo as ClientApplicationRepository
    participant Hash as Bcrypt HashProvider
    participant Token as TokenProvider (JWT Engine)
    participant Audit as Structured Security Audit Logger

    Daemon->>Gateway: POST /api/v1/oauth2/token (grant_type=client_credentials, credentials)
    Gateway->>AuthHandler: execute(clientId, clientSecret, grantType, requestedScope)
    AuthHandler->>Repo: findByClientId(clientId)
    Repo-->>AuthHandler: ClientApplication Aggregate
    AuthHandler->>Hash: compare(clientSecret, clientSecretHash)
    alt Credenciales Inválidas o Cliente Inactivo
        AuthHandler->>Audit: recordEvent(M2M_AUTH_FAILED, [REDACTED])
        AuthHandler-->>Daemon: 401 Unauthorized (invalid_client)
    end
    alt Scope no Autorizado
        AuthHandler-->>Daemon: 400 Bad Request (invalid_scope)
    end
    AuthHandler->>Token: issueAccessToken(clientId, scopes, ttl=3600s)
    Token-->>AuthHandler: Signed JWT String
    AuthHandler->>Audit: recordEvent(M2M_AUTH_SUCCESS, clientId)
    AuthHandler-->>Gateway: 200 OK (access_token, Bearer, 3600, scopes)
    Gateway-->>Daemon: JSON Response (Cache-Control: no-store)
```

---

### 2. Recetas Interactivas cURL Paso a Paso

#### Modo 1: Autenticación con Payload JSON en el Body

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "m2m-service-app",
    "client_secret": "ValidSecret123!_SuperSecureSecretForTesting_2026"
  }'
```

##### Respuesta Real Obtenida (HTTP 200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJtMm0tc2VydmljZS1hcHAiLCJpc3MiOiJodHRwczovL2F1dGguYW5nZWxwaXhlbC5pbyIsImF1ZCI6Imh0dHBzOi8vYXBpLmFuZ2VscGl4ZWwuaW8iLCJzdWIiOiJtMm0tc2VydmljZS1hcHAiLCJjbGllbnRfaWQiOiJtMm0tc2VydmljZS1hcHAiLCJ0b2tlbl90eXBlIjoiQmVhcmVyIiwianRpIjoiYzVhMmQzZGQtNzNkOS00OTFjLTlkNzktODljMTljYjA3MDMyIiwic2NvcGUiOiJpZGVudGl0eTpyZWFkIGlkZW50aXR5OndyaXRlIGF1ZGl0OmxvZyIsImlhdCI6MTc5NDkzNDAwOCwiZXhwIjoxNzk0OTM3NjA4fQ.aMSO06Cct1_cDTEnOXlbCzemxjLSJ39aKO75sJYWEd8",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "identity:read identity:write audit:log"
}
```

---

#### Modo 2: Autenticación RFC 6749 con Cabecera HTTP Basic Auth

El estándar OAuth2 permite enviar las credenciales en la cabecera `Authorization: Basic <base64>` y el `grant_type` en formato `application/x-www-form-urlencoded`.

Puedes utilizar la opción nativa `-u` de `curl` (que codifica a Base64 automáticamente y evita conflictos con el carácter `!` en shells interactivos como `zsh`):

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -u 'm2m-service-app:ValidSecret123!_SuperSecureSecretForTesting_2026' \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```

O suministrar directamente la cabecera Base64 precalculada:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Authorization: Basic bTJtLXNlcnZpY2UtYXBwOlZhbGlkU2VjcmV0MTIzIV9TdXBlclNlY3VyZVNlY3JldEZvclRlc3RpbmdfMjAyNg==" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```

##### Cabeceras y Cuerpo de Respuesta Obtenidos (HTTP 200 OK):
```http
HTTP/1.1 200 OK
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8
Content-Length: 591

{"access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...","token_type":"Bearer","expires_in":3600,"scope":"identity:read identity:write audit:log"}
```

---

#### Modo 3: Seguridad Negativa — Secreto Erróneo (HTTP 401 Unauthorized)

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "m2m-service-app",
    "client_secret": "ClaveCompletamenteErronea123!"
  }'
```

##### Respuesta de Seguridad Obtenida:
```json
{
  "error": "invalid_client",
  "error_description": "Client authentication failed: invalid client credentials"
}
```

---

#### Modo 4: Seguridad Negativa — Petición de Scope No Autorizado (HTTP 400 Bad Request)

Si el cliente intenta solicitar privilegios que exceden su rol autorizado en el catálogo (e.g. `admin:superpower`):

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "m2m-service-app",
    "client_secret": "ValidSecret123!_SuperSecureSecretForTesting_2026",
    "scope": "admin:superpower"
  }'
```

##### Respuesta de Seguridad Obtenida:
```json
{
  "error": "invalid_scope",
  "error_description": "Requested scope \"admin:superpower\" is not authorized for client \"m2m-service-app\""
}
```

---

### 3. Inspección Forense de Claims del Token M2M

El JWT generado para comunicaciones M2M posee una estructura estricta según las directrices de seguridad de OpenID y OAuth 2.0:

```json
{
  "iss": "https://auth.angelpixel.io",
  "aud": "https://api.angelpixel.io",
  "sub": "m2m-service-app",
  "client_id": "m2m-service-app",
  "token_type": "Bearer",
  "jti": "c5a2d3dd-73d9-491c-9d79-89c19cb07032",
  "scope": "identity:read identity:write audit:log",
  "iat": 1794934008,
  "exp": 1794937608
}
```

- **`sub` (Subject) y `client_id`:** Representan la identidad del servicio satélite autenticado (no hay usuario humano asociado).
- **`jti` (JWT ID):** UUID único que garantiza la no-repudiación y permite registrar el token en listas de revocación.
- **`scope`:** Cadena delimitada por espacios con los permisos concedidos al microservicio.

> [!TIP]
> Puedes probar e inspeccionar este endpoint de forma interactiva en **Swagger UI**:
> [`http://localhost:4000/api/docs/#/OAuth2/post_api_v1_oauth2_token`](http://localhost:4000/api/docs/#/OAuth2/post_api_v1_oauth2_token).

---

### 4. Cobertura de Pruebas Automatizadas

El flujo completo de Client Credentials M2M está certificado por la suite de pruebas de integración:

```bash
npx jest tests/integration/identity/interfaces/test_oauth2_token_m2m.ts
```

- **Happy Path:** Emisión exitosa de tokens con payloads JSON y form-urlencoded con HTTP Basic Auth.
- **Validaciones de Protocolo:** Rechazo ante `grant_type` no soportado o ausencia de `client_id`.
- **Gobernanza de Clientes:** Rechazo si un cliente público intenta el flujo M2M o si el cliente está desactivado.
- **Defensa en Profundidad:** Rechazo de scopes no autorizados y redacción de secretos en eventos de auditoría.

---

[⬅️ Volver al Hub Principal de Showcase](./README.md)
