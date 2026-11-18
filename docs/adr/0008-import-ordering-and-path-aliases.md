# 8. Convención de Ordenación de Imports y Path Aliases por Bounded Contexts

* **Status:** Accepted
* **Date:** 2026-11-18
* **Deciders:** Equipo de Arquitectura e Ingeniería

## Contexto y Problema

A medida que el proyecto `identity-service` ha crecido incorporando 22 Historias de Usuario a través de 8 Épicos, la importación de módulos mediante rutas relativas profundas (ej. `../../../src/contexts/identity/domain/entities/user/aggregate`) presentó los siguientes inconvenientes:
1. **Fragilidad ante Refactorizaciones:** Mover un archivo de prueba o de infraestructura requería ajustar manualmente decenas de puntos de retorno (`../../../`).
2. **Desorden Visual y Falta de Jerarquía:** Los imports de librerías externas (npm), adaptadores de entrada (HTTP), persistencia (PostgreSQL) y entidades de dominio se encontraban mezclados sin un criterio consistente.
3. **Opacidad de Fronteras Arquitectónicas:** Resultaba difícil auditar visualmente si un archivo estaba violando la regla de dependencia de Clean Architecture (las capas externas deben depender de las internas, nunca al revés).

## Drivers de la Decisión

- **Mapeo Claro de Capas:** Visualizar de un vistazo la procedencia y el nivel arquitectónico de cada dependencia importada.
- **Robustez en Rutas:** Reemplazar rutas relativas frágiles por alias semánticos basados en DDD y Bounded Contexts.
- **Interoperabilidad Total:** Compatibilidad transparente entre el compilador de TypeScript (`tsc`), el runner de pruebas (`jest`) y las herramientas de desarrollo en tiempo real (`tsx` / `vite`).
- **Optimización de Compilación:** Fomentar el uso de `import type` para artefactos que solo existen en tiempo de tipado (evitando emisiones innecesarias en bundles JS).

## Decisión

### 1. Configuración de Path Aliases en `tsconfig.json` y `jest.config.js`
Se configuran alias basados en Bounded Contexts y capas arquitectónicas:
- `@interfaces/*` $\to$ `interfaces/*` (Adaptadores de entrada: HTTP, CLI, Web).
- `@identity/domain/*` $\to$ `src/contexts/identity/domain/*` (Núcleo puro de dominio: Agregados, Value Objects, Excepciones, Eventos).
- `@identity/application/*` $\to$ `src/contexts/identity/application/*` (Puertos abstractos, Commands, Queries, Handlers).
- `@identity/infrastructure/*` $\to$ `src/contexts/identity/infrastructure/*` (Adaptadores técnicos: DB, Logging, Criptografía, Repositorios).
- `@shared/*` $\to$ `src/shared/*` (Kernel compartido e infraestructura transversal).

### 2. Convención Canónica de Ordenación de Imports (Outside-In / Hexagonal)
Todo archivo en el repositorio debe agrupar y ordenar sus imports en 5 bloques secuenciales separados por una línea en blanco:

```typescript
// 1. Librerías Externas (Node.js runtime & paquetes npm 3rd-party)
import type { Request, Response } from 'express';
import request from 'supertest';

// 2. Capa de Interfaces (Adaptadores Primarios / Entrada: HTTP, CLI, Middleware)
import { createApp } from '@interfaces/http/server';

// 3. Capa de Infraestructura (Adaptadores Secundarios / Persistencia, Logging, Clientes)
import { InMemorySecurityAuditLogger } from '@identity/infrastructure/logging/memory_security_audit_logger';

// 4. Capa de Aplicación (Puertos abstractos, DTOs, Handlers de Comandos/Queries)
import type { UserRepositoryPort } from '@identity/application/ports/user/repository';

// 5. Capa de Dominio (Entidades, Agregados, Value Objects, Excepciones)
import { User } from '@identity/domain/entities/user/aggregate';
import { CrossTenantContextViolationError } from '@identity/domain/exceptions/security/error';
import { Email } from '@identity/domain/value_objects/email/value';
import { TenantId } from '@identity/domain/value_objects/tenant_id/value';
```

### 3. Reglas de Sub-Ordenación
1. **Uso de `import type`:** Siempre que se importe únicamente una interfaz o tipo de TypeScript, se debe anteponer `import type`.
2. **Orden Alfabético:** Dentro de cada bloque, los módulos deben ordenarse alfabéticamente por su ruta de origen.

## Consecuencias

### Positivas
- Código auto-documentado: la cabecera de cada archivo refleja con precisión su acoplamiento arquitectónico.
- Eliminación total de rutas relativas con puntos suspensivos anidados (`../../../`).
- Refactorizaciones seguras: mover un archivo de pruebas dentro de `tests/` ya no rompe las rutas de importación.
- Soporte nativo y validado al 100% en `tsc` y Jest.

### Negativas / Consideraciones
- Requiere mantener alineados `tsconfig.json` (`compilerOptions.paths`) y `jest.config.js` (`moduleNameMapper`).
