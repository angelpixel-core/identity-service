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

    SecAdmin->>AKV: Actualiza credencial de base de datos o par de claves RSA
    AKV->>CSI: Sincronización automática de secretos en clúster AKS
    CSI->>K8sVol: Actualización atómica de symlink ..data
    Watcher->>K8sVol: Detección de cambio en FS y verificación SHA-256
    Watcher->>PoolMgr: Emisión de evento reloadCredentials(newCredentials)
    PoolMgr->>PG: Pre-flight health check en candidato Gen N+1 (SELECT 1)
    PG-->>PoolMgr: Validación exitosa de conectividad
    PoolMgr->>PoolMgr: Swap atómico de puntero activo y graceful drain de Gen N
    Watcher->>RSA: Emisión de evento reloadKeys(newKeyPair)
    RSA->>RSA: Actualización de clave de firma y exposición dual en /oauth2/jwks
```

#### A. Glosario de Actores y Componentes (Cajas del Diagrama)

| Participante / Caja | Tipo | Rol Arquitectónico y Frontera de Seguridad |
| :--- | :--- | :--- |
| **`SecAdmin` (Administrador de Seguridad)** | `actor` | Operador de seguridad (`system:superadmin`) o pipeline programado de rotación periódica (ej. cada 90 días conforme a PCI-DSS Req 3.6). |
| **`AKV` (Azure Key Vault)** | `participant` | Bóveda criptográfica corporativa respaldada por HSM y políticas RBAC donde residen `database-url` y los pares RSA-2048. |
| **`CSI` (Secrets Store CSI Driver)** | `participant` | Agente nativo de Kubernetes que sondea Azure Key Vault (`rotationPollInterval: 2m`) y proyecta los secretos dentro del pod. |
| **`K8sVol` (`/mnt/secrets-store`)** | `participant` | Volumen efímero en memoria (`tmpfs`) administrado por Kubernetes mediante enlaces simbólicos atómicos (`..data`). |
| **`Watcher` (`SecretWatcherService`)** | `participant` | Observador Node.js en proceso (`fs.watch`) que aplica debounce y valida cambios reales mediante digest SHA-256 antes de notificar. |
| **`PoolMgr` (`DynamicPostgresPoolManager`)** | `participant` | Gestor generacional ($N \to N+1$) de conexiones PostgreSQL que ejecuta pre-flight `SELECT 1`, swap atómico y drenado elegante sin caídas. |
| **`PG` (PostgreSQL Flexible Server)** | `participant` | Base de datos relacional administrada en Azure que valida las credenciales candidatas sobre transporte TLS estricto. |
| **`RSA` (`RsaKeyAdapter` — JWKS Cache)** | `participant` | Proveedor criptográfico asimétrico que activa la nueva clave de firma (`kid`) y mantiene la clave previa en ventana de gracia RFC 7517. |

#### B. Desglose Secuencial del Flujo (Pasos 1 al 10)

1. **Paso 1 (`SecAdmin -> AKV`):** El administrador de seguridad o el job de rotación actualiza la credencial `database-url` o genera un nuevo par de claves RSA en Azure Key Vault.
2. **Paso 2 (`AKV -> CSI`):** El Secrets Store CSI Driver detecta la nueva versión del secreto en su ciclo de sondeo en el clúster AKS.
3. **Paso 3 (`CSI -> K8sVol`):** Kubernetes materializa el nuevo directorio de secretos en `tmpfs` y actualiza atómicamente el enlace simbólico `..data` en `/mnt/secrets-store`.
4. **Paso 4 (`Watcher -> K8sVol`):** `SecretWatcherService` intercepta el evento del sistema de archivos, aplica debounce y compara el hash SHA-256 contra el contenido previo para descartar notificaciones duplicadas.
5. **Paso 5 (`Watcher -> PoolMgr`):** Al confirmarse un cambio real en `database-url`, el observador emite el evento `reloadCredentials(newCredentials)` hacia `DynamicPostgresPoolManager`.
6. **Paso 6 (`PoolMgr -> PG`):** El gestor instancia un pool candidato (Generación $N+1$) y ejecuta una prueba obligatoria `SELECT 1` contra PostgreSQL antes de conmutar tráfico.
7. **Paso 7 (`PG -->> PoolMgr`):** PostgreSQL valida la autenticación y responde exitosamente al pre-flight check (si fallara, el candidato se descarta en modo *Fail-Safe* preservando la Generación $N$).
8. **Paso 8 (`PoolMgr -> PoolMgr`):** Se realiza el intercambio atómico de puntero (*Atomic Pointer Swap*) a la Generación $N+1$, mientras la Generación $N$ pasa a `retiringPools` hasta completar sus transacciones activas (`graceful drain`).
9. **Paso 9 (`Watcher -> RSA`):** Cuando se detecta una rotación en las claves RSA, el observador emite `reloadKeys(newKeyPair)` hacia `RsaKeyAdapter`.
10. **Paso 10 (`RSA -> RSA`):** El adaptador promueve la nueva clave como clave de firma activa y expone simultáneamente ambas claves públicas (`kid` nuevo + anterior) en el endpoint JWKS (`/oauth2/jwks` / `/.well-known/jwks.json`) durante la ventana de gracia.

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

#### 🌐 Demostración Interactiva en la UI (Navegador — `US-16`)

1. **Prerrequisitos Root (`ADR-0009`):** Backend (`npm run dev:api` en `:4000`) y Vite (`npm run dev:web` en `:3000`) activos con sesión `system:superadmin` guardada en `localStorage` (`identity_session`). Si venís de ejecutar el **Paso 5: Teardown** o tu token venció, regenerá/reseteá la sesión Root así:

   ```bash
   # 1) Emitir un operador y JWT fresco en el Root Tenant ('system')
   export ROOT_EMAIL="admin.$(date +%s)@angelpixel.io"
   SESSION_JSON=$(./bin/identity users create-root-admin \
     --email "${ROOT_EMAIL}" \
     --password 'SuperAdmin2026!' \
     --raw-json | jq -c '{ userId, email: env.ROOT_EMAIL, tenantId: "system", roles: ["superadmin", "member"], token: .accessToken }')
   echo "${SESSION_JSON}"
   ```

   ```js
   // 2) En DevTools Console de http://localhost:3000:
   const session = /* pegá acá el valor de SESSION_JSON */;
   localStorage.removeItem('identity_session');
   localStorage.setItem('identity_session', JSON.stringify(session));
   location.href = '/platform';
   ```

   > [!TIP]
   > **Si ves `Error de Bóveda: Invalid or expired token`:**
   > - El JWT emitido por `create-root-admin` expira a la **1 hora** (`TTL 1h`) o bien el operador temporal fue eliminado en el **Paso 5 (`users delete`)** si reutilizaste el mismo token.
   > - Regenerá el token con el comando `1)` y actualizá `identity_session` en DevTools. Para evitar que otras pruebas comerciales (`acme-corp`) sobrescriban tu sesión Root, revisá la guía de aislamiento en [`06-cloud-infrastructure.md`](./06-cloud-infrastructure.md).
2. **Inspección de Metadatos (`GET /api/v1/secrets/status`):**
   - Abre [`http://localhost:3000/platform`](http://localhost:3000/platform) y selecciona **`Bóveda Criptográfica`** en la barra lateral izquierda.
   - Pulsa **`Refrescar Bóveda`** y verifica los chips `Active Key`, `JWKS Keys` y `Pool Gen`, junto con las tarjetas **Llaves de Firma RSA-2048** y **Pool PostgreSQL & TLS** (y opcionalmente el acordeón **Ver Snapshot JSON técnico**), confirmando que no se expone ninguna clave privada PEM en claro.
3. **Caso Negativo (Confirmación Explícita Obligatoria):** Comprueba en la tarjeta inferior que el botón **`Ejecutar Rotación de Llave`** permanece deshabilitado hasta marcar el checkbox de confirmación explícita.

   ![Consola /platform Bóveda Criptográfica — Inspección y Guardia de Confirmación (Pasos 2 y 3)](./assets/screenshots/ui_platform_vault_audit.png)

4. **Caso Positivo (Rotación en Caliente `POST /api/v1/secrets/rotate-signing-key`):**
   - Ingresa opcionalmente en **Nuevo Key ID (opcional)** `kid_rsa_showcase_2026`.
   - Marca el checkbox de confirmación y pulsa **`Ejecutar Rotación de Llave`**.
   - Verifica en **Resultado de Rotación** el nuevo `activeKeyId` y en **Llaves de Firma RSA-2048** que `JWKS Keys` incrementó reteniendo la llave previa durante el periodo de gracia.

   ![Consola /platform Bóveda Criptográfica — Rotación Exitosa en Caliente (Paso 4)](./assets/screenshots/us16_vault_rotation_success.png)

5. **Verificación Técnica & Trazabilidad E2E:** Comprueba `X-Request-ID` / `traceparent` W3C en DevTools; `tests/e2e/web/platform_console.spec.tsx` (Scenario 3).

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

    Client->>App: Petición que requiere persistencia segura
    App->>PoolMgr: Solicitud de conexión cliente del pool
    PoolMgr->>SSLGuard: Validación de opciones SSL (rejectUnauthorized=true, TLS 1.2+)
    alt Handshake Seguro con CA Válido
        SSLGuard->>PG: Establecimiento de túnel TLS con verificación de CA (/mnt/secrets-store/ca.crt)
        PG-->>PoolMgr: Handshake completado exitosamente (Cifrado Activo)
        PoolMgr-->>App: Conexión entregada y ejecución de transacción cifrada
        App-->>Client: Respuesta exitosa 200 OK con datos protegidos
    else Intento de Rotación Insegura (sslmode=disable / MitM)
        SSLGuard->>SSLGuard: Detección de degradación criptográfica o certificado no confiable
        SSLGuard->>Audit: Emisión de alerta de seguridad crítica (SECURITY_VIOLATION)
        SSLGuard-->>PoolMgr: Rechazo de inicialización y preservación del pool seguro anterior
        PoolMgr-->>App: Sonda /health/ready reporta 503 DOWN para proteger el tráfico
    end
```

#### A. Glosario de Actores y Componentes (Cajas del Diagrama)

| Participante / Caja | Tipo | Rol Arquitectónico y Frontera de Seguridad |
| :--- | :--- | :--- |
| **`Client` (Cliente / Transacción API)** | `actor` | Usuario final, aplicación SPA o cliente M2M que ejecuta una operación autenticada (registro, login, rotación o emisión de tokens). |
| **`App` (Aplicación — Server HTTP)** | `participant` | Instancia de `identity-service` (`:4000`) que atiende peticiones de negocio y expone las sondas `/health/live` y `/health/ready`. |
| **`PoolMgr` (`DynamicPostgresPoolManager`)** | `participant` | Administrador generacional de pools PostgreSQL que coordina la creación de candidatos, el swap atómico y la preservación *Fail-Safe*. |
| **`SSLGuard` (Anti-Downgrade SSL Guard)** | `participant` | Validador criptográfico en memoria que exige `rejectUnauthorized: true`, versión mínima TLS 1.2+ y bloquea `sslmode=disable` / `no-verify` / `prefer`. |
| **`PG` (PostgreSQL Flexible Server)** | `participant` | Instancia administrada en Azure endurecida con `require_secure_transport = on` y `ssl_min_protocol_version = TLSv1.2`. |
| **`Audit` (Logger de Auditoría NDJSON)** | `participant` | Emisor 12-Factor hacia `stdout` que registra eventos `CRITICAL` (`SECURITY_VIOLATION`) etiquetados con PCI-DSS 4.1 y SOC 2 CC6.7. |

#### B. Desglose Secuencial del Flujo (Pasos 1 al 11)

1. **Paso 1 (`Client -> App`):** Un cliente envía una petición HTTP autenticada que requiere lectura o escritura en PostgreSQL.
2. **Paso 2 (`App -> PoolMgr`):** El servidor solicita una conexión activa (o evalúa un pool candidato durante una rotación) a `DynamicPostgresPoolManager`.
3. **Paso 3 (`PoolMgr -> SSLGuard`):** Antes de abrir el socket, el gestor somete las opciones de conexión al `Anti-Downgrade SSL Guard` para exigir `rejectUnauthorized=true` y versión mínima TLS 1.2+.
4. **Paso 4 — Rama `alt` Handshake Seguro (`SSLGuard -> PG`):** Validadas las opciones, se negocia el túnel TLS 1.2+/1.3 verificando la cadena de confianza del servidor contra el certificado raíz montado en `/mnt/secrets-store/ca.crt`.
5. **Paso 5 — Rama `alt` Handshake Seguro (`PG -->> PoolMgr`):** PostgreSQL completa el handshake criptográfico y confirma el canal cifrado activo.
6. **Paso 6 — Rama `alt` Handshake Seguro (`PoolMgr -->> App`):** El pool entrega la conexión segura y la transacción SQL se ejecuta protegida en tránsito.
7. **Paso 7 — Rama `alt` Handshake Seguro (`App -->> Client`):** El servicio devuelve `HTTP 200 OK` al cliente con la respuesta de negocio.
8. **Paso 8 — Rama `else` Degradación / MitM (`SSLGuard -> SSLGuard`):** Ante un parámetro de downgrade (`sslmode=disable`, `no-verify`, `prefer`) o un certificado inválido/autofirmado, la guardia aborta la operación en memoria (`BLOCKED_ANTI_DOWNGRADE`).
9. **Paso 9 — Rama `else` Degradación / MitM (`SSLGuard -> Audit`):** Se emite de inmediato un registro estructurado NDJSON de severidad `CRITICAL` (`SECURITY_VIOLATION`) para correlación en SIEM.
10. **Paso 10 — Rama `else` Degradación / MitM (`SSLGuard -->> PoolMgr`):** Se rechaza el pool candidato preservando intacta la generación segura previa en modo *Fail-Safe*.
11. **Paso 11 — Rama `else` Degradación / MitM (`PoolMgr -->> App`):** Si el fallo afecta la conectividad activa por certificado inválido, `/health/ready` reporta `503 DOWN` para aislar tráfico sin provocar reinicios destructivos (`/health/live` permanece `200 OK`).

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

#### 🌐 Demostración Interactiva en la UI (Navegador — `US-17`)

1. **Prerrequisitos Root (`ADR-0009`):** Backend (`npm run dev:api` en `:4000`) y Vite (`npm run dev:web` en `:3000`) activos con sesión `system:superadmin` vigente en [`http://localhost:3000/platform`](http://localhost:3000/platform). Si venís de ejecutar el **Paso 5: Teardown** CLI o expiró el JWT de 1 hora (`Invalid or expired token`), regenerá `SESSION_JSON` en `localStorage` siguiendo el paso `1)` de **Demostración Interactiva (`US-16`)** arriba.
2. **Inspección de Postura TLS en Vivo — `Postura & Gobernanza` (`GET /api/v1/platform/posture`):**
   - Selecciona **`Postura & Gobernanza`** en la barra lateral izquierda de `/platform`.
   - Verifica el chip **`DB TLS: TLSv1.2`**, la tarjeta **Seguridad & Red** (`Base de Datos: TLSv1.2 · DYNAMIC_POSTGRES_POOL`) y opcionalmente el nodo `securityPosture.databaseTls` (`sslEnabled`, `minVersion`, `rejectUnauthorized: true`, `activeGeneration`) dentro del acordeón **Ver Snapshot JSON técnico**.

   ![Consola /platform Postura & Gobernanza — DB TLS y Seguridad & Red (US-17)](./assets/screenshots/us12_platform_iac_posture.png)

3. **Inspección del Pool PostgreSQL & TLS — `Bóveda Criptográfica` (`GET /api/v1/secrets/status`):**
   - Selecciona **`Bóveda Criptográfica`** en la barra lateral izquierda y pulsa **`Refrescar Bóveda`**.
   - Verifica en la tarjeta **Pool PostgreSQL & TLS** el `Modo del Pool` (`DYNAMIC_POSTGRES_POOL`), `TLS en Tránsito` (`TLSv1.2`) y `Validación CA: Strict (rejectUnauthorized)`, y opcionalmente `databasePool.ssl` en **Ver Snapshot JSON técnico**.
   - *Nota:* La defensa activa `BLOCKED_ANTI_DOWNGRADE` (`?sslmode=no-verify`) se prueba por CLI/API (`./bin/identity secrets rotate-db-credentials`), mientras la UI expone la postura TLS en modo solo lectura.

   ![Consola /platform Bóveda Criptográfica — Pool PostgreSQL & TLS (US-17)](./assets/screenshots/ui_platform_vault_audit.png)

4. **Trazabilidad E2E:** `tests/e2e/web/platform_console.spec.tsx` (Scenario 2 & 3).

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

### ⚡ Ejecución en Vivo & Verificación Interactiva Paso a Paso (Helm NetworkPolicies)

A diferencia de las pruebas unitarias aisladas, los controles de microsegmentación de red (**ISO/IEC 27001 A.13.1** y **SOC 2 CC6.6**) se validan directamente contra el motor nativo de **Helm v4** y su contrato estricto `values.schema.json`, sin necesidad de un clúster Kubernetes remoto.

#### Paso 0: Configurar Variables de Sesión

```bash
export HELM_CHART_DIR="deployments/helm/identity-service"
export HELM_RELEASE="identity-service"
export HELM_VALUES="${HELM_CHART_DIR}/values-local.yaml"
```

#### Paso 1: Renderizar de Forma Determinista `templates/networkpolicy.yaml`

Ejecuta `helm template` filtrado únicamente a la plantilla de red para inspeccionar en vivo los **2 manifiestos `networking.k8s.io/v1`** que gobiernan el namespace:
1. `identity-service-default-deny-all` (`podSelector: {}`, `policyTypes: [Ingress, Egress]`).
2. `identity-service` (Ingress exclusivo desde `ingress-nginx` `:4000` y Egress estricto a CoreDNS `:53`, PostgreSQL `:5432`, Redis `:6379`, HTTPS `:443` y Floci/IMDS `:4577/:4578`).

```bash
helm template "${HELM_RELEASE}" "${HELM_CHART_DIR}" \
  -f "${HELM_VALUES}" \
  -s templates/networkpolicy.yaml
```

##### Salida Real Verificada (Manifiestos Kubernetes Renderizados):
```yaml
---
# Source: identity-service/templates/networkpolicy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: identity-service-default-deny-all
  labels:
    helm.sh/chart: identity-service-1.0.0
    app.kubernetes.io/name: identity-service
    app.kubernetes.io/instance: identity-service
    app.kubernetes.io/version: "0.1.0"
    app.kubernetes.io/managed-by: Helm
    app.kubernetes.io/part-of: identity-platform
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress


---
# Source: identity-service/templates/networkpolicy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: identity-service
  labels:
    helm.sh/chart: identity-service-1.0.0
    app.kubernetes.io/name: identity-service
    app.kubernetes.io/instance: identity-service
    app.kubernetes.io/version: "0.1.0"
    app.kubernetes.io/managed-by: Helm
    app.kubernetes.io/part-of: identity-platform
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: identity-service
      app.kubernetes.io/instance: identity-service
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              app.kubernetes.io/name: ingress-nginx
          podSelector:
            matchLabels:
              app.kubernetes.io/name: ingress-nginx
      ports:
        - protocol: TCP
          port: 4000
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - ports:
        - protocol: TCP
          port: 5432
    - ports:
        - protocol: TCP
          port: 6379
    - ports:
        - protocol: TCP
          port: 443
    - ports:
      - port: 4577
        protocol: TCP
      - port: 4578
        protocol: TCP
```

#### Paso 2: Validación Negativa de Esquema (`values.schema.json`)

Invoca la misma acción `helm template` con parámetros malformados para comprobar que el esquema JSON del chart bloquea configuraciones inseguras o inválidas antes de llegar al clúster:

##### 2.1. Puerto Ingress fuera de rango IANA (`> 65535`)

```bash
helm template "${HELM_RELEASE}" "${HELM_CHART_DIR}" \
  -f "${HELM_VALUES}" \
  --set networkPolicy.ingress.port=70000 \
  -s templates/networkpolicy.yaml
```

##### Salida Real Verificada (Rechazo Determinista de Esquema):
```text
Error: values don't meet the specifications of the schema(s) in the following chart(s):
identity-service:
- at '/networkPolicy/ingress/port': maximum: got 70,000, want 65,535
```

##### 2.2. Tipo inválido en `networkPolicy.enabled` (no booleano)

```bash
helm template "${HELM_RELEASE}" "${HELM_CHART_DIR}" \
  -f "${HELM_VALUES}" \
  --set networkPolicy.enabled=not-a-boolean \
  -s templates/networkpolicy.yaml
```

##### Salida Real Verificada (Rechazo Determinista de Esquema):
```text
Error: values don't meet the specifications of the schema(s) in the following chart(s):
identity-service:
- at '/networkPolicy/enabled': got string, want boolean
```

#### Paso 3: Auditoría Integral Automatizada de Helm (`npm run test:helm`)

La sintaxis completa del chart, los invariantes de seguridad Zero-Trust y los casos negativos de `values.schema.json` se certifican en una sola pasada mediante la suite automatizada:

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

#### Paso 4: Verificación CLI de Postura en Runtime (`./bin/identity ops posture`)

Con un token `system:superadmin` vigente (si usaste `SESSION_JSON` en `US-16` o si tu `ROOT_TOKEN` anterior expiró tras 1 hora, actualízalo primero), verificamos que el plano de control expone la postura `ENFORCED` de `NetworkPolicy` en tiempo real:

```bash
# Si ya tenés SESSION_JSON en tu terminal (o tras regenerarlo):
export ROOT_TOKEN=$(echo "${SESSION_JSON}" | jq -r .token)

./bin/identity ops posture \
  --token "${ROOT_TOKEN}" \
  --raw-json | jq '.infrastructurePosture.networkPolicy'
```

##### Salida Real Verificada (`GET /api/v1/platform/posture`):
```json
{
  "story": "US-18",
  "defaultDenyAll": true,
  "allowedIngressPort": 4000,
  "status": "ENFORCED"
}
```

#### 🌐 Demostración Interactiva en la UI (Navegador — `US-18`)

1. **Prerrequisitos Root (`ADR-0009`):** Backend (`npm run dev:api` en `:4000`) y Vite (`npm run dev:web` en `:3000`) activos con sesión `system:superadmin` vigente en [`http://localhost:3000/platform`](http://localhost:3000/platform). Si venís de ejecutar el **Paso 5: Teardown** CLI o expiró el JWT de 1 hora (`Invalid or expired token`), regenerá `SESSION_JSON` en `localStorage` siguiendo el paso `1)` de **Demostración Interactiva (`US-16`)**.
2. **Inspección Read-Only (`GET /api/v1/platform/posture`):**
   - Selecciona **`Postura & Gobernanza`** en la barra lateral izquierda de `/platform`.
   - Verifica en la tarjeta **Seguridad & Red** el chip **`NetPolicy: ENFORCED`** y la regla **`Default Deny · Puerto 4000`**.
   - Expande el acordeón **Ver Snapshot JSON técnico** para inspeccionar el nodo `infrastructurePosture.networkPolicy` (`defaultDenyAll: true`, `allowedIngressPort: 4000`, `status: "ENFORCED"`).
   - *Nota:* Las políticas de red se mantienen estrictamente `READ_ONLY_POSTURE` en la UI; el renderizado y validación de manifiestos Kubernetes se realiza vía `npm run test:helm`.

   ![Consola /platform Postura & Gobernanza — NetworkPolicy ENFORCED (US-18)](./assets/screenshots/us18_platform_netpolicy.png)

3. **Trazabilidad E2E:** `tests/e2e/web/platform_console.spec.tsx` (Scenario 2).

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

    User->>Gateway: Intento de acceso cross-tenant o autenticación anómala
    Gateway->>Builder: Detección de incidente de seguridad y generación de evento
    Builder->>Builder: Sanitización y redacción criptográfica de secretos
    Builder->>Logger: Emisión de NDJSON estructurado con tags PCI/SOC2
    Logger->>Logger: Escritura no bloqueante (fail-safe) a stdout
    Daemon->>Logger: Recolección de trazas NDJSON desde el stream del pod
    Daemon->>LogAnalytics: Ingesta cifrada vía Azure Monitor Ingestion API
    LogAnalytics->>LogAnalytics: Persistencia WORM inmutable con retención de 365 días
    LogAnalytics->>SIEM: Alerta en tiempo real al equipo SOC / Monitoreo FinTech
```

#### A. Glosario de Actores y Componentes (Cajas del Diagrama)

| Participante / Caja | Tipo | Rol Arquitectónico y Frontera de Seguridad |
| :--- | :--- | :--- |
| **`User` (Usuario / Atacante)** | `actor` | Sujeto externo (usuario final, cliente M2M o actor malicioso) cuyas peticiones atraviesan los controles perimetrales y de tenencia. |
| **`Gateway` (Ingress & Controller HTTP)** | `participant` | Capa HTTP de Express y middlewares de seguridad (Rate Limiting, Tenant Context, Root Admin Guard, Auth) que detectan incidentes y propagan `X-Request-ID` / `X-Correlation-ID`. |
| **`Builder` (`AuditEventBuilder`)** | `participant` | Constructor de dominio que ensambla el esquema bancario (`eventId`, `timestamp`, `eventType`, `severity`, `tenantId`, `actor`, `trace`, `compliance`) y redacta secretos recursivamente. |
| **`Logger` (`ConsoleSecurityAuditLogger`)** | `participant` | Adaptador 12-Factor que serializa el evento como una línea NDJSON en `process.stdout` neutralizando errores de I/O (`EPIPE`) en modo *fail-safe*. |
| **`Daemon` (Container Insights DaemonSet)** | `participant` | Agente recolector a nivel de nodo en AKS (Container Insights / Fluent Bit) que captura el stream `stdout` sin introducir latencia al proceso Node.js. |
| **`LogAnalytics` (Azure Log Analytics)** | `participant` | Repositorio centralizado (`IdentitySecurityAudit_CL`) con cifrado CMK y política WORM inmutable de retención por 365 días (PCI-DSS 10.5 / SOC 2 CC6.8). |
| **`SIEM` (Microsoft Sentinel / SOC SIEM)** | `participant` | Plataforma de detección y respuesta que correlaciona eventos `ALERT` / `CRITICAL` y dispara incidentes en tiempo real para el equipo de seguridad FinTech. |

#### B. Desglose Secuencial del Flujo (Pasos 1 al 9)

1. **Paso 1 (`User -> Gateway`):** Un usuario o atacante envía una petición anómala (ej. manipulación de `tenantId` cross-tenant o credenciales M2M inválidas) hacia la API.
2. **Paso 2 (`Gateway -> Builder`):** Los middlewares de seguridad bloquean la operación (`HTTP 403` / `HTTP 401`) e invocan `AuditEventBuilder` con el contexto de actor, inquilino y cabeceras de trazabilidad W3C (`X-Request-ID`, `X-Correlation-ID`).
3. **Paso 3 (`Builder -> Builder`):** El filtro recursivo inspecciona todas las propiedades del payload y reemplaza irreversiblemente cualquier campo sensible (`password`, `client_secret`, `token`, `authorization`, `private_key`) por `[REDACTED]`.
4. **Paso 4 (`Builder -> Logger`):** El evento normalizado se entrega a `ConsoleSecurityAuditLogger` enriquecido con severidad (`ALERT` / `CRITICAL`) y etiquetas regulatorias (`pciRequirement`, `soc2Criteria`, `AUDIT_IMMUTABLE`).
5. **Paso 5 (`Logger -> Logger`):** El adaptador escribe exactamente una línea NDJSON terminada en `\n` hacia `process.stdout` de forma no bloqueante, garantizando que fallos de I/O nunca interrumpan transacciones de negocio.
6. **Paso 6 (`Daemon -> Logger`):** El agente DaemonSet del clúster AKS recolecta el flujo continuo de `stdout` del contenedor de manera asíncrona.
7. **Paso 7 (`Daemon -> LogAnalytics`):** Las líneas NDJSON recolectadas se transmiten cifradas mediante Azure Monitor Ingestion API hacia el workspace central.
8. **Paso 8 (`LogAnalytics -> LogAnalytics`):** Los registros se persisten en `IdentitySecurityAudit_CL` bajo política WORM (*Write Once, Read Many*) inmutable durante 365 días.
9. **Paso 9 (`LogAnalytics -> SIEM`):** Las reglas analíticas de Microsoft Sentinel evalúan eventos de severidad `ALERT` o `CRITICAL` y notifican en tiempo real al equipo SOC.

---

### 🚀 Ejecución en Vivo & Verificación Interactiva Paso a Paso (`./bin/identity audit`)

La inspección y exportación de bitácoras de seguridad está gobernada por el patrón **Root Tenant (ADR-0009)**: únicamente un operador autenticado del inquilino `system` con rol `superadmin` puede consultar `GET /api/v1/audit/events` mediante `./bin/identity audit events`. Cualquier inquilino comercial que lo intente recibe `HTTP 403 Forbidden` y queda registrado automáticamente en el flujo de auditoría.

#### Paso 0: Variables de Sesión y Aprovisionamiento de Actores (`${ROOT_TOKEN}` y `${USER_TOKEN}`)

```bash
# ==============================================================================
# Variables de Sesión Interactiva para Auditoría Estructurada NDJSON (US-19)
# ==============================================================================
export BASE_URL="http://localhost:4000"
export ROOT_EMAIL="auditor.$(date +%s)@angelpixel.io"
export ROOT_PASS='SuperAdmin2026!'
export USER_EMAIL="member.$(date +%s)@alpha-corp.com"
export USER_PASS='EnterprisePassword2026!'
export CUSTOM_REQ_ID="req-us19-audit-2026"
export CUSTOM_CORR_ID="corr-us19-audit-2026"
export DUMMY_SECRET='MySuperConfidentialSecret_2026!'

# 1. Aprovisionar operador Root Superadmin (tenant 'system')
ROOT_RESP=$(./bin/identity users create-root-admin \
  --email "${ROOT_EMAIL}" \
  --password "${ROOT_PASS}" \
  --raw-json)
export ROOT_TOKEN=$(echo "${ROOT_RESP}" | jq -r .accessToken)
export ROOT_USER_ID=$(echo "${ROOT_RESP}" | jq -r .userId)

# 2. Aprovisionar usuario comercial en 'alpha-corp'
USER_RESP=$(./bin/identity auth register \
  --tenant alpha-corp \
  --email "${USER_EMAIL}" \
  --password "${USER_PASS}" \
  --raw-json)
export USER_TOKEN=$(echo "${USER_RESP}" | jq -r .accessToken)
export USER_ID=$(echo "${USER_RESP}" | jq -r .userId)

echo "ROOT_USER_ID=${ROOT_USER_ID} | USER_ID=${USER_ID}"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
ROOT_RESP=$(curl -s -X POST "${BASE_URL}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: system" \
  -d "{\"email\": \"${ROOT_EMAIL}\", \"password\": \"${ROOT_PASS}\", \"roles\": [\"superadmin\", \"member\"]}")
export ROOT_TOKEN=$(echo "${ROOT_RESP}" | jq -r .accessToken)
export ROOT_USER_ID=$(echo "${ROOT_RESP}" | jq -r .userId)

USER_RESP=$(curl -s -X POST "${BASE_URL}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: alpha-corp" \
  -d "{\"email\": \"${USER_EMAIL}\", \"password\": \"${USER_PASS}\"}")
export USER_TOKEN=$(echo "${USER_RESP}" | jq -r .accessToken)
export USER_ID=$(echo "${USER_RESP}" | jq -r .userId)
```

</details>

---

#### Paso 1: Provocar Incidente Cross-Tenant (`HTTP 403`) con Trazabilidad W3C

Consultamos un recurso solicitando el inquilino `beta-corp` con el token del usuario de `alpha-corp`, propagando cabeceras explícitas `--request-id` y `--correlation-id` (`X-Request-ID` / `X-Correlation-ID`):

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity users get \
  --tenant beta-corp \
  --user-id "${USER_ID}" \
  --token "${USER_TOKEN}" \
  --request-id "${CUSTOM_REQ_ID}" \
  --correlation-id "${CUSTOM_CORR_ID}"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -i -X GET "${BASE_URL}/api/v1/users/${USER_ID}" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Tenant-ID: beta-corp" \
  -H "X-Request-ID: ${CUSTOM_REQ_ID}" \
  -H "X-Correlation-ID: ${CUSTOM_CORR_ID}"
```

</details>

##### Respuesta Real Obtenida (HTTP 403 Forbidden — Zero-Trust Guard):

```json
{
  "error": "Forbidden: Token does not belong to the requested tenant context"
}
```

---

#### Paso 2: Provocar Fallo M2M con Credencial Confidencial (`HTTP 401` + Redacción `[REDACTED]`)

Invocamos el intercambio M2M con un cliente inexistente pasando un `client_secret` real (`${DUMMY_SECRET}`) para comprobar que el evento emitido **jamás** filtra secretos en texto plano:

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity token m2m \
  --client-id rogue-billing-svc \
  --client-secret "${DUMMY_SECRET}"
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X POST "${BASE_URL}/api/v1/oauth2/token" \
  -H "Content-Type: application/json" \
  -d "{
    \"grant_type\": \"client_credentials\",
    \"client_id\": \"rogue-billing-svc\",
    \"client_secret\": \"${DUMMY_SECRET}\"
  }" | jq .
```

</details>

##### Respuesta Real Obtenida (HTTP 401 Unauthorized):

```json
{
  "error": "invalid_client",
  "error_description": "Client application \"rogue-billing-svc\" was not found"
}
```

---

#### Paso 3: Inspección & Exportación Real en Vivo (`./bin/identity audit events`)

##### 3.1. Exportación NDJSON filtrada por inquilino y severidad `ALERT`

**Comando CLI Oficial (`./bin/identity`):**

```bash
./bin/identity audit events \
  --token "${ROOT_TOKEN}" \
  --tenant alpha-corp \
  --severity ALERT \
  --format ndjson | jq .
```

<details>
<summary><b>Ver Receta Equivalente con cURL</b></summary>

```bash
curl -s -X GET "${BASE_URL}/api/v1/audit/events?tenantId=alpha-corp&severity=ALERT&format=ndjson" \
  -H "Authorization: Bearer ${ROOT_TOKEN}" | jq .
```

</details>

##### Salida Real Obtenida (Línea NDJSON Canónica PCI-DSS 10.2.5 / SOC 2 CC7.2):

```json
{
  "timestamp": "2026-11-20T19:00:20.393Z",
  "logType": "SECURITY_AUDIT",
  "eventType": "CROSS_TENANT_VIOLATION",
  "severity": "ALERT",
  "tenantId": "alpha-corp",
  "actor": {
    "userId": "59afcc51-09d6-4231-89fe-f99eda1e5273",
    "type": "USER",
    "ip": "::1"
  },
  "trace": {
    "requestId": "req-us19-audit-2026",
    "correlationId": "corr-us19-audit-2026",
    "traceId": "9b4ac6f3af268412c9aaf47479e21fc7",
    "spanId": "8320d56136a51c61",
    "traceparent": "00-9b4ac6f3af268412c9aaf47479e21fc7-8320d56136a51c61-01"
  },
  "compliance": {
    "pciRequirement": "10.2.5",
    "soc2Criteria": "CC7.2",
    "retentionCategory": "AUDIT_IMMUTABLE"
  },
  "action": "cross_tenant_access_denied",
  "status": "DENIED",
  "details": {
    "reason": "CROSS_TENANT_VIOLATION",
    "activeTenantId": "alpha-corp",
    "attemptedTenantId": "beta-corp",
    "userId": "59afcc51-09d6-4231-89fe-f99eda1e5273",
    "path": "/api/v1/users/59afcc51-09d6-4231-89fe-f99eda1e5273",
    "method": "GET"
  }
}
```

##### 3.2. Vista Tabular Operativa (`--format table`) y Comprobación de Cero Fugas de Secretos

```bash
# Vista tabular de los eventos recientes del proceso
./bin/identity audit events \
  --token "${ROOT_TOKEN}" \
  --limit 5 \
  --format table

# Verificar 0 apariciones en texto plano del client_secret enviado en el Paso 2
./bin/identity audit events --token "${ROOT_TOKEN}" --format ndjson | grep -c "${DUMMY_SECRET}" || true
```

##### Salidas Reales Obtenidas:

```text
REGISTROS DE AUDITORÍA DE SEGURIDAD EN VIVO (US-19 — WORM COMPLIANCE):
-------------------------------------------------------------------------------------------------------
TIMESTAMP (UTC)           EVENT TYPE                   SEVERITY   TENANT         STATUS    PCI-REQ
-------------------------------------------------------------------------------------------------------
2026-11-20T18:54:43.477Z  AUTH_LOGIN_FAILURE           WARN       -              FAILURE   10.2.1
2026-11-20T18:54:43.394Z  CROSS_TENANT_VIOLATION       ALERT      alpha-corp     DENIED    10.2.5
-------------------------------------------------------------------------------------------------------
✓ 2 evento(s) real(es) recuperado(s) del proceso. Retención WORM en Azure Log Analytics: 365 días.
```

```text
0
```

---

#### Paso 4: Gobernanza Root Tenant (ADR-0009) — Rechazo a Inquilino Comercial

Si un usuario comercial (`alpha-corp`) intenta consultar el stream de auditoría, el middleware `requireRootAdmin` bloquea la solicitud con `HTTP 403 Forbidden` y registra automáticamente el intento como `CROSS_TENANT_VIOLATION`:

```bash
./bin/identity audit events --token "${USER_TOKEN}"
```

##### Respuesta Real Obtenida (HTTP 403 Forbidden):

```json
{
  "error": "Forbidden: Platform governance operations require Root Tenant (system) superadmin privileges"
}
```

---

#### Paso 5: Teardown y Limpieza de Actores Temporales

```bash
./bin/identity users delete \
  --tenant alpha-corp \
  --token "${ROOT_TOKEN}" \
  --user-id "${USER_ID}"

./bin/identity users delete \
  --tenant system \
  --token "${ROOT_TOKEN}" \
  --user-id "${ROOT_USER_ID}"
```

---

#### 🌐 Demostración Interactiva en la UI (Navegador — `US-19`)

1. **Prerrequisitos Root (`ADR-0009`):** Backend (`npm run dev:api` en `:4000`) y Vite (`npm run dev:web` en `:3000`) activos con sesión `system:superadmin` vigente en [`http://localhost:3000/platform`](http://localhost:3000/platform). Si venís de ejecutar el **Paso 5: Teardown** CLI o expiró el JWT de 1 hora (`Invalid or expired token`), regenerá `SESSION_JSON` en `localStorage` siguiendo el paso `1)` de **Demostración Interactiva (`US-16`)**.
2. **Caso Positivo (Explorador Forense `GET /api/v1/audit/events`):**
   - Abre [`http://localhost:3000/platform`](http://localhost:3000/platform) y selecciona **`Auditoría Forense`** en la barra lateral izquierda.
   - Ingresa filtros en la barra de 3 columnas (e.g., **Severidad** = `WARN`, o **Tenant ID** = `acme-corp` / **Tipo de Evento** = `CROSS_TENANT_VIOLATION`) y pulsa **`Buscar Eventos`** (usa **`Limpiar`** para restablecer la vista completa).
   - Verifica el chip `Eventos cargados: N`, la tabla forense compacta con severidad, estado (`GRANTED_ELEVATED` / `FAILURE` / `DENIED`), `Trace ID` y `Timestamp`, y opcionalmente el acordeón **Ver Payload Forense técnico (JSON)**.

   ![Consola /platform Auditoría Forense — Filtros y Tabla Compacta (US-19)](./assets/screenshots/us19_audit_explorer_filtered.png)

3. **Caso Negativo (Severidad Inválida `400 Bad Request`):**
   - Ingresa en **Severidad** un valor no permitido (`DEBUG`) y pulsa **`Buscar Eventos`** → el servidor rechaza con `400` (`Invalid severity 'DEBUG'`) y la UI muestra el banner **`Error de Auditoría`**.

   ![Consola /platform Auditoría Forense — Rechazo 400 de Severidad Inválida (US-19)](./assets/screenshots/us19_audit_invalid_severity.png)

4. **Verificación Técnica & Trazabilidad E2E:** Comprueba `X-Request-ID` / `traceparent` W3C en DevTools; `tests/e2e/web/platform_console.spec.tsx` (Scenario 4).

---

### 🧪 Verificación Automatizada: Suites de Pruebas de Auditoría E2E (US-19)

La precisión del esquema de auditoría, la redacción obligatoria de secretos, la propagación de contexto W3C y el contrato HTTP de `GET /api/v1/audit/events` bajo gobernanza Root Tenant se certifican mediante las suites de integración:

```bash
npx jest tests/integration/identity/security/test_structured_audit_logging.ts tests/integration/identity/security/test_audit_events_api.ts
```

##### Salida Real de Verificación Automatizada (2/2 Suites, 9/9 Escenarios Aprobados):
```text
PASS tests/integration/identity/security/test_structured_audit_logging.ts
  Integration E2E: Structured Security Audit Logging & NDJSON Ingestion (US-19)
    Scenario 1 (BDD 1): Cross-Tenant Access Violation Detection
      ✓ should abort with 403 Forbidden and emit an ALERT NDJSON audit log when tenant mismatch is detected (89 ms)
    Scenario 2 (BDD 2): M2M Authentication & Strict Credential Redaction
      ✓ should reject invalid client credentials and ensure secrets are redacted in audit output (64 ms)
    Scenario 3: Correlation & Request ID Header Forwarding
      ✓ should preserve and forward client-supplied correlation headers into trace object (50 ms)
    Scenario 4: Runtime Server Wiring Default Resolution
      ✓ should instantiate ConsoleSecurityAuditLogger by default when in production environment (97 ms)

PASS tests/integration/identity/security/test_audit_events_api.ts
  Integration E2E: Live Security Audit Events API & Root Tenant Governance (US-19 & ADR-0009)
    ✓ should reject unauthenticated requests with 401 Unauthorized (51 ms)
    ✓ should reject commercial tenant users with 403 Forbidden and emit CROSS_TENANT_VIOLATION (45 ms)
    ✓ should capture real cross-tenant violations and M2M failures with W3C trace and [REDACTED] secrets (78 ms)
    ✓ should filter by tenantId, severity, eventType, limit and reject invalid severity with 400 (47 ms)
    ✓ should export valid NDJSON lines when format=ndjson is requested (156 ms)

Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        3.129 s
Ran all test suites matching tests/integration/identity/security/test_structured_audit_logging.ts|tests/integration/identity/security/test_audit_events_api.ts.
```

---

[⬅️ Volver al Hub Principal de Showcase](./README.md)
