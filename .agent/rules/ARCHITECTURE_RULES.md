# Reglas de Arquitectura — Identity Service

Este documento establece los principios de diseño, límites arquitectónicos y estándares de implementación obligatorios para el servicio de identidad. La fuente canónica de la topología es [`BC_SLICE_TEMPLATE.txt`](../templates/BC_SLICE_TEMPLATE.txt).

---

## 1. Patrón Arquitectónico Fundamental

El proyecto implementa **Vertical Slice Architecture** combinado con los principios de **Arquitectura Hexagonal (Ports & Adapters)** y **Domain-Driven Design (DDD)** táctico, estructurado por **Bounded Contexts**.

```text
               +-------------------------------------------+
               |                INTERFACES                 |
               |   (HTTP Express / Web Client React / CLI) |
               +-------------------------------------------+
                                     |  (Consume)
                                     v
               +-------------------------------------------+
               |             APPLICATION LAYER             |
               |   - Commands & Handlers (Write Slices)    |
               |   - Queries & Handlers (Read Slices)      |
               |   - Secondary Ports (SPIs)                |
               +-------------------------------------------+
                        |                         |
               (Implements Ports)          (Protects Core)
                        |                         |
                        v                         v
       +-------------------------------+   +---------------+
       |        INFRASTRUCTURE         |   | DOMAIN LAYER  |
       | (PostgreSQL, Cache, Security) |   | (Entities, VO)|
       +-------------------------------+   +---------------+
```

---

## 2. Reglas por Capas

### 2.1. Núcleo de Dominio (`src/contexts/<context>/domain/`)
1. **Aislamiento Hermético:** Cero dependencias externas. No importar Express, ORMs, librerías de persistencia, ni utilidades de red.
2. **Entidades y Aggregate Roots (`domain/entities/<aggregate>/aggregate.ts`):**
   - Poseen identidad única y controlan su ciclo de vida e invariantes de negocio.
   - Protegen el estado interno; las mutaciones ocurren únicamente a través de métodos de negocio explícitos.
3. **Value Objects (`domain/value_objects/<concept>/value.ts`):**
   - Son inmutables. Dos Value Objects con los mismos atributos son idénticos.
   - Validan sus propias restricciones en el constructor/factory method y lanzan excepciones tipadas de dominio.
4. **Excepciones de Dominio (`domain/exceptions/<aggregate>/error.ts`):**
   - Heredan de una clase base común de error de dominio (e.g. `DomainError`).
   - Describen fallos de invariantes de negocio, no errores de infraestructura.

### 2.2. Capa de Aplicación (`src/contexts/<context>/application/`)
1. **Separación CQRS por Slices:**
   - **Commands (`application/commands/<action>/`):** Intenciones de mutación. Contienen `command.ts` (DTO inmutable de entrada) y `handler.ts` (orquesta carga de agregado, ejecución de regla y persistencia vía puerto).
   - **Queries (`application/queries/<get_data>/`):** Consultas de sólo lectura optimizadas. Contienen `query.ts` y `handler.ts`.
2. **Puertos Secundarios (`application/ports/`):**
   - Interfaces abstractas TypeScript que declaran las necesidades de la aplicación (e.g. `UserRepositoryPort`, `HashProviderPort`, `CacheProviderPort`).
   - La capa de aplicación define los puertos; la capa de infraestructura los implementa.
3. **DTOs Limpios (`application/dtos/`):**
   - Contratos desacoplados tanto de HTTP como de esquemas de base de datos.

### 2.3. Capa de Infraestructura (`src/contexts/<context>/infrastructure/`)
1. **Adaptadores Concretos:**
   - Implementan los puertos definidos en la capa de aplicación.
   - Manejan detalles técnicos: consultas SQL, hashing con Bcrypt, firma de tokens JWT, serialización de caché.
2. **Mapeadores Puros (`infrastructure/persistence/mappers/`):**
   - Traductores bidireccionales explícitos: `Database Record / Model <-> Domain Entity / Aggregate`.
   - Prohibido filtrar modelos de persistencia hacia el dominio.

### 2.4. Capa de Interfaces (`interfaces/`)
1. **Canal HTTP (`interfaces/http/`):**
   - Implementado con Express en `interfaces/http/rest/v1/<context>/controllers.ts`.
   - Maneja exclusivamente: parsing de peticiones, validación de schemas (`schemas.ts`), despacho hacia el Command/Query Handler correspondiente, y mapeo de excepciones a códigos de estado HTTP estándar (201, 200, 400, 401, 403, 404, 409, 500).
2. **Canal Web Client (`interfaces/web/client/contexts/<context>/`):**
   - Frontend React autónomo organizado por Bounded Context.
   - Contratos de dominio en `domain/types.ts`.
   - Clientes de datos y hooks en `data/api.ts` y `data/queries.ts`.
   - Componentes modulares en `ui/components/`.

---

## 3. Reglas de Aislamiento Multitenant

1. **Contexto Obligatorio:** Toda operación de usuario, token emitido y registro persistido debe contener un `tenant_id` válido.
2. **Segregación en Consultas:** Las consultas de persistencia deben incluir explícitamente el filtro `tenant_id` para garantizar que ningún tenant pueda acceder o mutar datos ajenos.
3. **Middleware de Inyección:** El `TenantContextMiddleware` en Express extrae y valida el `tenant_id` de los claims del JWT antes de delegar a cualquier controlador protegido.

---

## 4. Convenciones de Código y Nomenclatura

- Carpetas: `snake_case` (e.g. `register_user/`, `value_objects/`).
- Archivos estándar de slice: `command.ts`, `query.ts`, `handler.ts`, `aggregate.ts`, `value.ts`, `repository.ts`, `controllers.ts`.
- Clases e Interfaces TypeScript: `PascalCase` (e.g. `RegisterUserCommand`, `UserAggregate`, `UserRepositoryPort`).
- Tipos de variables y funciones: `camelCase` (e.g. `registerUserHandler`, `tenantId`).

