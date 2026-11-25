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
  - id: "US-28"
    name: "Client Lifecycle Management & Secret Rotation"
    status: "completed"
  - id: "US-29"
    name: "Multi-Tenant / Multi-Domain Client Bindings & Explicit Tenant Resolution"
    status: "completed"
architecture_pattern: "Vertical Slice + Hexagonal (DDD) + ADR-0004"
security_standards:
  - "RFC 6749 (OAuth 2.0)"
  - "RFC 7636 (PKCE)"
  - "W3C Cross-Origin Resource Sharing (CORS)"
  - "Zero-Downtime Dynamic Configuration"
  - "Confidential Client Secret Entropy & Dual-Grace Rotation"
created_at: "2026-11-17"
updated_at: "2026-11-24"
tags:
  - showcase
  - walkthrough
  - epic-02
  - oauth2
  - client-registry
  - cors
  - m2m
  - lifecycle
  - secret-rotation
  - multi-domain
  - n-to-m-binding
  - tenant-resolution
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
| **US-28** | Gestión del Ciclo de Vida de Clientes y Rotación Zero-Downtime de Secretos | ✅ En Producción |
| **US-29** | Bindings Multi-Tenant / Multi-Dominio (N:M) y Resolución Explícita de Tenant | ✅ En Producción |

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

#### A. Glosario de Actores y Componentes (Cajas del Diagrama)

| Participante / Caja | Tipo | Rol Arquitectónico y Frontera de Seguridad |
| :--- | :--- | :--- |
| **`Browser` (Frontend SPA)** | `actor` | Navegador web que ejecuta la aplicación cliente (e.g. `portal.angelpixel.io`) e inicia la validación preliminar de origen antes de habilitar los flujos de login. |
| **`Gateway` (Express API Gateway)** | `participant` | Punto de entrada perimetral que recibe la solicitud `POST /api/v1/oauth2/clients/validate` y coordina la ejecución de middlewares. |
| **`Middleware` (clientAuthorizationMiddleware)** | `participant` | Filtro perimetral de gobernanza de clientes. Inspecciona las cabeceras `Origin` y `X-Client-ID`, consultando la caché o la base de datos para determinar los permisos de origen. |
| **`Cache` (Redis 7 Cache Engine)** | `participant` | Capa en memoria de respuesta ultrarrápida. Almacena tuplas validadas bajo la clave `client_origin:{clientId}:{origin}` con un TTL de 300 segundos para absorber ráfagas de tráfico CORS. |
| **`DB` (PostgreSQL 16 Client Registry)** | `participant` | Registro persistente y fuente de verdad donde residen las entidades `ClientApplication`, sus dominios permitidos (`allowed_origins`) y su estado (`is_active`). |

#### B. Desglose Secuencial del Flujo (Pasos 1 al 13)

1. **Paso 1 (`Browser -> Gateway`):** La SPA realiza una solicitud previa de validación de cliente y origen hacia `/api/v1/oauth2/clients/validate`.
2. **Paso 2 (`Gateway -> Middleware`):** La pasarela transfiere la petición al middleware de autorización de clientes.
3. **Paso 3 (`Middleware -> Middleware`):** Se extraen y sanitizan internamente los parámetros `clientId` y la cabecera `Origin`.
4. **Paso 4 (`Middleware -> Cache`):** Se realiza una consulta rápida a Redis bajo la clave `client_origin:{clientId}:{origin}`.
   - **Escenario Cache HIT (Paso 5):**
     5. **Paso 5 (`Cache -->> Middleware`):** Redis devuelve el resultado de validación pre-computado (`ClientValidationResult`), ahorrando el acceso a la base de datos.
   - **Escenario Cache MISS (Pasos 6 al 9):**
     6. **Paso 6 (`Middleware -> DB`):** Si no existe en memoria, se consulta a PostgreSQL por el identificador del cliente (`findByClientId`).
     7. **Paso 7 (`DB -->> Middleware`):** La base de datos devuelve el agregado `ClientApplication`.
     8. **Paso 8 (`Middleware -> Middleware`):** Se evalúan las reglas de negocio del dominio: que el cliente esté activo (`isActive === true`) y que el origen pertenezca a la lista blanca (`allowedOrigins.includes(origin)`).
     9. **Paso 9 (`Middleware -> Cache`):** El resultado de la validación se almacena en Redis con un TTL de 300 segundos (`SETEX`).
   - **Bifurcaciones de Decisión y Respuesta (Pasos 10 al 13):**
     10. **Paso 10 (`Middleware -->> Gateway` [Validación Aprobada]):** Con origen válido y cliente activo, el middleware concede el pase al pipeline invocando `next()`.
     11. **Paso 11 (`Gateway -->> Browser` [Validación Aprobada]):** El Gateway despacha la respuesta `HTTP 200 OK` con los metadatos del cliente (`authorized: true`, `clientName`, `scopes`).
     12. **Paso 12 (`Middleware -->> Browser` [Origen No Autorizado]):** Si el origen no figura en la lista permitida, se corta inmediatamente la petición con `HTTP 403 Forbidden` (`unauthorized_client_origin`).
     13. **Paso 13 (`Middleware -->> Browser` [Cliente Desactivado]):** Si el cliente fue suspendido administrativamente, se bloquea la petición con `HTTP 401 Unauthorized` (`client_deactivated`).

---

### 2. Ejecución en Vivo & Verificación Interactiva Paso a Paso

#### Paso 0: Preparación de la Sesión Interactiva en Terminal

Ejecuta este bloque en tu terminal para definir las variables base de clientes y orígenes:

```bash
# ==============================================================================
# Variables de Sesión Interactiva para Registro de Clientes
# ==============================================================================
export BASE_URL="http://localhost:4000"
export CLIENT_ID="portal-web"
export APP_ORIGIN="https://portal.angelpixel.io"
export REDIRECT_URI="https://portal.angelpixel.io/callback"
```

---

#### Escenario A: Origen Autorizado y Cliente Activo (HTTP 200 OK)

**Comando CLI Oficial (`./bin/identity`):**

```bash
CLIENT_INFO=$(./bin/identity client validate \
  --client-id "$CLIENT_ID" \
  --origin "$APP_ORIGIN" \
  --raw-json)

echo "$CLIENT_INFO" | jq .
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -i -X POST "$BASE_URL/api/v1/oauth2/clients/validate" \
  -H "Content-Type: application/json" \
  -H "Origin: $APP_ORIGIN" \
  -H "X-Client-ID: $CLIENT_ID" \
  -d "{\"clientId\": \"$CLIENT_ID\"}"
```
</details>

##### Respuesta Real Obtenida (HTTP 200 OK):
```text
HTTP/1.1 200 OK [48ms]
POST http://localhost:4000/api/v1/oauth2/clients/validate

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

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity client validate \
  --client-id "$CLIENT_ID" \
  --origin https://malicious-phishing-site.com
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -i -X POST "$BASE_URL/api/v1/oauth2/clients/validate" \
  -H "Content-Type: application/json" \
  -H "Origin: https://malicious-phishing-site.com" \
  -H "X-Client-ID: $CLIENT_ID" \
  -d "{\"clientId\": \"$CLIENT_ID\"}"
```
</details>

##### Respuesta de Seguridad Obtenida (HTTP 403 Forbidden):
```text
HTTP/1.1 403 Forbidden [29ms]
POST http://localhost:4000/api/v1/oauth2/clients/validate

{
  "error": "unauthorized_client_origin",
  "message": "Origin https://malicious-phishing-site.com is not authorized for client portal-web."
}
```

---

#### Escenario C: Intento de Uso de Cliente Revocado / Desactivado (HTTP 401 Unauthorized)

Cuando una aplicación cliente es desactivada por el equipo de seguridad o fin de ciclo de vida (`legacy-app`):

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity client validate \
  --client-id legacy-app \
  --origin https://legacy.angelpixel.io
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://legacy.angelpixel.io" \
  -H "X-Client-ID: legacy-app" \
  -d '{"clientId": "legacy-app"}'
```
</details>

##### Respuesta de Seguridad Obtenida (HTTP 401 Unauthorized):
```text
HTTP/1.1 401 Unauthorized [31ms]
POST http://localhost:4000/api/v1/oauth2/clients/validate

{
  "error": "client_deactivated",
  "message": "Client application \"legacy-app\" is currently deactivated."
}
```

---

#### Escenario D: Identificador de Cliente Inexistente (HTTP 404 Not Found)

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity client validate \
  --client-id cliente-fantasma \
  --origin https://portal.angelpixel.io
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://portal.angelpixel.io" \
  -H "X-Client-ID: cliente-fantasma" \
  -d '{"clientId": "cliente-fantasma"}'
```
</details>

##### Respuesta de Seguridad Obtenida (HTTP 404 Not Found):
```text
HTTP/1.1 404 Not Found [25ms]
POST http://localhost:4000/api/v1/oauth2/clients/validate

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

#### 🌐 Demostración Interactiva en la UI (Navegador — `US-03`)

1. **Prerrequisitos:** Backend (`npm run dev:api` en `:4000`) y Vite (`npm run dev:web` en `:3000`) activos, con una sesión comercial (`acme-corp`) guardada en `localStorage` (`identity_session`, obtenida previamente en `/auth`).
2. **Listado Seguro de Aplicaciones (`GET /api/v1/oauth2/clients`):**
   - Abre [`http://localhost:3000/tenant`](http://localhost:3000/tenant) en la pestaña **`Clientes & CORS`**.
   - Pulsa **`Recargar Clientes`** y verifica en pantalla las tarjetas de clientes (`portal-web`, `allowedOrigins`, `scopes`, chip `ACTIVE`/`INACTIVE`). Comprueba en **DevTools → Network** que `clientSecretHash` nunca se expone en el payload.
3. **Caso Positivo (Validador en Vivo de Origen CORS):**
   - En **Validador en Vivo de Origen CORS**, ingresa **Client ID** = `portal-web` y **Origin** = `https://portal.angelpixel.io`.
   - Pulsa **`Validar Origen CORS`** → `POST /api/v1/oauth2/clients/validate` devuelve `{ "authorized": true, ... }` en **Resultado Validación CORS** (`M3JsonViewer`).
4. **Caso Negativo (Origen No Autorizado):**
   - Cambia **Origin** a `https://evil-app.example.com` y pulsa **`Validar Origen CORS`** → el servidor rechaza con `403 Forbidden` y la UI muestra el detalle de rechazo.
5. **Verificación Técnica (`Network` & `traceparent`):** Comprueba las cabeceras `X-Request-ID` y `traceparent` W3C en DevTools y el badge de traza en `Resultado Validación CORS`.
6. **Trazabilidad E2E:** `tests/e2e/web/tenant_console.spec.tsx` (Scenario 1 & 2) y `tests/e2e/web/client_registry_origin.spec.tsx`.

![Consola /tenant Clientes & CORS en Material Design 3](./assets/screenshots/ui_tenant_clients_m2m.png)

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

> [!TIP]
> **Demostración Interactiva en UI disponible:** Puedes probar este flujo directamente desde el navegador en [`http://localhost:3000/tenant`](http://localhost:3000/tenant) → pestaña **`M2M Playground`**. Consulta el paso a paso completo en [Demostración Interactiva en la UI (Navegador — `US-04`)](#-demostración-interactiva-en-la-ui-navegador--us-04).

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

#### A. Glosario de Actores y Componentes (Cajas del Diagrama)

| Participante / Caja | Tipo | Rol Arquitectónico y Frontera de Seguridad |
| :--- | :--- | :--- |
| **`Daemon` (Microservicio Satélite / Backend Daemon)** | `actor` | Proceso automatizado o servicio backend consumidor que requiere autenticarse máquina a máquina (M2M) sin presencia de usuario. |
| **`Gateway` (Express Gateway)** | `participant` | Punto de entrada perimetral que recibe peticiones en `/api/v1/oauth2/token` tanto con cabeceras `Authorization: Basic` como con cuerpo JSON. |
| **`AuthHandler` (AuthenticateClientM2MCommandHandler)** | `participant` | Caso de uso de aplicación que orquesta la autenticación M2M, aplicando las invariantes del estándar RFC 6749 Sección 4.4. |
| **`Repo` (ClientApplicationRepository)** | `participant` | Repositorio de dominio encargado de recuperar la entidad del cliente y su hash de secreto correspondiente. |
| **`Hash` (Bcrypt HashProvider)** | `participant` | Adaptador criptográfico que ejecuta comparaciones seguras de tiempo constante para verificar el secreto plano provisto contra el hash almacenado. |
| **`Token` (TokenProvider JWT Engine)** | `participant` | Motor de generación de tokens que emite y firma criptográficamente el JWT con los scopes autorizados y tiempo de expiración (3600s). |
| **`Audit` (Structured Security Audit Logger)** | `participant` | Sistema de auditoría forense que emite eventos inmutables en formato NDJSON cumpliendo normativas PCI-DSS v4.0 (Req 10.2.4) y SOC 2 (CC7.2). |

#### B. Desglose Secuencial del Flujo (Pasos 1 al 13)

1. **Paso 1 (`Daemon -> Gateway`):** El microservicio envía `POST /api/v1/oauth2/token` con `grant_type=client_credentials` y sus credenciales (vía HTTP Basic Auth o JSON body).
2. **Paso 2 (`Gateway -> AuthHandler`):** El Gateway invoca el comando de autenticación pasando `clientId`, `clientSecret`, `grantType` y `requestedScope`.
3. **Paso 3 (`AuthHandler -> Repo`):** Se busca en la persistencia la ficha de registro del cliente por su identificador.
4. **Paso 4 (`Repo -> AuthHandler`):** El repositorio retorna el agregado `ClientApplication` (o `null` si no existe).
5. **Paso 5 (`AuthHandler -> Hash`):** Se ejecuta la verificación criptográfica del secreto plano frente al hash Bcrypt almacenado.
   - **Bifurcación Negativa: Credenciales Inválidas o Cliente Inactivo (Pasos 6 y 7):**
     6. **Paso 6 (`AuthHandler -> Audit`):** Se emite un evento de auditoría de severidad `WARNING` (`M2M_AUTH_FAILED`) asegurando que el secreto permanezca redactado como `[REDACTED]`.
     7. **Paso 7 (`AuthHandler -> Daemon`):** Se devuelve de inmediato `HTTP 401 Unauthorized` con el error estándar `invalid_client`.
   - **Bifurcación Negativa: Scope No Autorizado (Paso 8):**
     8. **Paso 8 (`AuthHandler -> Daemon`):** Si el cliente solicitó scopes que exceden su perfil registrado, se rechaza la petición con `HTTP 400 Bad Request` (`invalid_scope`).
   - **Flujo Exitoso (Pasos 9 al 13):**
     9. **Paso 9 (`AuthHandler -> Token`):** Se solicita la emisión del Access Token especificando los scopes autorizados y un tiempo de expiración estándar (3600 segundos).
     10. **Paso 10 (`Token -> AuthHandler`):** El motor criptográfico devuelve la cadena del token JWT firmada digitalmente.
     11. **Paso 11 (`AuthHandler -> Audit`):** Se registra un evento de auditoría de severidad `INFO` certificando la emisión exitosa del token (`M2M_AUTH_SUCCESS`).
     12. **Paso 12 (`AuthHandler -> Gateway`):** Se retorna el DTO de respuesta con el `access_token`, `token_type: "Bearer"` y `expires_in: 3600`.
     13. **Paso 13 (`Gateway -> Daemon`):** La pasarela despacha la respuesta JSON con la cabecera obligatoria de seguridad `Cache-Control: no-store`.

---

### 2. Ejecución en Vivo & Verificación Interactiva Paso a Paso

#### Modo 1: Autenticación con Payload JSON en el Body y Extracción Dinámica del Token (HTTP 200 OK)

Inicializa las credenciales de servicio en la sesión y extrae automáticamente el `M2M_TOKEN`:

```bash
export M2M_CLIENT_ID="m2m-service-app"
export M2M_CLIENT_SECRET="ValidSecret123!_SuperSecureSecretForTesting_2026"
```

**Comando CLI Oficial (`./bin/identity`):**

```bash
M2M_RESP=$(./bin/identity token m2m \
  --client-id "$M2M_CLIENT_ID" \
  --client-secret "$M2M_CLIENT_SECRET" \
  --raw-json)

export M2M_TOKEN=$(echo "$M2M_RESP" | jq -r .access_token)
echo "M2M_TOKEN=$M2M_TOKEN"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
M2M_RESP=$(curl -s -X POST "$BASE_URL/api/v1/oauth2/token" \
  -H "Content-Type: application/json" \
  -d "{
    \"grant_type\": \"client_credentials\",
    \"client_id\": \"$M2M_CLIENT_ID\",
    \"client_secret\": \"$M2M_CLIENT_SECRET\"
  }")

export M2M_TOKEN=$(echo "$M2M_RESP" | jq -r .access_token)
echo "M2M_TOKEN=$M2M_TOKEN"
```
</details>

##### Respuesta Real Obtenida (HTTP 200 OK):
```text
HTTP/1.1 200 OK [112ms]
POST http://localhost:4000/api/v1/oauth2/token

{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJtMm0tc2VydmljZS1hcHAiLCJpc3MiOiJodHRwczovL2F1dGguYW5nZWxwaXhlbC5pbyIsImF1ZCI6Imh0dHBzOi8vYXBpLmFuZ2VscGl4ZWwuaW8iLCJzdWIiOiJtMm0tc2VydmljZS1hcHAiLCJjbGllbnRfaWQiOiJtMm0tc2VydmljZS1hcHAiLCJ0b2tlbl90eXBlIjoiQmVhcmVyIiwianRpIjoiYzVhMmQzZGQtNzNkOS00OTFjLTlkNzktODljMTljYjA3MDMyIiwic2NvcGUiOiJpZGVudGl0eTpyZWFkIGlkZW50aXR5OndyaXRlIGF1ZGl0OmxvZyIsImlhdCI6MTc5NDkzNDAwOCwiZXhwIjoxNzk0OTM3NjA4fQ.aMSO06Cct1_cDTEnOXlbCzemxjLSJ39aKO75sJYWEd8",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "identity:read identity:write audit:log"
}
```

---

#### Modo 2: Autenticación RFC 6749 con Cabecera HTTP Basic Auth (HTTP 200 OK)

El estándar OAuth2 permite enviar las credenciales en la cabecera `Authorization: Basic <base64>` y el `grant_type` en formato `application/x-www-form-urlencoded`:

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity token m2m \
  --client-id "$M2M_CLIENT_ID" \
  --client-secret "$M2M_CLIENT_SECRET" \
  --auth-mode basic
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

Puedes utilizar la opción nativa `-u` de `curl` consumiendo directamente las variables de sesión:

```bash
curl -i -X POST "$BASE_URL/api/v1/oauth2/token" \
  -u "$M2M_CLIENT_ID:$M2M_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```
</details>

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

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity token m2m \
  --client-id m2m-service-app \
  --client-secret "ClaveCompletamenteErronea123!"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "m2m-service-app",
    "client_secret": "ClaveCompletamenteErronea123!"
  }'
```
</details>

##### Respuesta de Seguridad Obtenida (HTTP 401 Unauthorized):
```text
HTTP/1.1 401 Unauthorized [98ms]
POST http://localhost:4000/api/v1/oauth2/token

{
  "error": "invalid_client",
  "error_description": "Client authentication failed: invalid client credentials"
}
```

---

#### Modo 4: Seguridad Negativa — Petición de Scope No Autorizado (HTTP 400 Bad Request)

Si el cliente intenta solicitar privilegios que exceden su rol autorizado en el catálogo (e.g. `admin:superpower`):

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity token m2m \
  --client-id m2m-service-app \
  --client-secret "ValidSecret123!_SuperSecureSecretForTesting_2026" \
  --scope "admin:superpower"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

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
</details>

##### Respuesta de Seguridad Obtenida (HTTP 400 Bad Request):
```text
HTTP/1.1 400 Bad Request [42ms]
POST http://localhost:4000/api/v1/oauth2/token

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

### 4. Teardown y Validación de Integridad del Catálogo de Clientes

Las aplicaciones clientes pre-registradas (`portal-web`, `m2m-service-app`, `legacy-app`, `deactivated-worker`) constituyen el catálogo de gobernanza base y son inmutables durante las pruebas normales del showcase.

Si como operador deseas restaurar la base de datos PostgreSQL y la caché Redis a su estado limpio inicial exactamente como al desplegar el servicio por primera vez:

```bash
# Opción 1: Comando NPM estándar
npm run db:reset

# Opción 2: Vía CLI oficial
./bin/identity ops db-reset
```

> [!NOTE]
> Si deseas levantar una base de datos completamente limpia sin clientes semilla iniciales, puedes pasar la bandera `--no-seeds`:
> ```bash
> ./bin/identity ops db-reset --no-seeds
> ```

---

#### 🌐 Demostración Interactiva en la UI (Navegador — `US-04`)

1. **Prerrequisitos:** Backend (`npm run dev:api` en `:4000`) y Vite (`npm run dev:web` en `:3000`) activos, con una sesión comercial (`acme-corp`) guardada en `localStorage` (`identity_session`) y el cliente confidencial `m2m-service-app` sembrado.
2. **Caso Positivo (Emisión M2M `client_credentials`):**
   - Abre [`http://localhost:3000/tenant`](http://localhost:3000/tenant) y selecciona la pestaña **`M2M Playground`**.
   - Ingresa **Client ID** = `m2m-service-app`, **Client Secret** = `ValidSecret123!_SuperSecureSecretForTesting_2026` (semilla por defecto en PostgreSQL e In-Memory), y **Scopes Solicitados** = `identity:read`.
   - Pulsa **`Solicitar Token M2M`** → invoca `POST /api/v1/oauth2/token` (`grant_type: "client_credentials"`) y muestra `access_token`, `token_type: "Bearer"` y `scope` en **Respuesta Token M2M** (`M3JsonViewer`).
3. **Caso Negativo (Scope No Autorizado o Secreto Inválido):**
   - Cambia **Scopes Solicitados** a `system:root` (o ingresa un **Client Secret** incorrecto) y pulsa **`Solicitar Token M2M`** → el servidor responde `400`/`401` (`invalid_scope` / `invalid_client`) y se renderiza `M3AlertBanner` **`Error M2M`**.
4. **Verificación Técnica (`Network` & `traceparent`):** Comprueba las cabeceras `X-Request-ID` y `traceparent` W3C en **DevTools → Network** y el badge de traza en **Respuesta Token M2M**.
5. **Trazabilidad E2E:** `tests/e2e/web/tenant_console.spec.tsx` (Scenario 3).

---

### 5. Cobertura de Pruebas Automatizadas

El flujo completo de Client Credentials M2M está certificado por la suite de pruebas de integración:

```bash
npx jest tests/integration/identity/interfaces/test_oauth2_token_m2m.ts
```

- **Happy Path:** Emisión exitosa de tokens con payloads JSON y form-urlencoded con HTTP Basic Auth.
- **Validaciones de Protocolo:** Rechazo ante `grant_type` no soportado o ausencia de `client_id`.
- **Gobernanza de Clientes:** Rechazo si un cliente público intenta el flujo M2M o si el cliente está desactivado.
- **Defensa en Profundidad:** Rechazo de scopes no autorizados y redacción de secretos en eventos de auditoría.

---

## 🔄 US-28: Gestión del Ciclo de Vida de Clientes & Rotación Zero-Downtime de Secretos

### 1. Arquitectura, Invariantes de Dominio & RLS *Fail-Closed*

`US-28` extiende el agregado `ClientApplication` para gobernar el ciclo de vida completo de aplicaciones cliente (`spa`, `web`, `native`, `m2m`) desde `/api/v1/clients` bajo aislamiento **PostgreSQL RLS *Fail-Closed*** por `tenant_id` (y acceso transversal auditado para `system:superadmin` según `ADR-0009`):

1. **Perfiles Públicos vs. Confidenciales:** Los clientes `web` y `m2m` generan un `clientSecret` de alta entropía hasheado con `Argon2id` (devuelto en claro **una sola vez** al crear o rotar). Los clientes `spa` y `native` son estrictamente públicos (PKCE) y rechazan `rotate-secret` con `HTTP 400 invalid_client_operation`.
2. **Rotación Zero-Downtime con Ventana de Gracia Dual:** `POST /api/v1/clients/:clientId/rotate-secret` desplaza el hash vigente a `previousSecretHash` con vencimiento `secretGraceExpiresAt = now + gracePeriodSeconds`. Mientras `now < secretGraceExpiresAt`, tanto el secreto anterior como el nuevo son válidos en `/api/v1/oauth2/token`, permitiendo despliegues escalonados sin cortes.
3. **Suspensión Inmediata:** `PATCH /api/v1/clients/:clientId` con `{ "status": "suspended" }` cambia `isActive` a `false` y bloquea al instante cualquier emisión de tokens (`HTTP 401 invalid_client`).

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Tenant Admin (/tenant)
    participant Gateway as Express API Gateway
    participant Controller as OAuth2ClientController
    participant Domain as ClientApplication Aggregate
    participant DB as PostgreSQL 16 (RLS Fail-Closed)
    participant Audit as AuditLogger (NDJSON)

    Admin->>Gateway: POST /api/v1/clients/:clientId/rotate-secret (gracePeriodSeconds: 300)
    Gateway->>Controller: tenantContextMiddleware + authMiddleware
    Controller->>DB: findByClientId(clientId, tenantId)
    DB-->>Controller: ClientApplication (active, confidential)
    Controller->>Domain: rotateSecret(newArgon2Hash, 300)
    Domain-->>Controller: previousSecretHash = current, secretGraceExpiresAt = now + 300s
    Controller->>DB: save(client)
    Controller->>Audit: emit("CLIENT_SECRET_ROTATED", redacted)
    Controller-->>Admin: 200 OK (clientSecret [una vez], secretGraceExpiresAt)

    Note over Admin,DB: Durante 300s, tanto el secreto anterior como el nuevo autentican en /api/v1/oauth2/token
```

#### A. Glosario de Actores y Eventos Forenses

| Participante / Evento | Tipo | Responsabilidad |
| :--- | :--- | :--- |
| **`OAuth2ClientController`** | `participant` | Controlador HTTP para `POST /api/v1/clients`, `GET /api/v1/clients`, `PATCH /api/v1/clients/:clientId` y `POST /api/v1/clients/:clientId/rotate-secret`. |
| **`ClientApplication`** | `participant` | Agregado de dominio que impone invariantes de perfil (`spa`/`native` vs `web`/`m2m`), estado (`active`/`suspended`) y ventana dual. |
| **`AuditLogger` (NDJSON)** | `participant` | Registra eventos inmutables `CLIENT_CREATED`, `CLIENT_UPDATED`, `CLIENT_SUSPENDED`, `CLIENT_REACTIVATED` y `CLIENT_SECRET_ROTATED` redactando secretos (`[REDACTED]`). |

---

### 2. Ejecución en Vivo & Verificación Interactiva Paso a Paso

#### Escenario A: Registro de Cliente Confidencial `m2m` (`POST /api/v1/clients` → `201 Created`)

```bash
curl -s -X POST "http://localhost:4000/api/v1/clients" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "X-Tenant-ID: acme-corp" \
  -H "Content-Type: application/json" \
  -d '{
    "clientName": "Showcase Billing M2M",
    "clientProfile": "m2m",
    "allowedOrigins": ["https://billing.acme-corp.com"],
    "scopes": ["identity:read", "billing:write"]
  }' | jq .
```

##### Respuesta Real Obtenida (`HTTP 201 Created` — secreto expuesto una sola vez):
```json
{
  "id": "ea8faa81-6589-4747-9a31-5e8e59c3452f",
  "tenantId": "acme-corp",
  "clientId": "showcase-billing-m2m-49d69c",
  "clientName": "Showcase Billing M2M",
  "clientType": "confidential",
  "clientProfile": "m2m",
  "status": "active",
  "isActive": true,
  "allowedOrigins": ["https://billing.acme-corp.com"],
  "redirectUris": [],
  "allowedGrantTypes": ["client_credentials"],
  "scopes": ["identity:read", "billing:write"],
  "secretGraceExpiresAt": null,
  "createdAt": "2026-11-25T02:09:57.868Z",
  "updatedAt": "2026-11-25T02:09:57.868Z",
  "clientSecret": "DjMjFcZgjyMmuKqXmC22u9ZseKWcwNv1R3pS-j_ZTYc"
}
```

> [!IMPORTANT]
> Consultas posteriores a `GET /api/v1/clients` proyectan los metadatos del cliente **sin** `clientSecret` ni hashes internos (`secretHash` / `previousSecretHash`).

#### Escenario B: Rotación Zero-Downtime con Gracia Dual (`300s`)

```bash
curl -s -X POST "http://localhost:4000/api/v1/clients/showcase-billing-m2m-49d69c/rotate-secret" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "X-Tenant-ID: acme-corp" \
  -H "Content-Type: application/json" \
  -d '{ "gracePeriodSeconds": 300 }' | jq .
```

##### Respuesta Real Obtenida (`HTTP 200 OK`):
```json
{
  "clientId": "showcase-billing-m2m-49d69c",
  "clientSecret": "AWARl92S_BXLmfyeEy1Ew_DkeMZObGOqqawKMuf47PU",
  "secretGraceExpiresAt": "2026-11-25T02:14:57.895Z",
  "updatedAt": "2026-11-25T02:09:57.895Z"
}
```

Durante la ventana de 300 segundos, ambas llamadas a `POST /api/v1/oauth2/token` (`grant_type: "client_credentials"`) con el secreto anterior y con el secreto nuevo devuelven `HTTP 200 OK`:
```json
{ "token_type": "Bearer", "expires_in": 3600, "scope": "identity:read" }
```

#### Escenario C: Suspensión Inmediata (`PATCH /api/v1/clients/:clientId`) & Bloqueo OAuth2

```bash
curl -s -X PATCH "http://localhost:4000/api/v1/clients/showcase-billing-m2m-49d69c" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "X-Tenant-ID: acme-corp" \
  -H "Content-Type: application/json" \
  -d '{ "status": "suspended" }' | jq .
```

Al suspender (`status: "suspended"`, `isActive: false`), cualquier intento posterior en `POST /api/v1/oauth2/token` es bloqueado inmediatamente con `HTTP 401 Unauthorized`:
```json
{
  "error": "invalid_client",
  "error_description": "Client application \"showcase-billing-m2m-49d69c\" is currently deactivated"
}
```

#### Escenario D: Seguridad Negativa — Rotación en Cliente Público (`spa`)

Intentar `POST /api/v1/clients/:clientId/rotate-secret` sobre un cliente público (`clientProfile: "spa"`) devuelve `HTTP 400 Bad Request`:
```json
{
  "error": "invalid_client_operation",
  "error_description": "Public client application \"showcase-public-spa-9af08b\" cannot rotate client_secret",
  "message": "Public client application \"showcase-public-spa-9af08b\" cannot rotate client_secret"
}
```

---

### 3. 🌐 Demostración Interactiva en la UI (Navegador — `US-28`)

En [`http://localhost:3000/tenant`](http://localhost:3000/tenant) (pestaña **`Clientes & CORS`**, `ClientRegistryPanel.tsx`), los administradores del tenant pueden operar todo el ciclo de vida sin reiniciar servicios (y los operadores `system:superadmin` desde `/platform` bajo auditoría `ADR-0009`):

1. **Registro de Aplicación Cliente:** Desplegar **`Registrar Nueva Aplicación Cliente (US-28)`**, elegir perfil (`m2m`, `web`, `spa`, `native`) y pulsar **`Registrar Cliente`** para recibir el banner de copia única (`client-secret-once-banner`).

![Creación de cliente confidencial y secreto único](./assets/screenshots/us28_tenant_client_created.png)

2. **Rotación Zero-Downtime:** Pulsar **`Rotar Secreto`** sobre un cliente confidencial para emitir un nuevo secreto con ventana de gracia dual (`secretGraceExpiresAt`).

![Rotación de secreto con ventana de gracia](./assets/screenshots/us28_tenant_secret_rotation.png)

3. **Suspensión y Reactivación:** Pulsar **`Suspender`** cambia el chip de estado a `m2m · SUSPENDED` y bloquea nuevos tokens al instante.

![Suspensión de aplicación cliente](./assets/screenshots/us28_tenant_client_suspended.png)

*(Ver también la consola completa en el [Capítulo 09: Portal Visual Enterprise M3](./09-enterprise-ui-portal.md)).*

---

### 4. Cobertura de Pruebas Automatizadas (`US-28` — TDD 4 Capas)

El ciclo de vida completo de `US-28` está verificado en las 4 capas (**4 suites / 13 tests pasando**):

```bash
npx jest \
  tests/unit/identity/domain/test_client_lifecycle_and_rotation.ts \
  tests/integration/identity/oauth2/test_clients_lifecycle_api.ts \
  tests/acceptance/step_defs/test_client_lifecycle_and_rotation_steps.ts \
  tests/e2e/web/tenant_console.spec.tsx
```

- **Unit (`test_client_lifecycle_and_rotation.ts`):** invariantes público vs. confidencial, ventana de gracia dual y bloqueo por suspensión (3/3 passing).
- **Integration (`test_clients_lifecycle_api.ts`):** `/api/v1/clients*` con PostgreSQL RLS activo y rechazo `400 invalid_client_operation` en clientes `spa` (2/2 passing).
- **Acceptance BDD (`client_lifecycle_and_rotation.feature` / `test_client_lifecycle_and_rotation_steps.ts`):** alta confidencial, rotación con gracia dual y bloqueo al suspender (3/3 passing).
- **E2E Web (`tenant_console.spec.tsx`):** consola `/tenant` completa incluyendo Scenario 5 (`US-28`) (5/5 passing).

---

## 🌐 US-29: Bindings Multi-Tenant / Multi-Dominio (N:M) & Resolución Explícita de Tenant

### 1. Arquitectura, Invariantes N:M & Resolución Explícita (`ResolveClientTenantContext`)

`US-29` habilita que una misma aplicación SaaS (`client_id`) atienda múltiples dominios personalizados y se vincule de forma explícita y verificada con varios inquilinos (`tenants`) bajo una relación **N:M** persistida en `client_tenant_bindings` (PostgreSQL RLS *Fail-Closed*):

1. **Cero Inferencia Implícita de Tenant:** El sistema **nunca** deduce `tenant_id` únicamente a partir de encabezados HTTP implícitos (`Origin` / `Referer`). Exige un par explícito `client_id` + (`tenant_id` o `domain`) respaldado por un `ClientTenantBinding` activo y un `ClientApplication` activo.
2. **Unicidad e Integridad de Listas Blancas:** Cada pareja `(clientId, tenantId)` y cada `customDomain` (normalizado en minúsculas sin protocolo/puerto/ruta) son únicos. Tanto `redirect_uri` como `Origin` deben coincidir exactamente con `allowedRedirectUris` y `allowedCorsOrigins` del binding resuelto.
3. **Auditoría Forense (`AuditLogger` NDJSON):** Registra `CLIENT_TENANT_BINDING_CREATED`, `CLIENT_TENANT_BINDING_UPDATED`, `CLIENT_TENANT_BINDING_REVOKED` y `CLIENT_TENANT_BINDING_VIOLATION`.

```mermaid
sequenceDiagram
    autonumber
    actor App as SaaS App (tienda-a.tusherramientas.com)
    participant Gateway as Express API Gateway
    participant Resolver as ResolveClientTenantContext
    participant Repo as PostgresClientTenantBindingRepo
    participant Audit as AuditLogger (NDJSON)

    App->>Gateway: GET /api/v1/auth/config?client_id=...&domain=tienda-a...&redirect_uri=...
    Gateway->>Resolver: Resolver (client_id, tenant_id | domain)
    Resolver->>Repo: findActiveByClientAndDomain(clientId, domain)
    alt Binding Activo Encontrado & redirect_uri Válido
        Repo-->>Resolver: ClientTenantBinding (tenantId: tusherramientas-a)
        Resolver-->>Gateway: Contexto explícito validado
        Gateway-->>App: 200 OK (tenantId, customDomain, allowedAuthMethods, providers)
    else Tenant / Dominio Sin Binding Activo
        Resolver->>Audit: emit("CLIENT_TENANT_BINDING_VIOLATION")
        Resolver-->>App: 403 Forbidden (forbidden_tenant_client_binding)
    else redirect_uri Perteneciente a Otro Binding
        Resolver->>Audit: emit("CLIENT_TENANT_BINDING_VIOLATION")
        Resolver-->>App: 400 Bad Request (invalid_redirect_uri)
    end
```

---

### 2. Ejecución en Vivo & Verificación Interactiva Paso a Paso

#### Escenario A: Vinculación N:M de Un Mismo `client_id` a Dos Tenants/Dominios (`POST /api/v1/clients/:clientId/bindings`)

```bash
curl -s -X POST "http://localhost:4000/api/v1/clients/showcase-saas-1795574075808-1a2e66/bindings" \
  -H "Authorization: Bearer $ROOT_TOKEN" \
  -H "X-Tenant-ID: system" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tusherramientas-a-1795574075808",
    "customDomain": "tienda-a-1795574075808.tusherramientas.com",
    "allowedRedirectUris": ["https://tienda-a-1795574075808.tusherramientas.com/callback"],
    "allowedCorsOrigins": ["https://tienda-a-1795574075808.tusherramientas.com"]
  }' | jq .
```

##### Respuesta Real Obtenida (`HTTP 201 Created`) y Listado `GET /bindings` (`count: 2`):
```json
{
  "count": 2,
  "bindings": [
    {
      "id": "3c0d4d7d-382e-4ddc-b6fd-cfe4091c274e",
      "clientId": "showcase-saas-1795574075808-1a2e66",
      "tenantId": "tusherramientas-a-1795574075808",
      "customDomain": "tienda-a-1795574075808.tusherramientas.com",
      "allowedRedirectUris": ["https://tienda-a-1795574075808.tusherramientas.com/callback"],
      "allowedCorsOrigins": ["https://tienda-a-1795574075808.tusherramientas.com"],
      "isActive": true
    },
    {
      "id": "65937a2f-288c-4728-9fbe-d8fba01c253e",
      "clientId": "showcase-saas-1795574075808-1a2e66",
      "tenantId": "toolbox-b-1795574075808",
      "customDomain": "toolbox-b-1795574075808.com",
      "allowedRedirectUris": ["https://toolbox-b-1795574075808.com/callback"],
      "allowedCorsOrigins": ["https://toolbox-b-1795574075808.com"],
      "isActive": true
    }
  ]
}
```

#### Escenario B: Resolución Explícita por Dominio (`GET /api/v1/auth/config` → `200 OK`)

```bash
curl -s "http://localhost:4000/api/v1/auth/config?client_id=showcase-saas-1795574075808-1a2e66&domain=tienda-a-1795574075808.tusherramientas.com" | jq .
```

```json
{
  "bindingId": "3c0d4d7d-382e-4ddc-b6fd-cfe4091c274e",
  "clientId": "showcase-saas-1795574075808-1a2e66",
  "tenantId": "tusherramientas-a-1795574075808",
  "customDomain": "tienda-a-1795574075808.tusherramientas.com",
  "requiredFields": ["email", "password"],
  "allowedAuthMethods": { "password": true, "passkeys": false, "federatedOidc": true },
  "kycRequired": false,
  "kycMinLevel": "basic"
}
```

#### Escenario C: Seguridad Negativa — Tenant Sin Binding (`403`) & Redirect Cruzado (`400`)

1. Consultar `GET /api/v1/auth/config?client_id=...&tenant_id=academia-beisbol` (sin binding) devuelve **`HTTP 403 Forbidden`**:
```json
{
  "error": "forbidden_tenant_client_binding",
  "error_description": "Client \"showcase-saas-1795574075808-1a2e66\" is not bound to the requested tenant/domain",
  "message": "Client \"showcase-saas-1795574075808-1a2e66\" is not bound to the requested tenant/domain"
}
```
2. Enviar el `redirect_uri` de `toolbox-b` sobre el dominio de `tienda-a` devuelve **`HTTP 400 Bad Request`**:
```json
{
  "error": "invalid_redirect_uri",
  "error_description": "redirect_uri \"https://toolbox-b-1795574075808.com/callback\" is not authorized for this client-tenant binding",
  "message": "redirect_uri \"https://toolbox-b-1795574075808.com/callback\" is not authorized for this client-tenant binding"
}
```

---

### 3. 🌐 Demostración Interactiva en la UI (Navegador — `US-29`)

1. **Superficie `/tenant` (`Clientes & CORS` → `Dominios`):** Los administradores de inquilino inspeccionan los bindings y dominios autorizados de cada cliente (`tenant-bindings-<clientId>`).

![Inspección de dominios y bindings autorizados en /tenant](./assets/screenshots/us29_tenant_client_bindings.png)

2. **Consola Root `/platform` (`Bindings N:M` — `ClientBindingsPanel.tsx`):** Operadores `system:superadmin` gestionan vinculaciones N:M entre clientes, tenants, dominios personalizados y listas blancas de `redirect_uris` / CORS.

![Consola Root de Bindings N:M en /platform](./assets/screenshots/us29_platform_bindings_nm.png)

---

### 4. Cobertura de Pruebas Automatizadas (`US-29` — TDD 4 Capas)

Verificada en las 4 capas (**4 suites / 13 tests pasando**):

```bash
npx jest \
  tests/unit/identity/domain/test_client_tenant_binding.ts \
  tests/integration/identity/oauth2/test_client_tenant_bindings_api.ts \
  tests/acceptance/step_defs/test_client_tenant_bindings_steps.ts \
  tests/e2e/web/platform_console.spec.tsx
```

- **Unit (`test_client_tenant_binding.ts`):** normalización de `customDomain`, rechazo de protocolo/puerto/ruta y validación exacta de `redirect_uri` / `Origin` (3/3 passing).
- **Integration (`test_client_tenant_bindings_api.ts`):** CRUD `/api/v1/clients/:clientId/bindings` y resolución `/api/v1/auth/config` (1/1 passing).
- **Acceptance BDD (`client_tenant_bindings.feature` / `test_client_tenant_bindings_steps.ts`):** resolución N:M, bloqueo `403` y rechazo `400 invalid_redirect_uri` (3/3 passing).
- **E2E Web (`platform_console.spec.tsx`):** consola `/platform` completa incluyendo Scenario 6 (`US-29`) (6/6 passing).

---

[⬅️ Volver al Hub Principal de Showcase](./README.md)
