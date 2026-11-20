# 🛡️ Capítulo 07: Cumplimiento Regulatorio FinTech, Hardening & Resiliencia

Este capítulo documenta las capacidades avanzadas de seguridad en profundidad (*Defense-in-Depth*), resiliencia operativa y cumplimiento regulatorio estricto integradas en `identity-service`, alineadas con los estándares internacionales más rigurosos para la industria financiera y tecnológica:

- **PCI-DSS v4.0:** Requisitos 3 (Protección de datos del titular), 4 (Cifrado de transmisiones), 8 (Gestión de acceso e identidades) y 10 (Registro de auditoría y monitoreo).
- **SOC 2 Type II:** Criterios de Servicios de Confianza (Trust Services Criteria) para Seguridad (CC6.1 a CC6.8) y Disponibilidad (A1.1 a A1.3).
- **ISO/IEC 27001:2022:** Controles A.10 (Criptografía), A.12 (Seguridad operativa) y A.13 (Seguridad de las comunicaciones y redes).
- **NIST SP 800-53 Rev. 5:** Familias de control SC (Protección de sistemas y comunicaciones) y AU (Auditoría y rendición de cuentas).

---

## 📑 Resumen de Historias de Usuario (Epic 07)

| Historia de Usuario | Título & Alcance Técnico | Principales Componentes Involucrados | Normativa / Estándar |
| :--- | :--- | :--- | :--- |
| **US-16** | **Rotación de Secretos en Caliente sin Downtime** | `SecretWatcherService`, `DynamicPostgresPoolManager`, `RsaKeyAdapter` | PCI-DSS Req 3.6/3.7, SOC 2 CC6.1 |
| **US-17** | **Cifrado E2E en Tránsito & Anti-Downgrade SSL** | TLS 1.3/1.2 Mandatorio, `rejectUnauthorized: true`, Anti-Downgrade Guard | PCI-DSS Req 4.1, ISO 27001 A.10.1 |
| **US-18** | **Microsegmentación Zero-Trust con NetworkPolicies** | Calico/K8s CNI, Default Deny All, Egress Lockdown | ISO 27001 A.13.1, SOC 2 CC6.6 |
| **US-19** | **Auditoría Estructurada Inmutable WORM** | `AuditEventBuilder`, 12-Factor stdout NDJSON, Azure Log Analytics | PCI-DSS Req 10.2/10.3, SOC 2 CC6.8 |

---

## 🔑 US-16: Azure Key Vault CSI Driver Secret Rotation & In-Process Dynamic Reload

En infraestructuras financieras críticas, reiniciar los contenedores cada vez que se rota una credencial de base de datos o una clave criptográfica provoca micro-interrupciones, degradación de latencia y riesgo de saturación en el clúster. 

`identity-service` resuelve este reto implementando una **arquitectura de recarga dinámica en caliente dentro del propio proceso (In-Process Dynamic Reload)**, sincronizada automáticamente con el **Azure Key Vault Secrets Store CSI Driver** de Kubernetes.

### 🏛️ Pilares Arquitectónicos de US-16

#### 1. Observador de Secretos en Proceso (`SecretWatcherService`)
- **Monitoreo de Enlaces Simbólicos de Kubernetes:** Kubernetes actualiza los volúmenes montados por el CSI Driver de manera atómica, modificando el enlace simbólico `..data` para apuntar a un nuevo directorio con marca de tiempo (ej. `..2026_11_...`). `SecretWatcherService` supervisa `/mnt/secrets-store/` mediante `fs.watch`, reconociendo estos swaps atómicos de directorios en una sola pasada.
- **Debounce y Hashing Criptográfico SHA-256:** Para prevenir recargas espurias por eventos redundantes del sistema operativo, el servicio mantiene un mapa de hashes SHA-256 de los contenidos reales de los archivos. Si el contenido decodificado es idéntico al actual, la notificación es descartada silenciosamente.

#### 2. Gestor Dinámico de Conexiones PostgreSQL (`DynamicPostgresPoolManager`)
- **Arquitectura de Pools Generacionales ($N \to N+1$):** El gestor administra un pool activo (Generación $N$) y una lista de pools en retiro (*retiring pools*).
- **Pre-flight Healthcheck Mandatorio:** Cuando se detecta un cambio en `database-url`, el gestor crea un pool candidato (Generación $N+1$) y ejecuta una consulta de prueba estricta (`SELECT 1`).
- **Fail-Safe Inmutable:** Si el candidato falla (credenciales incorrectas, host inalcanzable o rechazo de autenticación), el swap es cancelado de inmediato, el pool activo $N$ se mantiene en producción sin alteraciones y las sondas `/health/ready` y `/health/live` continúan en estado saludable.
- **Intercambio Atómico de Puntero:** Si la comprobación es satisfactoria, el puntero del pool activo se actualiza atómicamente a la Generación $N+1$.
- **Graceful Draining sin Caída de Peticiones:** Las transacciones y queries que ya estaban en curso en la Generación $N$ finalizan sin ser interrumpidas; una vez agotadas las conexiones activas, el pool antiguo es cerrado limpiamente (`pool.end()`).

#### 3. Rotación Asimétrica de Claves de Firma JWT (`RsaKeyAdapter`)
- **Hot Key Rollover Asimétrico:** Cuando se rotan las claves RSA (`jwt-private.pem` y `jwt-public.pem`), el adaptador carga el nuevo par y actualiza su identificador de clave (`kid`).
- **Ventana de Gracia y JWKS Multi-Clave (RFC 7517):** Para evitar que tokens válidos en tránsito sean rechazados por otros microservicios, el endpoint público `/oauth2/jwks` publica simultáneamente la clave pública activa y la clave anterior durante el período de gracia configurado. Las nuevas firmas se generan con la clave nueva, mientras que la validación de tokens en vuelo se realiza contra la clave correspondiente mediante el encabezado `kid` del JWT.

---

### 🔄 Diagrama de Secuencia: Rotación de Secretos con Cero Tiempo de Inactividad (US-16)

```mermaid
sequenceDiagram
    autonumber
    actor SecAdmin as Administrador de Seguridad
    participant AKV as Azure Key Vault
    participant CSI as Secrets Store CSI Driver
    participant K8sVol as Volumen Montado (/mnt/secrets-store)
    participant Watcher as SecretWatcherService (In-Process)
    participant PoolMgr as DynamicPostgresPoolManager
    participant PG as PostgreSQL Flexible Server
    participant RSA as RsaKeyAdapter (JWKS Cache)

    SecAdmin->>AKV: 1. Actualiza credencial de base de datos o par de claves RSA
    AKV->>CSI: 2. Sincronización automática de secretos en clúster AKS
    CSI->>K8sVol: 3. Actualización atómica de symlink ..data
    Watcher->>K8sVol: 4. Detección de cambio en FS y verificación SHA-256
    Watcher->>PoolMgr: 5. Emisión de evento reloadCredentials(newCredentials)
    PoolMgr->>PG: 6. Pre-flight health check en candidato Gen N+1 (SELECT 1)
    PG-->>PoolMgr: 7. Validación exitosa de conectividad
    PoolMgr->>PoolMgr: 8. Swap atómico de puntero activo y graceful drain de Gen N
    Watcher->>RSA: 9. Emisión de evento reloadKeys(newKeyPair)
    RSA->>RSA: 10. Actualización de clave de firma y exposición dual en /oauth2/jwks
```

#### Glosario de Componentes US-16:
- **`Administrador de Seguridad`:** Ingeniero de operaciones o pipeline automatizado de rotación programada (ej. cada 90 días conforme a PCI-DSS Req 3.6).
- **`Azure Key Vault (AKV)`:** Almacén centralizado de secretos corporativos protegido por HSM dedicados y políticas de acceso RBAC.
- **`Secrets Store CSI Driver`:** Agente de Kubernetes que sondea periódicamente Azure Key Vault y monta los secretos como archivos en el pod.
- **`Volumen Montado (/mnt/secrets-store)`:** Sistema de archivos en memoria (`tmpfs`) donde residen los secretos, gestionado con enlaces simbólicos atómicos.
- **`SecretWatcherService (In-Process)`:** Módulo Node.js que supervisa los archivos sin dependencias de reinicio de procesos y filtra eventos duplicados.
- **`DynamicPostgresPoolManager`:** Adaptador de persistencia que desacopla la conexión física a base de datos de las operaciones de negocio, garantizando continuidad transaccional.
- **`PostgreSQL Flexible Server`:** Motor de base de datos relacional gestionado en Azure con autenticación forzada y TLS estricto.
- **`RsaKeyAdapter (JWKS Cache)`:** Proveedor criptográfico que administra el ciclo de vida de los pares de claves asimétricas RSA-2048 y emite el conjunto de claves públicas bajo RFC 7517.

---

### 🚀 Ejecución en Vivo & Verificación Interactiva Paso a Paso (`./bin/identity secrets`)

Las operaciones de rotación en caliente están protegidas por la gobernanza **Root Tenant (ADR-0009)**: únicamente un operador autenticado del inquilino `system` con rol `superadmin` puede invocar `/api/v1/secrets/*` (cualquier inquilino comercial recibe `HTTP 403 Forbidden` con auditoría `CROSS_TENANT_VIOLATION`).

#### Paso 0: Variables de Sesión y Aprovisionamiento del Operador Raíz (`${ROOT_TOKEN}`)

```bash
# ==============================================================================
# Variables de Sesión Interactiva para Rotación de Secretos en Caliente (US-16)
# ==============================================================================
export BASE_URL="http://localhost:4000"
export ROOT_EMAIL="secadmin.$(date +%s)@angelpixel.io"
export ROOT_PASS='SuperAdmin2026!'
export INVALID_DB_URL="postgresql://bad_user:wrong_pass@localhost:5432/identity_db"

REG_RESP=$(./bin/identity users create-root-admin \
  --email "${ROOT_EMAIL}" \
  --password "${ROOT_PASS}" \
  --raw-json)

export ROOT_TOKEN=$(echo "${REG_RESP}" | jq -r .accessToken)
export ROOT_USER_ID=$(echo "${REG_RESP}" | jq -r .userId)

echo "ROOT_USER_ID=${ROOT_USER_ID}"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
REG_RESP=$(curl -s -X POST "${BASE_URL}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: system" \
  -d "{
    \"email\": \"${ROOT_EMAIL}\",
    \"password\": \"${ROOT_PASS}\",
    \"roles\": [\"superadmin\", \"member\"]
  }")

export ROOT_TOKEN=$(echo "${REG_RESP}" | jq -r .accessToken)
export ROOT_USER_ID=$(echo "${REG_RESP}" | jq -r .userId)
```

</details>

---

#### Paso 1: Inspección de Línea Base (`./bin/identity secrets status`)

Consultamos la telemetría real del proceso antes de rotar (1 clave RSA en JWKS y pool PostgreSQL en Generación `1`):

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity secrets status --token "${ROOT_TOKEN}"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X GET "${BASE_URL}/api/v1/secrets/status" \
  -H "Authorization: Bearer ${ROOT_TOKEN}" | jq .
```

</details>

##### Respuesta Real Obtenida (HTTP 200 OK):

```json
{
  "status": "ACTIVE",
  "signingKeys": {
    "activeKeyId": "key-03b846e480b2",
    "retainedKeysCount": 0,
    "jwksKeysCount": 1,
    "exposedKids": ["key-03b846e480b2"],
    "jwksEndpoint": "/.well-known/jwks.json"
  },
  "databasePool": {
    "mode": "DYNAMIC_POSTGRES_POOL",
    "activeGeneration": 1,
    "retiringPoolsCount": 0,
    "totalConnections": 1,
    "idleConnections": 1,
    "waitingClients": 0
  }
}
```

---

#### Paso 2: Hot Key Rollover Asimétrico RSA-2048 & Ventana Dual JWKS (RFC 7517)

Disparamos la rotación real del par RSA-2048 en `RsaKeyAdapter` y verificamos inmediatamente el endpoint público `/.well-known/jwks.json`:

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity secrets rotate-signing-key --token "${ROOT_TOKEN}"

# Confirmar exposición simultánea de la clave nueva y la anterior en JWKS
./bin/identity oidc jwks --raw-json | jq '{keysCount: (.keys | length), kids: [.keys[].kid]}'
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X POST "${BASE_URL}/api/v1/secrets/rotate-signing-key" \
  -H "Authorization: Bearer ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

curl -s "${BASE_URL}/.well-known/jwks.json" | jq '{keysCount: (.keys | length), kids: [.keys[].kid]}'
```

</details>

##### Respuestas Reales Obtenidas (Rollover + Ventana Dual RFC 7517):

```json
{
  "status": "SUCCESS",
  "operation": "HOT_ASYMMETRIC_KEY_ROLLOVER",
  "previousKeyId": "key-03b846e480b2",
  "activeKeyId": "kid_rsa_1795145025060_2382f7",
  "retainedKeysCount": 1,
  "jwksKeysCount": 2,
  "exposedKids": [
    "kid_rsa_1795145025060_2382f7",
    "key-03b846e480b2"
  ],
  "gracePeriodMs": 900000,
  "compliance": {
    "pciRequirement": "10.2.6",
    "soc2Criteria": "CC6.1",
    "auditEventEmitted": "SECRET_ROTATION_SUCCESS"
  }
}
```

```json
{
  "keysCount": 2,
  "kids": [
    "kid_rsa_1795145025060_2382f7",
    "key-03b846e480b2"
  ]
}
```

---

#### Paso 3: Rotación Generacional de Credenciales PostgreSQL (Gen 1 → Gen 2)

Promovemos un nuevo pool candidato tras superar el pre-flight `SELECT 1`, ejecutando un *Atomic Pointer Swap* y drenado elegante de la generación previa:

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity secrets rotate-db-credentials --token "${ROOT_TOKEN}"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X POST "${BASE_URL}/api/v1/secrets/rotate-db-credentials" \
  -H "Authorization: Bearer ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

</details>

##### Respuesta Real Obtenida (HTTP 200 OK):

```json
{
  "status": "SUCCESS",
  "operation": "ZERO_DOWNTIME_DB_POOL_SWAP",
  "previousGeneration": 1,
  "activeGeneration": 2,
  "retiringPoolsCount": 1,
  "swapType": "ATOMIC_POINTER_SWAP",
  "compliance": {
    "pciRequirement": "10.2.6",
    "soc2Criteria": "CC6.1",
    "auditEventEmitted": "SECRET_ROTATION_SUCCESS"
  }
}
```

---

#### Paso 4: Demostración de Defensa Fail-Safe ante Credenciales Inválidas (HTTP 422)

Invocamos la **misma acción de dominio** pasando una URL PostgreSQL inválida (`${INVALID_DB_URL}`). El pre-flight `SELECT 1` rechaza el candidato, preserva intacta la Generación `2` y mantiene `/health/ready` en `200 UP`:

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity secrets rotate-db-credentials \
  --token "${ROOT_TOKEN}" \
  --database-url "${INVALID_DB_URL}"

# Verificar continuidad total de servicio en /health/ready
curl -s "${BASE_URL}/health/ready" | jq .
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X POST "${BASE_URL}/api/v1/secrets/rotate-db-credentials" \
  -H "Authorization: Bearer ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"databaseUrl\": \"${INVALID_DB_URL}\"}" | jq .

curl -s "${BASE_URL}/health/ready" | jq .
```

</details>

##### Respuesta Real Obtenida (HTTP 422 Unprocessable Entity — Fail-Safe Preservado):

```json
{
  "status": "FAILED_SAFE",
  "operation": "ZERO_DOWNTIME_DB_POOL_SWAP",
  "failSafePreserved": true,
  "activeGeneration": 2,
  "error": "Pre-flight check failed; active pool Generation 2 preserved without downtime",
  "compliance": {
    "pciRequirement": "10.2.6",
    "soc2Criteria": "CC6.1",
    "auditEventEmitted": "SECRET_ROTATION_FAILURE"
  }
}
```

```json
{
  "status": "UP",
  "checks": {
    "database": "OK",
    "cache": "OK"
  }
}
```

---

#### Paso 5: Teardown y Limpieza del Operador Temporal

```bash
./bin/identity users delete \
  --tenant system \
  --token "${ROOT_TOKEN}" \
  --user-id "${ROOT_USER_ID}"
```

---

### 🧪 Verificación Automatizada: Suites de Pruebas de Integración E2E (US-16)

La resiliencia de la recarga dinámica, la gobernanza Root Tenant en `/api/v1/secrets/*` y la ausencia total de caídas en peticiones se certifican mediante las suites de integración E2E dedicadas:

```bash
npx jest tests/integration/identity/security/test_zero_downtime_secret_rotation.ts tests/integration/identity/security/test_secrets_rotation_api.ts
```

##### Salida Real de Verificación Automatizada (4/4 Escenarios Aprobados):
```text
PASS tests/integration/identity/security/test_zero_downtime_secret_rotation.ts
  Integration E2E: Zero-Downtime Secret Rotation & CSI Driver Synchronization (US-16)
    Scenario 1: In-Flight Database Credential Swap (Zero-Downtime)
      ✓ should dynamically swap database pools without dropping queries when database-url rotates (159 ms)
      ✓ should fail-safe: preserve active pool and keep /health/ready UP when candidate credentials fail pre-swap check (133 ms)
    Scenario 2: Hot Asymmetric Key Rollover via CSI Volume Mount
      ✓ should seamlessly verify tokens in flight during key rollover and expose both keys in JWKS (171 ms)
    Scenario 3: Kubernetes Symlink Swap Synchronization (..data)
      ✓ should detect atomic symlink directory swap and update all mounted secrets in a single pass (113 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        3.142 s
Ran all test suites matching tests/integration/identity/security/test_zero_downtime_secret_rotation.ts.
```

---

## 🔒 US-17: Database Encryption In-Flight (TLS 1.3/1.2) & Anti-Downgrade Defense

En la industria de tecnología financiera (FinTech), el cifrado en tránsito no es opcional ni puede depender de configuraciones permisivas. El estándar **PCI-DSS v4.0 (Req 4.1)** y **SOC 2 (CC6.7)** prohíben explícitamente el uso de suites criptográficas obsoletas (SSLv3, TLS 1.0, TLS 1.1) y exigen autenticación mutua o verificación estricta de la cadena de confianza de la Autoridad Certificadora (CA).

`identity-service` implementa un blindaje integral para las conexiones hacia **Azure Database for PostgreSQL Flexible Server** y **Redis**, combinando verificación estricta de certificados, carga dinámica de certificados CA desde volúmenes CSI y una defensa activa contra ataques de degradación (*Anti-Downgrade SSL Guard*).

### 🏛️ Pilares Arquitectónicos de US-17

#### 1. Forzado Mandatorio de TLS 1.2+ y Carga Dinámica de CA
- **Cifrado E2E Obligatorio:** Toda conexión cliente administrada por `DynamicPostgresPoolManager` se inicializa con TLS 1.2 como versión mínima permitida (`DATABASE_SSL_MIN_VERSION: TLSv1.2` o `TLSv1.3`), rechazando cualquier intento de negociación bajo protocolos obsoletos.
- **Resolución de CA Root desde Volumen CSI (`DATABASE_SSL_CA_PATH`):** El certificado público de la CA de Azure (`ca.crt`) no se almacena en el código ni en la imagen del contenedor; se monta dinámicamente en `/mnt/secrets-store/ca.crt` mediante el CSI Driver. El servicio resuelve este archivo en tiempo de ejecución para validar criptográficamente la identidad del servidor de base de datos.

#### 2. Rechazo Determinista de MitM (`rejectUnauthorized: true`)
- **Bloqueo Incondicional de Certificados Inválidos:** Se prohíbe el uso de banderas permisivas como `rejectUnauthorized: false` o modos `sslmode=no-verify`. Si el servidor remoto presenta un certificado autofirmado desconocido, expirado o con nombres de dominio (SAN) no coincidentes, el handshake falla inmediatamente.
- **Aislamiento Seguro en Probes de Diagnóstico:** Ante un fallo de validación de certificados, el gestor de base de datos reporta el error a las sondas de salud. La sonda `/health/ready` responde de inmediato con `HTTP 503 Service Unavailable`, evitando que Kubernetes envíe tráfico de usuarios hacia un pod con conectividad degradada, mientras que `/health/live` se mantiene en `HTTP 200 OK` para prevenir reinicios destructivos en bucle (*crashloops*).

#### 3. Defensa Activa en Caliente (*Runtime Anti-Downgrade SSL Guard*)
- **Interceptación de Parámetros Maliciosos durante Rotaciones:** Si durante una rotación automática o manual de secretos CSI el archivo de configuración es alterado para incluir parámetros inseguros (ej. `sslmode=disable`, `ssl=false` o certificados alterados), el mecanismo *Anti-Downgrade SSL Guard* intercepta la operación en memoria.
- **Fail-Safe & Emisión de Alerta de Seguridad:** La recarga del nuevo pool es rechazada de inmediato, el pool seguro activo previo permanece intacto atendiendo transacciones cifradas y el sistema emite un evento de auditoría de seguridad clasificado como `SECURITY_VIOLATION` hacia las bitácoras estructuradas.

---

### 🔄 Diagrama de Secuencia: Validación TLS & Protección Anti-Downgrade (US-17)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente / Transacción API
    participant App as Aplicación (Server HTTP)
    participant PoolMgr as DynamicPostgresPoolManager
    participant SSLGuard as Anti-Downgrade SSL Guard
    participant PG as PostgreSQL Flexible Server (TLS 1.2+)
    participant Audit as Logger de Auditoría NDJSON

    Client->>App: 1. Petición que requiere persistencia segura
    App->>PoolMgr: 2. Solicitud de conexión cliente del pool
    PoolMgr->>SSLGuard: 3. Validación de opciones SSL (rejectUnauthorized: true, TLS >= 1.2)
    alt Handshake Seguro con CA Válido
        SSLGuard->>PG: 4. Establecimiento de túnel TLS con verificación de CA (/mnt/secrets-store/ca.crt)
        PG-->>PoolMgr: 5. Handshake completado exitosamente (Cifrado Activo)
        PoolMgr-->>App: 6. Conexión entregada; ejecución de transacción cifrada
        App-->>Client: 7. Respuesta exitosa 200 OK con datos protegidos
    else Intento de Rotación Insegura (sslmode=disable / MitM)
        SSLGuard->>SSLGuard: 4. Detección de degradación criptográfica o certificado no confiable
        SSLGuard->>Audit: 5. Emisión de alerta de seguridad crítica (SECURITY_VIOLATION)
        SSLGuard-->>PoolMgr: 6. Rechazo de inicialización y preservación del pool seguro anterior
        PoolMgr-->>App: 7. Sonda /health/ready reporta 503 DOWN para proteger el tráfico
    end
```

#### Glosario de Componentes US-17:
- **`Cliente / Transacción API`:** Usuario o aplicación externa ejecutando una operación autenticada (ej. registro, login o emisión de tokens).
- **`Aplicación (Server HTTP)`:** Instancia de `identity-service` que atiende peticiones en el puerto `:4000`.
- **`DynamicPostgresPoolManager`:** Administrador generacional de pools de conexión PostgreSQL con soporte estricto de SSL.
- **`Anti-Downgrade SSL Guard`:** Componente de defensa perimetral en memoria que valida las opciones criptográficas antes de cualquier operación de red.
- **`PostgreSQL Flexible Server (TLS 1.2+)`:** Instancia de base de datos en Azure configurada con `ssl_enforcement_enabled = true` y `ssl_minimal_tls_version_enforced = TLSv1.2`.
- **`Logger de Auditoría NDJSON`:** Módulo emisor de eventos de seguridad que envía trazas enriquecidas con severidad `CRITICAL` hacia stdout.

---

### 🚀 Ejecución en Vivo & Verificación Interactiva Paso a Paso (`./bin/identity secrets`)

Para comprobar el **Anti-Downgrade SSL Guard** en tiempo de ejecución reutilizamos las acciones de dominio de `./bin/identity secrets` introducidas en **US-16**: no existen comandos artificiales de prueba, sino que pasar parámetros de conexión degradados (`?sslmode=no-verify`, `?sslmode=prefer`, `?sslmode=disable`) dispara de forma natural la defensa perimetral PCI-DSS 4.1 / SOC 2 CC6.7.

#### Paso 0: Variables de Sesión para Vectores de Downgrade SSL

> [!TIP]
> Si ya ejecutaste el **Paso 0 de US-16** en esta misma sesión de terminal (sin haber borrado aún al operador raíz), `${BASE_URL}` y `${ROOT_TOKEN}` ya se encuentran cargadas. Si abres una nueva terminal, vuelve a generar `${ROOT_TOKEN}` con `./bin/identity users create-root-admin`.

```bash
# ==============================================================================
# Variables de Sesión Interactiva para Anti-Downgrade SSL Guard (US-17)
# ==============================================================================
export BASE_URL="http://localhost:4000"
export DOWNGRADE_NO_VERIFY_URL="postgresql://postgres:postgres@localhost:5432/identity_db?sslmode=no-verify"
export DOWNGRADE_PREFER_URL="postgresql://postgres:postgres@localhost:5432/identity_db?sslmode=prefer"
```

---

#### Paso 1: Inspección de la Postura TLS Activa del Pool (`./bin/identity secrets status`)

Consultamos la telemetría criptográfica del pool PostgreSQL para confirmar las políticas `minVersion` y `rejectUnauthorized`:

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity secrets status --token "${ROOT_TOKEN}" --raw-json | jq '.databasePool'
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X GET "${BASE_URL}/api/v1/secrets/status" \
  -H "Authorization: Bearer ${ROOT_TOKEN}" | jq '.databasePool'
```

</details>

##### Respuesta Real Obtenida (HTTP 200 OK):

```json
{
  "mode": "DYNAMIC_POSTGRES_POOL",
  "activeGeneration": 1,
  "retiringPoolsCount": 0,
  "totalConnections": 2,
  "idleConnections": 2,
  "waitingClients": 0,
  "ssl": {
    "enabled": true,
    "minVersion": "TLSv1.2",
    "rejectUnauthorized": true,
    "caConfigured": true
  }
}
```

---

#### Paso 2: Bloqueo Anti-Downgrade ante `?sslmode=no-verify` (HTTP 422 `BLOCKED_ANTI_DOWNGRADE`)

Intentamos rotar las credenciales de base de datos con una cadena que omite la verificación criptográfica del certificado CA (`sslmode=no-verify`):

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity secrets rotate-db-credentials \
  --token "${ROOT_TOKEN}" \
  --database-url "${DOWNGRADE_NO_VERIFY_URL}"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X POST "${BASE_URL}/api/v1/secrets/rotate-db-credentials" \
  -H "Authorization: Bearer ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"databaseUrl\": \"${DOWNGRADE_NO_VERIFY_URL}\"}" | jq .
```

</details>

##### Respuesta de Defensa Obtenida (HTTP 422 — `BLOCKED_ANTI_DOWNGRADE`):

```json
{
  "status": "BLOCKED_ANTI_DOWNGRADE",
  "operation": "ZERO_DOWNTIME_DB_POOL_SWAP",
  "failSafePreserved": true,
  "activeGeneration": 1,
  "reason": "SSL_DOWNGRADE_BLOCKED",
  "error": "Anti-Downgrade SSL Guard blocked insecure candidate; active pool Generation 1 preserved without downtime: Insecure sslmode 'no-verify' is forbidden. Encrypted transport must enforce full certificate verification.",
  "compliance": {
    "pciRequirement": "4.1",
    "soc2Criteria": "CC6.7",
    "auditEventEmitted": "SECRET_ROTATION_FAILURE"
  }
}
```

---

#### Paso 3: Bloqueo ante `?sslmode=prefer` & Verificación de Continuidad (`/health/ready`)

Repetimos el vector con `sslmode=prefer` (modo oportunista prohibido bajo PCI-DSS 4.1) y confirmamos que el pool seguro activo sigue atendiendo peticiones sin interrupción:

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity secrets rotate-db-credentials \
  --token "${ROOT_TOKEN}" \
  --database-url "${DOWNGRADE_PREFER_URL}"

# Confirmar continuidad total de servicio en /health/ready
curl -s "${BASE_URL}/health/ready" | jq .
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X POST "${BASE_URL}/api/v1/secrets/rotate-db-credentials" \
  -H "Authorization: Bearer ${ROOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"databaseUrl\": \"${DOWNGRADE_PREFER_URL}\"}" | jq .

curl -s "${BASE_URL}/health/ready" | jq .
```

</details>

##### Continuidad Confirmada (`/health/ready` — HTTP 200 OK):

```json
{
  "status": "UP",
  "checks": {
    "database": "OK",
    "cache": "OK"
  }
}
```

---

### 🧪 Verificación Automatizada: Suites de Cifrado y Hardening (US-17)

La efectividad de la protección TLS, la postura reportada por `/api/v1/secrets/status` y la defensa anti-downgrade se validan mediante las suites unitarias y de integración dedicadas:

```bash
npx jest tests/unit/identity/infrastructure/database/test_postgres_ssl_config.ts tests/integration/identity/security/test_database_tls_hardening.ts tests/integration/identity/security/test_secrets_rotation_api.ts
```

##### Salida Real de Verificación Automatizada (6/6 Escenarios Aprobados):
```text
PASS tests/integration/identity/security/test_database_tls_hardening.ts
  Integration E2E: Database Encryption In-Flight TLS & Hardening (US-17)
    Scenario 1: Full In-Flight TLS 1.2+ Enforcement with CA Certificate Validation
      ✓ should initialize dynamic pool with strict TLS 1.2+ and valid CA, serving /health probes with 200 OK (51 ms)
      ✓ should resolve SSL configuration from environment variables (DATABASE_SSL_*) on bootstrap (22 ms)
    Scenario 2: Runtime Anti-Downgrade Defense during CSI Secret Rotation
      ✓ should block downgrade attack when CSI secret rotates to sslmode=no-verify and emit security audit event (165 ms)
    Scenario 3: Deterministic Rejection of Untrusted / MitM Certificates
      ✓ should reject untrusted server certificates, returning 503 on readiness and 200 on liveness (84 ms)
    Scenario 4: CA Certificate Resolution from Mounted CSI Volume File (DATABASE_SSL_CA_PATH)
      ✓ should read CA certificate file from DATABASE_SSL_CA_PATH and bind it to pool configuration (47 ms)
      ✓ should bootstrap server directly with DATABASE_SSL_CA_PATH environment variable (39 ms)

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        2.136 s
Ran all test suites matching tests/integration/identity/security/test_database_tls_hardening.ts.
```

---

## 🌐 US-18: Kubernetes Zero-Trust NetworkPolicies & Micro-Segmentation

En entornos de servicios financieros y banca digital, asumir que el perímetro interno del clúster es seguro constituye una vulnerabilidad crítica. Si un contenedor auxiliar o de otra aplicación fuese comprometido, la ausencia de segmentación permitiría a un atacante realizar escaneos laterales, interceptar tráfico o exfiltrar datos.

Para neutralizar este vector, `identity-service` implementa una arquitectura **Zero-Trust nativa en Kubernetes** mediante `NetworkPolicies` orquestadas por el motor CNI (Calico / Azure CNI), certificada bajo los estándares **ISO/IEC 27001:2022 (Control A.13.1 - Seguridad de Redes)** y **SOC 2 Type II (Criterio CC6.6 - Microsegmentación de Límites Lógicos)**.

### 🏛️ Pilares Arquitectónicos de US-18

#### 1. Política Incondicional `default-deny-all`
- **Aislamiento Total por Defecto:** En `deployments/helm/identity-service/templates/networkpolicy.yaml`, el manifiesto `identity-service-default-deny-all` aplica un selector vacío (`podSelector: {}`) afectando a todo el namespace con `policyTypes: [Ingress, Egress]`.
- **Cero Suposición de Confianza:** Cualquier intento de comunicación que no esté explícitamente listado en una regla posterior es descartado silenciosamente por el kernel a nivel de eBPF / iptables.

#### 2. Whitelist Estricta de Tráfico Entrante (Ingress)
- **Acceso Exclusivo desde el Controlador de Ingress:** El tráfico entrante se autoriza únicamente hacia el puerto `:4000` (puerto de servicio HTTP) y se filtra doblemente:
  1. `namespaceSelector`: Debe originarse en el namespace del controlador (`ingress-nginx`).
  2. `podSelector`: Debe provenir de pods con la etiqueta del controlador oficial (`app.kubernetes.io/name: ingress-nginx`).
- **Inmunidad ante Movimiento Lateral:** Ningún otro microservicio dentro del clúster (incluso dentro del mismo namespace) puede alcanzar directamente el puerto HTTP de `identity-service`.

#### 3. Lockdown Estricto de Tráfico Saliente (Egress)
- **Microsegmentación por Puerto y Destino:** La política de salida restringe estrictamente los destinos autorizados a los requerimientos esenciales del servicio:
  - **Resolución de Nombres DNS:** Tráfico UDP y TCP en puerto `:53` restringido exclusivamente al namespace `kube-system` con destino a los pods de `CoreDNS` (`kube-dns`).
  - **Base de Datos PostgreSQL:** Tráfico TCP en puerto `:5432` hacia la instancia administrada de Azure Database for PostgreSQL Flexible Server.
  - **Caché Distribuida Redis:** Tráfico TCP en puerto `:6379` hacia Azure Cache for Redis.
  - **Salida HTTPS Cifrada:** Tráfico TCP en puerto `:443` hacia Azure Key Vault y los endpoints de federación OAuth2/OIDC externos (Google Identity y Microsoft Entra ID).
  - **Servicio de Metadatos Azure IMDS / CSI:** Tráfico TCP en puertos `:4577` y `:4578` para la sincronización de credenciales del Secrets Store CSI Driver.
  - **Bloqueo de Exfiltración:** Todo intento de conexión hacia puertos no estándar, rangos de IP arbitrarios o internet abierto no catalogado es bloqueado de inmediato.

---

### 🔄 Diagrama de Secuencia: Filtrado Perimetral Zero-Trust (US-18)

```mermaid
sequenceDiagram
    autonumber
    actor Attacker as Pod Comprometido en Clúster
    actor Nginx as Ingress NGINX (Namespace ingress-nginx)
    participant CNI as Kubernetes CNI / NetworkPolicy Engine
    participant Pod as Pod identity-service (:4000)
    participant CoreDNS as CoreDNS (kube-system :53)
    participant PG as PostgreSQL Flexible Server (:5432)
    participant RogueExt as Servidor Malicioso en Internet

    Nginx->>CNI: 1. Petición HTTPS entrante reenviada a puerto :4000
    CNI->>CNI: 2. Validación de regla Ingress (namespace y pod match)
    CNI->>Pod: 3. Tráfico permitido y entregado a identity-service
    Pod->>CNI: 4. Consulta DNS de host de base de datos
    CNI->>CoreDNS: 5. Egress permitido hacia kube-system:53
    CoreDNS-->>Pod: 6. Resolución IP exitosa
    Pod->>CNI: 7. Conexión TCP cifrada a base de datos
    CNI->>PG: 8. Egress permitido hacia puerto :5432
    Attacker--xCNI: 9. Intento de escaneo lateral o exploit directo a :4000
    CNI--xAttacker: 10. BLOQUEADO (Violación de Default-Deny-All)
    Pod--xCNI: 11. Intento hipotético de exfiltración hacia IP externa no autorizada
    CNI--xRogueExt: 12. BLOQUEADO (Egress no autorizado rechazado a nivel de kernel)
```

#### Glosario de Componentes US-18:
- **`Ingress NGINX (ingress-nginx)`:** Único punto de entrada autorizado al clúster, responsable de la terminación TLS y reenrutamiento seguro.
- **`Kubernetes CNI / NetworkPolicy Engine`:** Motor de red subyacente (ej. Calico o Azure CNI) que hace cumplir las reglas de filtrado perimetral en cada nodo de cómputo.
- **`Pod identity-service (:4000)`:** Instancia de la aplicación protegida en su espacio de red local.
- **`CoreDNS (kube-system :53)`:** Servicio de resolución de nombres autorizado dentro del clúster.
- **`PostgreSQL Flexible Server (:5432)`:** Base de datos relacional autorizada para persistencia.
- **`Pod Comprometido en Clúster`:** Simulación de una amenaza interna que intenta realizar escaneo lateral o ataques directos a otros contenedores.
- **`Servidor Malicioso en Internet`:** Destino externo no autorizado utilizado para evaluar la prevención de fuga de datos (*data exfiltration*).

---

### 🧪 Verificación Automatizada: Auditoría de NetworkPolicies en Helm

La sintaxis, el renderizado de plantillas y las restricciones estrictas del esquema JSON para NetworkPolicies se auditan mediante la suite de empaquetado:

```bash
npm run test:helm
```

##### Salida Real de Verificación de NetworkPolicies (Auditoría Aprobada):
```text
=== [3/6] Renderizando Plantillas Kubernetes (helm template) ===
...
✓ Manifiesto NetworkPolicy renderizado correctamente.

=== [4/6] Auditando Invariantes de Orquestación, Probes, CSI y Seguridad ===
...
✓ NetworkPolicies Zero-Trust (default-deny-all, Ingress :4000 desde ingress-nginx y Egress :53, :5432, :6379, :443, :4577/:4578) verificadas.

=== [6/6] Verificando Rechazo Estricto de Casos Negativos (values.schema.json) ===
...
Probando caso negativo: networkPolicy.enabled tipo no booleano...
✓ Caso negativo validado (falló según lo esperado): networkPolicy.enabled tipo no booleano.
Probando caso negativo: networkPolicy.ingress.port fuera de rango IANA (> 65535)...
✓ Caso negativo validado (falló según lo esperado): networkPolicy.ingress.port fuera de rango IANA (> 65535).
```

---

## 📋 US-19: Structured Security Audit Logging & Immutable WORM Analytics

En organizaciones financieras reguladas, los registros de auditoría no sólo deben existir, sino que deben ser inmutables, estructurados de forma estricta y estar protegidos contra cualquier manipulación interna o externa. El estándar **PCI-DSS v4.0 (Requisitos 10.2 y 10.3)** y **SOC 2 Type II (Criterio CC6.8)** exigen registrar todo intento de acceso a datos sensibles, cambios de privilegios, fallos de autenticación e incidentes de seguridad con marcas de tiempo atómicas y almacenamiento no modificable (*Write Once, Read Many* o WORM).

`identity-service` implementa una arquitectura integral de auditoría de seguridad basada en el principio **12-Factor App (Logs como flujos continuos)**, combinando emisión estructurada en NDJSON hacia `stdout`, sanitización criptográfica preventiva y recolección automatizada hacia **Azure Log Analytics Workspace** con retención inmutable de 365 días.

### 🏛️ Pilares Arquitectónicos de US-19

#### 1. Registro Basado en el Manifiesto 12-Factor (stdout NDJSON)
- **Flujo de Eventos Desacoplado:** La aplicación no escribe bitácoras en archivos locales del pod ni interactúa sincrónicamente con bases de datos remotas de logging. Cada evento de seguridad se emite como una línea individual de texto JSON (**Newline Delimited JSON o NDJSON**) directamente a la salida estándar (`process.stdout`).
- **Arquitectura Fail-Safe y No Bloqueante:** Implementada en `ConsoleSecurityAuditLogger`, la escritura en el stream de salida intercepta y neutraliza cualquier error de I/O (ej. `EPIPE` por rotación de descriptores de archivo) sin arrojar excepciones no controladas. Esto garantiza de forma absoluta que un fallo transitorio en la infraestructura de observabilidad jamás degrade o aborte una transacción de negocio activa.
- **Sanitización y Redacción Criptográfica Preventiva:** Antes de la serialización del evento, un filtro de ofuscación analiza recursivamente todas las propiedades del payload. Cualquier campo clasificado como secreto (`password`, `client_secret`, `token`, `authorization`, `private_key` o credenciales bancarias) es redactado de forma irreversible reemplazándolo por `[REDACTED]`.

#### 2. Constructor Estructurado de Eventos (`AuditEventBuilder`)
- **Esquema de Seguridad Enriquecido:** Todo evento generado a través del dominio o la capa de aplicación implementa el siguiente esquema normalizado:
  - `eventId`: Identificador único UUIDv4 para correlación y deduplicación en sistemas SIEM.
  - `timestamp`: Marca temporal en UTC con precisión de milisegundos bajo formato estándar ISO-8601.
  - `eventType`: Tipología estandarizada del evento (ej. `CROSS_TENANT_ACCESS_ATTEMPT`, `TOKEN_ISSUED`, `CREDENTIAL_ROTATION`, `M2M_AUTH_FAILURE`).
  - `severity`: Clasificación de riesgo operacional (`INFO`, `WARN`, `ALERT`, `CRITICAL`).
  - `tenantId` & `actor`: Identificación unívoca del espacio de tenencia y del sujeto ejecutor (usuario final, cliente M2M o subsistema interno).
  - `complianceTags`: Etiquetas declarativas para auditoría regulatoria (ej. `["PCI-DSS-10.2", "SOC2-CC6.8"]`).
  - `trace`: Contexto distribuido según la especificación W3C Trace Context (`traceId`, `spanId`), permitiendo correlacionar el evento de auditoría con las trazas distribuidas de OpenTelemetry.

#### 3. Ingesta y Retención Inmutable WORM en Azure Log Analytics
- **Recolección Automatizada en Clúster:** Agentes dedicados en AKS (Container Insights / Fluent Bit) consumen el stream de `stdout` de los contenedores sin introducir latencia en el proceso de la aplicación.
- **Almacenamiento WORM (365 Días):** Los eventos se persisten en una tabla dedicada dentro del espacio de trabajo de Azure Log Analytics (`IdentitySecurityAudit_CL`), configurada con una política inmutable de retención de 365 días. Bajo este modelo WORM (*Write Once, Read Many*), los registros no pueden ser alterados ni purgados prematuramente, satisfaciendo los requerimientos de auditoría forense financiera.

---

### 🔄 Diagrama de Secuencia: Pipeline de Auditoría de Seguridad Inmutable (US-19)

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuario / Atacante
    participant Gateway as Ingress & Controller HTTP
    participant Builder as AuditEventBuilder
    participant Logger as ConsoleSecurityAuditLogger (stdout)
    participant Daemon as Container Insights (DaemonSet)
    participant LogAnalytics as Azure Log Analytics Workspace
    participant SIEM as Microsoft Sentinel / SOC SIEM

    User->>Gateway: 1. Intento de acceso cross-tenant o autenticación anómala
    Gateway->>Builder: 2. Detección de incidente de seguridad y generación de evento
    Builder->>Builder: 3. Sanitización y redacción criptográfica de secretos
    Builder->>Logger: 4. Emisión de NDJSON estructurado con tags PCI/SOC2
    Logger->>Logger: 5. Escritura no bloqueante (fail-safe) a stdout
    Daemon->>Logger: 6. Recolección de trazas NDJSON desde el stream del pod
    Daemon->>LogAnalytics: 7. Ingesta cifrada vía Azure Monitor Ingestion API
    LogAnalytics->>LogAnalytics: 8. Persistencia WORM inmutable con retención de 365 días
    LogAnalytics->>SIEM: 9. Alerta en tiempo real al equipo SOC / Monitoreo FinTech
```

#### Glosario de Componentes US-19:
- **`Usuario / Atacante`:** Origen de la petición evaluada por los filtros de seguridad de `identity-service`.
- **`Ingress & Controller HTTP`:** Capa de enrutamiento y middlewares de seguridad (Rate Limiting, Tenant Context, Auth).
- **`AuditEventBuilder`:** Clase de dominio encargada de ensamblar y normalizar el payload del evento de auditoría con metadatos contextuales y regulatorios.
- **`ConsoleSecurityAuditLogger (stdout)`:** Adaptador de infraestructura que realiza la sanitización criptográfica y escribe en `process.stdout` de forma no bloqueante.
- **`Container Insights (DaemonSet)`:** Agente recolector desplegado en cada nodo del clúster AKS que recopila flujos de salida estándar de los contenedores.
- **`Azure Log Analytics Workspace`:** Repositorio centralizado en la nube con cifrado en reposo mediante claves administradas por el cliente (CMK) y retención WORM de 365 días.
- **`Microsoft Sentinel / SOC SIEM`:** Plataforma de seguridad que analiza las bitácoras en tiempo real y dispara incidentes automáticos ante eventos con severidad `ALERT` o `CRITICAL`.

---

### 🧪 Verificación Automatizada: Suite de Pruebas de Auditoría E2E (US-19)

La precisión del esquema de auditoría, la redacción obligatoria de secretos y la propagación de contexto W3C se certifican mediante la siguiente suite de integración:

```bash
npx jest tests/integration/identity/security/test_structured_audit_logging.ts
```

##### Salida Real de Verificación Automatizada (4/4 Escenarios Aprobados):
```text
PASS tests/integration/identity/security/test_structured_audit_logging.ts
  Integration E2E: Structured Security Audit Logging & NDJSON Ingestion (US-19)
    Scenario 1 (BDD 1): Cross-Tenant Access Violation Detection
      ✓ should abort with 403 Forbidden and emit an ALERT NDJSON audit log when tenant mismatch is detected (107 ms)
    Scenario 2 (BDD 2): M2M Authentication & Strict Credential Redaction
      ✓ should reject invalid client credentials and ensure secrets are redacted in audit output (49 ms)
    Scenario 3: Correlation & Request ID Header Forwarding
      ✓ should preserve and forward client-supplied correlation headers into trace object (66 ms)
    Scenario 4: Runtime Server Wiring Default Resolution
      ✓ should instantiate ConsoleSecurityAuditLogger by default when in production environment (98 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
Snapshots:   0 total
Time:        2.072 s
Ran all test suites matching tests/integration/identity/security/test_structured_audit_logging.ts.
```

---

[⬅️ Volver al Hub Principal de Showcase](./README.md)
