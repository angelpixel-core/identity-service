# 3. Estrategia de Aislamiento Multitenant

* **Status:** Accepted
* **Date:** 2026-11-03
* **Deciders:** Equipo de Arquitectura e Ingeniería

## Contexto y Problema

El Identity Service debe atender múltiples organizaciones (*Tenants*) concurrentemente. En entornos SaaS B2B, la fuga de datos entre organizaciones constituye una falla crítica de seguridad y cumplimiento normativo. Se requiere una estrategia de aislamiento que garantice seguridad estricta sin incurrir en costos operativos o de infraestructura desmedidos en etapas tempranas.

## Drivers de la Decisión

- Garantía de segregación de datos entre tenants: ningún usuario o proceso debe poder leer o mutar información de una organización ajena.
- Rendimiento y optimización de costos en infraestructura de base de datos.
- Facilidad de propagación del contexto de tenant en peticiones HTTP y en cachés en memoria.
- Simplicidad en migraciones y despliegue del servicio.

## Opciones Consideradas

1. **Base de Datos por Tenant (Database per Tenant):** Máximo aislamiento físico, pero alto costo operacional, dificultad en migraciones coordinadas y subutilización de recursos para tenants pequeños.
2. **Esquema por Tenant (Schema per Tenant en PostgreSQL):** Buen aislamiento lógico, pero complejidad en la gestión dinámica de conexiones y migraciones de esquemas en caliente.
3. **Base de Datos Compartida con Segregación por Columna Discriminadora (`tenant_id`) y Middleware de Contexto:** Eficiente en costos y mantenimiento, permite índices compuestos `(email, tenant_id)` y control programático estricto mediante Value Objects y middlewares de autenticación.

## Decisión

Adoptar una estrategia de **Base de Datos Compartida con Aislamiento Estricto por `tenant_id` y Propagación de Contexto**:
1. **Value Object `TenantId`:** Todo agregado o entidad persistible valida la presencia de un `tenant_id` válido.
2. **Unicidad Compuesta:** Las restricciones de unicidad de cuentas se aplican sobre la tupla `(email, tenant_id)`.
3. **Claims en Tokens JWT:** Al autenticarse, el servicio emite un JWT firmado que incluye `tenantId` en sus claims.
4. **Middleware de Inyección (`TenantContextMiddleware`):** En cada petición entrante, el middleware valida el token, extrae el `tenant_id` y lo inyecta en el contexto de ejecución.
5. **Particionado de Caché:** Las claves de caché en memoria incorporan explícitamente el prefijo de tenant (`user_profile:{tenantId}:{userId}`) para evitar envenenamiento o lecturas cruzadas.

## Consecuencias

### Positivas
- Infraestructura simple y altamente escalable con PostgreSQL estándar.
- Cero sobrecostos de mantenimiento de múltiples bases de datos.
- Aislamiento auditado en código mediante Value Objects e índices compuestos.

### Negativas / Riesgos
- El equipo debe ser disciplinado al escribir queries de repositorio para no omitir nunca la cláusula `WHERE tenant_id = :tenant_id`.
- Se requiere suite de pruebas de integración específica que intente consultar registros de otros tenants para certificar el bloqueo.

