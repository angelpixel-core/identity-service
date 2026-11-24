# EPIC-05: Identity Federation & External IdP Brokerage

* **ID:** EPIC-05
* **Bounded Context:** `identity` / `federation`
* **Estado:** In Progress (`US-10` y `US-11` completadas; `US-33` y `US-34` planificadas bajo `ADR-0010`)
* **Arquitectura:** Identity Broker Pattern / External OIDC Clients / Just-In-Time (JIT) Provisioning
* **Topología de Referencia:** [`.agent/TREE.txt`](../../TREE.txt)

---

## 1. Visión y Definición del Dominio

Esta épica posiciona a `identity-service` no solo como emisor de identidad propia, sino como un **Identity Broker** federado. Permite que usuarios de las aplicaciones satélites inicien sesión utilizando proveedores de identidad corporativos y sociales de terceros (Google Workspace, Microsoft Entra ID / Azure AD, Okta, Auth0) sin forzar a cada aplicación consumidora a implementar sus propios conectores de integración.

El Broker centraliza el flujo de delegación OIDC, valida los claims de los tokens externos recibidos, efectúa el enlace de cuentas (*Account Linking*) en función de la verificación de correo electrónico y aprovisiona perfiles de usuario dentro del tenant correspondiente de manera *Just-In-Time* (JIT).

---

## 2. Alcance y Vertical Slices

### 2.1. External OIDC Provider Connectors
* **User Story:** [`US-10: External OIDC Provider Connectors (Google & Microsoft Entra ID)`](stories/US-10-external-oidc-connectors.md)
* **Flujo:**
  * Abstracción genérica `ExternalIdentityProviderPort` con implementaciones concretas para Google y Microsoft Entra ID.
  * Generación de URLs de redirección con parámetros `state` y `nonce` criptográficos para prevención de ataques CSRF y Replay.
  * Recepción de callback, intercambio de código por tokens externos y validación de firma contra los JWKS oficiales de Google / Microsoft.
* **Artefactos Principales:**
  * `src/contexts/identity/domain/ports/external_identity_provider_port.ts`
  * `src/contexts/identity/infrastructure/federation/google_oidc_adapter.ts`
  * `src/contexts/identity/infrastructure/federation/microsoft_entra_adapter.ts`
  * `interfaces/http/rest/v1/federation/federation_controller.ts` (`GET /auth/federation/:provider/login`, `GET /auth/federation/:provider/callback`)

### 2.2. Federated Account Linking & JIT Tenant Provisioning
* **User Story:** [`US-11: Federated Account Linking & Tenant Profile Provisioning (JIT)`](stories/US-11-federated-account-linking.md)
* **Flujo:**
  * Persistencia en tabla `federated_identities` (`provider`, `external_subject_id`, `user_id`, `tenant_id`, `profile_data`).
  * Enlace automático cuando el correo provisto por el IdP externo está marcado como `email_verified: true` y coincide con una cuenta local del mismo tenant.
  * Aprovisionamiento transparente (JIT) si el usuario no existe previamente en la organización, asignando roles base.
  * Emisión de los tokens de sesión nativos de `identity-service` tras el éxito de la federación.
* **Artefactos Principales:**
  * `src/contexts/identity/domain/entities/federated_identity/aggregate.ts`
  * `src/contexts/identity/application/commands/process_federated_callback/command.ts` & `handler.ts`
  * `src/contexts/identity/infrastructure/persistence/repositories/federated_identity/postgres_repository.ts`

### 2.3. Per-Tenant Federated Provider Registry
* **User Story:** [`US-33: Per-Tenant Federated Provider Registry (Okta, LinkedIn, Slack)`](stories/US-33-per-tenant-federated-provider-registry.md) *(Planned)*
* **Flujo:** Configuración dinámica por inquilino de proveedores OIDC/OAuth2 corporativos o sociales (`tenant_federated_providers` bajo PostgreSQL RLS *Fail-Closed*) con `client_secret` cifrado en reposo.

### 2.4. Generic OIDC/OAuth2 Adapter & Multi-Tenant Resolution
* **User Story:** [`US-34: Generic OIDC/OAuth2 Adapter & Multi-Tenant Runtime Resolution`](stories/US-34-generic-oidc-adapter-and-multi-tenant-resolution.md) *(Planned)*
* **Flujo:** `GenericOidcAdapter` implementando `ExternalIdentityProviderPort` vía Discovery + JWKS estándar (`JwksTokenVerifier`) y coexistencia con los conectores de Google y Microsoft Entra ID.

---

## 3. Hoja de Ruta de Implementación

1. **Modelado de Dominio & Entidad Federada:**
   * Entidad `FederatedIdentity` con reglas de vinculación y unicidad por `(provider, external_subject_id)`.
2. **Abstracción de Conectores OIDC Externos:**
   * Puerto `ExternalIdentityProviderPort` y manejo seguro de estados CSRF (`state` firmado / encriptado).
3. **Persistencia e Infraestructura:**
   * Migración DDL para tabla `federated_identities`.
   * Integración con la capa de persistencia bajo RLS.
4. **Composición de Endpoints de Callback:**
   * Rutas `/auth/federation/:provider/login` y `/auth/federation/:provider/callback`.
5. **Testing & Calidad:**
   * Mocks de proveedores OIDC externos para tests unitarios y de integración.
   * Acceptance tests BDD cubriendo flujos de nuevo usuario (JIT) y vinculación de cuenta existente.

---

## 4. Definición de Hecho (Definition of Done - DoD)

- [ ] Soporte probado para al menos dos proveedores externos (Google y Microsoft).
- [ ] Validación de estados CSRF y firma de tokens externos.
- [ ] Vinculación segura de cuentas condicionada a email verificado.
- [ ] Aprovisionamiento JIT de usuarios en el tenant respectivo.
- [ ] Trazabilidad en [`TRACEABILITY_MATRIX.md`](../../memory/TRACEABILITY_MATRIX.md) con estado `Completed`.
- [ ] Artículo técnico documentado en `.agent/publications/`.

