# PRD Interno y Memoria de Ejecución — Identity Service

**Tipo de Documento:** PRD Privado / Memoria de Agente  
**Propósito:** Contexto estratégico, narrativa para live-coding / code challenge, criterios de evaluación senior y directrices de ejecución autónoma.  
**Stack Objetivo:** Node.js, TypeScript, Express, PostgreSQL, React, Jest, Supertest, Cucumber, Playwright.  
**Arquitectura de Referencia:** Vertical Slice Architecture + Hexagonal / DDD (según `.agent/templates/BC_SLICE_TEMPLATE.txt`).

---

## 1. Contexto de Negocio y Misión Privada

El objetivo de este repositorio es servir como demostración de maestría en ingeniería de software (*Staff / Principal Engineer Level*) implementando un servicio de identidad multitenant (`identity-service`).
El código debe evidenciar no solo funcionalidad, sino **excelencia en separación de responsabilidades**, **diseño defensivo**, **inversión de dependencias (IoC)**, **aislamiento estricto por tenant** y **trazabilidad punta a punta**.

---

## 2. Estrategia de Narrativa para Live-Coding (Timeboxing de 60 Minutos)

Durante una sesión de exposición técnica o entrevista de live-coding, la ejecución debe seguir una progresión deliberada que comunique señorío técnico:

### Minuto 0 a 5: Fundamentación Arquitectónica
- Explicar la topología de directorios antes de tirar código.
- Declaración clave: *"Organizo el sistema en Vertical Slices aislando el núcleo de dominio mediante arquitectura hexagonal. Esto garantiza que las reglas de negocio nunca dependan de la infraestructura ni del framework HTTP, facilitando pruebas unitarias ultrarrápidas y posibilitando evolucionar hacia microservicios o persistencia multitenant sin reescribir la lógica central."*

### Minuto 5 a 25: Dominio Puro y Aplicación (Backend Core)
- Comenzar desde el centro hacia afuera (Outside-In o Inside-Out estricto):
  1. Value Objects (`Email`, `TenantId`) con validación invariante inmediata.
  2. Aggregate Root (`User`) con control de estado y encapsulamiento.
  3. Puertos secundarios (`UserRepositoryPort`, `HashProviderPort`).
  4. Command Handler (`register_user`) y Query Handler (`get_user_profile`).
- Demostrar que los handlers orquestan flujos limpios sin conocer SQL ni Express.

### Minuto 25 a 40: Infraestructura y Adaptadores HTTP
- Implementar los adaptadores que satisfacen los puertos:
  1. `BcryptAdapter` (hashing con salting) y `JwtTokenAdapter` (firma con claims de tenant).
  2. `PostgresUserRepository` con filtrado estricto por `tenant_id`.
  3. `MemoryCacheAdapter` para acelerar lecturas en el Read Slice.
  4. Controladores Express y middlewares de validación de contexto multitenant.

### Minuto 40 a 50: Frontend React por Bounded Context
- Mostrar la misma disciplina en el frontend:
  1. Contratos y tipos inmutables (`domain/types.ts`).
  2. Cliente API desacoplado de la UI (`data/api.ts`).
  3. Estado global de sesión mediante `AuthContext` y `AuthProvider`.
  4. Componente de formulario (`RegisterForm`) y tarjeta de perfil (`UserProfileCard`).

### Minuto 50 a 60: Densidad de Pruebas y Cierre
- Ejecutar la pirámide de testing:
  1. Unit tests instantáneos sobre `Email` y el Command Handler.
  2. Integration test sobre el endpoint `/api/v1/auth/register` vía Supertest.
  3. Especificación Gherkin para demostrar comprensión de BDD y comunicación con negocio.

---

## 3. Rúbricas de Evaluación Técnica (Senior / Staff Level)

| Dimensión | Criterio de Aprobación Excepcional | Error Crítico a Evitar |
| :--- | :--- | :--- |
| **Separación de Capas** | Cero imports de Express o DB en la carpeta `domain/`. Puertos definidos como interfaces abstractas. | Usar modelos de Sequelize/TypeORM/Prisma directamente como entidades de dominio. |
| **Aislamiento Multitenant** | El `tenant_id` se valida y propaga en cada operación; las lecturas de caché se particionan por tenant (`user_profile:{tenantId}:{userId}`). | Consultas a base de datos que olvidan filtrar por `tenant_id` provocando data leaking. |
| **CQRS y Slices** | Escrituras (Command) separadas de Lecturas (Query) en carpetas y modelos independientes. | Crear un único servicio monolítico `UserService` con 20 métodos mezclando lectura y mutación. |
| **Manejo de Errores** | Excepciones tipadas de negocio (`DomainValidationError`, `ConflictError`) capturadas centralizadamente por middleware Express y mapeadas a códigos HTTP semánticos (400, 409). | Try/catch anidados en cada controller devolviendo strings genéricos o error 500 para fallos de validación. |
| **Testing** | Tests unitarios puros sin levantar servicios externos + tests de integración dirigidos a contratos. | Intentar testear el 100% con tests E2E lentos o tests unitarios que mockean funciones internas triviales. |

---

## 4. Restricciones Operativas para el Agente

1. **Paridad Canónica:** Ningún archivo de código o documentación debe desviarse de las rutas establecidas en `.agent/TREE.txt`.
2. **Actualización Atómica de Matriz:** Cada avance en una historia de usuario o commit debe reflejarse en tiempo real en `TRACEABILITY_MATRIX.md`.
3. **Publicaciones:** Con cada Use Case completado, se redactará un artículo técnico explicativo en `.agent/publications/` desglosando la solución implementada.

