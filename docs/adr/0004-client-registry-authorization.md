# 4. Registro de Clientes y Autorización de Servicios (Client Registry & Service Authorization)

* **Status:** Accepted
* **Date:** 2026-11-05
* **Deciders:** Principal Identity & Security Architect, Equipo de Ingeniería

## Contexto y Problema

`identity-service` evoluciona desde un servicio de autenticación básica hacia un Identity Provider (IdP) & Broker centralizado para todo el ecosistema de aplicaciones (E-commerce, Portales de IA, Aplicaciones Móviles, Portfolios y Servicios Backend Satélites).

En una arquitectura distribuida, la simple validación de cabeceras CORS en el navegador es insuficiente:
1. Las llamadas Server-to-Server (M2M) o herramientas de prueba (cURL, Postman) no ejecutan el mecanismo de preflight CORS del navegador y pueden invocar endpoints si no existe una validación criptográfica de identidad de la aplicación cliente.
2. Clientes frontend de distintas organizaciones o propósitos requieren flujos de redirección y scopes dispares.
3. Se requiere un control centralizado de los permisos, tipos de concesión (*grant types*) y dominios autorizados para cada aplicación consumidora.

## Drivers de la Decisión

- Control estricto de acceso de aplicaciones cliente más allá del origen HTTP reportado por el navegador.
- Soporte simultáneo para aplicaciones frontend públicas (SPAs / Mobile) y servicios backend confidenciales (M2M).
- Compatibilidad nativa con los estándares OAuth 2.0 (RFC 6749) y PKCE (RFC 7636).
- Capacidad de revocar o suspender aplicaciones cliente de forma dinámica en base de datos sin redesplegar el servicio.

## Opciones Consideradas

1. **Control exclusivo por CORS y variables de entorno (`ALLOWED_ORIGINS`):** Frágil, requiere redespliegues para agregar o dar de baja aplicaciones y no valida llamadas backend M2M.
2. **API Keys estáticas en cabeceras HTTP:** No distingue entre clientes públicos y confidenciales, y carece de semántica de scopes o flujos de autorización estándar.
3. **Registro Dinámico de Clientes en Base de Datos (`registered_clients`) con Clasificación Estricta:** Permite modelar formalmente las características de seguridad de cada aplicación consumidora en PostgreSQL, soportando validación de secretos para clientes confidenciales y obligatoriedad de PKCE para clientes públicos.

## Decisión

Adoptar un **Registro Estricto de Clientes en Base de Datos (`registered_clients`)** con soporte para clientes confidenciales y públicos:

1. **Clasificación de Clientes (`client_type`):**
   * **`confidential`:** Servicios backend y aplicaciones con capacidad de resguardar secretos de forma segura. Requieren autenticación mediante `client_id` y `client_secret` (hasheado con Argon2id / Bcrypt).
   * **`public`:** Single Page Applications (SPAs en React/Vite) y aplicaciones móviles donde el código fuente se ejecuta en el dispositivo del usuario y no es posible resguardar un secreto. **Requerimiento estricto:** Prohibición de `client_secret` y exigencia mandataria del flujo Authorization Code con **PKCE (Proof Key for Code Exchange - RFC 7636, método `S256`)**.

2. **Modelo de Datos en PostgreSQL (`registered_clients`):**
   * `id` (UUID, Primary Key)
   * `client_id` (VARCHAR(100), Unique, Not Null)
   * `client_secret_hash` (VARCHAR(255), Nullable para clientes públicos)
   * `client_name` (VARCHAR(150), Not Null)
   * `client_type` (VARCHAR(20), Not Null - Check: `'confidential'`, `'public'`)
   * `allowed_origins` (TEXT[], Not Null - Orígenes permitidos para CORS dinámico y validación de cabeceras)
   * `redirect_uris` (TEXT[], Not Null - URIs válidas para retorno de flujos OAuth2/OIDC)
   * `allowed_grant_types` (TEXT[], Not Null - Ej. `['authorization_code', 'refresh_token', 'client_credentials']`)
   * `scopes` (TEXT[], Not Null - Ej. `['openid', 'profile', 'email', 'identity:read']`)
   * `is_active` (BOOLEAN, Default `true`)
   * `created_at`, `updated_at` (TIMESTAMPTZ)

3. **Middleware de Inspección de Cliente (`ClientAuthorizationMiddleware`):**
   * En peticiones públicas o de intercambio de tokens, intercepta `client_id`, valida su estado activo en el repositorio, comprueba que el `Origin` o `Redirect URI` coincida exactamente con los registrados y verifica que el `grant_type` solicitado esté expresamente autorizado para dicha aplicación.

## Consecuencias

### Positivas
- Seguridad robusta: Previene el consumo de endpoints por aplicaciones no registradas o desde dominios no homologados.
- Cumplimiento de RFC 6749 y RFC 7636 para clientes modernos.
- Gestión granular de scopes por aplicación cliente.
- Desacoplamiento de la configuración de clientes respecto al ciclo de despliegue de la API.

### Negativas / Riesgos
- Consulta adicional a la base de datos o caché para validar los metadatos del cliente en cada handshake OAuth2 (mitigable con almacenamiento en caché Redis con TTL corto).
- Obliga a crear fixtures y seeds de clientes autorizados en los entornos de testing y desarrollo local.

