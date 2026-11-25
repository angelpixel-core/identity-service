# 🎨 Capítulo 09: Portal Visual Enterprise Material Design 3 & Bounded Shell

Este capítulo documenta la capa visual de `identity-service`, construida de forma nativa sobre **React 19**, **Vite 8**, **Storybook 10** y un sistema de diseño propio alineado con **Google Material Design 3 (M3)** sin dependencias de librerías UI pesadas.

- **Design Tokens Centralizados (`tokens.css`):** Paleta Cloud/Security Console (`#1A73E8`), superficies tonales (`#F8FAFD`, `#F1F4F9`, `#E9EEF6`), tipografía `Inter` / `Roboto` + `JetBrains Mono` y estados semánticos WCAG 2.1 AA.
- **Separación Estricta de Contextos (Bounded Contexts en UI):** Superficies aisladas `/auth`, `/tenant` y `/platform` mediante `BoundedShell`, evitando la exposición de navegación administrativa a usuarios sin sesión o sin privilegios Root.
- **Trazabilidad W3C en Frontend:** El cliente HTTP compartido (`api_client.ts`) inyecta `X-Request-ID` en cada petición y expone `traceparent` para inspección directa en consola.

---

## 📑 Resumen de Historias de Usuario (Epic 09)

| Historia de Usuario | Título & Alcance Técnico | Principales Componentes Involucrados | Estándar / Paradigma |
| :--- | :--- | :--- | :--- |
| **US-23** | **Google Material Design 3 Design System & Bounded-Context Shell** | `tokens.css`, `M3Primitives.tsx`, `BoundedShell.tsx`, `api_client.ts`, Storybook 10 | Material Design 3, WCAG 2.1 AA, ADR-0009 |
| **US-24** | **Superficie `/auth`: Portal Usuario, OIDC Discovery/JWKS, PKCE S256 & Federación** | `AuthPortalView.tsx`, `OidcDiscoveryPanel.tsx`, `PkceAndSessionsPanel.tsx`, `FederationPanel.tsx` | RFC 7636 (PKCE S256), OIDC Discovery, W3C Trace |
| **US-25** | **Superficie `/tenant`: Client Registry, M2M Playground & Laboratorio RLS/Cross-Tenant** | `TenantConsoleView.tsx`, `ClientRegistryPanel.tsx`, `M2mPlaygroundPanel.tsx`, `RlsAndCrossTenantLabPanel.tsx` | OAuth2 Client Credentials, CORS, PostgreSQL RLS, Zero-Trust |
| **US-26** | **Consola `/platform`: Gobernanza Root, Bóveda Criptográfica, Auditoría & SRE** | `PlatformConsoleView.tsx`, `SecurityPosturePanel.tsx`, `VaultAndRotationPanel.tsx`, `AuditExplorerPanel.tsx`, `SreObservabilityPanel.tsx` | ADR-0009, Vault CSI, Audit SSE, OpenTelemetry & Probes |
| **US-27** | **Showcase Interactivo & Evidencia Visual (`docs/showcase/01..09`)** | `scripts/capture-showcase.ts`, `docs/showcase/01..09`, `assets/screenshots/*.png` | Playwright Retina (`2x`), Walkthroughs E2E |

---

## 🧩 US-23: Material Design 3 Design System, Storybook 10 & Bounded-Context Shell

`US-23` establece la base visual y de seguridad en el cliente SPA para operar los distintos contextos del servicio de identidad bajo un modelo **Zero-Trust**:

1. **Invariante 1 — Design Tokens M3 Centralizados:** Todo color, elevación, radio de borde y tipografía reside en [`tokens.css`](../../interfaces/web/client/design-system/tokens.css) y es consumido mediante variables `--md-sys-*` desde [`styles.css`](../../interfaces/web/client/styles.css), con cero valores hexadecimales o `rgba(...)` literales fuera de `tokens.css`.
2. **Invariante 2 — Separación de Superficies (`/auth`, `/tenant`, `/platform`):** `BoundedShell` aísla el portal de autenticación centrado (`/auth`), el workspace multi-tenant (`/tenant`) y la consola Root (`/platform`), bloqueando el acceso en cliente con `403 Forbidden` si el usuario no pertenece al tenant `system` con rol `superadmin` (ADR-0009).
3. **Invariante 3 — Catálogo Storybook 10 & React 19:** Todas las primitivas (`M3Card`, `M3Button`, `M3Chip`, `M3AlertBanner`, `M3NavigationRail`, `M3TextField`, `M3JsonViewer`) se documentan y compilan de forma estática con `npm run build-storybook`.

---

### 📸 Evidencia Visual de los 4 Escenarios BDD (US-23)

#### 1. Superficie `/auth` sin sesión activa
Portal centrado estilo *Google Account / Sign-In* sin exponer elementos de navegación de `/tenant` ni de `/platform`.

![Superficie /auth sin sesión activa](./assets/screenshots/us23_auth_unauthenticated.png)

#### 2. Guardia de ruta `/platform` (`403 Forbidden` para inquilino comercial)
Un usuario autenticado en `acme-corp` con rol `member` es bloqueado por `BoundedShell`, mostrando el banner M3 de acceso denegado (`403 Forbidden`) y recomendando operar con `system:superadmin`.

![Bloqueo 403 Forbidden en /platform para acme-corp](./assets/screenshots/us23_platform_forbidden_403.png)

#### 3. Workspace `/platform` para Root Superadmin (`system · superadmin`)
Un operador autenticado en el inquilino `system` con rol `superadmin` accede a la **Platform Governance Console** con el `M3NavigationRail` y el badge activo `system · superadmin`.

![Workspace /platform para system:superadmin](./assets/screenshots/us23_platform_superadmin_shell.png)

#### 4. Catálogo de Primitivas M3 en Storybook 10
Compilación estática y catálogo interactivo de `M3Primitives.stories.tsx` sobre Storybook 10.6.6 (`npm run build-storybook`).

![Catálogo M3Primitives en Storybook 10](./assets/screenshots/us23_storybook_m3_catalog.png)

---

## 🔐 US-24: Superficie `/auth` — Portal Usuario, OIDC Discovery/JWKS, PKCE S256 & Federación

`US-24` unifica todo el ciclo de autenticación e identidad en `/auth` mediante el selector M3 **"Flujo de Identidad"** (`role="listbox"` en [`AuthPortalView.tsx`](../../interfaces/web/client/contexts/auth/ui/AuthPortalView.tsx)), ejecutando operaciones reales contra el backend sin datos simulados:

1. **Invariante 1 — PKCE S256 Nativo en Navegador:** `PkceAndSessionsPanel` calcula `code_verifier` y `code_challenge` (`BASE64URL(SHA256(...))`) en vivo mediante `crypto.subtle.digest('SHA-256', ...)` (RFC 7636).
2. **Invariante 2 — Endpoints Reales & Trazabilidad W3C:** Cada llamada (`/.well-known/openid-configuration`, `/.well-known/jwks.json`, `/oauth2/authorize`, `/api/v1/oauth2/token`, `/oauth2/refresh`, `/oauth2/revoke` y `/api/v1/auth/federation/*`) pasa por `apiRequest` y muestra el header `traceparent` en `M3JsonViewer`.
3. **Invariante 3 — Selector M3 & Refinamientos UX:** Transición suave entre los 4 flujos (**Cuenta**, **OIDC & JWKS**, **PKCE & Sesiones**, **Federación**), cierre de sesión integrado en `UserProfileCard`, tabla de semáforos de proveedores en `FederationPanel` y laboratorio OIDC manual en `<details>`.

---

### 📸 Evidencia Visual de los 4 Flujos de `/auth` (US-24)

#### 1. Flujo `Cuenta`: Perfil Autenticado Multi-Tenant (`US-01`, `US-02`)
`UserProfileCard` renderizando la sesión activa en `acme-corp` con cierre de sesión integrado en el footer.

![Flujo Cuenta autenticado en /auth](./assets/screenshots/us24_auth_account_profile.png)

#### 2. Flujo `OIDC & JWKS`: Discovery y Claves RSA en Vivo (`US-07`)
Consulta real de `GET /.well-known/openid-configuration` y `GET /.well-known/jwks.json` con propagación de `traceparent` W3C.

![Flujo OIDC & JWKS en vivo](./assets/screenshots/us24_auth_oidc_discovery_jwks.png)

#### 3. Flujo `PKCE & Sesiones`: WebCrypto S256, Exchange y Refresh (`US-08`, `US-09`)
Generación de par PKCE S256 en navegador, intercambio en `/oauth2/authorize` + `/api/v1/oauth2/token` y emisión de `access_token` / `id_token` con traza W3C.

![Flujo PKCE S256 y Sesiones Refresh](./assets/screenshots/us24_auth_pkce_sessions.png)

#### 4. Flujo `Federación`: Semáforo de Proveedores y JIT Provisioning (`US-10`, `US-11`)
Estado en vivo de **Google OIDC** y **Microsoft Entra ID**, popover informativo y laboratorio OIDC manual colapsable.

![Flujo Federación Social en /auth](./assets/screenshots/us24_auth_federation_providers.png)

#### 5. Onboarding Dinámico por Política (`US-32` en `/auth`)
Adaptación en tiempo real del formulario `/auth` según `/api/v1/auth/config` (campo `Teléfono (E.164)` + aviso KYC, y bloqueo cuando `password: false`; ver detalle en [Capítulo 10: Políticas Dinámicas por Tenant](./10-tenant-policies-onboarding.md#-us-32-onboarding-dinámico-y-validación-estricta-en-auth-y-backend)):

![Onboarding dinámico en /auth con Teléfono E.164 obligatorio y aviso KYC](./assets/screenshots/us32_auth_dynamic_phone_kyc.png)

![Onboarding en /auth con método password deshabilitado por política](./assets/screenshots/us32_auth_password_disabled.png)

#### 5. Federación OIDC Dinámica Multi-Tenant (`US-34`)
- Renderizado dinámico de botones de IdP corporativos (como **Okta Corporate**) a partir de `GET /api/v1/auth/config` sin exponer secretos del cliente en el navegador.
- Inicio de flujo federado contra `/api/v1/auth/federation/:provider/login` con `state` HMAC-SHA256 y verificación E2E en `tests/e2e/web/auth_portal_oidc_federation.spec.tsx` (Scenario 10).

![Botón Dinámico de Okta Corporate en /auth (US-34)](./assets/screenshots/us34_auth_dynamic_federation.png)

#### 6. Registro de Passkeys WebAuthn / FIDO2 en `/auth` → `Cuenta` (`US-35`)
- Botón **`Registrar Passkey / Biometría`** visible cuando `TenantPolicy.allowedAuthMethods.passkeys === true` (`US-30`), ejecutando `navigator.credentials.create()` y listando las credenciales registradas sin exponer material biométrico.
- Trazabilidad E2E: `tests/e2e/web/auth_portal_oidc_federation.spec.tsx` (Scenario 7).

![Registro y Listado de Passkey WebAuthn en /auth (US-35)](./assets/screenshots/us35_auth_passkey_registration.png)

#### 7. Autenticación Passwordless con Passkey en `/auth` (`US-36`)
- Botón **`Iniciar sesión con Passkey`** (`[data-testid="passkey-login-btn"]`) en `LoginForm`, ejecutando `navigator.credentials.get()` y emitiendo JWT RFC 9068 con `amr: ["hwk", "user"]` + `RefreshSession` HttpOnly.
- Trazabilidad E2E: `tests/e2e/web/auth_portal_oidc_federation.spec.tsx` (Scenario 8).

![Autenticación Passwordless con Passkey en /auth (US-36)](./assets/screenshots/us36_auth_passkey_login.png)

#### 8. Verificación KYC y Badge en `UserProfileCard` en `/auth` (`US-37`)
- Renderizado dinámico del badge KYC (`Sin verificar` → `Pendiente` → `Verificado`) y botón **`Iniciar Verificación KYC`** (`[data-testid="start-kyc-btn"]`) cuando `TenantPolicy.kycPolicy.required === true`.
- Trazabilidad E2E: `tests/e2e/web/auth_portal_oidc_federation.spec.tsx` (Scenario 9).

![Verificación KYC y Badge de Estado en /auth (US-37)](./assets/screenshots/us37_auth_kyc_verification.png)

---

## 🏢 US-25: Superficie `/tenant` — Client Registry, M2M Playground & Laboratorio RLS/Cross-Tenant

`US-25` dota a los administradores de inquilinos autenticados de una consola M3 en `/tenant` ([`TenantConsoleView.tsx`](../../interfaces/web/client/contexts/tenant/ui/TenantConsoleView.tsx)) organizada en 3 pestañas accesibles (**Clientes & CORS**, **M2M Playground** y **Laboratorio RLS / Cross-Tenant**):

1. **Invariante 1 — Proyección Segura Sin Secretos (`US-03`):** `GET /api/v1/oauth2/clients` proyecta los clientes OAuth2 registrados del inquilino sin exponer `clientSecretHash` ni credenciales confidenciales.
2. **Invariante 2 — Validación CORS y Emisión M2M Reales (`US-03`, `US-04`):** `ClientRegistryPanel` valida orígenes en vivo (`POST /api/v1/oauth2/clients/validate`) y `M2mPlaygroundPanel` solicita tokens `Bearer` reales (`POST /api/v1/oauth2/token` con `client_credentials`).
3. **Invariante 3 — Aislamiento RLS y Bloqueo Zero-Trust (`US-05`, `US-06`):** `RlsAndCrossTenantLabPanel` demuestra en vivo cómo un intento de consulta con `X-Tenant-ID` ajeno recibe `HTTP 403 Forbidden` y emite el evento de auditoría `CROSS_TENANT_VIOLATION`.

---

### 📸 Evidencia Visual de los 3 Escenarios de `/tenant` (US-25)

#### 1. Pestaña `Clientes & CORS`: Listado Seguro y Validación en Vivo (`US-03`)
Clientes OAuth2 cargados desde PostgreSQL sin exposición de `clientSecretHash` y validación CORS exitosa (`authorized: true`) con `traceparent` W3C.

![Consola /tenant — Clientes y Validación CORS](./assets/screenshots/us25_tenant_clients_cors.png)

#### 2. Pestaña `M2M Playground`: Emisión de Token `client_credentials` (`US-04`)
Intercambio real contra `POST /api/v1/oauth2/token` para `m2m-service-app`, mostrando el `access_token` emitido y su trazabilidad W3C.

![Consola /tenant — M2M Playground](./assets/screenshots/us25_tenant_m2m_playground.png)

#### 3. Pestaña `Laboratorio RLS / Cross-Tenant`: Bloqueo `403 Forbidden` (`US-05`, `US-06`)
Intento de salto cross-tenant hacia `beta-corp` desde `acme-corp`, interceptado con `HTTP 403 Forbidden` y banner M3 Zero-Trust.

![Consola /tenant — Bloqueo Cross-Tenant 403](./assets/screenshots/us25_tenant_rls_cross_tenant_403.png)

#### 4. Ciclo de Vida de Clientes & Rotación Zero-Downtime (`US-28` en `Clientes & CORS`)
Extensión de `ClientRegistryPanel.tsx` sobre `POST /api/v1/clients`, `PATCH /api/v1/clients/:clientId` y `POST /api/v1/clients/:clientId/rotate-secret` (ver recorrido técnico y `curl` reales en [Capítulo 02: Dynamic Client Registry](./02-client-registry.md#-us-28-gestión-del-ciclo-de-vida-de-clientes--rotación-zero-downtime-de-secretos)):

![Creación de cliente confidencial y secreto único](./assets/screenshots/us28_tenant_client_created.png)

![Rotación de secreto con ventana de gracia](./assets/screenshots/us28_tenant_secret_rotation.png)

![Suspensión de aplicación cliente](./assets/screenshots/us28_tenant_client_suspended.png)

#### 5. Bindings Multi-Dominio & Tenant Autorizados (`US-29` en `Clientes & CORS`)
Inspección en `/tenant` mediante el botón **`Dominios`** de `ClientRegistryPanel.tsx` (`tenant-bindings-<clientId>`), mostrando los dominios y bindings activos del inquilino (ver detalle en [Capítulo 02: Dynamic Client Registry](./02-client-registry.md#-us-29-bindings-multi-tenant--multi-dominio-nm--resolución-explícita-de-tenant)):

![Inspección de dominios y bindings autorizados en /tenant](./assets/screenshots/us29_tenant_client_bindings.png)

#### 6. Inspector Público `/api/v1/auth/config` (`US-31` en `Política de Identidad`)
Consulta en vivo del contrato público sin secretos desde `TenantPolicyPanel.tsx` mostrando `HTTP 200`, `ETag`, `Cache-Control` y su proyección JSON (ver detalle en [Capítulo 10: Políticas Dinámicas por Tenant](./10-tenant-policies-onboarding.md#-us-31-contrato-público-dinámico-del-flujo-de-autenticación-get-apiv1authconfig)):

![Inspector Público /api/v1/auth/config en /tenant](./assets/screenshots/us31_tenant_auth_config_inspector.png)

![Contrato JSON GET /api/v1/auth/config en Chromium](./assets/screenshots/us31_public_auth_config.png)

#### 5. Editor de Política de Tenant (`US-30`)
- Configuración interactiva de `requiredAttributes.phone`, `kycPolicy` y `allowedAuthMethods` con *Lockout Guard* (impide deshabilitar todos los métodos) y modo lectura estricto para `member`.
- Trazabilidad E2E: `tests/e2e/web/tenant_console.spec.tsx` (Scenario 6).

![Editor de Política de Tenant en Tenant Console (US-30)](./assets/screenshots/us30_tenant_policy_editor.png)

#### 6. Panel de Proveedores Federados por Tenant (`US-33`)
- Registro y eliminación de proveedores OIDC corporativos propios del tenant con cifrado `AES-256-GCM` en servidor, validación `https://` anti-SSRF y cero exposición de `clientSecret` en el cliente.
- Trazabilidad E2E: `tests/e2e/web/tenant_console.spec.tsx` (Scenario 8).

![Panel de Proveedores Federados en Tenant Console (US-33)](./assets/screenshots/us33_tenant_federated_providers.png)

---

## 🛡️ US-26: Consola `/platform` — Gobernanza Root, Bóveda Criptográfica, Auditoría & SRE

`US-26` unifica en `/platform` ([`PlatformConsoleView.tsx`](../../interfaces/web/client/contexts/platform/ui/PlatformConsoleView.tsx)) el plano de control para operadores `system:superadmin` (`ADR-0009`), organizado en 4 vistas mediante `M3NavigationRail`:

1. **Postura de Seguridad & Gobernanza Root (`US-12`–`US-15`, `US-18`):** Vista estrictamente de solo lectura alimentada por `GET /api/v1/platform/posture` (`platform_controller.ts`), sin controles mutables de defensa ni exposición de secretos.
2. **Bóveda Criptográfica (`US-16`, `US-17`):** Metadatos de llaves activas/rotadas y rotación controlada (`POST /api/v1/secrets/rotate`) con confirmación explícita.
3. **Explorador de Auditoría Forense (`US-19`):** Stream SSE en vivo (`/api/v1/audit/events`), filtros reactivos parciales case-insensitive (`severity`, `eventType`, `tenantId`, `traceId`), paginación, ordenamiento por timestamp, copia de `traceId` y snackbar fijo.
4. **Observabilidad SRE (`US-20`–`US-22`):** Strip copiable de `traceparent` W3C, Golden Signals Prometheus (`/metrics`) y sondas detalladas incluyendo PostgreSQL y Redis (`/health/live`, `/health/ready`, `/health`).

---

### 📸 Evidencia Visual de las 4 Vistas de `/platform` (US-26)

#### 1. Postura de Seguridad & Gobernanza Root (`US-12`–`US-15`, `US-18`)
Vista de solo lectura exponiendo postura IaC, Ingress TLS 1.3, Helm, NetworkPolicy y Rate Limit.

![Consola /platform — Postura de Seguridad](./assets/screenshots/us18_platform_netpolicy.png)

#### 2. Bóveda Criptográfica & Rotación Confirmada (`US-16`, `US-17`)
Metadatos de llaves RS256 sin exponer material secreto y rotación confirmada en vivo.

![Consola /platform — Bóveda Criptográfica](./assets/screenshots/us16_vault_rotation_success.png)

#### 3. Explorador de Auditoría Forense (`US-19`)
Filtrado parcial reactivo, tabla paginada ordenable por timestamp, botón de copia para `traceId` y stream SSE en tiempo real.

![Consola /platform — Auditoría Forense](./assets/screenshots/us19_audit_explorer_filtered.png)

#### 4. Observabilidad SRE: Métricas RED, Golden Signals y Probes (`US-20`–`US-22`)
Tarjetas en vivo de métricas Prometheus (`/metrics`), `traceparent` W3C copiable y diagnóstico de sondas.

![Consola /platform — Observabilidad SRE](./assets/screenshots/us21_sre_metrics.png)

#### 5. Bindings N:M Client ↔ Tenant / Dominios Custom (`US-29` — `ClientBindingsPanel.tsx`)
Gestión transversal para operadores `system:superadmin` de vinculaciones N:M entre clientes SaaS, inquilinos, dominios personalizados y listas blancas de `redirect_uris` / CORS:

![Consola Root de Bindings N:M en /platform](./assets/screenshots/us29_platform_bindings_nm.png)

#### 5. Gestión Global de Políticas por Tenant (`US-30`)
- Administración cross-tenant exclusiva para `system:superadmin` sobre políticas de atributos requeridos, KYC y métodos de autenticación por inquilino.
- Trazabilidad E2E: `tests/e2e/web/platform_console.spec.tsx` (Scenario 7).

![Gestión de Políticas por Tenant en Platform Console (US-30)](./assets/screenshots/us30_platform_tenant_policies.png)

#### 6. Gobierno Multi-Tenant de Proveedores IdP (`US-33`)
- Supervisión global y gestión de proveedores OIDC corporativos por tenant con proyección *zero-secret* y auditoría forense redactada.
- Trazabilidad E2E: `tests/e2e/web/platform_console.spec.tsx` (Scenario 8).

![Gestión Multi-Tenant de Proveedores IdP en Platform Console (US-33)](./assets/screenshots/us33_platform_federated_providers.png)

---

## 📸 US-27: Showcase Interactivo & Evidencia Visual (`docs/showcase/01..09`)

`US-27` cierra `EPIC-09` integrando walkthroughs visuales y capturas Playwright en alta densidad Retina (`deviceScaleFactor: 2`) contra el backend (`:4000`) y el frontend (`:3000`) reales a lo largo de los **9 capítulos** del Showcase:

- **Automatización Playwright (`scripts/capture-showcase.ts` / `npm run showcase:capture`):** Genera las 9 capturas base `ui_*.png` (`ui_auth_account.png`, `ui_auth_oidc_jwks.png`, `ui_auth_pkce_sessions.png`, `ui_auth_federation.png`, `ui_tenant_clients_m2m.png`, `ui_tenant_rls_lab.png`, `ui_platform_posture.png`, `ui_platform_vault_audit.png`, `ui_platform_sre.png`), las 3 capturas del ciclo de vida de clientes `US-28` (`us28_tenant_client_created.png`, `us28_tenant_secret_rotation.png`, `us28_tenant_client_suspended.png`), las 2 capturas de bindings N:M `US-29` (`us29_tenant_client_bindings.png`, `us29_platform_bindings_nm.png`), las 2 capturas de contrato público `US-31` (`us31_tenant_auth_config_inspector.png`, `us31_public_auth_config.png`) y las 2 capturas de onboarding dinámico `US-32` (`us32_auth_dynamic_phone_kyc.png`, `us32_auth_password_disabled.png`) sin mocks ni exposición de secretos en claro.
- **Cobertura Integral `01..09`:** Cada capítulo (`01`–`08`) incluye la sección `### 🖥️ Interfaz Visual (UI) & Walkthrough en Navegador`, y el capítulo `09` consolida la arquitectura M3, Storybook 10 y el walkthrough detallado de `US-23` a `US-27` con verificación de enlaces (`0` enlaces rotos).

---

## 🧪 Verificación Técnica Asociada

```bash
# 1. Auditoría de Design Tokens (0 colores literales fuera de tokens.css)
rg -n "#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(" interfaces/web/client/styles.css

# 2. Compilación de producción SPA (Vite 8)
npm run build:web

# 3. Compilación estática del catálogo de componentes (Storybook 10)
npm run build-storybook

# 4. Suites E2E Web (US-23 a US-26)
npm run test:e2e -- tests/e2e/web/m3_shell_and_route_guards.spec.tsx tests/e2e/web/auth_portal_oidc_federation.spec.tsx tests/e2e/web/tenant_console.spec.tsx tests/e2e/web/platform_console.spec.tsx
```
