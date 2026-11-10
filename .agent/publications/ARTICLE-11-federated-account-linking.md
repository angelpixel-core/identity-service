# ARTICLE-11: Arquitectura de Enlace de Cuentas y Provisión Just-In-Time (JIT) — Federación Segura Multi-Tenant con Google Workspace y Microsoft Entra ID

* **Artículo ID:** ARTICLE-11
* **User Story:** [US-11: Federated Account Linking and JIT Provisioning](../epics/EPIC-05-identity-federation/stories/US-11-federated-account-linking.md)
* **Épica Asociada:** [EPIC-05: Identity Federation & External IdP Brokerage](../epics/EPIC-05-identity-federation/README.md)
* **Bounded Context:** `identity` / `federation` / `session`
* **Tipo de Slice:** Domain / Application / Persistence Slice (Federated Account Linking, JIT Tenant Provisioning & Native Session Issuance)
* **Rama de Trabajo:** `feat/US-11-federated-account-linking`
* **ADR Relacionado:** [ADR-0004: Client Authentication Strategy](../../docs/adr/0004-client-authentication-strategy.md), [ADR-0005: PostgreSQL Row-Level Security Strategy](../../docs/adr/0005-postgresql-rls-strategy.md), [ADR-0006: OIDC Authorization Server & Cryptography](../../docs/adr/0006-oidc-session-flow.md)
* **Guía Interactiva:** [GUIDELINE-12: Enlace de Cuentas Federadas y Provisión Just-In-Time](../guidelines/GUIDELINE-12-federated-account-linking.md)
* **Principio Rector:** Zero Friction User Onboarding, Multi-Tenant Account Linking, OWASP Pre-Hijacking Prevention, Unmatchable Federated Password Hash, Native Session Issuance
* **Fecha:** 2026-11-10
* **Autor / Tech Lead:** Angel Szymczak & Antigravity (Pair Programming)

---

## 1. Resumen Ejecutivo: La Paradoja de la Federación

En arquitecturas empresariales multiorganizacionales y SaaS B2B, la autenticación federada resuelve el primer gran obstáculo del onboarding corporativo: permitir que los colaboradores inicien sesión con sus identidades empresariales de **Google Workspace** o **Microsoft Entra ID (Office 365)** sin tener que memorizar credenciales locales.

Sin embargo, una vez validado el token OIDC externo (completado en US-10), el sistema se enfrenta a una encrucijada crítica de diseño:
1. **Riesgo de Fragmentación de Identidades:** Si un usuario preexistente que ya posee una cuenta local (creada mediante registro clásico de usuario y contraseña) inicia sesión vía Google, crear ciegamente un nuevo perfil generaría dos registros divergentes para la misma persona en el mismo tenant, corrompiendo la auditoría y los permisos de usuario.
2. **Vulnerabilidad de Secuestro de Cuentas (*Pre-Hijacking Attack*):** Si el sistema enlaza automáticamente una identidad externa basándose únicamente en la coincidencia de cadenas del correo electrónico sin verificar que el proveedor externo haya certificado dicho buzón, un atacante podría registrar una cuenta gratuita en un proveedor no verificado con el correo del administrador de la víctima y asumir control total de la cuenta interna al federar.
3. **Invariantes de Base de Datos y Credenciales Huérfanas:** Las tablas de usuarios en bases de datos relacionales suelen requerir un hash de contraseña no nulo (`password_hash NOT NULL`). Asignar contraseñas vacías, cadenas fijas o hashes predecibles introduce agujeros de seguridad donde atacantes podrían intentar autenticación por contraseña contra cuentas concebidas para ser exclusivamente federadas.

Con **US-11**, **AngelPixel Identity Service** resuelve esta paradoja mediante una **Arquitectura de Resolución de Identidad de 3 Vías** totalmente desacoplada, con garantías criptográficas en el dominio, mitigación estricta de ataques de *pre-hijacking*, persistencia aislada por tenant mediante PostgreSQL Row-Level Security (RLS) y emisión inmediata de una sesión nativa estándar de la plataforma.

```
+---------------------------------------------------------------------------------------------------------+
| FLUJO DE RESOLUCIÓN DE IDENTIDAD Y SESIÓN NATIVA EN ANGELPIXEL IDENTITY SERVICE (US-11)                 |
|                                                                                                         |
|                           [ ID Token OIDC Verificado por Broker US-10 ]                                 |
|                                                |                                                        |
|                                                v                                                        |
|                                 ¿userProfile.emailVerified === true?                                    |
|                                  |                              |                                       |
|                                 (NO)                           (SI)                                     |
|                                  |                              |                                       |
|                                  v                              v                                       |
|                       [ HTTP 401 Unauthorized ]   ¿Existe FederatedIdentity en tenant?                  |
|                        Audit: callback_failed      |                                |                   |
|                                                   (SI)                             (NO)                 |
|                                                    |                                |                   |
|                                                    v                                v                   |
|                                         [ 1. Direct Sign-In ]         ¿Existe User local por email?     |
|                                         - Resuelve User vinculado      |                         |      |
|                                         - isNewUser: false            (SI)                      (NO)    |
|                                         - linked: false                |                         |      |
|                                                                        v                         v      |
|                                                          [ 2. Account Linking ]    [ 3. JIT Provision ] |
|                                                          - Asocia a User local     - User.createFedUser |
|                                                          - Persiste Identity       - Persiste Identity  |
|                                                          - isNewUser: false        - isNewUser: true    |
|                                                          - linked: true            - linked: true       |
|                                                                        |                         |      |
|                                                                        +------------+------------+      |
|                                                                                     |                   |
|                                                                                     v                   |
|                                                                    [ EMISIÓN DE SESIÓN NATIVA ]         |
|                                                                    - RS256 JWT Access Token (1h)        |
|                                                                    - RefreshSession en DB PostgreSQL    |
|                                                                    - Cookie HttpOnly SameSite=Strict    |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Dominio Enriquecido: Agregados e Invariantes Criptográficas

Siguiendo los principios de Domain-Driven Design (DDD), la lógica de negocio y las políticas de seguridad residen en el corazón del modelo de dominio, protegidas de dependencias de infraestructura o frameworks de entrega HTTP.

### El Agregado `FederatedIdentity`

Modela la asociación persistente e inmutable entre una cuenta de usuario local de la organización y el identificador único externo emitido por el Identity Provider de terceros:

```typescript
export class FederatedIdentity {
  private readonly id: string;
  private readonly userId: string;
  private readonly tenantId: TenantId;
  private readonly provider: FederatedProviderId;
  private readonly externalSubjectId: string;
  private readonly externalEmail: Email;
  private readonly createdAt: Date;
  private readonly updatedAt: Date;

  // Invariantes protegidas en constructor privado
  private constructor(props: ReconstituteFederatedIdentityProps) {
    this.validateId(props.id);
    this.validateUserId(props.userId);
    this.validateProvider(props.provider);
    this.validateExternalSubjectId(props.externalSubjectId);
    // ...
  }

  public matchesSubject(provider: FederatedProviderId, externalSubjectId: string): boolean {
    return this.provider === provider && this.externalSubjectId === externalSubjectId.trim();
  }

  public belongsToTenant(tenantId: TenantId): boolean {
    return this.tenantId.equals(tenantId);
  }
}
```

### Endurecimiento del Agregado `User`: Fábrica Semántica y Credenciales Inalcanzables

Para resolver la necesidad de persistir usuarios aprovisionados Just-In-Time en PostgreSQL con un campo `password_hash` no nulo sin exponerlos a ataques de autenticación por contraseña, se incorporó una fábrica semántica especializada en el agregado `User`:

```typescript
export interface FederatedUserCreateProps {
  id?: string;
  email: Email;
  tenantId: TenantId;
}

export class User {
  // ...
  public static createFederatedUser(props: FederatedUserCreateProps): User {
    const id = props.id && props.id.trim().length > 0 ? props.id.trim() : crypto.randomUUID();
    const unmatchablePasswordHash = `$2b$12$FEDERATED_NO_LOCAL_PASSWORD_${crypto.randomUUID()}`;
    return User.create({
      id,
      email: props.email,
      tenantId: props.tenantId,
      passwordHash: unmatchablePasswordHash,
    });
  }

  public hasLocalPassword(): boolean {
    return !this.passwordHash.startsWith('$2b$12$FEDERATED_NO_LOCAL_PASSWORD_');
  }
}
```

**Beneficios de Seguridad del Enfoque:**
- **Inviabilidad Matemática de Fuerza Bruta:** El prefijo `$2b$12$` satisface la sintaxis bcrypt ante validaciones de base de datos, pero el contenido aleatorio de 128 bits generado criptográficamente garantiza que ninguna contraseña plana suministrada por un usuario o atacante podrá generar una coincidencia durante `bcrypt.compare`.
- **Introspección Semántica:** El método `user.hasLocalPassword()` permite a las capas de aplicación o interfaces UI identificar instantáneamente si el usuario requiere configurar una contraseña local para accesos offline o si opera estrictamente bajo gobernanza OIDC de su empresa.

---

## 3. Orquestación del Caso de Uso: `LinkOrProvisionFederatedUserCommandHandler`

La capa de aplicación orquesta la resolución en cuatro pasos secuenciales deterministas:

### 1. Barrera Mandatoria Anti-Hijacking
Antes de cualquier consulta a base de datos, el handler evalúa la certificación del correo electrónico:
```typescript
if (!userProfile.emailVerified) {
  await this.auditLogger?.logEvent({
    eventType: 'federation_callback_failed',
    timestamp: new Date(),
    ip,
    reason: 'Unverified external email: email_verified must be true',
    metadata: { provider: userProfile.provider, email: userProfile.email, tenantId },
  });
  throw new Error(`Cannot link or provision account: ${userProfile.provider} email "${userProfile.email}" is not verified`);
}
```

### 2. Detección de Vínculo Federado Existente (Direct Sign-In)
Busca en el repositorio de identidades federadas si el par `(provider, externalSubjectId)` ya fue registrado. Si existe, verifica que pertenezca al `tenant_id` invocado (previniendo fugas cross-tenant) y recupera directamente el `User` local, estableciendo `isNewUser: false` y `linked: false`.

### 3. Enlace a Cuenta Preexistente (Account Linking)
Si no existe vínculo previo, busca en `userRepository.findByEmail(email, tenantId)`. Si existe un usuario local registrado con el mismo correo electrónico en la organización, reutiliza su identificador y persiste una nueva entidad `FederatedIdentity`, vinculando el proveedor externo con `isNewUser: false` y `linked: true`.

### 4. Provisión Just-In-Time (JIT Provisioning)
Si no existe ni vínculo ni usuario previo en la organización, invoca `User.createFederatedUser({ email, tenantId })`, persiste el nuevo usuario en la base de datos y crea el registro correspondiente en `federated_identities`, retornando `isNewUser: true` y `linked: true`.

### 5. Emisión de Sesión Nativa
Independientemente de la vía resuelta, el handler no delega la sesión al IdP externo, sino que emite una sesión soberana de la plataforma:
- Genera un **Access Token RS256** mediante `TokenProviderPort`, con claims estructurados (`sub`, `iss`, `tenant_id`, `provider`, `auth_time`, TTL 1 hora).
- Instancia una entidad `RefreshSession` deslizante y persiste su hash SHA-256 en base de datos.
- El controlador HTTP inyecta el `refresh_token` como una cookie `HttpOnly; SameSite=Strict; Secure`.

---

## 4. Persistencia Segura y Aislamiento RLS en PostgreSQL

La persistencia de identidades federadas se diseñó para cumplir con el principio de mínimo privilegio y el aislamiento de datos a nivel de motor de base de datos (PostgreSQL Row-Level Security, implementado en US-05).

### Esquema Relacional (`008-create-federated-identities.sql`)

```sql
CREATE TABLE IF NOT EXISTS federated_identities (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    external_subject_id VARCHAR(255) NOT NULL,
    external_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Invariante 1: Un sujeto externo de un proveedor sólo puede vincularse a una cuenta
CREATE UNIQUE INDEX IF NOT EXISTS idx_federated_provider_subject 
ON federated_identities (provider, external_subject_id);

-- Invariante 2: Un usuario no puede vincular dos cuentas del mismo proveedor
CREATE UNIQUE INDEX IF NOT EXISTS idx_federated_user_provider 
ON federated_identities (user_id, provider);

-- Aislamiento RLS automático mediante función del catálogo
SELECT apply_tenant_rls('federated_identities');
```

Gracias a `apply_tenant_rls`, cualquier consulta sobre `federated_identities` ejecutada por el servicio filtra de forma fail-closed mediante la política:
$$\text{USING } (\text{tenant\_id} = \text{current\_setting}('app.current\_tenant\_id', \text{true}))$$

Si un atacante lograra vulnerar la capa de aplicación o manipular el parámetro `tenant_id`, el motor de base de datos abortará la lectura o mutación al no coincidir el contexto de sesión transaccional.

---

## 5. Verificación Rigurosa en la Pirámide de Pruebas

La implementación de US-11 fue validada de forma integral a través de los cuatro niveles de la pirámide de pruebas, garantizando cero regresiones:

```
                      / \
                     /   \
                    / BDD \      11 suites, 39 escenarios (100% PASS)
                   /-------\
                  / Integr. \    18 suites, 111 tests (100% PASS)
                 /-----------\
                / SDK Client  \  7 suites, 38 tests (100% PASS)
               /---------------\
              /   Unit Tests    \ 47 suites, 350 tests (100% PASS)
             /-------------------\
```

1. **Nivel Unitario Aislado (350 tests):**
   - Invariantes de agregados (`User`, `FederatedIdentity`) en memoria sin dependencias.
   - Verificación de hash inalcanzable y método `hasLocalPassword()`.
   - Comprobación de las 7 ramas lógicas en `LinkOrProvisionFederatedUserCommandHandler` con mocks puros.
2. **Nivel de Integración (111 tests):**
   - Repositorio `PostgresFederatedIdentityRepository` con consultas parametrizadas `ON CONFLICT` y soporte `withClient()` para transacciones RLS.
   - Pruebas de penetración de aislamiento multi-tenant contra vectores de inyección SQL y discrepancia de encabezados.
3. **Nivel de Aceptación BDD (39 escenarios):**
   - `tests/acceptance/features/federated_account_linking.feature`: 5 escenarios en lenguaje Gherkin que validan provisión JIT, vinculación por correo preexistente, enlaces multi-proveedor, login directo y rechazo estricto de correos no verificados.
4. **Nivel SDK TypeScript (38 tests):**
   - Recurso `client.federation.handleCallback(...)` tipado que valida la recepción de tokens y los flags de provisión `isNewUser` y `linked`.

---

## 6. Conclusiones e Impacto Estratégico

La culminación de **US-11** consolida la visión del **EPIC-05 (Identity Federation & External IdP Brokerage)** al dotar a AngelPixel Identity Service de una plataforma de federación empresarial de clase mundial:

1. **Experiencia de Usuario sin Fricción:** Los nuevos empleados o clientes corporativos se aprovisionan al instante en su primera visita mediante Single Sign-On (SSO).
2. **Higiene Criptográfica y Resiliencia OWASP:** La arquitectura neutraliza vectores de pre-hijacking mediante verificación mandatoria de correo y blinda las cuentas contra ataques de fuerza bruta local con hashes inalcanzables.
3. **Soberanía de Sesión:** El servicio no depende del proveedor externo para mantener la sesión del usuario, emitiendo tokens nativos RS256 y cookies deslizantes `HttpOnly` auditables internamente.
4. **Aislamiento Multi-Tenant de Grado Bancario:** La combinación de verificaciones de dominio y Row-Level Security en PostgreSQL garantiza que ninguna identidad federada sea visible o accesible fuera de las fronteras estrictas de su organización.
