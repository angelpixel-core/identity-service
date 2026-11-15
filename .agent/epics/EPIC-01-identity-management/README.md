# EPIC-01: Identity & Access Management Service

* **ID:** EPIC-01
* **Bounded Context:** `identity`
* **Estado:** In Progress
* **Arquitectura:** Vertical Slice Architecture + Hexagonal / DDD (TypeScript / Express / React)
* **Topología de Referencia:** [`.agent/TREE.txt`](../../TREE.txt)

---

## 1. Visión y Definición del Dominio

El servicio administra la autenticación segura de usuarios, el aislamiento multitenant y la emisión de tokens JWT enriquecidos con claims organizacionales (`tenant_id`). Garantiza segregación estricta de datos en la persistencia y lectura optimizada de perfiles a través de mecanismos de caché multinivel.

---

## 2. Alcance y Vertical Slices

### 2.1. Write Slice (Command): `register_user`
- **User Story:** [`US-01: Tenant User Registration`](stories/US-01-user-registration.md)
- **Flujo:** Recibe credenciales y `tenantId`, valida el formato RFC 5322 del correo y la complejidad de la clave mediante Value Objects, hashea la contraseña vía `BcryptAdapter`, persiste en PostgreSQL y emite un token JWT con claims de tenant.
- **Artefactos Principales:**
  - `src/contexts/identity/domain/value_objects/email/value.ts`
  - `src/contexts/identity/domain/entities/user/aggregate.ts`
  - `src/contexts/identity/application/commands/register_user/command.ts` & `handler.ts`
  - `src/contexts/identity/infrastructure/persistence/repositories/user/repository.ts`
  - `interfaces/http/rest/v1/identity/controllers.ts` (`POST /api/v1/auth/register`)

### 2.2. Read Slice (Query): `get_user_profile`
- **User Story:** [`US-02: Get Tenant User Profile`](stories/US-02-tenant-profie-read.md)
- **Flujo:** Recibe la solicitud autenticada con Bearer JWT, valida el token y extrae el contexto con middlewares de Express, consulta la información del perfil primero en caché en memoria (`MemoryCacheAdapter`), ante un *cache miss* consulta PostgreSQL, puebla la caché con TTL y retorna el ViewModel sanitizado (sin passwords).
- **Artefactos Principales:**
  - `src/contexts/identity/application/queries/get_user_profile/query.ts` & `handler.ts`
  - `src/contexts/identity/infrastructure/cache/memory_cache_adapter.ts`
  - `interfaces/http/middlewares/auth_middleware.ts` & `tenant_context_middleware.ts`
  - `interfaces/http/rest/v1/identity/controllers.ts` (`GET /api/v1/auth/me`)

---

## 3. Hoja de Ruta de Implementación (Mapa de Commits)

### Fase A: Core Domain & Abstracciones Backend (Commits 1 a 6)
- `[commit 1]`: `feat(backend): initialize Node/Express/TS setup and tsconfig`
- `[commit 2]`: `feat(domain): define Value Objects (Email, TenantId)`
- `[commit 3]`: `feat(domain): define User Aggregate with domain invariants`
- `[commit 4]`: `feat(domain): define UserRepositoryPort and HashProviderPort interfaces`
- `[commit 5]`: `feat(app): implement register_user Command Slice (command and handler)`
- `[commit 6]`: `feat(app): implement get_user_profile Query Slice (query and handler)`

### Fase B: Infraestructura, Persistencia y Seguridad (Commits 7 a 13)
- `[commit 7]`: `feat(infra): implement BcryptAdapter for password hashing`
- `[commit 8]`: `feat(infra): implement JwtTokenAdapter for authentication & tenant claims`
- `[commit 9]`: `feat(infra): implement PostgresUserRepository using raw SQL or Query Builder`
- `[commit 10]`: `feat(infra): implement MemoryCacheAdapter for fast read queries`
- `[commit 11]`: `feat(infra): add TenantContextMiddleware & AuthMiddleware`
- `[commit 12]`: `feat(interfaces): expose Express AuthController endpoints (/register, /me)`
- `[commit 13]`: `feat(interfaces): assemble composition root in server.ts and error-handling middleware`

### Fase C: Frontend Domain, Context & API Adapters (Commits 14 a 21)
- `[commit 14]`: `feat(frontend): initialize React/TS app structure and API client contract`
- `[commit 15]`: `feat(frontend): implement AuthApiClient with fetch/axios and error handling`
- `[commit 16]`: `feat(frontend): implement AuthContext and AuthProvider for state management`
- `[commit 17]`: `feat(frontend): create custom hook useAuth for authentication actions`
- `[commit 18]`: `feat(frontend): create custom hook useUserProfile with client-side caching strategy`
- `[commit 19]`: `feat(frontend): build RegisterForm & LoginForm UI components`
- `[commit 20]`: `feat(frontend): build UserProfileCard UI component displaying tenant info`
- `[commit 21]`: `feat(frontend): wire frontend AuthProvider to App views and route protection`

### Fase D: Integración, Pruebas y Cierre (Commits 22 a 24)
- `[commit 22]`: `test(backend): add unit tests and acceptance BDD feature for user registration`
- `[commit 23]`: `test(frontend): add component test and E2E spec for RegisterForm & UserProfileCard`
- `[commit 24]`: `docs: finalize public architecture overview and technical publications`

---

## 4. Definición de Hecho (Definition of Done - DoD)

- [ ] Escenarios Gherkin validados con Cucumber/BDD.
- [ ] Pirámide de testing completa (Unit, Integration, Acceptance, E2E).
- [ ] Aislamiento de capas respetado sin imports indebidos de Express/DB en dominio.
- [ ] Matriz de trazabilidad [`TRACEABILITY_MATRIX.md`](../../memory/TRACEABILITY_MATRIX.md) con estado `Completed` para cada criterio.
- [ ] Artículos técnicos de cada caso de uso redactados en `.agent/publications/`.

