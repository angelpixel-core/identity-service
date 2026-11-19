# 9. Patrón Root Tenant y Gobernanza de Plataforma Multi-Tenant

* **Status:** Accepted
* **Date:** 2026-11-19
* **Deciders:** Principal Identity & Security Architect, Equipo de Ingeniería

## Contexto y Problema

En el [ADR-0003](0003-multi-tenant-isolation-strategy.md) y [ADR-0005](0005-postgresql-rls-strategy.md), el servicio adoptó una arquitectura de base de datos compartida con discriminador `tenant_id` y aislamiento forzado mediante **PostgreSQL Row-Level Security (RLS)**.

Sin embargo, en toda plataforma SaaS B2B surge la necesidad de operar y supervisar la infraestructura a nivel global:
1. ¿Quién administra la plataforma, aprovisiona nuevos inquilinos y gestiona clientes OAuth2?
2. ¿Cómo un operador de soporte o un proceso automatizado de supervisión puede inspeccionar o auditar datos de un inquilino cliente sin romper el modelo *Fail-Closed* de RLS?
3. ¿Cómo evitar el antipatrón de introducir "puertas traseras" (*backdoors*) como banderas `is_superadmin: true` o cláusulas condicionales `OR is_superadmin = true` en SQL que debilitan las garantías de cumplimiento normativo (PCI-DSS v4.0 Req 10.2 y SOC 2 Type II CC6.1)?

## Drivers de la Decisión

- **Simetría y Homogeneidad en Datos:** El operador de la plataforma debe residir dentro del mismo modelo de persistencia y RLS sin esquemas paralelos ni tablas ad-hoc (`admin_users`).
- **Defensa en Profundidad y Aislamiento RLS:** La evaluación de políticas RLS en PostgreSQL debe mantenerse estricta, uniforme e inmutable para cualquier consulta.
- **Trazabilidad y Auditoría Forense Inmutable:** Cualquier acción administrativa ejecutada por un operador de plataforma sobre el contexto de un inquilino cliente debe generar un registro estructurado NDJSON inmutable y no-repudiable.
- **IdP como Pasaporte Criptográfico:** El Identity Service emite tokens OIDC con claims estandarizados (`sub`, `tenant_id`, `roles`, `actor_type`) que permiten a los servicios satélite río abajo verificar la autoridad del operador localmente vía JWKS sin llamadas síncronas de retorno.

## Opciones Consideradas

1. **Tabla o Base de Datos Separada para Administradores (`admin_users`):**
   * *Desventajas:* Duplica la lógica de autenticación, sesiones, hashing y rotación de tokens. Requiere puertas de enlace duales y encarece la infraestructura.
2. **Bypass de RLS Condicional en Queries Aplicativas (`if isSuperadmin`):**
   * *Desventajas:* Antipatrón peligroso que anula las garantías de [ADR-0005](0005-postgresql-rls-strategy.md). Un fallo en la validación del backend expone toda la base de datos a fuga de información.
3. **Patrón Root Tenant Simétrico (`system`) con Delegación Cross-Tenant Auditada:**
   * El operador de la plataforma reside dentro de un inquilino reservado de primera clase: `tenant_id: 'system'`.
   * Toda sesión de base de datos del operador ejecuta `SET LOCAL app.current_tenant_id = 'system'`.
   * Las operaciones administrativas que involucren a inquilinos cliente se autorizan mediante una regla estricta de delegación en los guardias de seguridad, emitiendo un evento de auditoría de elevación de privilegios.

## Decisión

Adoptar el **Patrón Root Tenant Simétrico** bajo las siguientes especificaciones:

### 1. Inquilino Reservado `system`
- Se reserva canónicamente el identificador `system` (configurable vía variable de entorno `ROOT_TENANT_ID`, por defecto `'system'`) para albergar a los operadores de la plataforma.
- El Value Object `TenantId` expone la constante `TenantId.ROOT_TENANT_ID = 'system'` y el método `tenantId.isRoot(): boolean`.

### 2. Modelo de Roles en el Agregado `User`
- Todo usuario posee un arreglo de roles (`roles: string[]`, por defecto `['member']`).
- Los operadores de la plataforma en `system` poseen roles elevados: `roles: ['superadmin']` o `['platform_operator']`.
- En tokens JWT, el emisor incluye los claims:
  ```json
  {
    "sub": "usr_root_superadmin_01",
    "email": "admin@angelpixel.io",
    "tenant_id": "system",
    "roles": ["superadmin"],
    "actor_type": "platform_operator"
  }
  ```

### 3. Delegación Cross-Tenant y Auditoría Forense (`createCrossTenantGuard`)
El middleware de guardia Zero-Trust aplica la siguiente regla de gobierno:
- **Flujo Estándar:** Si `activeTenantId === attemptedTenantId`, se permite el acceso directo dentro de los límites del inquilino.
- **Acceso Delegado de Plataforma:** Si `activeTenantId !== attemptedTenantId`:
  - Se autoriza **únicamente** si `activeTenantId === 'system'` **Y** el token autenticado contiene el rol `superadmin`.
  - Se emite de forma síncrona un evento de auditoría estructurado:
    * `eventType: "PLATFORM_OPERATOR_CROSS_TENANT_ACTION"`
    * `severity: "WARN"`
    * `status: "GRANTED_ELEVATED"`
    * `metadata: { operatorUserId, sourceTenant: "system", targetTenant: attemptedTenantId, path, method }`
- **Bloqueo Taxativo:** Si un usuario regular intenta acceso cross-tenant, o si un usuario de `system` carece del rol `superadmin`, la petición se aborta inmediatamente con `HTTP 403 Forbidden` (`CROSS_TENANT_VIOLATION`).

## Consecuencias

### Positivas
- **Cero Deuda Técnica ni Duplicidad:** Los administradores son ciudadanos de primera clase en la base de datos sin duplicar entidades de usuario ni tablas paralelas.
- **RLS Inalterado y Homogéneo:** RLS permanece 100% estricto y libre de cláusulas de bypass condicional en SQL.
- **Cumplimiento Normativo Auditado:** Cumplimiento con PCI-DSS v4.0 Req 10.2 y SOC 2 Type II CC6.1 mediante auditoría inmutable de accesos administrativos elevados.
- **Desacoplamiento Total:** Los microservicios downstream consumen los claims del JWT para aplicar autorización local (PEP) sin re-consultar al IdP.

### Negativas / Consideraciones
- Requiere provisionar y proteger las credenciales iniciales del usuario superadmin en el inquilino `system` mediante procesos de bootstrapping seguros (`npm run db:reset`).
