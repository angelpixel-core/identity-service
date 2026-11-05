# 5. Estrategia de Aislamiento Multitenant con PostgreSQL Row-Level Security (RLS)

* **Status:** Accepted
* **Date:** 2026-11-05
* **Deciders:** Principal Identity & Security Architect, Equipo de Ingeniería

## Contexto y Problema

En el [ADR-0003](0003-multi-tenant-isolation-strategy.md), se adoptó una arquitectura de base de datos compartida con discriminador `tenant_id` a nivel aplicativo (Value Objects en dominio y middlewares en Express). Si bien dicho diseño es costo-eficiente y modular, el propio ADR documentó un riesgo latente:
> *"El equipo debe ser disciplinado al escribir queries de repositorio para no omitir nunca la cláusula WHERE tenant_id = :tenant_id."*

En un entorno IdP de grado enterprise que da servicio a múltiples aplicaciones corporativas y portales de usuarios, el riesgo de que una omisión involuntaria en una consulta manual, agregación o migración exponga información entre organizaciones resulta inaceptable. Se requiere una arquitectura de **Defensa en Profundidad** (*Defense in Depth*) donde el motor de base de datos garantice la segregación física/lógica de forma determinista, independientemente del código aplicativo.

## Drivers de la Decisión

- Garantía criptográfica y lógica de aislamiento: Imposibilidad de filtrado de datos entre tenants incluso si el repositorio omite un filtro explícito en SQL.
- Compatibilidad con el Connection Pooling de Node.js (`pg.Pool`) sin retención residual de variables de sesión.
- Soporte para tareas administrativas legítimas (migraciones DDL, agregación analítica de plataforma) mediante roles controlados.
- Preservar el rendimiento de lectura y escritura con impacto nulo en la latencia de queries indexadas.

## Opciones Consideradas

1. **Mantener aislamiento exclusivamente en código aplicativo (ADR-0003):** Insuficiente para un IdP Enterprise; depende 100% de la disciplina del desarrollador.
2. **Esquema por Tenant (`search_path` dinámico en PostgreSQL):** Excelente aislamiento pero introduce sobrecarga operativa insostenible al escalar en cientos de esquemas y coordinar migraciones en caliente.
3. **Row-Level Security (RLS) en PostgreSQL con variable de sesión transaccional (`SET LOCAL`):** Aprovecha la base de datos única y los índices existentes, forzando al motor de PostgreSQL a inyectar la condición de aislamiento en el planificador de consultas de forma transparente y segura.

## Decisión

Implementar **PostgreSQL Row-Level Security (RLS)** en todas las tablas con discriminador organizativo, gestionando el contexto mediante variables transaccionales seguras:

1. **Activación de Políticas RLS:**
   * En cada tabla multitenant (`users`, `registered_clients`, `federated_identities`, `refresh_sessions`), se ejecuta:
     ```sql
     ALTER TABLE users ENABLE ROW LEVEL SECURITY;
     ALTER TABLE users FORCE ROW LEVEL SECURITY; -- Aplica incluso para el dueño de la tabla salvo bypass explícito

     CREATE POLICY tenant_isolation_policy ON users
       FOR ALL
       USING (tenant_id = current_setting('app.current_tenant_id', true)::text)
       WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::text);
     ```

2. **Gestión del Contexto de Sesión en Connection Pool (`pg.Pool`):**
   * El cliente de Node.js obtiene una conexión del pool y ejecuta sus operaciones dentro de un bloque transaccional utilizando **`SET LOCAL`**:
     ```sql
     BEGIN;
     SELECT set_config('app.current_tenant_id', $1, true); -- true = LOCAL a la transacción
     -- Operaciones de lectura y escritura del caso de uso
     COMMIT;
     ```
   * **Propiedad Clave de `SET LOCAL`:** El parámetro de configuración expira y se destruye automáticamente tan pronto como la transacción finaliza (`COMMIT` o `ROLLBACK`). Cuando la conexión física de `pg` regresa al pool, queda completamente limpia de estado, eliminando cualquier posibilidad de contaminación cruzada entre peticiones concurrentes.

3. **Bypass Controlado para Migraciones y Superadmin:**
   * Las migraciones de estructura (DDL) y procesos batch de plataforma se ejecutan bajo un rol de base de datos específico dotado del atributo `BYPASSRLS` o deshabilitando temporalmente el setting bajo auditoría estricta.

## Consecuencias

### Positivas
- **Defensa en Profundidad:** Incluso si un desarrollador ejecuta `SELECT * FROM users;`, PostgreSQL únicamente retornará las filas correspondientes al `tenant_id` fijado en la transacción.
- **Cero fugas en el Connection Pool:** `SET LOCAL` garantiza limpieza automática sin depender de bloques `finally` en JavaScript.
- Transparencia para las capas superiores: Los agregados y entidades de dominio continúan utilizando su `TenantId` sin alterar su semántica.

### Negativas / Riesgos
- Toda interacción con la base de datos debe orquestarse a través de un runner transaccional con contexto de tenant (`TenantAwareTransactionRunner`).
- Si una operación olvida ejecutar `SET LOCAL app.current_tenant_id`, la política RLS evaluará `current_setting('app.current_tenant_id', true)` como `NULL`, resultando en 0 filas devueltas (bloqueo por defecto *Fail-Closed*).

