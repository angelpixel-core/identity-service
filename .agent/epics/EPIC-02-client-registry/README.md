# EPIC-02: Client Registry & Service Authorization

* **ID:** EPIC-02
* **Bounded Context:** `identity` / `client-registry`
* **Estado:** Completed (US-03 y US-04 completadas al 100%)
* **Arquitectura:** Vertical Slice Architecture + Hexagonal / DDD (TypeScript / Express / PostgreSQL)
* **Topología de Referencia:** [`.agent/TREE.txt`](../../TREE.txt)

---

## 1. Visión y Definición del Dominio

El subsistema de **Client Registry & Service Authorization** transforma a `identity-service` en una autoridad centralizada capaz de verificar de forma determinista la identidad, procedencia y permisos de las aplicaciones consumidoras dentro del ecosistema (E-commerce, Portales de IA, Aplicaciones Móviles, Backends y Microservicios satélites).

Más allá del mecanismo de cabeceras CORS de navegador (que no protege contra invocaciones server-to-server o clientes maliciosos), este módulo impone la validación estricta de `client_id`, origen del tráfico (`allowed_origins`), URIs de redirección (`redirect_uris`), tipos de concesión autorizados (`allowed_grant_types`) y scopes de acceso.

---

## 2. Alcance y Vertical Slices

### 2.1. Dynamic Client Registry & Origin Validation
* **User Story:** [`US-03: Dynamic Client Registry and Origin Validation`](stories/US-03-client-registry-origin-validation.md)
* **Flujo:** Validación en tiempo de ejecución del solicitante. Clasifica a los clientes en:
  * `confidential`: Aplicaciones backend / M2M con `client_secret` hasheado criptográficamente (Argon2id/Bcrypt).
  * `public`: SPAs en navegadores (React/Vite) y aplicaciones móviles nativas sin secreto embebido, que requieren obligatoriamente PKCE (RFC 7636) y validación estricta de orígenes y redirect URIs.
* **Artefactos Principales:**
  * `src/contexts/identity/domain/entities/client_application/aggregate.ts`
  * `src/contexts/identity/domain/value_objects/client_id/value.ts`
  * `src/contexts/identity/domain/value_objects/origin/value.ts`
  * `src/contexts/identity/infrastructure/persistence/repositories/client_application/postgres_repository.ts`
  * `interfaces/http/middlewares/client_authorization_middleware.ts`

### 2.2. Client Credentials Grant (M2M / Service-to-Service)
* **User Story:** [`US-04: Client Credentials & Scoped Access Token Grant`](stories/US-04-client-credentials-scoped-grant.md)
* **Flujo:** Endpoints de autorización M2M donde un microservicio backend autentica con `client_id` y `client_secret` para obtener un JWT firmado con scopes acotados (`identity:read`, `identity:write`, etc.) sin intervención de usuario final.
* **Artefactos Principales:**
  * `src/contexts/identity/application/commands/authenticate_client/command.ts` & `handler.ts`
  * `interfaces/http/rest/v1/oauth2/token_controller.ts` (`POST /oauth2/token` con `grant_type=client_credentials`)

---

## 3. Hoja de Ruta y Metodología de Implementación

Conforme a [`.agent/rules/DEVELOPMENT_WORKFLOW.md`](../../rules/DEVELOPMENT_WORKFLOW.md), cada User Story de esta épica se construye mediante la disciplina **Outside-In Test-Driven Development (4 Capas)**:

1. **Fase de Apertura (Top-Down / Red Phase):**
   * Especificar primero la cúspide E2E y los escenarios de Aceptación BDD (`.feature`).
   * Especificar las pruebas de integración de adaptadores PostgreSQL y middlewares Express.
   * Especificar las pruebas unitarias de invariantes del agregado `ClientApplication` y sus Value Objects.
2. **Fase de Clausura (Bottom-Up / Green Phase):**
   * Implementar y sellar la base del Dominio puro (`ClientId`, `OriginDomain`, `ClientApplication`).
   * Implementar DDL (`006-create-registered-clients.sql`), `PostgresClientApplicationRepository` y `ClientAuthorizationMiddleware`.
   * Conectar y verificar la suite BDD (*Living Documentation*) en VERDE.
   * Ejecutar la verificación integral E2E.

---

## 4. Definición de Hecho (Definition of Done - DoD)

- [x] Escenarios Gherkin validados con Cucumber/BDD (`client_registry_validation.feature` y `client_credentials_grant.feature`).
- [x] Validación de clientes confidenciales y públicos con control de scopes y flujo `client_credentials`.
- [x] Pirámide de testing completa en 4 capas (Unit, Integration, Acceptance, E2E) con 157 tests pasando al 100%.
- [x] Trazabilidad en [`TRACEABILITY_MATRIX.md`](../../memory/TRACEABILITY_MATRIX.md) con estado `Completed`.
- [x] Artículos técnicos documentados en `.agent/publications/` (`ARTICLE-03`, `ARTICLE-03-B` y `ARTICLE-04`).

