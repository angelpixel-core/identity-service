# Reglas y Estándares de Testing — Identity Service

Este documento define la estrategia, principios y directrices técnicas de testing para garantizar calidad y mantenibilidad en un entorno multitenant bajo **Vertical Slice Architecture** y **Hexagonal / DDD**.

---

## 1. Filosofía de Pruebas: Alta Densidad de Valor

Para mantener el desarrollo ágil sin sobrecargar la suite de pruebas ni caer en tests redundantes, adoptamos una **estrategia de alta densidad de valor**:
- Cada test debe validar un comportamiento crítico o invariante de negocio.
- Se evita el testing trivial de getters/setters, DTOs planos o librerías externas ya probadas.
- Cobertura guiada por la **Pirámide de Pruebas**, implementando casos representativos y no negociables por capa.

---

## 2. Pirámide de Pruebas del Proyecto

| Capa de la Pirámide | Herramienta / Enfoque | Objetivo Técnico | Nivel de Aislamiento |
| :--- | :--- | :--- | :--- |
| **1. Unit Tests** | Jest / TypeScript | Invariantes de Dominio puros (`Value Objects`, `AggregateRoot`) y orquestación de Handlers de aplicación. | 100% en memoria. Sin I/O ni base de datos. Mocks/Fakes para puertos secundarios. |
| **2. Integration Tests** | Jest + Supertest / Testcontainers | Adaptadores de persistencia relacional (PostgreSQL), adaptadores de caché (Redis/Memory) y contratos HTTP (Express Controllers + Middlewares). | Conexión real o emulada a infraestructura y contratos HTTP. |
| **3. Acceptance (BDD)** | Cucumber / Gherkin (`.feature`) | Living Documentation. Especificación ejecutable del comportamiento de negocio en lenguaje ubicuo (*Given / When / Then*). | Test de caja negra sobre la API pública o caso de uso completo. |
| **4. End-to-End (E2E)** | Playwright (o React Testing Library) | Flujos críticos completos de usuario desde la UI de React hasta la respuesta del backend y actualización del contexto global. | Extremo a extremo (Frontend + Backend mockeado o real). |

---

## 3. Directrices por Capa

### 3.1. Pruebas Unitarias (Domain & Application)
- **Ubicación:** `tests/unit/<context_slug>/domain/` y `tests/unit/<context_slug>/application/`
- **Reglas:**
  1. Los tests de `domain/` deben ejecutarse en menos de 5ms. Prohibido instanciar servidores HTTP, conexiones a bases de datos o sistemas de archivos.
  2. Los `Value Objects` deben probarse validando tanto casos positivos como fallos defensivos ante entradas inválidas (e.g. `Email` inválido lanza excepción tipada de dominio).
  3. Los handlers de aplicación (`commands` / `queries`) se prueban inyectando implementaciones simuladas (Mocks/Spies/Fakes) de los puertos (`UserRepositoryPort`, `HashProviderPort`, etc.).

### 3.2. Pruebas de Integración (Infrastructure & Interfaces)
- **Ubicación:** `tests/integration/<context_slug>/repositories/` y `tests/integration/<context_slug>/interfaces/`
- **Reglas:**
  1. Cada adaptador que implemente un puerto secundario debe tener su suite de integración (e.g. `PostgresUserRepository` valida inserción, lectura y aislamiento por `tenant_id`).
  2. Los tests de controladores Express validan códigos de estado HTTP (201, 200, 400, 401, 409), headers y esquemas JSON devueltos.
  3. Los middlewares de autenticación y contexto multitenant (`AuthMiddleware`, `TenantContextMiddleware`) deben probarse ante tokens válidos, inválidos, expirados y manipulados.

### 3.3. Pruebas de Aceptación BDD (Gherkin)
- **Ubicación:** `tests/acceptance/features/` y `tests/acceptance/step_defs/`
- **Reglas:**
  1. Todo caso de uso principal debe tener su archivo `.feature` redactado en lenguaje de negocio claro.
  2. Los escenarios deben reflejar el flujo exitoso (*Happy Path*) y los escenarios de error de negocio más relevantes (*Alternate / Failure Paths*).

### 3.4. Pruebas End-to-End (E2E / Frontend)
- **Ubicación:** `tests/e2e/web/`
- **Reglas:**
  1. Validan que los formularios de React (e.g. `RegisterForm`, `LoginForm`) manejen estados de carga, validaciones visuales de campos, errores devueltos por la API y actualización del `AuthContext`.
  2. No probar estilos CSS cosméticos; probar accesibilidad, interacción de usuario y persistencia de sesión.

---

## 4. Convenciones de Nomenclatura de Tests

- Archivos de test unitario: `test_<subject>.ts` (e.g. `test_email.ts`, `test_register_user_handler.ts`).
- Archivos de test de integración: `test_<adapter>.ts` (e.g. `test_postgres_repository.ts`, `test_register_api.ts`).
- Archivos de especificación BDD: `<feature_name>.feature` y `test_<feature_name>_steps.ts`.
- Archivos de spec E2E: `<component_or_flow>.spec.tsx`.

