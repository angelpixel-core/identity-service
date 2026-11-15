# Guía Técnica de Pruebas Interactivas: US-17 — Cifrado de Base de Datos en Tránsito (TLS 1.3/1.2) y en Reposo (CMK) para Azure PostgreSQL Flexible Server

> **Document ID:** `GUIDELINE-18-database-encryption-flexible-server`  
> **Bounded Context:** `infrastructure` / `database-security`  
> **Historia de Usuario:** [US-17: Database Encryption In-Flight (TLS 1.3/1.2) & At-Rest (CMK) for PostgreSQL Flexible Server](../epics/EPIC-07-fintech-compliance-hardening-and-security-standards/stories/US-17-database-encryption-flexible-server.md)  
> **Estándares Regulatorios:** PCI-DSS v4.0 (Req 3.6 & 4.1) · SOC 2 Type II (CC6.1 & CC6.7)  
> **Arquitectura & Decisiones:** [ADR 0007: Cloud Infrastructure Topology](../../docs/adr/0007-cloud-infrastructure-topology.md)  
> **Componentes Principales:**
> - Fábrica Criptográfica & Anti-Downgrade Guard: [`src/contexts/identity/infrastructure/persistence/database/postgres_ssl_config.ts`](../../src/contexts/identity/infrastructure/persistence/database/postgres_ssl_config.ts)
> - Gestor Dinámico de Conexiones: [`src/contexts/identity/infrastructure/persistence/database/dynamic_postgres_pool_manager.ts`](../../src/contexts/identity/infrastructure/persistence/database/dynamic_postgres_pool_manager.ts)
> - Contenedor HTTP & Probes: [`interfaces/http/server.ts`](../../interfaces/http/server.ts)
> - Hardening Terraform: [`infrastructure/terraform/modules/postgres/`](../../infrastructure/terraform/modules/postgres/)
> - Empaquetado Helm: [`deployments/helm/identity-service/`](../../deployments/helm/identity-service/)
> - Suite E2E de Hardening TLS: [`tests/integration/identity/security/test_database_tls_hardening.ts`](../../tests/integration/identity/security/test_database_tls_hardening.ts)

---

## 1. Visión General: Arquitectura Criptográfica FinTech

Para cumplir con las exigencias no negociables de **PCI-DSS v4.0 (Req 4.1)** y **SOC 2 Type II (CC6.7)** en infraestructuras financieras y bancarias, `identity-service` implementa un modelo de defensa en profundidad donde **ningún byte sensible transita en texto plano** entre el contenedor de la aplicación y el motor relacional de base de datos.

```mermaid
flowchart TD
    subgraph K8sPod["Kubernetes Pod: identity-service (UID 1000)"]
        SERVER["HTTP Engine (server.ts)\nLiveness /health/live (200 UP)\nReadiness /health/ready (503 si DB falla)"]
        
        subgraph DataLayer["Capa de Persistencia & Criptografía"]
            FACTORY["createSecurePostgresConfig\n- Anti-Downgrade Guard\n- rejectUnauthorized: true\n- minVersion: TLSv1.2 / TLSv1.3\n- CA Pinning & Resolution"]
            DPM["DynamicPostgresPoolManager\n- activePool Pointer\n- Pre-Swap Health Check (SELECT 1)\n- Atomic Swap & Graceful Drain\n- Fail-Safe Preservation"]
            WATCHER["SecretWatcherService\n(/mnt/secrets-store CSI)"]
        end
    end

    subgraph AzureCloud["Infraestructura Gestionada (Azure / Floci)"]
        PG["Azure PostgreSQL Flexible Server\n- require_secure_transport = on\n- ssl_min_protocol_version = TLSv1.2\n- Customer-Managed Key (CMK) at-rest\n- User-Assigned Managed Identity"]
        AKV["Azure Key Vault\n- CMK Encryption Key (RSA 2048/4096)\n- Database Credentials (rotationPollInterval: 2m)"]
    end

    SERVER --> DPM
    WATCHER -->|Evento de rotación| DPM
    DPM --> FACTORY
    FACTORY -->|Conexión TLS 1.2+ Estricta| PG
    AKV -.->|Cifra discos en reposo| PG
    AKV -->|Inyecta certificados & credenciales| WATCHER
```

---

## 2. Ejecución de Pruebas Automatizadas (Turnkey)

Para ejecutar la verificación automatizada integral de extremo a extremo, se disponen de las siguientes suites:

### 2.1. Pruebas Unitarias de Criptografía y Gestor Dinámico
Valida el factory criptográfico, el bloqueo de flags inseguras y la recarga en caliente con protección anti-downgrade:
```bash
# Suite de configuración SSL y Anti-Downgrade Guard (12 pruebas)
npx jest tests/unit/identity/infrastructure/database/test_postgres_ssl_config.ts

# Suite de DynamicPostgresPoolManager con soporte TLS y fail-safe (10 pruebas)
npx jest tests/unit/identity/infrastructure/database/test_dynamic_postgres_pool_manager.ts
```

### 2.2. Suite E2E de Hardening TLS (4 Escenarios de Seguridad)
Ejecuta la suite de integración de seguridad que simula apretones de manos TLS 1.3/1.2, ataques de degradación en tiempo de ejecución, rechazo determinista de certificados Man-in-the-Middle y resolución de CA institucional desde archivos montados en CSI:
```bash
npx jest tests/integration/identity/security/test_database_tls_hardening.ts
```

### 2.3. Suite de Infraestructura Terraform (5 Etapas sobre Floci ARM)
Audita que las directivas `require_secure_transport`, `ssl_min_protocol_version = "TLSv1.2"` y los bloques dinámicos de CMK se sinteticen correctamente en el plan de Terraform:
```bash
npm run test:infra
```

### 2.4. Suite de Empaquetado Helm (6 Etapas de Validación)
Verifica la inyección de variables de entorno en el Deployment (`DATABASE_SSL_*`), el enforzamiento estricto del JSON Schema Draft-07 (enum `["TLSv1.2", "TLSv1.3"]`) y el rechazo intencional de configuraciones corruptas o inseguras:
```bash
npm run test:helm
```

---

## 3. Vectores de Prueba Interactiva y Validación Manual

A continuación se detallan los 5 vectores interactivos de auditoría de seguridad implementados en la historia.

### Vector 1: Conexión Nominal TLS 1.3 / 1.2 y Verificación de Probes de Salud

**Propósito:** Confirmar que el contenedor establece el socket seguro exclusivamente bajo TLS 1.2 o superior con certificado CA verificado, respondiendo `200 OK` en sus sondas de salud.

**Procedimiento:**
1. Iniciar la aplicación con configuración SSL habilitada:
   ```bash
   DATABASE_SSL_ENABLED=true \
   DATABASE_SSL_MIN_VERSION=TLSv1.2 \
   DATABASE_SSL_CA="-----BEGIN CERTIFICATE-----\n..." \
   npm start
   ```
2. Consultar el probe de liveness:
   ```bash
   curl -i http://localhost:4000/health/live
   ```
   *Respuesta esperada:* `HTTP/1.1 200 OK` (`{"status":"UP"}`)
3. Consultar el probe de readiness con validación de socket a PostgreSQL:
   ```bash
   curl -i http://localhost:4000/health/ready
   ```
   *Respuesta esperada:* `HTTP/1.1 200 OK` con `checks.database: "UP"`.

---

### Vector 2: Intento de Degradación Criptográfica (*Anti-Downgrade Attack*) en Rotación CSI

**Propósito:** Verificar que si un atacante o un secreto corrupto en el Secrets Store CSI inyecta una cadena con `sslmode=disable`, `sslmode=no-verify` o `rejectUnauthorized: false`, el sistema:
1. Aborta la inicialización del pool candidato mediante `SecurityConfigurationError`.
2. Preserva el `activePool` previo intacto (*Fail-Safe Principle*).
3. Emite un evento de auditoría estructurado de fallo (`secret_rotation_failure`).

**Comprobación Automatizada en el Test Suite:**
```typescript
// Fragmento de test_database_tls_hardening.ts (Escenario 2)
it('Scenario 2: CSI runtime rotation anti-downgrade defense & audit event', async () => {
  // Inyección de credenciales con sslmode=disable
  const downgradeUri = 'postgresql://postgres:secret@localhost:5432/identity_db?sslmode=disable';
  await dpm.reloadCredentials({ connectionString: downgradeUri });

  // Invariante 1: El pool activo original permanece funcional
  const res = await dpm.query('SELECT 1 as alive');
  expect(res.rows[0].alive).toBe(1);

  // Invariante 2: Evento de auditoría emitido con el motivo del rechazo
  const auditEvents = auditLogger.getEvents();
  const failureEvent = auditEvents.find(e => e.eventType === 'secret_rotation_failure');
  expect(failureEvent).toBeDefined();
  expect(failureEvent?.metadata.reason).toContain('Insecure sslmode');
});
```

---

### Vector 3: Detección y Bloqueo Inmediato de Certificados MitM o Autofirmados

**Propósito:** Certificar que un certificado no firmado por la CA institucional confiable (ataque Man-in-the-Middle o certificado autofirmado no autorizado) es bloqueado inmediatamente en el apretón de manos TLS, degradando el readiness a `503 Service Unavailable` sin abortar el proceso (`liveness` permanece en `200 UP`).

**Comportamiento en Runtime:**
- Socket TLS emite: `Error: self-signed certificate` / `DEPTH_ZERO_SELF_SIGNED_CERT`.
- Probe `/health/live`: responde `200 OK` (el proceso no entra en CrashLoopBackOff).
- Probe `/health/ready`: responde `503 Service Unavailable`:
  ```json
  {
    "status": "DOWN",
    "checks": {
      "database": "DOWN"
    }
  }
  ```
- Kubernetes retira el Pod de los endpoints del `Service`, protegiendo el tráfico de los usuarios.

---

### Vector 4: Resolución de Certificado CA desde Volumen CSI Montado (`DATABASE_SSL_CA_PATH`)

**Propósito:** Validar que en entornos de producción Kubernetes, donde la autoridad certificadora se monta como un archivo en `/mnt/secrets-store/ca.crt` mediante el CSI Driver, el contenedor resuelve y lee el archivo de disco transparentemente.

**Configuración Verificada:**
```bash
# Variables de entorno inyectadas por templates/deployment.yaml
DATABASE_SSL_ENABLED="true"
DATABASE_SSL_MIN_VERSION="TLSv1.2"
DATABASE_SSL_CA_PATH="/mnt/secrets-store/ca.crt"
```

El servidor lee de forma síncrona el contenido PEM en el arranque (`fs.readFileSync(caPath, 'utf8')`), alimentando el parámetro `ca` de la fábrica `createSecurePostgresConfig`.

---

### Vector 5: Validación Preventiva en Helm de Protocolos Inseguros (JSON Schema)

**Propósito:** Demostrar que cualquier intento de configurar una versión vulnerable de TLS (TLS 1.0 o TLS 1.1) o tipos no booleanos en `values.yaml` es rechazado de inmediato en tiempo de linting o despliegue.

**Comprobación Interactiva con Helm:**
```bash
# Intento 1: Configurar protocolo obsoleto TLS 1.0 (debe fallar)
helm template deployments/helm/identity-service \
  --set database.ssl.minVersion="TLSv1.0"

# Salida esperada:
# Error: values don't meet the specifications of the schema(s) in the following chart(s):
# identity-service:
# - database.ssl.minVersion: database.ssl.minVersion must be one of the following: "TLSv1.2", "TLSv1.3"

# Intento 2: Inyectar valor no booleano (debe fallar)
helm template deployments/helm/identity-service \
  --set database.ssl.enabled="not-a-boolean"

# Salida esperada:
# - database.ssl.enabled: Invalid type. Expected: boolean, given: string
```

---

## 4. Matriz de Troubleshooting y Códigos de Error Criptográfico

| Código / Mensaje de Error | Origen del Fallo | Causa Raíz | Acción Correctiva Inmediata |
| :--- | :--- | :--- | :--- |
| `SecurityConfigurationError: Insecure sslmode 'no-verify' is prohibited` | `postgres_ssl_config.ts` | La cadena de conexión o las credenciales CSI intentan saltarse la validación CA. | Eliminar `sslmode=no-verify`, `disable`, `allow` o `prefer`. Configurar `sslmode=require` o `verify-full`. |
| `SecurityConfigurationError: Insecure rejectUnauthorized=false is strictly prohibited` | `postgres_ssl_config.ts` | Se configuró explícitamente `rejectUnauthorized: false` en `poolConfig.ssl`. | Forzar `rejectUnauthorized: true` o no definir el flag (por defecto es `true`). |
| `DEPTH_ZERO_SELF_SIGNED_CERT` | `tls.Socket` (Node.js) | El servidor de base de datos presenta un certificado autofirmado no registrado en el bundle CA. | Inyectar la CA raíz legítima en `DATABASE_SSL_CA` o montar el certificado en `DATABASE_SSL_CA_PATH`. |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | `tls.Socket` (Node.js) | Falta un certificado intermedio en la cadena de confianza presentada por PostgreSQL. | Asegurar que el servidor presente la cadena completa (*fullchain*) o que la CA intermedia esté en el almacén de confianza. |
| `ERR_TLS_CERT_ALTNAME_INVALID` | `tls.Socket` (Node.js) | El hostname de conexión (ej. `localhost`) no coincide con el Common Name (CN) o SAN del certificado. | Conectar utilizando el FQDN exacto del servidor (ej. `postgres.database.azure.com`). |
| `database.ssl.minVersion must be one of the following: "TLSv1.2", "TLSv1.3"` | Helm Linter / Engine | Se intentó desplegar el Chart con `minVersion` inferior a TLS 1.2. | Modificar `values.yaml` para usar `"TLSv1.2"` o `"TLSv1.3"`. |
