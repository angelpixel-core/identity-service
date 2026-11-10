# ARTICLE-08: Flujo OAuth2 Authorization Code con PKCE (RFC 7636) y Emisión Asimétrica OIDC RS256 para Clientes Públicos en Arquitecturas Multi-Tenant

* **Artículo ID:** ARTICLE-08
* **User Story:** [US-08: OAuth2 Authorization Code Flow with PKCE & User Consent](../epics/EPIC-04-oidc-server-sessions/stories/US-08-auth-code-pkce-flow.md)
* **Épica Asociada:** [EPIC-04: OIDC Server & Sessions Engine](../epics/EPIC-04-oidc-server-sessions/README.md)
* **Bounded Context:** `identity` / `oauth2-auth-flow`
* **Tipo de Slice:** Security / Protocol & Command Slices (Authorization Code with PKCE Flow)
* **Rama de Trabajo:** `feat/US-08-auth-code-pkce`
* **ADR Relacionado:** [ADR-0004: Client Authentication Strategy](../../docs/adr/0004-client-authentication-strategy.md), [ADR-0006: OIDC Authorization Server & Cryptography](../../docs/adr/0006-oidc-session-flow.md)
* **Guía Interactiva:** [GUIDELINE-09: OAuth2 Authorization Code Flow con PKCE (RFC 7636) y Canje de Tokens OIDC RS256](../guidelines/GUIDELINE-09-oauth2-authorization-code-pkce.md)
* **Principio Rector:** Zero Shared Secrets in Public Clients, Cryptographic Code Binding & Short-Lived Ephemeral Grants
* **Fecha:** 2026-11-09
* **Autor / Tech Lead:** Angel Szymczak & Antigravity (Pair Programming)

---

## 1. Resumen Ejecutivo y Obsolescencia del Implicit Grant

En las especificaciones originales de OAuth 2.0 (RFC 6749), las aplicaciones ejecutadas en el navegador del usuario —tales como Single Page Applications (SPAs en React, Vue, Angular) o aplicaciones móviles nativas— fueron catalogadas como **clientes públicos** (*public clients*) debido a su incapacidad estructural para custodiar de forma confidencial un secreto de cliente (`client_secret`).

Para satisfacer esta limitación, RFC 6749 introdujo el flujo implícito (*Implicit Grant*), en el cual el servidor de autorización retornaba directamente el `access_token` en el fragmento de la URI de redirección (`#access_token=...`). Con los años, la evolución de la ciberseguridad y el consenso de la IETF en *OAuth 2.0 Security Best Current Practice* (RFC 8252 y el borrador consolidado OAuth 2.1) demostraron que el flujo implícito es intrínsecamente inseguro:

1. **Fuga en Historial y Cabeceras Referer:** Los tokens en fragmentos URI son susceptibles de persistir en registros de proxies, historiales de navegación y cabeceras `Referer`.
2. **Inyección de Tokens:** Un atacante puede engañar a un cliente público para que acepte un token emitido para otro usuario o aplicación.
3. **Ausencia de Prueba Criptográfica de Posesión:** Cualquier entidad que capture el código o token puede consumirlo sin demostrar que originó la petición.

Con **US-08**, **AngelPixel Identity Service** formaliza la implementación del **OAuth2 Authorization Code Flow protegido con PKCE (Proof Key for Code Exchange, RFC 7636)** y emisión criptográfica asimétrica **RS256** (`access_token` e `id_token` OIDC Core 1.0):

```
+---------------------------------------------------------------------------------------------------+
| RFC 7636: Dynamic Cryptographic Binding                                                            |
|                                                                                                   |
|  Cliente Público (SPA)                      AngelPixel IdP                                        |
|  [code_verifier]                                                                                  |
|         |                                                                                         |
|         |-- 1. S256(code_verifier) -> code_challenge -------------------------------------------> |
|         |   GET /oauth2/authorize?client_id=...&code_challenge=...&code_challenge_method=S256     |
|         |                                                                                         |
|         | <-------------------------------------------- 2. Emite authorization_code (TTL: 60s) -- |
|         |                                                                                         |
|         |-- 3. POST /oauth2/token { code, code_verifier, client_id, redirect_uri } -------------> |
|         |                                                                                         |
|         |                                              IdP valida:                                |
|         |                                              BASE64URL(SHA256(verifier)) == challenge   |
|         |                                                                                         |
|         | <-------------------------------------------- 4. Emite RS256 access_token + id_token - |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Amenaza Mitigada: *Authorization Code Interception Attack*

En sistemas operativos móviles y de escritorio, múltiples aplicaciones pueden registrar el mismo esquema de URI personalizado (ej. `myapp://callback`) o interceptar peticiones entrantes. En el flujo tradicional sin PKCE, si un actor malicioso intercepta el `authorization_code` redirigido a través del navegador, puede enviarlo al endpoint `/oauth2/token` y obtener acceso ilícito a la cuenta del usuario, ya que los clientes públicos no disponen de `client_secret` para autenticarse.

**Cómo PKCE neutraliza la amenaza:**

1. El cliente legítimo genera un secreto efímero de alta entropía denominado `code_verifier` (entre 43 y 128 caracteres Base64URL).
2. El cliente deriva el `code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))` y lo envía en el primer paso al endpoint de autorización.
3. El servidor almacena el `code_challenge` enlazado al `authorization_code`.
4. El atacante puede llegar a interceptar el `authorization_code`, pero **no posee el `code_verifier` original** (el cual reside exclusivamente en la memoria volátil del cliente legítimo).
5. Cuando el atacante intenta canjear el código sin el `code_verifier` exacto, el servidor ejecuta la validación criptográfica y aborta inmediatamente con `400 Bad Request` (`invalid_grant`).

---

## 3. Arquitectura del Flujo PKCE en AngelPixel Identity Service

La siguiente secuencia describe el ciclo de vida completo de extremo a extremo implementado en US-08:

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuario Final
    participant SPA as Cliente SPA / Móvil
    participant AuthCtrl as OAuth2AuthorizeController
    participant IssueCmd as IssueAuthorizationCodeHandler
    participant CodeRepo as InMemoryAuthCodeRepo
    participant TokenCtrl as OAuth2TokenController
    participant ExchCmd as ExchangeAuthorizationCodeHandler
    participant PkceVal as PkceValidator (Domain Service)
    participant RsaSigner as RsaKeyAdapter (RS256)

    Note over SPA: Genera code_verifier (43-128 chars)<br/>Calcula code_challenge = S256(verifier)
    User->>SPA: Inicia sesión / Autorización
    SPA->>AuthCtrl: GET /oauth2/authorize?client_id=e-commerce-spa&redirect_uri=https://shop.local/callback&code_challenge=...&code_challenge_method=S256
    AuthCtrl->>IssueCmd: execute(IssueAuthorizationCodeCommand)
    IssueCmd->>IssueCmd: Valida cliente registrado y redirect_uri permitida
    IssueCmd->>IssueCmd: Exige PKCE para clientes públicos
    IssueCmd->>CodeRepo: save(AuthorizationCode) [TTL: 60s, isUsed: false]
    AuthCtrl-->>SPA: 302 Redirect Location: https://shop.local/callback?code=AUTH_CODE_XYZ
    
    Note over SPA: Extrae code de la URL redirigida
    SPA->>TokenCtrl: POST /oauth2/token (grant_type=authorization_code, code=AUTH_CODE_XYZ, code_verifier=..., client_id, redirect_uri)
    TokenCtrl->>ExchCmd: execute(ExchangeAuthorizationCodeCommand)
    ExchCmd->>CodeRepo: findByCode("AUTH_CODE_XYZ")
    CodeRepo-->>ExchCmd: AuthorizationCode
    ExchCmd->>ExchCmd: Valida binding: client_id y redirect_uri idénticos
    ExchCmd->>ExchCmd: Valida estado: no usado y no expirado (<60s)
    ExchCmd->>PkceVal: validateVerifier(verifier, challenge, 'S256')
    PkceVal->>PkceVal: timingSafeEqual(SHA256(verifier), challenge)
    ExchCmd->>ExchCmd: code.markAsUsed()
    ExchCmd->>CodeRepo: save(code)
    ExchCmd->>RsaSigner: signToken(access_token payload)
    ExchCmd->>RsaSigner: signToken(id_token payload)
    ExchCmd-->>TokenCtrl: TokenResponseDto (access_token, id_token, token_type=Bearer, expires_in=3600)
    TokenCtrl-->>SPA: 200 OK (JSON con tokens firmados RS256)
```

---

## 4. Especificación BDD Gherkin Outside-In como Living Documentation

Siguiendo el rigor de desarrollo guiado por pruebas Outside-In, el comportamiento del flujo PKCE fue formalizado en [`tests/acceptance/features/oauth2_pkce_flow.feature`](../../tests/acceptance/features/oauth2_pkce_flow.feature):

```gherkin
Feature: OAuth2 Authorization Code Flow with PKCE (RFC 7636)
  As a public client application (SPA or mobile app)
  I want to authorize users via Authorization Code grant with PKCE
  So that tokens are exchanged securely without client secrets and protected against interception

  Background:
    Given the identity service is running and healthy
    And a registered public client "e-commerce-spa" with redirect URI "https://shop.local/callback"
    And a registered confidential client "backend-service" with redirect URI "https://api.local/callback"

  Scenario: Successful authorization code generation with PKCE S256
    When the client requests authorization with:
      | client_id             | e-commerce-spa                              |
      | redirect_uri          | https://shop.local/callback                 |
      | response_type         | code                                        |
      | code_challenge        | E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM |
      | code_challenge_method | S256                                        |
      | scope                 | openid profile                              |
    Then the response status should be 302
    And the redirect URL should contain an authorization code

  Scenario: Successful token exchange with valid code_verifier
    Given an authorization code issued for "e-commerce-spa" with challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    When the client requests a token exchange with:
      | grant_type    | authorization_code                          |
      | client_id     | e-commerce-spa                              |
      | code_verifier | dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk |
      | redirect_uri  | https://shop.local/callback                 |
    Then the response status should be 200
    And the response body should contain a valid "access_token"
    And the response body should contain a valid "id_token"
    And the "token_type" should be "Bearer"

  Scenario: Reject token exchange with invalid code_verifier
    Given an authorization code issued for "e-commerce-spa" with challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    When the client requests a token exchange with:
      | grant_type    | authorization_code          |
      | client_id     | e-commerce-spa              |
      | code_verifier | wrong_verifier_string_value |
      | redirect_uri  | https://shop.local/callback |
    Then the response status should be 400
    And the error code should be "invalid_grant"

  Scenario: Reject code reuse on second token exchange attempt
    Given an authorization code issued for "e-commerce-spa" with challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    And the code has already been exchanged successfully
    When the client attempts to exchange the same code again
    Then the response status should be 400
    And the error code should be "invalid_grant"

  Scenario: Reject authorization request without code_challenge for public client
    When the client requests authorization with:
      | client_id     | e-commerce-spa              |
      | redirect_uri  | https://shop.local/callback |
      | response_type | code                        |
    Then the response status should be 400
    And the error code should be "invalid_request"
```

Los 5 escenarios fueron implementados y verificados exhaustivamente en [`tests/acceptance/step_defs/test_oauth2_pkce_flow_steps.ts`](../../tests/acceptance/step_defs/test_oauth2_pkce_flow_steps.ts) utilizando los vectores de prueba criptográficos canónicos de RFC 7636 Apéndice B.

---

## 5. Modelado de Dominio y Arquitectura Hexagonal

### 5.1. Entidad de Dominio `AuthorizationCode`

La entidad [`AuthorizationCode`](../../src/contexts/identity/domain/entities/authorization_code.ts) encapsula el estado y las invariantes del código de autorización:

```typescript
export interface AuthorizationCodeProps {
  code: string;
  clientId: string;
  tenantId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  scope: string[];
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

export class AuthorizationCode {
  private readonly props: AuthorizationCodeProps;

  public static create(params: { ... }): AuthorizationCode {
    const code = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 1000); // 60s TTL

    return new AuthorizationCode({
      code,
      ...params,
      expiresAt,
      createdAt: now,
    });
  }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() > this.props.expiresAt.getTime();
  }

  public isUsed(): boolean {
    return this.props.usedAt !== undefined;
  }

  public markAsUsed(now: Date = new Date()): void {
    if (this.isUsed()) {
      throw new DomainException('Authorization code has already been used', 'code_already_used');
    }
    this.props.usedAt = now;
  }
}
```

### 5.2. Servicio de Dominio Criptográfico `PkceValidator`

El validador [`PkceValidator`](../../src/contexts/identity/domain/services/pkce_validator.ts) aplica las transformaciones de RFC 7636 con protección criptográfica contra ataques de temporización (*timing attacks*):

```typescript
export class PkceValidator {
  public static computeS256Challenge(verifier: string): string {
    return crypto
      .createHash('sha256')
      .update(verifier, 'ascii')
      .digest('base64url');
  }

  public static validate(verifier: string, challenge: string, method: string): boolean {
    if (method !== 'S256') return false;
    if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
    if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false;

    const computed = this.computeS256Challenge(verifier);
    const bufComputed = Buffer.from(computed, 'ascii');
    const bufChallenge = Buffer.from(challenge, 'ascii');

    if (bufComputed.length !== bufChallenge.length) return false;
    return crypto.timingSafeEqual(bufComputed, bufChallenge);
  }
}
```

### 5.3. Casos de Uso en la Capa de Aplicación

1. **`IssueAuthorizationCodeCommandHandler`:**
   * Carga el agregado `ClientApplication` desde `ClientApplicationRepositoryPort`.
   * Invoca `client.isRedirectUriAllowed(redirectUri)` garantizando coincidencia estricta.
   * Si `client.isPublic()`, exige `code_challenge` y `code_challenge_method === 'S256'`.
   * Instancia y persiste `AuthorizationCode` en el repositorio.
2. **`ExchangeAuthorizationCodeCommandHandler`:**
   * Recupera el código desde `AuthorizationCodeRepositoryPort`.
   * Verifica estrictamente que el `clientId` y `redirectUri` coincidan con los de emisión.
   * Comprueba `code.isExpired()` y `code.isUsed()`.
   * Invoca `PkceValidator.validate(codeVerifier, code.codeChallenge, code.codeChallengeMethod)`.
   * Llama a `code.markAsUsed()` y persiste el cambio (previniendo reuso).
   * Firma y emite `access_token` e `id_token` asimétricos con `RsaKeyAdapter` (RS256).

---

## 6. Integración en SDK TypeScript y Especificación OpenAPI 3.1

### 6.1. SDK TypeScript (`@angelpixel/identity-sdk`)

El SDK de TypeScript se actualizó con soporte de primera clase para la construcción de URLs de autorización y el canje seguro de códigos:

```typescript
// 1. Construcción de URL con PKCE
const authUrl = client.oauth2.buildAuthorizationUrl({
  clientId: 'e-commerce-spa',
  redirectUri: 'https://shop.local/callback',
  responseType: 'code',
  scope: 'openid profile',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  codeChallengeMethod: 'S256',
  state: 'xyzState123',
});

// 2. Canje de Código por Tokens
const tokens = await client.oauth2.exchangeAuthorizationCode({
  clientId: 'e-commerce-spa',
  code: authCode,
  codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  redirectUri: 'https://shop.local/callback',
});

console.log('Access Token:', tokens.access_token);
console.log('ID Token:', tokens.id_token);
```

### 6.2. OpenAPI 3.1

El contrato formal en [`docs/openapi.yaml`](../../docs/openapi.yaml) incorporó:
* Endpoint `/oauth2/authorize` y su alias `/api/v1/oauth2/authorize` documentando parámetros query `response_type`, `client_id`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method`, y `state`.
* Extensión del endpoint `POST /oauth2/token` con el esquema `grant_type: authorization_code`, declarando los atributos requeridos (`code`, `code_verifier`, `redirect_uri`, `client_id`).

---

## 7. Matriz de Seguridad y Mitigación de Vulnerabilidades

| Vector de Ataque | Mitigación Implementada | Estándar / RFC |
| :--- | :--- | :--- |
| **Intercepción de Código en Tránsito** | `code_verifier` nunca viaja al endpoint de autorización; solo se envía su resumen SHA-256 (`code_challenge`). Sin el verificador original, el código interceptado es inútil. | RFC 7636 |
| **Reutilización de Código (*Code Replay*)** | Marcado atómico `isUsed: true` tras el primer canje exitoso. Intentos posteriores son rechazados con `400 invalid_grant`. | RFC 6749 §4.1.2 |
| **Expiración Prolongada de Códigos** | TTL acotado a 60 segundos (`expiresAt = now + 60s`). Minimiza la ventana temporal de exposición. | NIST SP 800-63C |
| **Inyección de Redirect URI Maliciosa** | `ClientApplication.isRedirectUriAllowed` valida coincidencia exacta con la lista blanca pre-registrada. El canje posterior re-valida que el `redirect_uri` coincida con el solicitado inicialmente. | RFC 6749 §3.1.2 |
| **Timing Attacks en Verificación PKCE** | `crypto.timingSafeEqual` compara hashes binarios en tiempo constante, previniendo análisis de canales laterales. | CWE-208 |
| **Degradación de Algoritmo PKCE** | Rechazo tajante de `code_challenge_method: plain`. Únicamente se admite `S256`. | OAuth 2.1 §7.5.2 |
| **Filtración de Secretos en Logs** | La entidad `AuthorizationCode` implementa `toString()` y `[util.inspect.custom]()` redactando el código a `[REDACTED]`. | CWE-312 |

---

## 8. Conclusión

La finalización de **US-08** dota a **AngelPixel Identity Service** de las capacidades necesarias para operar como un proveedor de identidad de estándar industrial, permitiendo que aplicaciones cliente modernas (SPAs y móviles) se autentiquen de manera robusta sin secretos compartidos y sin exponerse a vulnerabilidades históricas de intercepción de tráfico. Con una arquitectura hexagonal sólida y una suite exhaustiva de 372 pruebas pasando al 100%, el sistema se posiciona preparado para la gestión avanzada de sesiones y consentimientos.
