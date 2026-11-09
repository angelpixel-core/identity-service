# Guía de Pruebas Interactivas: US-03 (Dynamic Client Registry and Origin Validation)

> **Document ID:** `GUIDELINE-04-client-registry-validation`  
> **Bounded Context:** `identity` / `client-registry`  
> **Historia de Usuario:** `US-03: Dynamic Client Registry and Origin Validation`  
> **Arquitectura:** Hexagonal / DDD + Client Registry + Origin Guard Middleware (ADR-0004)

---

## 1. Visión General

Esta guía describe cómo verificar manualmente de principio a fin el subsistema de **Client Registry & Origin Validation** implementado en **US-03**.

Permite validar:
1. **Validación de Origen Homologado (200 OK):** Solicitudes provenientes de orígenes autorizados (`Origin` o `Referer`) para un cliente público registrado (`portal-web`).
2. **Rechazo de Origen No Autorizado (403 Forbidden):** Bloqueo inmediato cuando una aplicación intenta consumir el IdP desde un dominio no listado en `allowed_origins` (`unauthorized_client_origin`).
3. **Bloqueo de Cliente Desactivado (401 Unauthorized):** Rechazo de clientes marcados con `is_active: false` (`client_deactivated`).
4. **Validación de Parámetros Requeridos (400 Bad Request):** Respuestas ante ausencia o formato inválido de `client_id`.
5. **Guard Visual en Frontend:** Verificación del componente `ClientAuthorizationGuard` en la aplicación React.

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
> **Inicialización de Volúmenes y Nuevas Migraciones de Base de Datos:**  
> La imagen oficial de PostgreSQL **solo ejecuta** los scripts ubicados en `/docker-entrypoint-initdb.d/` cuando el volumen `db_data` está vacío (durante la primera inicialización del cluster).
> 
> Si el volumen de datos ya existía de etapas anteriores a **US-03**, PostgreSQL omitirá los scripts nuevos (`006-create-registered-clients.sql` y `007-enable-postgresql-rls.sql`).
> 
> Para sincronizar el esquema en caliente sin reiniciar la base de datos, ejecuta:
> ```bash
> docker compose exec -T db psql -U postgres < infrastructure/local/initdb.d/006-create-registered-clients.sql
> docker compose exec -T db psql -U postgres < infrastructure/local/initdb.d/007-enable-postgresql-rls.sql
> ```
> 
> O alternativamente, para un reinicio limpio completo con volumen recreado desde cero:
> ```bash
> docker compose down -v
> docker compose up -d
> ```

### Paso 2.2: Semillas de Clientes Disponibles por Defecto

En modo desacoplado / desarrollo en memoria o base de datos PostgreSQL, el sistema dispone de los siguientes clientes registrados:

| `client_id` | Tipo | Orígenes Permitidos | Estado |
| :--- | :--- | :--- | :--- |
| `portal-web` | `public` | `https://portal.angelpixel.io` | `active: true` |
| `legacy-app` | `public` | `https://legacy.angelpixel.io` | `active: false` |
| `m2m-service-app` | `confidential` | N/A (M2M Backend) | `active: true` |

---

## 3. Pruebas Interactivas vía cURL / Terminal

### Caso 1: Origen y Cliente Válidos (200 OK)

Ejecuta una petición simulando una SPA autorizada en `https://portal.angelpixel.io`:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://portal.angelpixel.io" \
  -d '{"clientId": "portal-web"}'
```

**Respuesta Esperada:**
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

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

### Caso 2: Intento de Acceso desde Dominio Malicioso (403 Forbidden)

Ejecuta la misma petición pero simulando un sitio no homologado (`https://malicious-site.com`):

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://malicious-site.com" \
  -d '{"clientId": "portal-web"}'
```

**Respuesta Esperada:**
```http
HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8

{
  "error": "unauthorized_client_origin",
  "message": "Origin https://malicious-site.com is not authorized for client portal-web."
}
```

---

### Caso 3: Solicitud con Cliente Desactivado (401 Unauthorized)

Ejecuta una petición utilizando el cliente `legacy-app`:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://legacy.angelpixel.io" \
  -d '{"clientId": "legacy-app"}'
```

**Respuesta Esperada:**
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8

{
  "error": "client_deactivated",
  "message": "Client application \"legacy-app\" is currently deactivated."
}
```

---

### Caso 4: Solicitud sin Client ID (400 Bad Request)

Ejecuta una petición omitiendo el identificador de cliente:

```bash
curl -i -X POST http://localhost:4000/api/v1/oauth2/clients/validate \
  -H "Content-Type: application/json" \
  -H "Origin: https://portal.angelpixel.io" \
  -d '{}'
```

**Respuesta Esperada:**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{
  "error": "missing_client_id",
  "message": "Client ID is required via header \"x-client-id\", query parameter \"client_id\", or body \"clientId\"."
}
```

---

## 4. Pruebas Automatizadas de Certificación

Para ejecutar la verificación completa de todos los contratos creados en **US-03**:

```bash
# Ejecutar las 4 capas de pruebas del slice
npm test && npm run test:acceptance && npm run test:e2e
```

Todos los tests deben pasar en verde (`116 passed`).

