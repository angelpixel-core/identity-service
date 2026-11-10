# Guía de Pruebas Interactivas: US-09 (Rotación de Refresh Tokens y Ciclo de Vida de Sesión)

> **Document ID:** `GUIDELINE-10-refresh-token-rotation`  
> **Bounded Context:** `identity` / `oauth2` / `session` / `security`  
> **Historia de Usuario:** [US-09: Refresh Token Rotation & Session Lifecycle](../epics/EPIC-04-oidc-server-sessions/stories/US-09-refresh-token-rotation.md)  
> **Plan de Refactorización:** [US-09: Refactoring Plan Inside-Out](../epics/EPIC-04-oidc-server-sessions/stories/US-09-refresh-token-refactoring-plan.md)  
> **Estándares RFC:** [RFC 6749 §6 (Refreshing an Access Token)](https://datatracker.ietf.org/doc/html/rfc6749#section-6), [RFC 6819 §5.2.2.3 (Refresh Token Rotation & Revocation)](https://datatracker.ietf.org/doc/html/rfc6819#section-5.2.2.3), [RFC 7009 (OAuth 2.0 Token Revocation)](https://datatracker.ietf.org/doc/html/rfc7009), [RFC 6265bis (HTTP State Management Mechanism)](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis)  
> **Componentes Principales:**
> - `OAuth2SessionController` ([`interfaces/http/rest/v1/oauth2/session_controller.ts`](../../interfaces/http/rest/v1/oauth2/session_controller.ts))
> - `RotateRefreshTokenCommandHandler` ([`src/contexts/identity/application/commands/rotate_refresh_token/handler.ts`](../../src/contexts/identity/application/commands/rotate_refresh_token/handler.ts))
> - `RevokeSessionCommandHandler` ([`src/contexts/identity/application/commands/revoke_session/handler.ts`](../../src/contexts/identity/application/commands/revoke_session/handler.ts))
> - `RefreshSession` ([`src/contexts/identity/domain/entities/refresh_session/aggregate.ts`](../../src/contexts/identity/domain/entities/refresh_session/aggregate.ts))
> - `InMemoryRefreshSessionRepository` ([`src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository.ts`](../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository.ts))
> - `OAuth2Resource` ([`sdks/typescript/src/resources/oauth2_resource.ts`](../../sdks/typescript/src/resources/oauth2_resource.ts))

---

## 1. Visión General del Flujo y Modelo de Amenazas

Esta guía técnica proporciona los procedimientos paso a paso, diagramas de arquitectura y ejemplos de ejecución en consola para validar y operar el subsistema de **Rotación de Refresh Tokens (RTR)** y **Revocación en Cascada por Detección de Reuso (Token Family Revocation)** implementado en **US-09**.

### El Dilema de los Tokens de Acceso de Larga Duración

En arquitecturas cliente-servidor modernas (SPAs web, aplicaciones móviles híbridas y nativas):
1. **Tokens de Acceso Efímeros (`access_token`):** Los JWT firmados con RS256 tienen un tiempo de vida intencionalmente corto (e.g., 15 minutos / 900 segundos) para mitigar el impacto si son interceptados.
2. **Tokens de Refresco Persistentes (`refresh_token`):** Permiten al cliente obtener un nuevo `access_token` sin requerir que el usuario vuelva a ingresar credenciales interrumpiendo su flujo de trabajo.
3. **El Riesgo Crítico de Exfiltración:** Si un atacante extrae un `refresh_token` estático (vía XSS, sniffing en canal no seguro o acceso físico al dispositivo), obtiene acceso indefinido a la cuenta de la víctima hasta que expire la validez máxima del token (días o semanas).

### La Solución Criptográfica: Rotación Estricta 1 a 1 (RFC 6819 §5.2.2.3)

Para mitigar el robo de credenciales de refresco, el servidor aplica **Refresh Token Rotation**:
- **Consumo Único (One-Time Use):** Cada vez que un cliente presenta un `refresh_token` válido, dicho token pasa inmediatamente al estado inmutable `consumed`.
- **Emisión Deslizante (Sliding Window):** El servidor genera y entrega un *nuevo* `refresh_token` criptográficamente aleatorio, vinculado a la misma **Familia de Sesión (`family_id`)**.
- **Detección de Reuso (Reuse Detection):** Si un token en estado `consumed` es presentado nuevamente, el servidor identifica que ha ocurrido una brecha (o bien el cliente legítimo o el atacante está intentando reutilizar un token ya consumido). En ese milisegundo exacto, **toda la familia de tokens es revocada (`revoked`)** y todas las sesiones asociadas a ese árbol se anulan de forma irreversible.

---

## 2. Diagrama de Secuencia de Arquitectura

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuario Final
    participant Client as Cliente (Web SPA / Mobile)
    participant SessionCtrl as IdP: /oauth2/refresh & /revoke
    participant RotateHandler as RotateRefreshTokenHandler
    participant SessionRepo as RefreshSessionRepository (Memory/Postgres)
    participant CryptoSigner as RS256 Signer (JWT)

    Note over Client,SessionCtrl: Flujo 1: Rotación Legítima Silenciosa (Token Válido)
    Client->>SessionCtrl: POST /oauth2/refresh<br/>Cookie: refresh_token=RT_A (HttpOnly)<br/>o Body: { refresh_token: "RT_A" }
    SessionCtrl->>RotateHandler: execute({ refreshToken: "RT_A", ip, userAgent })
    RotateHandler->>SessionRepo: findByTokenHash(SHA256("RT_A"))
    SessionRepo-->>RotateHandler: RefreshSession(id: 1, family: FAM_1, status: 'active')
    
    Note over RotateHandler: 1. Marca RT_A como 'consumed'<br/>2. Genera RT_B criptográfico (256-bit)<br/>3. Crea childSession(id: 2, family: FAM_1, status: 'active')
    RotateHandler->>SessionRepo: save(session_1: consumed)<br/>save(session_2: active)
    RotateHandler->>CryptoSigner: sign({ sub: userId, aud: clientId, exp: 900 })
    CryptoSigner-->>RotateHandler: new_access_token (RS256 JWT)
    RotateHandler-->>SessionCtrl: { access_token, new_refresh_token: "RT_B", expires_in: 900 }
    SessionCtrl-->>Client: HTTP 200 OK<br/>Set-Cookie: refresh_token=RT_B; HttpOnly; SameSite=Strict; Secure<br/>Body: { access_token: "...", token_type: "Bearer", expires_in: 900 }

    Note over Client,SessionCtrl: Flujo 2: Ataque de Reuso (Atacante presenta RT_A ya consumido)
    actor Attacker as Atacante Malicioso
    Attacker->>SessionCtrl: POST /oauth2/refresh<br/>Body: { refresh_token: "RT_A" }
    SessionCtrl->>RotateHandler: execute({ refreshToken: "RT_A", ip: "198.51.100.2" })
    RotateHandler->>SessionRepo: findByTokenHash(SHA256("RT_A"))
    SessionRepo-->>RotateHandler: RefreshSession(id: 1, family: FAM_1, status: 'consumed')
    
    Note over RotateHandler: ALERTA CRÍTICA: session.isConsumed() == true<br/>Detección de Reuso / Ataque de Replay
    RotateHandler->>SessionRepo: revokeFamily("FAM_1", "reuse_detected")
    Note over SessionRepo: Invalida TODOS los tokens de FAM_1<br/>(incluyendo el legítimo RT_B)
    RotateHandler->>RotateHandler: AuditLogger.logEvent("refresh_token_reuse_detected")
    RotateHandler-->>SessionCtrl: Throw OAuth2AuthenticationError(401, 'invalid_grant')
    SessionCtrl-->>Attacker: HTTP 401 Unauthorized<br/>{ "error": "invalid_grant", "error_description": "Refresh token has already been consumed..." }

    Note over Client,SessionCtrl: Flujo 3: Cierre de Sesión Explícito (RFC 7009)
    User->>Client: Pulsa "Cerrar Sesión"
    Client->>SessionCtrl: POST /oauth2/revoke<br/>Cookie: refresh_token=RT_B<br/>o Body: { refresh_token: "RT_B" }
    SessionCtrl->>SessionRepo: revokeFamily("FAM_1", "user_logout")
    SessionCtrl-->>Client: HTTP 200 OK<br/>Set-Cookie: refresh_token=; Max-Age=0<br/>{ "message": "Session revoked successfully" }
```

---

## 3. Preparación del Entorno

### Paso 3.1: Iniciar el Servidor de Identidad

Inicia el entorno de desarrollo en el puerto estándar:

```bash
cd apps/sites/portfolio/identity-service
npm run dev
```

El servidor quedará a la escucha en `http://localhost:4000` (o `http://localhost:9393` en integración monorrepo).

Verifica la disponibilidad de los endpoints de sesión:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/.well-known/openid-configuration
# Salida esperada: 200
```

---

## 4. Pruebas Interactivas Paso a Paso

### Prueba 4.1: Obtención de Tokens Iniciales (Login / Token Exchange)

Para simular una sesión inicial, realizamos una solicitud de canje de credenciales o de código de autorización que devuelva un `refresh_token`:

```bash
# Simular obtención de tokens mediante POST /oauth2/token
INITIAL_RESPONSE=$(curl -s -X POST http://localhost:4000/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "client_id": "e-commerce-spa",
    "code": "AUTH_CODE_VALID",
    "redirect_uri": "https://shop.local/callback",
    "code_verifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  }')

echo "$INITIAL_RESPONSE"
```

*Nota para pruebas directas en memoria:* Si estás probando directamente mediante scripts de integración, puedes instanciar el repositorio y crear una sesión activa con:

```typescript
import { RefreshSession } from './src/contexts/identity/domain/entities/refresh_session/aggregate';
import { TenantId } from './src/contexts/identity/domain/value_objects/tenant_id/value';
import { ClientId } from './src/contexts/identity/domain/value_objects/client_id/value';

const plainTokenA = RefreshSession.generatePlainToken();
const session = RefreshSession.create({
  userId: 'usr-usr_01J00000000000000000000001',
  tenantId: TenantId.create('ten-ten_01J00000000000000000000001'),
  clientId: ClientId.create('e-commerce-spa'),
  plainToken: plainTokenA,
});
// Guardar en el repositorio en memoria de app.locals.sessionRepository
```

---

### Prueba 4.2: Rotación Silenciosa Legítima (Uso de Cookies HttpOnly)

En clientes web SPA, el servidor gestiona el token de refresco mediante una cookie `HttpOnly`, `SameSite=Strict` y `Secure`. Simulamos el comportamiento del navegador utilizando el parámetro `-c` (guardar cookies) y `-b` (enviar cookies) de cURL.

#### Paso A: Solicitar Rotación de Token

```bash
curl -i -X POST http://localhost:4000/oauth2/refresh \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -b cookies.txt \
  -d '{
    "client_id": "e-commerce-spa",
    "refresh_token": "PLAIN_TOKEN_A_HEX"
  }'
```

#### Respuesta Esperada (HTTP 200 OK):

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Set-Cookie: refresh_token=PLAIN_TOKEN_B_HEX; Path=/oauth2; HttpOnly; SameSite=Strict; Max-Age=2592000
Cache-Control: no-store
Pragma: no-cache

{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6...",
  "token_type": "Bearer",
  "expires_in": 900
}
```

**Verificaciones de Seguridad:**
1. La cabecera `Set-Cookie` emite un nuevo valor (`PLAIN_TOKEN_B_HEX`).
2. El token anterior (`PLAIN_TOKEN_A_HEX`) ha quedado internamente en estado `consumed` en el almacén de sesiones.
3. Se devuelve un nuevo JWT firmado asimétricamente (`access_token`) con 15 minutos de vigencia (`expires_in: 900`).
4. Las cabeceras `Cache-Control: no-store` y `Pragma: no-cache` impiden que intermediarios o proxies almacenen la respuesta.

---

### Prueba 4.3: Detección de Reuso y Revocación de Familia (Simulación de Ataque)

Simulamos un escenario donde un atacante interceptó previamente `PLAIN_TOKEN_A_HEX` e intenta utilizarlo tras haber sido ya rotado por el usuario legítimo:

```bash
# El atacante presenta el token anterior ya consumido
curl -i -X POST http://localhost:4000/oauth2/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "e-commerce-spa",
    "refresh_token": "PLAIN_TOKEN_A_HEX"
  }'
```

#### Respuesta Esperada (HTTP 401 Unauthorized):

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
Pragma: no-cache

{
  "error": "invalid_grant",
  "error_description": "Refresh token has already been consumed. Session compromised and revoked."
}
```

#### Verificación del Log de Auditoría de Seguridad:
En los registros del servidor (`SecurityAuditLoggerPort`) se registra inmediatamente un evento de alerta:
```json
{
  "eventType": "refresh_token_reuse_detected",
  "clientId": "e-commerce-spa",
  "reason": "Refresh token reuse detected; entire token family revoked",
  "metadata": {
    "familyId": "fam-4f3b2a1c...",
    "userId": "usr-usr_01J00000000000000000000001",
    "tenantId": "ten-ten_01J00000000000000000000001"
  }
}
```

---

### Prueba 4.4: Verificación de Infracción en Cascada sobre el Token Hijo Legítimo

Tras el intento de reuso, toda la familia quedó revocada. Si el usuario legítimo intenta utilizar ahora su nuevo token `PLAIN_TOKEN_B_HEX`, el servidor **rechaza la petición** forzando una nueva autenticación primaria:

```bash
curl -i -X POST http://localhost:4000/oauth2/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "e-commerce-spa",
    "refresh_token": "PLAIN_TOKEN_B_HEX"
  }'
```

#### Respuesta Esperada (HTTP 401 Unauthorized):

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8

{
  "error": "invalid_grant",
  "error_description": "Refresh session has been revoked"
}
```

> **Garantía Criptográfica:** El atacante queda bloqueado y el usuario legítimo es deslogueado preventivamente, protegiendo los recursos protegidos del tenant de accesos ilegítimos.

---

### Prueba 4.5: Cierre de Sesión Explícito (Revocación RFC 7009)

Cuando el usuario hace clic en "Cerrar Sesión", el cliente invoca el endpoint de revocación para destruir la sesión activa y limpiar la cookie del navegador:

```bash
curl -i -X POST http://localhost:4000/oauth2/revoke \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "reason": "user_logout"
  }'
```

#### Respuesta Esperada (HTTP 200 OK):

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Set-Cookie: refresh_token=; Path=/oauth2; Max-Age=0; HttpOnly; SameSite=Strict
Cache-Control: no-store
Pragma: no-cache

{
  "message": "Session revoked successfully"
}
```

**Conformidad con RFC 7009:** Si un cliente envía un token inexistente, malformado o vacío a `/oauth2/revoke`, el servidor responde igualmente con `200 OK` (evitando oráculos de enumeración de tokens válidos).

---

### Prueba 4.6: Ejecución Programática con el SDK de TypeScript

El SDK `@angelpixel-core/identity-sdk` provee métodos de alto nivel para gestionar la rotación y revocación:

```typescript
import { IdentityServiceClient } from '@angelpixel-core/identity-sdk';

const client = new IdentityServiceClient({
  baseUrl: 'http://localhost:4000',
});

async function main() {
  // 1. Rotación de Token
  try {
    const rotationResult = await client.oauth2.refreshToken({
      refreshToken: 'PLAIN_TOKEN_CURRENT',
      clientId: 'e-commerce-spa',
    });

    console.log('Nuevo Access Token:', rotationResult.access_token);
    console.log('Nuevo Refresh Token:', rotationResult.refresh_token);
    console.log('Vigencia en segundos:', rotationResult.expires_in);

    // 2. Cierre de Sesión / Revocación
    const revokeResult = await client.oauth2.revokeToken({
      refreshToken: rotationResult.refresh_token,
      reason: 'user_logout',
    });
    console.log(revokeResult.message); // 'Session revoked successfully'
  } catch (error: any) {
    console.error('Error de autenticación:', error.code, error.message);
  }
}
```

---

## 5. Hardening Criptográfico y Mitigaciones CWE

| Vulnerabilidad | Mitigación Implementada | Evidencia en Código |
| :--- | :--- | :--- |
| **CWE-208: Observable Timing Discrepancy** | Comparación de hashes en tiempo constante con `crypto.timingSafeEqual` sobre buffers de longitud garantizada. | [`RefreshSession.verifyHash()`](../../src/contexts/identity/domain/entities/refresh_session/aggregate.ts#L96-L109) |
| **CWE-312: Cleartext Storage of Sensitive Information** | Los tokens en reposo (`InMemoryRefreshSessionRepository` / Postgres) almacenan exclusivamente el hash unidireccional SHA-256 (`token_hash`). El valor plano solo existe en tránsito. | [`RefreshSession.hashToken()`](../../src/contexts/identity/domain/entities/refresh_session/aggregate.ts#L83-L91) |
| **CWE-532: Insertion of Sensitive Info into Log Files** | Implementación de `[util.inspect.custom]()` y `toString()` devolviendo `[REDACTED]` en entidades y value objects criptográficos para evitar fugas en logs de consola o tracing. | [`RefreshSession`](../../src/contexts/identity/domain/entities/refresh_session/aggregate.ts#L274-L288) |
| **CWE-770: Allocation of Resources Without Limits (Memory Leak)** | Purgado pasivo por umbral (`auto-purge`) cada 50 operaciones en repositorios en memoria, eliminando sesiones expiradas. | [`InMemoryRefreshSessionRepository`](../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository.ts#L88-L102) |

---

## 6. Matriz de Transporte Dual: Web vs Mobile

| Propiedad | Cliente Web (SPA / SSR) | Cliente Mobile (React Native / iOS / Android) |
| :--- | :--- | :--- |
| **Canal de Transporte del Refresh Token** | Cookie HTTP (`refresh_token`) con flags de seguridad. | Cuerpo de la petición JSON (`{ "refresh_token": "..." }`) o Header. |
| **Protección contra XSS** | Total: `HttpOnly=true` impide lectura desde JavaScript (`document.cookie`). | N/A (Entorno nativo fuera del sandbox del navegador). |
| **Protección contra CSRF** | Total: `SameSite=Strict` garantiza que la cookie no viaja en peticiones cross-site. | N/A (Los clientes móviles nativos no envían cookies automáticas entre apps). |
| **Custodia en el Dispositivo** | Almacén protegido del navegador (Browser Cookie Jar). | Almacén Criptográfico Nativo de Hardware (`SecureStore` Keychain / KeyStore). |
| **Lectura Rápida de Perfil** | `window.localStorage` (sin tokens sensibles). | `react-native-mmkv` síncrono para perfil de usuario y tenant activo. |

---

## 7. Tabla de Códigos de Error RFC y Diagnóstico

| Código HTTP | Código OAuth2 (`error`) | Causa Raíz | Acción Correctiva |
| :--- | :--- | :--- | :--- |
| **`400 Bad Request`** | `invalid_request` | Petición sin `refresh_token` en cookies ni en el cuerpo JSON. | Enviar el parámetro obligatorio `refresh_token` o incluir la cookie HttpOnly. |
| **`401 Unauthorized`** | `invalid_grant` | Token malformado o desconocido en el repositorio. | Volver a iniciar sesión con credenciales primarias. |
| **`401 Unauthorized`** | `invalid_grant` | **Detección de Reuso:** Token consumido previamente. | Toda la familia fue revocada por seguridad; reautenticar al usuario. |
| **`401 Unauthorized`** | `invalid_grant` | La sesión fue revocada explícitamente (`isRevoked() == true`). | Redirigir a login interactivo. |
| **`401 Unauthorized`** | `invalid_grant` | La sesión ha expirado (`isExpired() == true`, >30 días). | Redirigir a login interactivo. |

---

## 8. Checklist de Verificación de Calidad

- [x] **Flujo Feliz:** Rotación 1 a 1 emite nuevo `refresh_token` y nuevo `access_token` RS256.
- [x] **Seguridad de Cookies:** Flag `HttpOnly`, `SameSite=Strict`, `Secure` configurados según ambiente.
- [x] **Detección de Reuso:** Intento de reusar token consumido revoca de inmediato la familia completa.
- [x] **Revocación RFC 7009:** Endpoint `/oauth2/revoke` responde `200 OK` e invalida la sesión y cookie.
- [x] **Cero Filtración en Logs:** Tokens planos ofuscados en `util.inspect` y `toString`.
- [x] **Mitigación CWE-208:** Comparación `timingSafeEqual` activa.
- [x] **Cobertura de Pruebas:** 100% pruebas unitarias, de integración y SDK pasando (418 pruebas verdes en monorrepo).
