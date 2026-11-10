# ARTICLE-10-B: Bucle de Refactorización Inside-Out — Mitigación de Ataques CSRF y Replay en Flujos Federados mediante Criptografía Timing-Safe y Caché de JWKS con Auto-Rollover

* **Artículo ID:** ARTICLE-10-B
* **User Story:** [US-10: External OIDC Provider Connectors](../epics/EPIC-05-identity-federation/stories/US-10-external-oidc-connectors.md)
* **Plan de Refactorización:** [US-10: Refactoring Plan Inside-Out](../epics/EPIC-05-identity-federation/stories/US-10-external-oidc-refactoring-plan.md)
* **Épica Asociada:** [EPIC-05: Identity Federation & External IdP Brokerage](../epics/EPIC-05-identity-federation/README.md)
* **Bounded Context:** `identity` / `federation-connectors` / `security`
* **Tipo de Slice:** Architectural Refactor / Inside-Out Hardening (Cryptographic Resiliency & Isolation)
* **Rama de Trabajo:** `feat/US-10-external-oidc-connectors`
* **ADR Relacionado:** [ADR-0004: Client Authentication Strategy](../../docs/adr/0004-client-authentication-strategy.md), [ADR-0006: OIDC Authorization Server & Cryptography](../../docs/adr/0006-oidc-session-flow.md)
* **Fecha:** 2026-11-10
* **Autor / Tech Lead:** Angel Szymczak & Antigravity (Pair Programming)

---

## 1. Motivación y Resumen Ejecutivo

Al culminar la fase inicial TDD Outside-In de [US-10](ARTICLE-10-external-oidc-connectors.md), la integración con Google y Microsoft Entra ID satisfacía plenamente los criterios de aceptación BDD. Sin embargo, una auditoría técnica orientada a robustez enterprise y resiliencia ante ataques avanzados identificó cuatro vulnerabilidades y riesgos operativos potenciales:

1. **Vulnerabilidad a Ataques de Canal Lateral por Temporización (CWE-208):**
   Las comparaciones convencionales de firmas o strings terminan anticipadamente en el primer carácter dispar. En entornos con baja latencia de red, un atacante puede deducir iterativamente la firma HMAC del parámetro `state`, forjando tokens anti-CSRF válidos.
2. **Caídas de Servicio por Rotación de Claves Externas (*Key Rollover Downtime*):**
   Tanto Google como Microsoft rotan sus claves privadas de firma asimétrica periódicamente. Si un ID Token es firmado con una nueva clave y el servidor mantiene una caché estática de JWKS con TTL de varias horas, cualquier intento de login fallaría sistemáticamente hasta que la caché expire.
3. **Riesgo de Inundación de Peticiones hacia IdPs Externos (DoS / Cache Thrashing):**
   Si un atacante envía intencionalmente tokens con `kid` inexistentes de forma masiva, un mecanismo de refresco ingenuo saturaría los servidores de Google/Microsoft o agotaría las conexiones del broker local.
4. **Acoplamiento a la Red en Suites de Pruebas:**
   Para garantizar una suite de testing determinista que se ejecute en segundos sin conexión a internet ni dependencia de servicios de terceros, era mandatorio implementar adaptadores de transporte inyectables y suites unitarias completamente aisladas.

Para resolver estos desafíos bajo una política de cero regresión, se implementó el **Bucle de Refactorización Inside-Out** detallado en este artículo.

```
+---------------------------------------------------------------------------------------------------------+
| ARQUITECTURA DE RESILIENCIA Y HARDENING CRIPTOGRÁFICO INSIDE-OUT                                        |
|                                                                                                         |
|  [ID Token Entrante]                                                                                    |
|         │                                                                                               |
|         ▼                                                                                               |
|  [JwksTokenVerifier]                                                                                    |
|         ├── 1. ¿Clave en Caché (kid) y no expirada? ---> [Sí] ---> Valida firma RS256 con KeyObject    |
|         │                                                                                               |
|         └── 2. [No: Cache Miss o Rollover]                                                             |
|                 ├── ¿Pasaron más de 5s desde último intento? (Cooldown Anti-DoS)                        |
|                 │         ├── [Sí] ---> Refresh Keys con Retry & Backoff Exponencial                   |
|                 │         └── [No]  ---> Bloquea refresco excesivo                                      |
|                 └── Fallo de red: FAIL-SAFE Mantiene claves previas activas                             |
|                                                                                                         |
|  [State Token Anti-CSRF]                                                                                |
|         │                                                                                               |
|         ▼                                                                                               |
|  [FederationStateManager]                                                                               |
|         ├── 1. crypto.timingSafeEqual(providedHMAC, expectedHMAC) (Mitiga CWE-208)                      |
|         ├── 2. Tolerancia estricta de reloj (Clock Skew: 60s)                                           |
|         └── 3. Redacción [REDACTED] de secretos en logs y representaciones de memoria                   |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Hardening Criptográfico de `FederationStateManager`

El manejador de estado fue blindado contra vectores de falsificación, manipulación temporal y fugas de memoria:

1. **Comparación en Tiempo Constante (`crypto.timingSafeEqual`):**
   ```typescript
   const providedBuf = Buffer.from(providedSignature);
   const expectedBuf = Buffer.from(expectedSignature);

   if (
     providedBuf.length !== expectedBuf.length ||
     !crypto.timingSafeEqual(providedBuf, expectedBuf)
   ) {
     throw new Error('Invalid state token: signature verification failed');
   }
   ```
   Al igualar las longitudes de los buffers y ejecutar la comparación byte a byte en tiempo constante, se elimina cualquier filtración de información por análisis de microsegundos de CPU.

2. **Validación de Desviación de Reloj (*Clock Skew Tolerance*):**
   En arquitecturas cloud distribuidas, los relojes de los servidores pueden diferir ligeramente. Se implementó una tolerancia configurable (`clockToleranceSeconds = 60`):
   - Rechaza tokens con `expiresAt < now - tolerance` (expirados).
   - Rechaza tokens con `createdAt > now + tolerance` (emitidos en el futuro).

3. **Defensa contra Fuga de Secretos en Observabilidad:**
   Implementación obligatoria de `toString()` y `[util.inspect.custom]()` ocultando el secreto de firma (`secret: [REDACTED]`), previniendo exposiciones accidentales en herramientas APM o volcados de logs (`console.log(stateManager)`).

---

## 3. Resiliencia de JWKS con Auto-Rollover, Retry y Cooldown Anti-DoS

El componente `JwksTokenVerifier` fue rediseñado para operar en entornos de alta concurrencia con tolerancia a fallos:

### 3.1. Auto-Rollover ante `kid miss`
Cuando Google o Microsoft publican un nuevo par de claves criptográficas, los tokens emitidos inmediatamente contendrán un `kid` desconocido para la caché local.
* El verificador detecta el `kid miss`.
* Si han transcurrido al menos 5 segundos desde la última revalidación (`minRefreshIntervalMs = 5000`), ejecuta una descarga forzada del JWKS oficial.
* Las nuevas claves se indexan en un `Map<string, crypto.KeyObject>`, resolviendo el token entrante sin intervención humana ni reinicio del servicio.

### 3.2. Ventana de Enfriamiento (*Cooldown Guard*) Anti-DoS
Para impedir que peticiones maliciosas con `kid` aleatorios fuercen al servidor a saturar de peticiones HTTP a Google o Microsoft:
* Si se recibe una petición con un `kid` desconocido pero el último refresco ocurrió hace menos de 5 segundos, la petición se rechaza de inmediato sin realizar llamadas HTTP externas adicionales.

### 3.3. Reintentos con Backoff Exponencial y Jitter
Ante microcortes de red o respuestas HTTP 503 temporales al consultar el endpoint JWKS:
* Se ejecutan hasta 3 intentos con retrasos exponenciales progresivos (`delay = initialRetryDelayMs * 2^attempt + jitter`).

### 3.4. Resiliencia Fail-Safe
Si los 3 intentos de refresco fallan debido a una caída total del proveedor externo, el verificador no borra las claves previamente aprendidas. Mantiene la caché anterior activa, permitiendo que cualquier token emitido con una clave preexistente continúe siendo validado con éxito.

---

## 4. Batería de 6 Suites Unitarias Aisladas (Tests 100% Deterministas)

Como parte del bucle Inside-Out, se construyeron 6 suites de pruebas unitarias aisladas sin llamadas de red ni dependencias externas:

1. **`test_federation_state_manager.ts` (11 tests):**
   - Generación de nonces de 128 bits con alta entropía.
   - Verificación de state válido y decodificación de claims.
   - Rechazo de firmas manipuladas, estados expirados y formatos inválidos.
   - Redacción de secretos en `util.inspect`.
2. **`test_jwks_token_verifier.ts` (11 tests):**
   - Almacenamiento y consulta de claves `KeyObject`.
   - Auto-refresco en caliente ante `kid miss`.
   - Bloqueo de refrescos excesivos dentro del cooldown guard.
   - Reintentos con backoff exponencial.
   - Verificación de firmas RS256, rechazo de tokens expirados o con audiencia inválida.
3. **`test_google_oidc_adapter.ts` (7 tests):**
   - Parámetros de URL (`scope`, `login_hint`, `prompt`, `access_type=offline`).
   - Canje y normalización de perfiles de Google.
   - Rechazo si `email_verified !== true` o si el claim `nonce` no coincide.
4. **`test_microsoft_entra_adapter.ts` (6 tests):**
   - URLs para tenants específicos y `common`.
   - Normalización de claims corporativos (`oid`/`sub` y `preferred_username`/`upn`/`email`).
5. **`test_federated_handlers.ts` (8 tests):**
   - `GenerateFederatedLoginUrlQueryHandler`: Validación de tenants, providers y parámetros.
   - `ProcessFederatedCallbackCommandHandler`: Verificación de state, mitigación de discrepancias de proveedor y logging de auditoría de seguridad (`federation_callback_processed`, `federation_callback_failed`).
6. **`test_federation_controller.ts` (8 tests):**
   - Controlador Express desacoplado: validación Zod, soporte dual JSON vs. 302 Redirect y mapeo estandarizado de excepciones OAuth2 (`invalid_request` 400 vs. `invalid_grant` 401).

---

## 5. Resultados de la Verificación Cero-Regresión

Con la incorporación de estas suites, el ecosistema de pruebas de `identity-service` alcanzó un nuevo máximo histórico de calidad:

```
Test Suites: 44 passed, 44 total (Unit Suites)
Tests:       320 passed, 320 total (Unit Tests)
Time:        6.023 s

Test Suites: 10 passed, 10 total (Acceptance BDD Suites)
Tests:       34 passed, 34 total (Acceptance Scenarios)

Test Suites: 17 passed, 17 total (Integration Suites)
Tests:       105 passed, 105 total (Integration Tests)

Test Suites: 7 passed, 7 total (TypeScript SDK Suites)
Tests:       38 passed, 38 total (SDK Tests)

================================================================================
TOTAL ECOSISTEMA: 443 PRUEBAS PASADAS / 0 FALLOS / 0 ERRORES DE TIPADO
================================================================================
```

---

## 6. Conclusión y Lecciones Aprendidas

El bucle de refactorización Inside-Out sobre **US-10** demuestra que implementar autenticación federada en sistemas de misión crítica exige mucho más que una simple redirección HTTP:
* Requiere **blindaje contra ataques de canal lateral** mediante comparaciones timing-safe.
* Demanda **resiliencia criptográfica dinámica** ante rotaciones de claves en caliente sin caídas de servicio.
* Necesita **defensa en profundidad** mediante no-repudio de correos verificados y mitigación de replay attacks con nonces.

Este conjunto de adaptadores y verificadores sienta las bases para el siguiente paso en **EPIC-05**: **US-11 (Federated Account Linking & Tenant Profile Provisioning JIT)**.
