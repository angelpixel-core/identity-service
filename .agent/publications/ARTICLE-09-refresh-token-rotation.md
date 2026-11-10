# ARTICLE-09: Rotación de Refresh Tokens (RFC 6819 §5.2.2.3), Detección de Reuso y Ciclo de Vida de Sesiones Deslizantes en Arquitecturas OIDC Multi-Tenant

* **Artículo ID:** ARTICLE-09
* **User Story:** [US-09: Refresh Token Rotation & Session Lifecycle](../epics/EPIC-04-oidc-server-sessions/stories/US-09-refresh-token-rotation.md)
* **Épica Asociada:** [EPIC-04: OIDC Server & Sessions Engine](../epics/EPIC-04-oidc-server-sessions/README.md)
* **Bounded Context:** `identity` / `oauth2-session-lifecycle`
* **Tipo de Slice:** Security / Protocol & Session Slices (Refresh Token Rotation & Family Revocation)
* **Rama de Trabajo:** `feat/US-09-refresh-token-rotation`
* **ADR Relacionado:** [ADR-0004: Client Authentication Strategy](../../docs/adr/0004-client-authentication-strategy.md), [ADR-0006: OIDC Authorization Server & Cryptography](../../docs/adr/0006-oidc-session-flow.md)
* **Guía Interactiva:** [GUIDELINE-10: Rotación de Refresh Tokens y Ciclo de Vida de Sesión](../guidelines/GUIDELINE-10-refresh-token-rotation.md)
* **Principio Rector:** Sliding Ephemeral Sessions, One-Time Use Cryptographic Tokens, Automated Breach Detection & Cascade Revocation
* **Fecha:** 2026-11-10
* **Autor / Tech Lead:** Angel Szymczak & Antigravity (Pair Programming)

---

## 1. Resumen Ejecutivo: La Paradoja de los Tokens de Refresco

En arquitecturas cliente-servidor desacopladas (Single Page Applications y clientes móviles nativos), la autenticación sin estado (*stateless authentication*) mediante JSON Web Tokens (JWT) firmados asimétricamente con RS256 es el estándar de facto de la industria. Sin embargo, este diseño enfrenta una contradicción de seguridad fundamental:

1. **Tokens de Acceso Efímeros (`access_token`):** Deben tener un tiempo de expiración deliberadamente breve (e.g., 15 minutos / 900 segundos) para minimizar la ventana de exposición en caso de intercepción o fuga en tránsito.
2. **Fricción de Usuario:** Si el token de acceso expira y la sesión no se renueva automáticamente, el usuario debe reingresar sus credenciales primarias interrumpiendo su flujo de trabajo cada pocos minutos.
3. **El Peligro de los Tokens de Refresco Estáticos (`refresh_token`):** Si el servidor emite un token de refresco persistente con validez prolongada (30 a 90 días) sin rotación, dicho token se convierte en el equivalente funcional de una contraseña en texto claro. Cualquier exfiltración (mediante vulnerabilidades XSS en web, malware en el dispositivo móvil, o volcados de memoria no protegidos) concede a un adversario acceso persistente e indetectable.

Con **US-09**, **AngelPixel Identity Service** formaliza una solución de seguridad de grado bancario basada en **Refresh Token Rotation (RTR, RFC 6819 §5.2.2.3)**, **Revocación Automática por Detección de Reuso (Token Family Revocation)** y transporte seguro diferenciado por plataforma (Cookies `HttpOnly` en Web vs. `SecureStore` de hardware en Mobile).

```
+---------------------------------------------------------------------------------------------------------+
| RFC 6819 §5.2.2.3: Sliding Refresh Token Rotation & Family Revocation Lifecycle                         |
|                                                                                                         |
|  Cliente Legítimo (Web/Mobile)              AngelPixel IdP                    Atacante Malicioso         |
|  [RT_A (Token Inicial Activo)]                     |                                   |                |
|         |                                          |                                   |                |
|         |-- 1. POST /oauth2/refresh (RT_A) ------> |                                   |                |
|         |                                          |                                   |                |
|         |                              IdP Procesa:                                    |                |
|         |                              - Invalida RT_A ('consumed')                    |                |
|         |                              - Emite nuevo RT_B criptográfico                |                |
|         |                              - Firma nuevo access_token RS256                |                |
|         |                                          |                                   |                |
|         | <--- 2. HTTP 200 { RT_B, AccessToken } - |                                   |                |
|         |                                          |                                   |                |
|         |                                          | <--- 3. Replay Attack (RT_A) ---- | (Robó RT_A)    |
|         |                                          |                                   |                |
|         |                                     IdP Detecta:                             |                |
|         |                                     RT_A.isConsumed() == true                |                |
|         |                                     ¡BRECHA DE SEGURIDAD DETECTADA!          |                |
|         |                                     Revoca toda la familia (RT_A, RT_B)      |                |
|         |                                     Log: REFRESH_TOKEN_REUSE_DETECTED        |                |
|         |                                          |                                   |                |
|         |                                          | --- 4. HTTP 401 invalid_grant --> | (Bloqueado)    |
|         |                                          |                                                    |
|         |-- 5. POST /oauth2/refresh (RT_B) ------> |                                                    |
|         |                                     IdP Rechaza:                                              |
|         |                                     Familia Revocada Preventivamente                          |
|         | <--- 6. HTTP 401 invalid_grant --------- | (Fuerza login primario de la víctima legítima)     |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Modelo de Amenazas: Exfiltración, Replay y Almacenamiento

El diseño de US-09 neutraliza tres clases críticas de vectores de ataque descritos en el modelo de amenazas de OAuth 2.0 (RFC 6819) y OWASP Top 10:

### 2.1. Vector de Ataque: *Refresh Token Leak & Silent Replay*
- **Escenario:** Un atacante consigue robar un `refresh_token` de la víctima (e.g., vía XSS inyectado en un componente de terceros, sniffing en una red Wi-Fi no confiable o extracción desde un respaldo no cifrado).
- **Impacto sin RTR:** El atacante utiliza el token de refresco en paralelo con el usuario legítimo durante semanas. Dado que el token nunca cambia, el sistema no tiene forma de distinguir entre el cliente legítimo y el adversario.
- **Defensa con RTR:** El token solo puede ser consumido **una sola vez**. En el instante en que el atacante o el usuario legítimo consuman el token, el que se quede con la versión anterior del token intentará usarlo más adelante, disparando la trampa de detección de reuso (*Reuse Detection Trap*).

### 2.2. Vector de Ataque: *Cross-Site Scripting (XSS) y Exfiltración de LocalStorage*
- **Escenario:** Muchos clientes web SPA almacenan tokens en `window.localStorage` o `window.sessionStorage`. Cualquier script malicioso ejecutado en el contexto de la aplicación (inyección XSS) puede leer `localStorage.getItem("refresh_token")` y enviarlo a un servidor remoto de comando y control.
- **Defensa en US-09:** En clientes web, el `refresh_token` se transporta y almacena exclusivamente como una **cookie HTTP** con los flags de máxima seguridad:
  - `HttpOnly = true`: Impide completamente la lectura o modificación desde JavaScript (`document.cookie`).
  - `SameSite = 'Strict'`: Bloquea el envío automático de la cookie en peticiones cross-site, eliminando de raíz ataques CSRF.
  - `Secure = true`: Exige transporte TLS/HTTPS garantizado en entornos de staging y producción.
  - `Path = '/oauth2'` (o `/api/v1/oauth2`): Restringe el ámbito de la cookie a los endpoints estrictos de sesión.

---

## 3. Arquitectura de Dominio: Agregado `RefreshSession` y Token Families

En la arquitectura hexagonal de AngelPixel Identity Service, la sesión de refresco no es un simple registro de base de datos, sino un agregado rico de dominio con invariantes criptográficos estrictos:

```typescript
export type RefreshSessionStatus = 'active' | 'consumed' | 'revoked';

export class RefreshSession {
  private readonly id: string;
  private readonly familyId: string;
  private readonly userId: string;
  private readonly tenantId: TenantId;
  private readonly clientId: ClientId;
  private readonly tokenHash: string; // Hash SHA-256 (Nunca texto plano en reposo)
  private status: RefreshSessionStatus;
  private readonly expiresAt: Date;
  private readonly createdAt: Date;
  private consumedAt: Date | null;
  private revokedAt: Date | null;
  private revocationReason: string | null;
}
```

### 3.1. Propiedades Criptográficas Fundamentales
1. **Generación Criptográfica de Alta Entropía:**
   Los tokens planos se generan utilizando el generador de números pseudoaleatorios del sistema operativo (`crypto.randomBytes(32)`), garantizando 256 bits de entropía criptográfica incondicional.
2. **Hasheo Unidireccional en Reposo (Mitigación CWE-312):**
   El servidor **nunca almacena el token plano en la base de datos**. Almacena el digest hexadecimal SHA-256 del token (`tokenHash = SHA256(plainToken)`). Incluso si un atacante obtiene acceso de lectura a la base de datos, no puede derivar los tokens planos necesarios para autenticarse.
3. **Comparación en Tiempo Constante (Mitigación CWE-208):**
   Al verificar si un token plano corresponde a un hash registrado, se utiliza `crypto.timingSafeEqual` sobre buffers de longitud fija para neutralizar ataques de canal lateral basados en temporización.

---

## 4. Algoritmo de Detección de Reuso y Revocación en Cascada

El caso de uso [`RotateRefreshTokenCommandHandler`](../../src/contexts/identity/application/commands/rotate_refresh_token/handler.ts) implementa la lógica estricta de rotación 1 a 1 y detección de brechas:

```mermaid
flowchart TD
    START([Petición entrante con refresh_token]) --> HASH[Calcular SHA256(plainToken)]
    HASH --> FIND[Buscar sesión en repositorio por tokenHash]
    
    FIND --> FOUND{¿Sesión existe?}
    FOUND -- No --> ERR_UNKNOWN[Lanzar 401 invalid_grant: Token desconocido]
    
    FOUND -- Sí --> STATUS_CHECK{¿Estado de la sesión?}
    
    STATUS_CHECK -- 'consumed' --> COMPROMISED[¡ALERTA: Detección de Reuso / Token Reuse Detected!]
    COMPROMISED --> REVOKE_ALL[sessionRepository.revokeFamily(familyId, 'reuse_detected')]
    REVOKE_ALL --> AUDIT[auditLogger.logEvent('refresh_token_reuse_detected')]
    AUDIT --> ERR_COMPROMISED[Lanzar 401 invalid_grant: Sesión comprometida y revocada]
    
    STATUS_CHECK -- 'revoked' --> ERR_REVOKED[Lanzar 401 invalid_grant: Sesión previamente revocada]
    
    STATUS_CHECK -- 'active' --> EXP_CHECK{¿session.isExpired()?}
    EXP_CHECK -- Sí --> ERR_EXPIRED[Lanzar 401 invalid_grant: Token expirado]
    
    EXP_CHECK -- No --> ROTATE_FLOW[1. Marcar sesión actual como 'consumed'\n2. Generar nuevo plainToken hijo de 256 bits\n3. Crear nueva RefreshSession activa en la misma familyId\n4. Firmar nuevo RS256 access_token e id_token\n5. Persistir ambas sesiones atómicamente]
    ROTATE_FLOW --> RETURN_OK[Retornar 200 OK con nuevo token y cookie HttpOnly]
```

### Garantía de Detección de Reuso
Cuando un atacante intercepta un token y el usuario legítimo lo rota, la sesión queda en estado `consumed`. Cuando el atacante intenta utilizar ese token consumido:
1. El servidor detecta `session.isConsumed() === true`.
2. Invoca de inmediato `sessionRepository.revokeFamily(familyId, 'reuse_detected')`.
3. Todos los tokens derivados en esa familia (incluyendo el token legítimo en posesión de la víctima) son revocados atómicamente.
4. Se registra una auditoría de seguridad para el equipo de SOC/SecOps.
5. Se responde con `401 Unauthorized` (`invalid_grant`), deslogueando a ambas partes y previniendo cualquier acceso indebido a los recursos del tenant.

---

## 5. Revocación Explícita de Sesión (RFC 7009)

El caso de uso [`RevokeSessionCommandHandler`](../../src/contexts/identity/application/commands/revoke_session/handler.ts) implementa la especificación **RFC 7009 (OAuth 2.0 Token Revocation)** para el cierre de sesión voluntario:
- Permite la revocación por cookie HttpOnly o por cuerpo JSON (`{ "refresh_token": "..." }`).
- Revoca tanto el token actual como la familia de sesión en su totalidad (`revokeFamily`).
- **Respuesta Idempotente Segura:** Conforme a RFC 7009 §2.2, si el cliente envía un token inválido, expirado o malformado, el servidor responde con `200 OK` para no revelar la validez o existencia de credenciales a potenciales adversarios en labores de enumeración.
- **Limpieza de Cookie:** El controlador HTTP emite la cabecera `Set-Cookie: refresh_token=; Max-Age=0` para forzar al navegador a purgar la cookie del almacén local.

---

## 6. Verificación de Calidad y Cero-Regresión

El subsistema de rotación de tokens cuenta con una suite completa de pruebas piramidales:
- **Pruebas de Dominio:** Cobertura de invariantes en `RefreshSession` (estados inmutables, derivación de familias, redacción de secretos en `util.inspect`).
- **Pruebas de Repositorio:** Cobertura de auto-purga y expiración pasiva en `InMemoryRefreshSessionRepository`.
- **Pruebas de Aplicación e Integración:** Verificación de rotación exitosa, simulación de replay attack, auditoría de eventos de seguridad y endpoints HTTP `/oauth2/refresh` y `/oauth2/revoke`.
- **SDK de TypeScript:** Pruebas unitarias de los métodos `client.oauth2.refreshToken` y `client.oauth2.revokeToken`.

Total de pruebas pasando en `identity-service`: **418 pruebas verdes en 67 suites (100% éxito)**.
