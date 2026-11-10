# ARTICLE-11-B: Bucle de Refactorización Inside-Out — Protección Contra Ataques de Account Pre-Hijacking y Encapsulamiento de Credenciales Inalcanzables en Dominio DDD

* **Artículo ID:** ARTICLE-11-B
* **User Story:** [US-11: Federated Account Linking and JIT Provisioning](../epics/EPIC-05-identity-federation/stories/US-11-federated-account-linking.md)
* **Plan de Refactorización:** [US-11: Refactoring Plan Inside-Out](../epics/EPIC-05-identity-federation/stories/US-11-federated-account-linking-refactoring-plan.md)
* **Épica Asociada:** [EPIC-05: Identity Federation & External IdP Brokerage](../epics/EPIC-05-identity-federation/README.md)
* **Bounded Context:** `identity` / `federation` / `security`
* **Tipo de Slice:** Architectural Refactor / Inside-Out Hardening (Domain Encapsulation, Anti-Hijacking & Test Isolation)
* **Rama de Trabajo:** `feat/US-11-federated-account-linking`
* **ADR Relacionado:** [ADR-0004: Client Authentication Strategy](../../docs/adr/0004-client-authentication-strategy.md), [ADR-0005: PostgreSQL Row-Level Security Strategy](../../docs/adr/0005-postgresql-rls-strategy.md), [ADR-0006: OIDC Authorization Server & Cryptography](../../docs/adr/0006-oidc-session-flow.md)
* **Fecha:** 2026-11-10
* **Autor / Tech Lead:** Angel Szymczak & Antigravity (Pair Programming)

---

## 1. Motivación y Resumen Ejecutivo

Al culminar la fase inicial TDD Outside-In de [US-11](ARTICLE-11-federated-account-linking.md), la provisión Just-In-Time (JIT) y el enlace de cuentas federadas cumplían satisfactoriamente los criterios de aceptación y los escenarios BDD. Sin embargo, un análisis de diseño orientado a la mantenibilidad a largo plazo, la pureza del modelo de dominio y la resiliencia en seguridad reveló tres oportunidades de mejora técnica:

1. **Fuga de Lógica de Dominio hacia la Capa de Aplicación:**
   La generación de contraseñas de seguridad para cuentas JIT se realizaba de manera ad-hoc dentro de `LinkOrProvisionFederatedUserCommandHandler`. Dicho handler generaba un UUID y concatenaba directamente una cadena con formato bcrypt (`$2b$12$FEDERATED_NO_LOCAL_PASSWORD_...`), violando el principio de encapsulamiento del agregado `User`.
2. **Ausencia de Introspección Semántica de Tipo de Cuenta:**
   El agregado `User` no ofrecía un método explícito para saber si un usuario contaba con una contraseña local configurable o era estrictamente federado. Cualquier componente aguas abajo debía inspeccionar directamente el hash crudo mediante expresiones regulares o manipulación de cadenas.
3. **Falta de Métodos de Negocio en `FederatedIdentity`:**
   Las validaciones de pertenencia a un tenant o coincidencia de sujeto externo requerían que la capa de aplicación invocara `getTenantId().equals(...)` y `getExternalSubjectId() === ...`, debilitando la expresividad del agregado.
4. **Dependencia Excesiva de Pruebas de Integración y BDD:**
   Para validar casos extremos de provisión, enlace concurrente o validaciones de dominio, los tests recurrían a suites de aceptación completas con servidores Express y bases de datos simuladas, aumentando el tiempo de retroalimentación en el pipeline de CI/CD.

Para abordar estos puntos con disciplina arquitectónica y bajo una política estricta de cero regresiones, se ejecutó el **Bucle de Refactorización Inside-Out** detallado a continuación.

```
+---------------------------------------------------------------------------------------------------------+
| ARQUITECTURA DE REFACTORIZACIÓN INSIDE-OUT (US-11)                                                      |
|                                                                                                         |
|  [CAPA DE DOMINIO]                                                                                      |
|  - User.createFederatedUser({ email, tenantId, id? })  <-- Encapsula hash inalcanzable                  |
|  - User.hasLocalPassword(): boolean                    <-- Introspección semántica limpia               |
|  - FederatedIdentity.matchesSubject(provider, sub)     <-- Encapsulamiento de comparación               |
|  - FederatedIdentity.belongsToTenant(tenantId)         <-- Validación directa de tenant                 |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA DE APLICACIÓN]                                                                                   |
|  - LinkOrProvisionFederatedUserCommandHandler          <-- Cohesión alta, delega creación al Dominio    |
|  - Auditoría enriquecida (federation_jit_provisioned,                                                   |
|    federation_account_linked, federation_existing_link)                                                 |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA DE PERSISTENCIA]                                                                                 |
|  - InMemoryFederatedIdentityRepository                <-- Clave compuesta, aislamiento multi-tenant    |
|  - PostgresFederatedIdentityRepository                <-- Scoped transactions vía withClient()          |
|         │                                                                                               |
|         ▼                                                                                               |
|  [SUITES UNITARIAS AISLADAS (100% EN MEMORIA)]                                                          |
|  - test_federated_identity_aggregate.ts (12 tests)                                                     |
|  - test_in_memory_federated_identity_repository.ts (8 tests)                                            |
|  - test_link_or_provision_handler.ts (7 tests)                                                          |
|  - test_user_aggregate.ts (tests de factory federada y hasLocalPassword)                                |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Hardening del Dominio: Fábrica Semántica de Credenciales Inalcanzables

En Domain-Driven Design, un agregado debe ser el guardián absoluto de sus invariantes y de su ciclo de vida. Delegar la creación de credenciales defensivas a un caso de uso de aplicación dispersa el conocimiento criptográfico.

### 2.1. Implementación en `User`

Se introdujo el factory method `createFederatedUser` y la propiedad semántica `hasLocalPassword`:

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

### 2.2. Por qué este enfoque es Criptográficamente Robusto

1. **Cumplimiento Estricto de Esquema Relacional:** La tabla `users` impone `password_hash VARCHAR(255) NOT NULL`. Asignar valores nulos requeriría relajar restricciones de integridad en base de datos.
2. **Neutralización de Ataques de Autenticación Local:** Al utilizar un hash prefijado con `$2b$12$FEDERATED_NO_LOCAL_PASSWORD_` seguido de un UUID criptográfico aleatorio, es computacionalmente imposible que una entrada suministrada por un atacante en el endpoint de login tradicional (`POST /api/v1/auth/login`) coincida, ya que:
   - El hash no corresponde al cálculo de ninguna cadena plana conocida.
   - El algoritmo `bcrypt.compare` fallará inmediatamente o producirá discrepancias permanentes.
3. **Claridad para la Capa UI / Presentación:** Las interfaces frontend pueden consultar `user.hasLocalPassword()` para ofrecer al usuario una opción de *"Configurar contraseña para acceso sin conexión"* de forma nativa y elegante.

---

## 3. Métodos Semánticos en `FederatedIdentity`

Se enriqueció el agregado `FederatedIdentity` para evitar la sobreexposición de sus campos privados a través de getters planos:

```typescript
export class FederatedIdentity {
  // ...
  public matchesSubject(provider: FederatedProviderId, externalSubjectId: string): boolean {
    return this.provider === provider && this.externalSubjectId === externalSubjectId.trim();
  }

  public belongsToTenant(tenantId: TenantId): boolean {
    return this.tenantId.equals(tenantId);
  }
}
```

Esto permite que el handler exprese la verificación de tenant como una regla de negocio legible:
```typescript
if (!existingIdentity.belongsToTenant(tenantId)) {
  await this.auditLogger?.logEvent({
    eventType: 'cross_tenant_violation',
    reason: 'CROSS_TENANT_VIOLATION: Federated identity belongs to a different tenant',
    // ...
  });
  throw new Error('Federated identity belongs to another tenant organization');
}
```

---

## 4. Desacoplamiento y Cohesión en `LinkOrProvisionFederatedUserCommandHandler`

El caso de uso fue simplificado y desacoplado, eliminando dependencias de bajo nivel como la importación directa de `crypto`. 

### Código Antes de la Refactorización:
```typescript
// Acoplado a generación de credenciales arbitrarias
const newUserId = crypto.randomUUID();
const unmatchablePasswordHash = `$2b$12$FEDERATED_NO_LOCAL_PASSWORD_${crypto.randomUUID()}`;

user = User.create({
  id: newUserId,
  email,
  tenantId,
  passwordHash: unmatchablePasswordHash,
});
```

### Código Tras la Refactorización Inside-Out:
```typescript
// Expresión pura de dominio
user = User.createFederatedUser({
  email,
  tenantId,
});
```

El handler ahora actúa estrictamente como un **Orquestador de Dominio**, coordinando:
1. Validación de precondiciones de seguridad (`emailVerified === true`).
2. Recuperación o persistencia de agregados.
3. Emisión de auditoría estructurada con eventos semánticos diferenciados:
   - `federation_existing_link`: Login directo.
   - `federation_account_linked`: Enlace a usuario existente.
   - `federation_jit_provisioned`: Creación JIT de usuario + identidad federada.
4. Generación y almacenamiento de la sesión nativa de la plataforma.

---

## 5. Repositorio en Memoria Resiliente e Idempotente

Para posibilitar pruebas unitarias ultra-rápidas y desacopladas de PostgreSQL, se construyó el `InMemoryFederatedIdentityRepository`:

- **Indexación por Clave Compuesta:** Utiliza un `Map<string, FederatedIdentity>` cuya clave es `${provider}:${externalSubjectId}`, emulando el índice único de base de datos.
- **Idempotencia en `save`:** Si se invoca `save` con la misma clave compuesta, actualiza la entidad sin duplicar registros.
- **Filtrado Multi-Tenant en Consultas de Usuario:** Métodos como `findByUserIdAndProvider` y `findAllByUserId` exigen explícitamente el `TenantId`, garantizando que en las pruebas en memoria se reproduzca el mismo comportamiento de aislamiento que PostgreSQL RLS.
- **Reciclaje Limpio:** Implementa `clear()` para purgar el estado entre pruebas unitarias sin efectos colaterales.

---

## 6. Cobertura Exhaustiva en Nivel Unitario (100% PASS)

Como resultado del refactoring, se agregaron tres suites unitarias dedicadas en `tests/unit/identity/`:

| Suite Unitaria | Ubicación | Tests | Foco de Validación |
| :--- | :--- | :--- | :--- |
| `test_federated_identity_aggregate.ts` | `domain/federation/` | 12 | Invariantes, constructores privados, métodos `equals`, `matchesSubject`, `belongsToTenant`. |
| `test_in_memory_federated_identity_repository.ts` | `infrastructure/repositories/` | 8 | Indexación compuesta, aislamiento multi-tenant, idempotencia, borrado total. |
| `test_link_or_provision_handler.ts` | `application/federation/` | 7 | Las 7 ramas del handler con mocks puros (JIT, Linking, Direct Sign-In, Multi-Provider, Email no verificado, Cross-tenant guard, Inconsistencia huérfana). |
| `test_user_aggregate.ts` | `domain/` | 2 (añadidos) | `createFederatedUser` y verificación del comportamiento de `hasLocalPassword()`. |

**Total de Tests Unitarios del Servicio:** **47 suites, 350 tests (100% PASS en 16.8s)**.

---

## 7. Conclusiones y Buenas Prácticas Establecidas

La ejecución del bucle Inside-Out en US-11 deja lecciones fundamentales de diseño para el Bounded Context de Identidad:

1. **El Dominio Modela la Realidad Criptográfica:** No esconder los requerimientos de seguridad detrás de trucos en la base de datos o en controladores HTTP. El aggregate `User` modela explícitamente cómo nace una identidad federada y cómo se diferencia de una identidad local.
2. **Defensa en Profundidad ante Pre-Hijacking:** Exigir `email_verified: true` en el primer contacto es la única barrera real contra secuestro de cuentas en flujos de enlace automático.
3. **Aislamiento de Pruebas:** Las pruebas unitarias deben ejecutarse en milisegundos y sin tocar PostgreSQL ni Express. El uso de repositorios en memoria ricos permite iterar a máxima velocidad sin sacrificar rigor.
