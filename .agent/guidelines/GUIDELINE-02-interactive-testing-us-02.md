# Guía de Pruebas Interactivas: US-02 (Get Tenant User Profile & Cache-Aside)

> **Document ID:** `GUIDELINE-02-interactive-testing-us-02`  
> **Bounded Context:** `identity`  
> **Historia de Usuario:** `US-02: Get Tenant User Profile`  
> **Arquitectura:** Vertical Slice (Read Slice) + Hexagonal (DDD) + Cache-Aside Pattern + Multi-Tenant Isolation (ADR-0003)

---

## 1. Visión General

Esta guía detalla los procedimientos paso a paso para interactuar manualmente y validar de principio a fin la funcionalidad de **US-02: Get Tenant User Profile**, implementada a través del endpoint `GET /api/v1/auth/me`.

> [!TIP]
> **¿Prefieres pruebas visuales en el navegador?**  
> Para interactuar con la tarjeta de perfil en vivo en la Web App (`http://localhost:3000`) o inspeccionar sus estados de carga y error en Storybook (`http://localhost:6006`), consulta [GUIDELINE-03: Pruebas Visuales en Navegador](GUIDELINE-03-visual-browser-testing.md).

Permite validar los siguientes aspectos clave:
1. **Flujo Cache-Aside:** Comportamiento ante *Cache Miss* (consulta a persistencia y población en caché con clave `user_profile:{tenantId}:{userId}` y TTL) y *Cache Hit* (respuesta instantánea en memoria sin consultar PostgreSQL).
2. **Seguridad y Frontera Multi-Tenant (AuthMiddleware):** Verificación estricta de tokens Bearer JWT y detección activa de intentos de acceso cruzado entre tenants (`403 Forbidden` cuando `x-tenant-id` difiere del claim `tenantId` del token).
3. **Respuesta Sanitizada (`UserProfileDTO`):** Confirmación de que el payload nunca expone hashes de contraseñas u otros datos sensibles.
4. **Componente Web y Hook:** Validación de estados de carga, error y reintento en el componente React `UserProfileCard` con `useUserProfile`.

---

## 2. Preparación del Entorno

### Paso 2.1: Levantar la Infraestructura Local

Asegúrate de que los contenedores de PostgreSQL y Redis se encuentren activos:

```bash
npm run docker:up
# o alternativamente: docker compose up -d
```

Verifica el estado de los contenedores:
```bash
docker compose ps
```
Ambos contenedores (`identity-db` y `identity-cache`) deben encontrarse en estado `healthy` o `Up`.

### Paso 2.2: Configuración de Entorno (.env)

Verifica que el archivo `.env` contenga la configuración requerida para base de datos, firma JWT y TTL de caché:

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

### Paso 2.3: Iniciar el Servidor API

Inicia el servidor en modo desarrollo:

```bash
npm run dev:api
```

*Salida esperada en terminal:*
```text
Identity Service HTTP Server listening on port 4000
Connected to PostgreSQL: postgresql://postgres:postgres@localhost:5432/identity_db
```

---

## 3. Pruebas Manuales Paso a Paso (HTTP / REST)

Abre una segunda terminal o tu cliente HTTP preferido (cURL, Postman, Bruno, Thunder Client).

### Prerrequisito: Obtención de Token JWT Válido

Para interactuar con `GET /api/v1/auth/me`, primero registraremos un usuario en el tenant `acme-corp` para obtener un token JWT firmado:

```bash
# 1. Registrar usuario y capturar respuesta
curl -s -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: acme-corp" \
  -d '{
    "email": "carlos@acme.com",
    "password": "Password123!"
  }' | tee /tmp/register_response.json
```

*Respuesta esperada:*
```json
{
  "user": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "carlos@acme.com",
    "tenantId": "acme-corp",
    "createdAt": "2026-11-05T03:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Extrae el token a una variable de entorno de tu shell:
```bash
TOKEN=$(cat /tmp/register_response.json | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo "Token configurado: ${TOKEN:0:25}..."
```

---

### Caso 3.1: Consulta Exitosa de Perfil — Primer Acceso / Cache Miss (HTTP 200 OK)

Ejecuta la primera consulta al perfil utilizando el token obtenido:

```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-tenant-id: acme-corp"
```

*Respuesta esperada:*
```json
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "carlos@acme.com",
  "tenantId": "acme-corp",
  "createdAt": "2026-11-05T03:00:00.000Z",
  "updatedAt": "2026-11-05T03:00:00.000Z"
}
```

> **Verificación Cache Miss:**
> 1. El orquestador `GetUserProfileQueryHandler` busca la clave `user_profile:acme-corp:<userId>` en `MemoryCacheAdapter`.
> 2. Al no encontrarla (*Cache Miss*), consulta a PostgreSQL mediante `UserRepositoryPort.findById`.
> 3. Pueblos la entrada en caché con el TTL configurado (por defecto 60 segundos o `CACHE_TTL_SECONDS`).
> 4. Se comprueba que **NO** se expone `passwordHash` en el payload de respuesta.

---

### Caso 3.2: Consulta Consecutiva Inmediata — Cache Hit (HTTP 200 OK)

Ejecuta inmediatamente el mismo comando sin modificar parámetros:

```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-tenant-id: acme-corp"
```

*Respuesta esperada:*
```json
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "carlos@acme.com",
  "tenantId": "acme-corp",
  "createdAt": "2026-11-05T03:00:00.000Z",
  "updatedAt": "2026-11-05T03:00:00.000Z"
}
```

> **Verificación Cache Hit:**
> La respuesta se sirve en tiempo submilisegundo directamente desde la memoria RAM del proceso sin emitir queries SQL hacia PostgreSQL.

---

### Caso 3.3: Violación de Frontera Multi-Tenant (HTTP 403 Forbidden)

Intenta acceder al perfil utilizando el token de `acme-corp`, pero solicitando explícitamente el tenant de un competidor (`beta-corp`):

```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-tenant-id: beta-corp"
```

*Respuesta esperada:*
```json
HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8

{
  "error": "Tenant access forbidden: token claims do not match requested tenant"
}
```

> **Invariante de Seguridad:**
> `AuthMiddleware` intercepta la petición y compara el header `x-tenant-id` (`beta-corp`) con el claim `tenantId` verificado del JWT (`acme-corp`). Al diferir, bloquea el paso antes de alcanzar la capa de aplicación, neutralizando ataques de suplantación lateral.

---

### Caso 3.4: Validaciones de Autenticación Defensiva (HTTP 401 Unauthorized)

#### A. Ausencia Total de Encabezado Authorization
```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "x-tenant-id: acme-corp"
```
*Respuesta:*
```json
HTTP/1.1 401 Unauthorized
{"error": "Authorization header missing or invalid"}
```

#### B. Formato de Autenticación No Bearer
```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Basic dXNlcjpwYXNz" \
  -H "x-tenant-id: acme-corp"
```
*Respuesta:*
```json
HTTP/1.1 401 Unauthorized
{"error": "Authorization header missing or invalid"}
```

#### C. Token JWT Inválido o Manipulado
```bash
curl -i -X GET http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token-adulterado" \
  -H "x-tenant-id: acme-corp"
```
*Respuesta:*
```json
HTTP/1.1 401 Unauthorized
{"error": "Invalid or expired authentication token"}
```

---

## 4. Pruebas Interactivas de Frontend (React UI & Custom Hook)

La interfaz de usuario implementa el hook reactivo `useUserProfile` y el componente `UserProfileCard`:

### 4.1. Comportamiento del Hook `useUserProfile`

El hook ubicado en `interfaces/web/client/contexts/identity/data/queries.ts` incorpora una estrategia de caché del lado cliente:
1. **Primera invocación:** Activa `isLoading: true`, realiza el `fetch` con los headers `Authorization` y `x-tenant-id`.
2. **Poblado en cliente:** Al recibir la respuesta, guarda el perfil en un mapa en memoria con clave `user_profile:{tenantId}:{userId}`.
3. **Llamadas subsiguientes:** Si la entrada está en caché de cliente y no ha expirado su TTL (60 s), retorna inmediatamente `data` con `isLoading: false` sin despachar peticiones de red.
4. **Acción de refresco:** Invocar `reload()` purga la caché local y fuerza un nuevo `fetch` al servidor.

### 4.2. Validación de Componente `UserProfileCard`

Ubicado en `interfaces/web/client/contexts/identity/ui/components/user_profile_card.tsx`:

* **Estado Cargando:** Renderiza `role="status"` con mensaje `"Cargando información del perfil..."`.
* **Estado de Error:** Renderiza `role="alert"` con el mensaje de error y un botón interactivo `"Reintentar"` que invoca `reload()`.
* **Estado Exitoso:** Renderiza:
  * Correo del usuario en `heading`.
  * Badge visual de la organización con `data-testid="tenant-badge"`.
  * Identificador único de usuario (`userId`).
  * Marcas de tiempo de creación y actualización.
  * Botón `"Actualizar Perfil"` para refrescar datos en demanda.

Para verificar estos comportamientos en modo automatizado / renderizado:
```bash
npm run test:e2e
```

---

## 5. Modo Aislado In-Memory (Zero Dependencies)

Si deseas probar la API sin tener Docker ni PostgreSQL levantado:

1. Ejecuta con `DATABASE_URL` vacío:
   ```bash
   DATABASE_URL="" npm run dev:api
   ```
2. El servidor arrancará utilizando `InMemoryUserRepository` y `MemoryCacheAdapter`:
   ```text
   Identity Service HTTP Server listening on port 4000
   Running in isolated in-memory storage mode
   ```
3. Registra un usuario y consulta el perfil como se detalla en la Sección 3. Todo el ciclo de Cache Miss, Cache Hit y seguridad multitenant funcionará idénticamente.

---

## 6. Ejecución de la Pirámide de Pruebas Automatizadas

Para validar que todo el slice cumple con las 4 capas de pruebas del sistema:

```bash
# Nivel 1: Unit Tests (Query Handler y MemoryCacheAdapter con TTL)
npm run test:unit

# Nivel 2: Integration Tests (API GET /api/v1/auth/me y AuthMiddleware)
npm run test:integration

# Nivel 3: Acceptance Tests (Escenarios BDD de Cache Miss/Hit en Gherkin)
npm run test:acceptance

# Nivel 4: E2E Tests (Hook useUserProfile y componente UserProfileCard)
npm run test:e2e

# Ejecución Completa de la Pirámide (82/82 tests verdes)
npm test && npm run test:acceptance && npm run test:e2e
```

---

## 7. Resumen de Claves y Parámetros Técnicos

| Concepto | Convención / Valor | Propósito |
| :--- | :--- | :--- |
| **Clave de Caché** | `user_profile:{tenantId}:{userId}` | Segregación absoluta de caché por organización y usuario |
| **TTL Servidor** | 60 segundos (o `CACHE_TTL_SECONDS`) | Vigencia de la entrada en `MemoryCacheAdapter` |
| **TTL Cliente** | 60 segundos | Vigencia en la caché en memoria del hook `useUserProfile` |
| **Header Tenant** | `x-tenant-id: <slug>` | Identificador de organización enviado por el cliente |
| **Header Auth** | `Authorization: Bearer <token>` | Credencial JWT portadora de los claims autenticados |
| **Claim Tenant** | `payload.tenantId` | Identidad fidedigna de la organización firmada criptográficamente |

