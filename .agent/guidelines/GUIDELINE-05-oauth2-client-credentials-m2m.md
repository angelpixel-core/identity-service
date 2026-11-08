# Guía de Pruebas Interactivas: US-04 (OAuth2 M2M Client Credentials Grant & Scoped Token Issuance)

> **Document ID:** `GUIDELINE-05-oauth2-client-credentials-m2m`  
> **Bounded Context:** `identity` / `oauth2-token`  
> **Historia de Usuario:** `US-04: Client Credentials & Scoped Access Token Grant`  
> **Estándar Normativo:** RFC 6749 (Secciones 2.3.1, 4.4, 5.1 y 5.2) y RFC 7519 (JWT)  
> **Arquitectura:** Hexagonal / DDD + Client Registry + Scoped Tokens (ADR-0004)

---

## 1. Visión General

Esta guía detalla los procedimientos paso a paso para interactuar manualmente y validar de principio a fin el flujo **Machine-to-Machine (M2M)** implementado en **US-04**.

Permite validar:
1. **Emisión Exitosa de Token M2M (`200 OK`):** Intercambio de credenciales confidenciales por un token Bearer JWT con claims RFC 7519 (`iss`, `aud`, `sub`, `client_id`, `scope`, `jti`, `token_type: "Bearer"`).
2. **Métodos de Autenticación RFC 6749:** Soporte dual para autenticación vía payload JSON (`client_id` + `client_secret`) y cabecera HTTP Basic (`Authorization: Basic <base64>`) con `application/x-www-form-urlencoded`.
3. **Acotamiento y Negociación de Scopes:** Concesión de scopes específicos (`scope=identity:read`) y asignación por defecto de todos los scopes autorizados cuando el parámetro `scope` es omitido.
4. **Barreras Defensivas y Códigos de Error RFC 6749 Sección 5.2:**
   - Rechazo de scopes no autorizados (`400 Bad Request` / `invalid_scope`).
   - Rechazo de clientes públicos en flujos M2M (`400 Bad Request` / `unauthorized_client`).
   - Rechazo de credenciales incorrectas (`401 Unauthorized` / `invalid_client`).
   - Rechazo de clientes desactivados (`401 Unauthorized` / `invalid_client`).
   - Bloqueo de múltiples métodos de autenticación simultáneos (`400 Bad Request` / `invalid_request`).
5. **Smart Caching y Renovación Automática:** Uso del SDK cliente `OAuth2M2MClient` con caché en memoria y buffer de 60 segundos.

---

## 2. Preparación del Entorno

### Paso 2.1: Levantar los Servicios en Docker Compose

Asegúrate de que los contenedores de base de datos, caché y la API se encuentren activos:

```bash
docker compose up -d
```

Verifica la salud de los servicios:

```bash
docker compose ps
```

> [!IMPORTANT]
> **Inicialización de Semillas en PostgreSQL:**  
> Si tu volumen de datos `db_data` fue creado previamente, sincroniza las semillas ejecutando:
> ```bash
> docker compose exec -T db psql -U postgres < infrastructure/local/initdb.d/006-create-registered-clients.sql
> ```

### Paso 2.2: Clientes y Credenciales Disponibles para Pruebas

El sistema dispone de las siguientes semillas registradas en PostgreSQL y en el repositorio en memoria:

| `client_id` | Tipo | Secreto en Texto Claro (`client_secret`) | Scopes Permitidos | Estado |
| :--- | :--- | :--- | :--- | :--- |
| `m2m-service-app` | `confidential` | `ValidSecret123!_SuperSecureSecretForTesting_2026` | `identity:read identity:write audit:log` | `active: true` |
| `deactivated-worker` | `confidential` | `ValidSecret123!_SuperSecureSecretForTesting_2026` | `identity:read` | `active: false` |
| `portal-web` | `public` | N/A (Cliente Público sin secreto) | `openid profile email` | `active: true` |

---

## 3. Pruebas Interactivas vía cURL / Terminal

### Caso 1: Emisión Exitosa con JSON Payload (200 OK)

Solicita un token para el worker `m2m-service-app` sin especificar `scope` (se otorgan todos los scopes autorizados por defecto):

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "m2m-service-app",
    "client_secret": "ValidSecret123!_SuperSecureSecretForTesting_2026"
  }'
```

**Respuesta Esperada:**
```http
HTTP/1.1 200 OK
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8

{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "identity:read identity:write audit:log"
}
```

> [!TIP]
> Puedes inspeccionar los claims del JWT devuelto en [jwt.io](https://jwt.io) para confirmar la presencia de `iss`, `aud`, `sub: "m2m-service-app"`, `client_id: "m2m-service-app"` y `jti`.

---

### Caso 2: Autenticación HTTP Basic y Form-Urlencoded (RFC 6749 Sección 4.4.2)

Ejecuta la autenticación utilizando la cabecera `Authorization: Basic <base64>` y cuerpo `application/x-www-form-urlencoded`:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Authorization: Basic bTJtLXNlcnZpY2UtYXBwOlZhbGlkU2VjcmV0MTIzIV9TdXBlclNlY3VyZVNlY3JldEZvclRlc3RpbmdfMjAyNg==" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"
```

**Respuesta Esperada:**
```http
HTTP/1.1 200 OK
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8

{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "identity:read identity:write audit:log"
}
```

---

### Caso 3: Negociación de Scope Específico (200 OK)

Solicita únicamente el permiso de lectura (`identity:read`):

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "m2m-service-app",
    "client_secret": "ValidSecret123!_SuperSecureSecretForTesting_2026",
    "scope": "identity:read"
  }'
```

**Respuesta Esperada:**
```http
HTTP/1.1 200 OK
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8

{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "identity:read"
}
```

---

### Caso 4: Rechazo por Scope No Autorizado (400 Bad Request)

Intenta solicitar un scope superior (`admin:superpower`) que no está asignado a la aplicación:

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

**Respuesta Esperada:**
```http
HTTP/1.1 400 Bad Request
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8

{
  "error": "invalid_scope",
  "error_description": "Requested scope \"admin:superpower\" is not authorized for client \"m2m-service-app\""
}
```

---

### Caso 5: Rechazo por Secreto Inválido (401 Unauthorized)

Envía una contraseña errónea para comprobar la validación criptográfica y la auditoría de seguridad:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "m2m-service-app",
    "client_secret": "WrongSecret123!_SuperSecureSecretForTesting_2026"
  }'
```

**Respuesta Esperada:**
```http
HTTP/1.1 401 Unauthorized
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8

{
  "error": "invalid_client",
  "error_description": "Client authentication failed: invalid client credentials"
}
```

---

### Caso 6: Rechazo por Cliente Desactivado (401 Unauthorized)

Intenta autenticar al cliente `deactivated-worker`:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "deactivated-worker",
    "client_secret": "ValidSecret123!_SuperSecureSecretForTesting_2026"
  }'
```

**Respuesta Esperada:**
```http
HTTP/1.1 401 Unauthorized
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8

{
  "error": "invalid_client",
  "error_description": "Client application \"deactivated-worker\" is currently deactivated"
}
```

---

### Caso 7: Intento de Flujo M2M desde Cliente Público (400 Bad Request)

Los clientes de tipo `public` (SPA, móviles) tienen prohibido usar el flujo de credenciales de cliente según RFC 6749:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "portal-web",
    "client_secret": "ValidSecret123!_SuperSecureSecretForTesting_2026"
  }'
```

**Respuesta Esperada:**
```http
HTTP/1.1 400 Bad Request
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8

{
  "error": "unauthorized_client",
  "error_description": "Public clients are not authorized to use client_credentials grant type"
}
```

---

### Caso 8: Múltiples Métodos de Autenticación Simultáneos (400 Bad Request)

La sección 2.3.1 de RFC 6749 prohíbe taxativamente enviar credenciales en la cabecera Basic y en el cuerpo simultáneamente:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/token \
  -H "Authorization: Basic bTJtLXNlcnZpY2UtYXBwOlZhbGlkU2VjcmV0MTIzIV9TdXBlclNlY3VyZVNlY3JldEZvclRlc3RpbmdfMjAyNg==" \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "m2m-service-app",
    "client_secret": "ValidSecret123!_SuperSecureSecretForTesting_2026"
  }'
```

**Respuesta Esperada:**
```http
HTTP/1.1 400 Bad Request
Cache-Control: no-store
Pragma: no-cache
Content-Type: application/json; charset=utf-8

{
  "error": "invalid_request",
  "error_description": "Multiple client authentication methods detected. Client credentials must be provided via HTTP Basic OR request body, not both."
}
```

---

## 4. Uso del SDK Consumidor (`OAuth2M2MClient`)

Para microservicios y workers satélites desarrollados en TypeScript / Node.js, el proyecto provee el SDK [OAuth2M2MClient](../../interfaces/http/client/oauth2_m2m_client.ts) con caché inteligente.

### Script Demostrativo de Caché y Auto-Renovación

Ejecuta el script dedicado de demostración empaquetado en el proyecto:

```bash
npm run demo:m2m
```

> [!NOTE]
> Este script se encuentra implementado en [`scripts/demo_m2m_client.ts`](../../scripts/demo_m2m_client.ts). Permite configurar opcionalmente una URL base alternativa mediante la variable de entorno `IDP_BASE_URL` (por defecto `http://localhost:4000`).

**Salida Esperada:**
```text
Conectando con Identity Provider en http://localhost:4000...

1. Primera solicitud (Petición HTTP real hacia /api/v1/oauth2/token)...
✓ Token obtenido exitosamente (expira en: 3600s)
  Token: eyJhbGciOiJIUzI1NiIsInR5cCI6Ik...

2. Segunda solicitud consecutiva inmediata (Smart Cache Hit en memoria)...
✓ ¿Mismo token reutilizado desde caché?: SÍ (Cache Hit)

¡Demostración de OAuth2M2MClient completada con éxito!
```

---

## 5. Pruebas Automatizadas de Certificación

Para certificar todo el comportamiento de US-04 en la pirámide de pruebas:

```bash
# Capa 3: Aceptación BDD (Gherkin Living Doc)
npm run test:acceptance -- tests/acceptance/step_defs/test_client_credentials_grant_steps.ts

# Capa 4: E2E Machine to Machine Spec con SDK
npm run test:e2e -- tests/e2e/m2m/client_credentials_flow.spec.ts

# Capa 2: Integración de Endpoints HTTP
npm run test:integration -- tests/integration/identity/interfaces/test_oauth2_token_m2m.ts
```

