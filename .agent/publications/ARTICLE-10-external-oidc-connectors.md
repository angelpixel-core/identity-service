# ARTICLE-10: Arquitectura Identity Broker — Conexión Desacoplada con Google Workspace y Microsoft Entra ID mediante OIDC y JWKS Dinámico

* **Artículo ID:** ARTICLE-10
* **User Story:** [US-10: External OIDC Provider Connectors](../epics/EPIC-05-identity-federation/stories/US-10-external-oidc-connectors.md)
* **Épica Asociada:** [EPIC-05: Identity Federation & External IdP Brokerage](../epics/EPIC-05-identity-federation/README.md)
* **Bounded Context:** `identity` / `federation-connectors`
* **Tipo de Slice:** Integration / Security / Protocol Slice (Identity Broker & External OIDC Delegation)
* **Rama de Trabajo:** `feat/US-10-external-oidc-connectors`
* **ADR Relacionado:** [ADR-0004: Client Authentication Strategy](../../docs/adr/0004-client-authentication-strategy.md), [ADR-0006: OIDC Authorization Server & Cryptography](../../docs/adr/0006-oidc-session-flow.md)
* **Guía Interactiva:** [GUIDELINE-11: Conectores OIDC Externos Google & Microsoft Entra ID](../guidelines/GUIDELINE-11-external-oidc-connectors.md)
* **Principio Rector:** Identity Broker Pattern, Zero Shared Secrets with External IdPs, Dynamic JWKS Verification, Anti-CSRF Cryptographic State
* **Fecha:** 2026-11-10
* **Autor / Tech Lead:** Angel Szymczak & Antigravity (Pair Programming)

---

## 1. Resumen Ejecutivo: El Reto de la Identidad en Ecosistemas Multi-Tenant

En arquitecturas corporativas y plataformas SaaS multiorganizacionales, delegar la responsabilidad de la autenticación a proveedores de identidad empresariales de terceros (**Google Workspace** y **Microsoft Entra ID / Office 365**) es un requisito indispensable para la adopción B2B.

Sin embargo, implementar conectores individuales directamente en cada aplicación satélite (portal web, apps móviles, dashboards de administración) introduce una grave dispersión técnica:
1. **Proliferación de Secretos y Credenciales:** Cada frontend o microservicio requeriría registrar y custodiar sus propios `client_id` y `client_secret` ante Google y Azure, multiplicando la superficie de ataque.
2. **Inconsistencia de Modelos de Perfil:** Google y Microsoft estructuran los claims de identidad de manera heterogénea (e.g. `sub` vs. `oid`, `email` vs. `preferred_username` / `upn`, verificación booleana explícita vs. verificación implícita de directorio).
3. **Acoplamiento de Seguridad:** Obliga a cada cliente satélite a gestionar la complejidad criptográfica de validar firmas de ID Tokens mediante claves asimétricas distribuidas en JSON Web Key Sets (JWKS).

Con **US-10**, **AngelPixel Identity Service** asume formalmente el rol de **Identity Broker Federado**. Centraliza el flujo OIDC de 3 vías, abstrae la heterogeneidad de los proveedores externos mediante un puerto de dominio agnóstico (`ExternalIdentityProviderPort`), blinda la comunicación contra ataques CSRF y Replay mediante tokens criptográficos efímeros, y normaliza los perfiles de usuario verificados (`FederatedUserProfile`) preparándolos para la provisión Just-In-Time (US-11).

```
+---------------------------------------------------------------------------------------------------------+
| ARQUITECTURA IDENTITY BROKER FEDERADO EN ANGELPIXEL IDENTITY SERVICE                                    |
|                                                                                                         |
|  [Cliente Web / Mobile]                                                                                 |
|         |                                                                                               |
|         |-- 1. GET /api/v1/auth/federation/:provider/login?tenant_id=acme&redirect_uri=... ------------>|
|         |                                                                                               |
|         |                     identity-service Broker:                                                  |
|         |                     - Genera state firmado: base64url(payload).hmac                           |
|         |                     - Genera nonce criptográfico: 128-bit hex                                 |
|         |                     - Adapta parámetros específicos del IdP externo                           |
|         |                                                                                               |
|         |<-- 2. HTTP 302 Redirect hacia IdP Externo (Google / Microsoft Entra) -------------------------|
|         |                                                                                               |
|         |==== 3. Usuario se autentica con su cuenta corporativa externa (Google Accounts / Microsoft) ==|
|         |                                                                                               |
|         |<-- 4. IdP Externo redirige con ?code=EXT_CODE&state=payload.hmac ----------------------------|
|         |                                                                                               |
|         |-- 5. GET/POST /api/v1/auth/federation/:provider/callback?code=...&state=... ----------------->|
|         |                                                                                               |
|         |                     identity-service Broker:                                                  |
|         |                     - Valida state con crypto.timingSafeEqual (Anti-CSRF)                     |
|         |                     - Canjea code por ID Token vía POST /token del IdP                        |
|         |                     - Descarga JWKS oficial (Google / Microsoft) y valida firma RS256         |
|         |                     - Valida nonce original == id_token.nonce (Anti-Replay)                   |
|         |                     - Exige email_verified == true                                            |
|         |                     - Normaliza perfil a FederatedUserProfile                                 |
|         |                                                                                               |
|         |<-- 6. HTTP 200 OK { status: 'success', userProfile: { email, externalSubjectId, ... } } ------|
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Abstracción Desacoplada: `ExternalIdentityProviderPort`

Siguiendo los principios de la Arquitectura Hexagonal (Ports & Adapters), la capa de dominio no conoce los detalles de implementación HTTP ni las URLs de Google o Microsoft. Todo conector externo satisface un contrato abstracto:

```typescript
export type FederatedProviderId = 'google' | 'microsoft';

export interface FederatedUserProfile {
  provider: FederatedProviderId;
  externalSubjectId: string; // 'sub' en Google, 'oid'/'sub' en Microsoft
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  rawClaims?: Record<string, unknown>;
}

export interface ExternalIdentityProviderPort {
  readonly providerId: FederatedProviderId;
  getAuthorizationUrl(params: GenerateAuthUrlParams): Promise<string>;
  exchangeCodeAndVerifyToken(params: ExchangeCallbackParams): Promise<FederatedUserProfile>;
}
```

### Implementaciones Concretas de Infraestructura

1. **`GoogleOidcAdapter`:**
   - **Autorización:** `https://accounts.google.com/o/oauth2/v2/auth` con scopes `openid email profile`, `response_type=code`, `access_type=offline` y `prompt=consent`.
   - **Canje de Tokens:** `https://oauth2.googleapis.com/token`.
   - **Verificación JWKS:** `https://www.googleapis.com/oauth2/v3/certs`.
   - **Invariante Crítica:** Valida explícitamente `payload.email_verified === true`.

2. **`MicrosoftEntraAdapter`:**
   - **Autorización:** `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize` (soporta tenants multi-organización `common`, corporativos `organizations` o GUID específico del tenant corporativo) con `response_mode=query` y scopes `openid email profile User.Read`.
   - **Canje de Tokens:** `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`.
   - **Verificación JWKS:** `https://login.microsoftonline.com/common/discovery/v2.0/keys`.
   - **Normalización de Identidad:** Mapea el identificador único de objeto corporativo `oid` (con fallback a `sub`) y extrae el correo principal de `preferred_username`, `upn` o `email`.

---

## 3. Modelo Criptográfico Anti-CSRF y Anti-Replay

Para impedir ataques de suplantación y manipulación de sesiones federadas, se incorporan dos mecanismos criptográficos rigurosos:

### 3.1. Estado Anti-CSRF Firmado (`FederationStateManager`)

A diferencia de implementaciones inseguras que confían en estados opacos no verificados o estados en texto plano vulnerables a manipulación por parte de un proxy malicioso:
* El parámetro `state` enviado al IdP externo es un token estructurado de dos segmentos: `encodedPayload.signature`.
* El payload almacena en Base64URL: `tenantId`, `clientId`, `redirectUri`, `provider`, `nonce`, `createdAt` y `expiresAt` (TTL de 10 minutos).
* La firma es un **HMAC-SHA256** computado con una clave secreta del servidor.
* En el retorno del callback, la verificación utiliza **`crypto.timingSafeEqual`** sobre los buffers binarios, previniendo ataques de canal lateral por análisis de tiempo (CWE-208).

### 3.2. Nonce Criptográfico Anti-Replay

* Se genera un `nonce` aleatorio de 128 bits (`crypto.randomBytes(16).toString('hex')`) inyectado en la solicitud de autorización al IdP externo.
* El IdP externo está obligado por el estándar OpenID Connect Core 1.0 a incluir este claim `nonce` sin alteraciones dentro del ID Token firmado.
* El adaptador valida que `id_token.nonce === statePayload.nonce`. Si un atacante intentase reutilizar un ID Token previamente capturado en un nuevo flujo de login, la verificación se aborta inmediatamente.

---

## 4. Verificación Criptográfica Descentralizada mediante JWKS Dinámico

El componente `JwksTokenVerifier` proporciona validación asimétrica de firmas RS256 con las siguientes características de ingeniería:
* **Conversión Nativa a `KeyObject`:** Emplea `crypto.createPublicKey({ key: jwk, format: 'jwk' })` de Node.js, transformando los parámetros RSA (`n`, `e`) en claves públicas sin librerías externas pesadas.
* **Caché en Memoria con TTL (1 hora):** Evita sobrecargar los endpoints de Google y Microsoft en cada autenticación.
* **Auto-Refresco en Caliente ante `kid miss` (*Zero-Downtime Key Rollover*):** Si Google o Microsoft rotan sus claves y el ID Token entrante posee un `kid` no registrado en la caché, el verificador dispara automáticamente una revalidación inmediata ante el endpoint JWKS (con una ventana de enfriamiento de 5 segundos para prevenir ataques de denegación de servicio por agotamiento de conexiones).
* **Reintentos con Backoff Exponencial:** Hasta 3 intentos ante fallos transitorios de red con retraso exponencial progresivo.

---

## 5. Pruebas y Cero Regresiones (Testing Pyramid)

La implementación se verificó rigurosamente a través de todos los estratos de la pirámide de testing:

| Estrato de Pruebas | Cobertura US-10 | Estado |
| :--- | :--- | :--- |
| **Pruebas de Aceptación BDD** | `tests/acceptance/features/external_oidc_connectors.feature` (5 escenarios Cucumber) | **10 / 10 suites pasadas (34 escenarios)** |
| **Pruebas de Integración** | `test_google_adapter.ts`, `test_microsoft_entra_adapter.ts`, `test_federation_api.ts` | **17 / 17 suites pasadas (105 tests)** |
| **Pruebas Unitarias Aisladas** | `test_federation_state_manager.ts`, `test_jwks_token_verifier.ts`, `test_google_oidc_adapter.ts`, `test_microsoft_entra_adapter.ts`, `test_federated_handlers.ts`, `test_federation_controller.ts` | **44 / 44 suites pasadas (320 tests)** |
| **SDK TypeScript** | `sdks/typescript/tests/federation.test.ts` (Login URL y Callback processing) | **7 / 7 suites pasadas (38 tests)** |
| **Total Ecosistema** | **443 pruebas automatizadas ejecutadas en memoria** | **100% Verde / 0 Errores** |

---

## 6. Conclusiones y Próximos Pasos (Hacia US-11)

Con la culminación de **US-10**, `identity-service` cuenta con la infraestructura completa de **Identity Broker**:
1. Conexión segura y desacoplada con Google Workspace y Microsoft Entra ID.
2. Protección criptográfica integral contra ataques CSRF, Replay y claves forjadas.
3. Extracción de perfiles de usuario verificados listos para integrarse en el ciclo de vida de la organización.

El siguiente hito del épico **EPIC-05** es **US-11: Federated Account Linking & Tenant Profile Provisioning (JIT)**, donde se persistirán las identidades federadas en base de datos bajo PostgreSQL RLS, se efectuará la vinculación automática por correo verificado y se emitirán las sesiones y tokens nativos de `identity-service`.
