# EPIC-04: OIDC / OAuth2 Authorization Server & Session Lifecycle

* **ID:** EPIC-04
* **Bounded Context:** `identity` / `oidc-server`
* **Estado:** Planned
* **Arquitectura:** OpenID Connect Core 1.0 + OAuth 2.0 (RFC 6749, RFC 7636 PKCE) + Asymmetric Cryptography
* **Topología de Referencia:** [`.agent/TREE.txt`](../../TREE.txt)

---

## 1. Visión y Definición del Dominio

Esta épica posiciona a `identity-service` como un **Servidor de Autorización OAuth2 e Identity Provider OpenID Connect (OIDC)** conforme a los estándares de la industria. Proporciona a las aplicaciones satélites del ecosistema los mecanismos para autenticar usuarios finales, autorizar el consumo de APIs y gestionar sesiones persistentes seguras sin requerir acceso a las contraseñas ni compartir secretos simétricos.

La arquitectura se fundamenta en la criptografía asimétrica **RS256 (RSA 2048-bit)**, rotación de claves públicas con cabecera `kid` (Key ID), exposición de endpoints estándar de descubrimiento (`/.well-known/openid-configuration`) y claves (`/.well-known/jwks.json`), flujos de autorización con PKCE (RFC 7636) y rotación de Refresh Tokens mediante cookies con atributos `HttpOnly`, `Secure` y `SameSite=Strict`.

---

## 2. Alcance y Vertical Slices

### 2.1. Cryptographic Key Management & JWKS/Discovery Endpoints
* **User Story:** [`US-07: Cryptographic Keypair Management, JWKS and OpenID Discovery Endpoints`](stories/US-07-jwks-discovery-endpoints.md)
* **Flujo:**
  * Almacenamiento seguro de par de claves RSA 2048-bit (privada/pública) con asignación de `kid`.
  * Exposición de `GET /.well-known/openid-configuration` (metadatos del servidor, endpoints de autorización, token, userinfo, algoritmos soportados).
  * Exposición de `GET /.well-known/jwks.json` con la clave pública en formato JSON Web Key Set para verificación externa desacoplada.
* **Artefactos Principales:**
  * `src/contexts/identity/domain/services/asymmetric_key_provider.ts`
  * `src/contexts/identity/infrastructure/security/rsa_key_adapter.ts`
  * `interfaces/http/rest/v1/oidc/discovery_controller.ts`

### 2.2. OAuth2 Authorization Code Flow with PKCE & Consent Screen
* **User Story:** [`US-08: OAuth2 Authorization Code Flow with PKCE & User Consent`](stories/US-08-auth-code-pkce-flow.md)
* **Flujo:**
  * Endpoint `GET /oauth2/authorize` que valida `client_id`, `redirect_uri`, `scope`, `code_challenge` y `code_challenge_method` (`S256`).
  * Emisión de un `authorization_code` efímero (TTL 60 segundos) asociado al usuario autenticado.
  * Intercambio en `POST /oauth2/token` con validación del `code_verifier` (SHA-256) antes de emitir el par Access Token (JWT) e ID Token (OIDC).
* **Artefactos Principales:**
  * `src/contexts/identity/application/commands/issue_authorization_code/command.ts` & `handler.ts`
  * `src/contexts/identity/application/commands/exchange_code_for_tokens/command.ts` & `handler.ts`
  * `interfaces/http/rest/v1/oauth2/authorize_controller.ts`
  * `interfaces/http/rest/v1/oauth2/token_controller.ts`

### 2.3. Sliding Session & Refresh Token Rotation with HttpOnly Cookies
* **User Story:** [`US-09: Sliding Session Refresh Token Rotation with HttpOnly Cookies`](stories/US-09-refresh-token-rotation.md)
* **Flujo:**
  * Almacenamiento de Refresh Tokens opacos en PostgreSQL con hash criptográfico, vinculados a una familia de sesiones (`family_id`).
  * Despacho en cookies seguras `HttpOnly`, `Secure`, `SameSite=Strict`.
  * Detección de reuso de Refresh Token: Si un token ya consumido es presentado nuevamente, se invalida inmediatamente toda la familia de sesiones (mitigación de compromiso).
* **Artefactos Principales:**
  * `src/contexts/identity/domain/entities/refresh_session/aggregate.ts`
  * `src/contexts/identity/application/commands/rotate_refresh_token/command.ts` & `handler.ts`
  * `interfaces/http/rest/v1/oauth2/session_controller.ts` (`POST /oauth2/refresh`, `POST /oauth2/logout`)

---

## 3. Hoja de Ruta de Implementación

1. **Gestión Criptográfica & JWKS:**
   * Generación y carga segura de claves RSA (PEM).
   * Generación de estructura JWKS con propiedades `kty`, `n`, `e`, `alg`, `use`, `kid`.
2. **Endpoints de Descubrimiento OIDC:**
   * Controlador de descubrimiento estándar RFC 8414 / OIDC Discovery.
3. **Flujo Authorization Code con PKCE:**
   * Persistencia en caché o tabla temporal de authorization codes efímeros.
   * Validación criptográfica S256 (`BASE64URL-ENCODE(SHA256(ASCII(code_verifier))) == code_challenge`).
4. **Manejo de Refresh Tokens y Detección de Reuso:**
   * Implementación del patrón de familias de tokens y rotación estricta con cookies HttpOnly.
5. **Testing & Calidad:**
   * Unit tests criptográficos de validación PKCE y firma JWT.
   * Integration tests de endpoints OIDC con bibliotecas cliente estándar.
   * Acceptance tests BDD con Gherkin.

---

## 4. Definición de Hecho (Definition of Done - DoD)

- [ ] Endpoints `/.well-known/openid-configuration` y `/.well-known/jwks.json` validados por spec OIDC.
- [ ] Flujo Authorization Code con PKCE probado end-to-end.
- [ ] Rotación de Refresh Tokens con invalidación automática ante reuso.
- [ ] Cookies protegidas con `HttpOnly`, `Secure` y `SameSite=Strict`.
- [ ] Trazabilidad en [`TRACEABILITY_MATRIX.md`](../../memory/TRACEABILITY_MATRIX.md) con estado `Completed`.
- [ ] Artículo técnico documentado en `.agent/publications/`.

