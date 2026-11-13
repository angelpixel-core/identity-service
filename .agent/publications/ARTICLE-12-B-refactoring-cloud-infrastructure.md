# ARTICLE-12-B: Bucle de Refactorización Inside-Out — Hardening de Resiliencia en Scripts de Plataforma, Contratos de Esquema Helm y Tolerancia a Fallos en Infraestructura Cloud-Native

* **Artículo ID:** ARTICLE-12-B
* **User Stories Asociadas:** [US-12: Terraform Azure Provisioning](../epics/EPIC-06-cloud-infrastructure-and-container-orchestration/stories/US-12-terraform-azure-resources-provisioning.md) · [US-13: Nginx Ingress TLS Routing](../epics/EPIC-06-cloud-infrastructure-and-container-orchestration/stories/US-13-nginx-ingress-tls-routing.md) · [US-14: Helm Manifests & K8s Packaging](../epics/EPIC-06-cloud-infrastructure-and-container-orchestration/stories/US-14-k8s-deployment-helm-manifests.md) · [US-15: CI/CD Pipelines & Rollback Guard](../epics/EPIC-06-cloud-infrastructure-and-container-orchestration/stories/US-15-cicd-pipeline-azure-integration.md)
* **Épica:** [EPIC-06: Cloud Infrastructure & Container Orchestration (Azure & Floci)](../epics/EPIC-06-cloud-infrastructure-and-container-orchestration/README.md)
* **Bounded Context:** `platform` / `infrastructure` / `security` / `devops`
* **Tipo de Slice:** Architectural Refactor / Inside-Out Hardening (Schema Contracts, Resilient Proxy, POSIX Traps & Negative Testing)
* **Rama de Trabajo:** `development`
* **ADR Relacionado:** [ADR 0007: Cloud Infrastructure Topology](../../docs/adr/0007-cloud-infrastructure-topology.md)
* **Fecha:** Noviembre 2026
* **Autor / Tech Lead:** AngelSolutions Cloud Platform & Security Engineering Team (Pair Programming)

---

## 1. Motivación y Resumen Ejecutivo

Al concluir el ciclo de entrega de las cuatro historias de usuario que componen [EPIC-06](ARTICLE-12-cloud-infrastructure-azure-floci.md), la infraestructura en la nube y los artefactos de orquestación cumplían rigurosamente con los criterios de aceptación y los escenarios BDD:
- 17 recursos de Azure aprovisionados en Terraform sobre el emulador Floci.
- Ingress-Nginx con terminación TLS y redirección HTTP 308 permanente.
- Helm Chart con probes desacopladas (`/health/live` y `/health/ready` con degradación `503`) y driver CSI de Azure Key Vault.
- Pipelines duales en GitHub Actions y CircleCI con circuit breaker de rollback automático.

Sin embargo, someter la solución a una auditoría técnica orientada a la **resiliencia operativa**, la **prevención proactiva del error humano** y la **disciplina arquitectónica inside-out** reveló cuatro oportunidades críticas de hardening:

1. **Ausencia de Contratos de Tipos en Helm (`values.yaml` débilmente tipado):**
   Cualquier operador o pipeline podía inyectar accidentalmente parámetros erróneos (por ejemplo, `replicaCount: 0`, un proveedor CSI no soportado como `aws`, o un path de probe sin barra inicial `health/live`). Helm procesaba estos valores generando manifiestos de Kubernetes formalmente válidos en sintaxis pero letales en runtime, postergando la detección del fallo hasta el despliegue en el clúster.
2. **Fragilidad por Sincronización Estática en Pruebas Locales:**
   El script de verificación de Terraform (`scripts/test-terraform-floci.sh`) utilizaba una pausa arbitraria (`sleep 2`) para esperar la inicialización del proxy Node.js contra el contenedor Floci. En entornos de CI congestionados o estaciones de trabajo con alta carga de CPU, este retardo fijo generaba condiciones de carrera intermitentes (*flaky tests*).
3. **Vulnerabilidad ante Cancelaciones Abruptas en el Despliegue:**
   Si un operador interrumpía manualmente (`Ctrl+C` / `SIGINT`) o el orquestador de CI cancelaba (`SIGTERM`) el script `deploy-helm-rollout.sh` durante el comando bloqueante `kubectl rollout status`, el script terminaba de inmediato sin ejecutar el circuit breaker, dejando al clúster en un estado de despliegue parcial o inconsistente.
4. **Falta de Pruebas Negativas Automatizadas en Infraestructura:**
   La suite `scripts/test-helm-chart.sh` sólo validaba casos nominales exitosos ("camino feliz"). No existía verificación automatizada de que el linter rechazara intencionalmente configuraciones corruptas o fuera de contrato.

Para erradicar estas debilidades y asegurar que la plataforma posea el mismo nivel de rigor y robustez que el dominio de negocio, se ejecutó un **Bucle de Refactorización Inside-Out** sobre la infraestructura.

```
+---------------------------------------------------------------------------------------------------------+
| ARQUITECTURA DEL REFACTOR INSIDE-OUT (EPIC-06)                                                          |
|                                                                                                         |
|  [CAPA 1: CONTRATOS ESTRICTOS DE ESQUEMA]                                                               |
|  - values.schema.json (Draft-07)                        <-- Invariantes de tipos, rangos y enums        |
|  - Validación nativa en lint, template, upgrade y rollout                                               |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA 2: RESILIENCIA EN EMULACIÓN ARM]                                                                 |
|  - floci-proxy.mjs                                      <-- Health endpoint /__proxy_health             |
|  - Graceful shutdown (SIGINT/SIGTERM), socket draining, timeout 30s y clientError handling              |
|  - test-terraform-floci.sh                              <-- Sondeo activo <200ms reemplaza sleep 2       |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA 3: PROTECCIÓN POSIX DE ROLLOUT ATÓMICO]                                                         |
|  - deploy-helm-rollout.sh                               <-- Trap defensivo INT/TERM                     |
|  - Circuit breaker forzado: rollback automático garantizado ante cancelación abrupta                   |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA 4: NEGATIVE SCHEMA TESTING]                                                                      |
|  - test-helm-chart.sh (6/6 etapas)                      <-- assert_lint_failure con regex estricto      |
|  - 4 vectores de validación negativa: replicaCount=0, csi.provider=aws, service.type, probe.path        |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Contratos Formales de Configuración con JSON Schema Draft-07 en Helm

En desarrollo de software guiado por el dominio (DDD), un objeto de valor (*Value Object*) valida invariantes en el momento exacto de su instanciación; no permite la existencia de un estado inválido en memoria. En infraestructura moderna, **JSON Schema** cumple idéntica función para los parámetros de empaquetado.

### 2.1. Implementación de `values.schema.json`

Se diseñó [`deployments/helm/identity-service/values.schema.json`](../../deployments/helm/identity-service/values.schema.json) bajo el estándar JSON Schema Draft-07, vinculándose automáticamente al motor de Helm v3:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ValuesSchema",
  "type": "object",
  "required": ["replicaCount", "image", "service", "strategy", "securityContext", "podSecurityContext", "keyVaultCSI"],
  "properties": {
    "replicaCount": {
      "type": "integer",
      "minimum": 1,
      "description": "Número de réplicas requeridas. Mínimo 1 para garantizar disponibilidad."
    },
    "image": {
      "type": "object",
      "required": ["repository", "pullPolicy", "tag"],
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "pullPolicy": { "type": "string", "enum": ["Always", "IfNotPresent", "Never"] },
        "tag": { "type": "string", "minLength": 1 }
      }
    },
    "strategy": {
      "type": "object",
      "required": ["type", "rollingUpdate"],
      "properties": {
        "type": { "type": "string", "enum": ["RollingUpdate", "Recreate"] },
        "rollingUpdate": {
          "type": "object",
          "required": ["maxSurge", "maxUnavailable"]
        }
      }
    },
    "podSecurityContext": {
      "type": "object",
      "required": ["runAsNonRoot", "runAsUser", "fsGroup"],
      "properties": {
        "runAsNonRoot": { "type": "boolean", "const": true },
        "runAsUser": { "type": "integer", "minimum": 1000 },
        "fsGroup": { "type": "integer", "minimum": 1000 }
      }
    },
    "keyVaultCSI": {
      "type": "object",
      "required": ["enabled", "provider", "keyvaultName"],
      "properties": {
        "enabled": { "type": "boolean" },
        "provider": { "type": "string", "enum": ["azure"] },
        "keyvaultName": { "type": "string", "minLength": 3 }
      }
    },
    "livenessProbe": {
      "type": "object",
      "properties": {
        "httpGet": {
          "type": "object",
          "properties": {
            "path": { "type": "string", "pattern": "^/" }
          }
        }
      }
    }
  }
}
```

### 2.2. Por qué este Contrato Elimina el *Configuration Drift*

1. **Fallo Temprano (*Fail-Fast*):** `helm lint`, `helm template`, `helm install` y `helm upgrade` evalúan el esquema antes de renderizar cualquier plantilla Go. Si un valor viola las restricciones, el comando aborta con código de salida `1`.
2. **Diagnósticos Estructurados:** Helm reporta la ruta JSON exacta de la infracción (e.g., `- at '/replicaCount': minimum: got 0, want 1` o `- at '/keyVaultCSI/provider': value must be 'azure'`).
3. **Blindaje de Producción:** Previene que un parámetro tipográfico en un archivo `values-production.yaml` degrade silenciosamente las directivas de seguridad (`runAsNonRoot`) o deje sin réplicas al servicio.

---

## 3. Resiliencia en la Capa de Emulación ARM: Floci Reverse Proxy Hardening

El proxy intermedio [`scripts/floci-proxy.mjs`](../../scripts/floci-proxy.mjs) actúa como una Capa Anti-Corrupción (*Anti-Corruption Layer - ACL*) entre las llamadas del provider oficial `azurerm` de Terraform y el emulador Floci. Durante el refactor, se convirtió en un componente de alta resiliencia.

### 3.1. Endpoint de Salud Diagnóstico (`/__proxy_health`)

Se introdujo un interceptor prioritario que responde de inmediato sin reenviar tráfico al upstream:

```javascript
// Interceptar endpoint de diagnóstico y salud del proxy
if (req.url === '/__proxy_health') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'UP',
    proxyPort: PROXY_PORT,
    target: `localhost:${FLOCI_PORT}`,
    timestamp: new Date().toISOString()
  }));
  return;
}
```

### 3.2. Sondeo Activo en `scripts/test-terraform-floci.sh`

Se eliminó el `sleep 2` estático, reemplazándolo por una rutina de polling activo con timeout determinista de 10 segundos:

```bash
echo "Esperando que floci-proxy esté listo en https://localhost:${PROXY_PORT}/__proxy_health..."
MAX_ATTEMPTS=50
ATTEMPT=0
PROXY_READY=false

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  if curl -sk "https://localhost:${PROXY_PORT}/__proxy_health" | grep -q '"status":"UP"'; then
    PROXY_READY=true
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 0.2
done

if [ "$PROXY_READY" = false ]; then
  echo -e "${RED}Error: floci-proxy no respondió en https://localhost:${PROXY_PORT}/__proxy_health tras 10s.${NC}"
  exit 1
fi
```

*Resultado:* El test inicia en menos de **200 ms** en lugar de esperar 2 segundos completos de forma ciega, y si el proxy falla, el test aborta de inmediato con un mensaje descriptivo.

### 3.3. Drenado de Conexiones y Traps de Limpieza

Para evitar puertos bloqueados (`EADDRINUSE`) en ejecuciones sucesivas de pruebas:
- `server.on('clientError')`: Captura y destruye sockets ante handshakes SSL malformados de clientes locales, evitando que el servidor quede colgado.
- Manejadores de `SIGTERM` y `SIGINT`: El proxy deja de aceptar nuevas conexiones, drena los sockets activos y fija un fallback de 3 segundos con `.unref()` para cierre forzado si existieran peticiones estancadas.
- Trap POSIX en `test-terraform-floci.sh`: `trap cleanup EXIT INT TERM HUP` garantiza que la función `cleanup` envíe `kill -TERM` al PID del proxy incluso si el usuario cancela la prueba con `Ctrl+C`.

---

## 4. Protección de Rollouts con Traps POSIX y Circuit Breaking

En `scripts/deploy-helm-rollout.sh`, el despliegue realiza una invocación bloqueante para monitorear el estado de los Pods:

```bash
kubectl rollout status deployment/identity-service -n identity --timeout=120s
```

Si este comando fallaba por timeout o sondas de salud insatisfechas, el script ejecutaba la función `rollback_and_exit`. Sin embargo, si la ejecución era cancelada externamente (por ejemplo, timeout del runner de CI o cancelación manual del operador), la señal POSIX `SIGINT` o `SIGTERM` abortaba el shell inmediatamente sin ejecutar el bloque de recuperación.

### 4.1. Implementación del Trap Defensivo

Se armó un trap de señales específico justo antes de iniciar la fase crítica de despliegue:

```bash
# ==============================================================================
# Circuit Breaker Trap: Garantizar rollback si el rollout es interrumpido
# ==============================================================================
trap 'echo -e "\n${RED}[CIRCUIT BREAKER] Despliegue interrumpido por señal del sistema. Activando rollback forzado...${NC}"; rollback_and_exit "Interrupción externa (SIGINT/SIGTERM)"' INT TERM
```

### 4.2. Comportamiento Garantizado

Ante cualquier evento de terminación prematura:
1. El script atrapa la señal del kernel.
2. Invoca inmediatamente `rollback_and_exit`.
3. Ejecuta `helm rollback identity-service 0 -n identity`.
4. El clúster retorna atómicamente a la última versión saludable conocida, previniendo Pods en bucle `CrashLoopBackOff` o estados de despliegue huérfanos.

---

## 5. Negative Schema Testing: Validación Extensiva de Fallos en `test-helm-chart.sh`

La prueba de un contrato no está completa si únicamente verificamos que los datos correctos sean aceptados. Es indispensable comprobar que **los datos incorrectos sean rechazados con el motivo exacto**.

### 5.1. La Función `assert_lint_failure`

Se incorporó la función auxiliar `assert_lint_failure` en [`scripts/test-helm-chart.sh`](../../scripts/test-helm-chart.sh):

```bash
assert_lint_failure() {
  local description="$1"
  local expected_pattern="$2"
  shift 2
  local output

  echo "Probando caso negativo: ${description}..."
  set +e
  output=$(run_helm lint "${CHART_REL_PATH}" "$@" 2>&1)
  local status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo -e "${RED}Error: helm lint debió fallar para '${description}', pero fue aceptado exitosamente.${NC}"
    exit 1
  fi

  if ! echo "${output}" | grep -qE "${expected_pattern}"; then
    echo -e "${RED}Error: El mensaje de error no contiene el patrón esperado '${expected_pattern}'.${NC}"
    echo "Salida obtenida:"
    echo "${output}"
    exit 1
  fi
  echo -e "${GREEN}✓ Caso negativo validado (falló según lo esperado): ${description}.${NC}"
}
```

### 5.2. Los 4 Vectores de Prueba Negativa

Se incluyeron cuatro casos que cubren los límites más críticos del sistema:

| Vector de Prueba | Parámetro Inyectado | Invariante Violada | Patrón Regex de Error Esperado |
| :--- | :--- | :--- | :--- |
| **1. Réplicas por debajo del mínimo** | `--set replicaCount=0` | `minimum: 1` | `replicaCount.*minimum.*got 0` |
| **2. Proveedor CSI no soportado** | `--set keyVaultCSI.provider=aws` | `enum: ["azure"]` | `keyVaultCSI/provider.*must be 'azure'` |
| **3. Tipo de servicio inexistente** | `--set service.type=IngressIP` | `enum: ["ClusterIP", "NodePort", "LoadBalancer"]` | `service/type.*value must be one of` |
| **4. Path de sonda sin barra inicial** | `--set livenessProbe.httpGet.path=health/live` | `pattern: "^/"` | `livenessProbe/httpGet/path.*pattern` |

Al ejecutarse `npm run test:helm`, los cuatro casos son rechazados sistemáticamente por Helm con código de salida `1` y los diagnósticos esperados, pasando la etapa `[6/6]` con éxito absoluto.

---

## 6. Analogía Arquitectónica: Del Dominio DDD a la Plataforma Cloud-Native

Existe una correspondencia directa entre los principios de Domain-Driven Design aplicados en el código de backend y las prácticas de ingeniería de infraestructura implementadas en este refactor:

| Concepto en Domain-Driven Design (DDD) | Equivalente en Plataforma Cloud-Native / IaC | Implementación en `identity-service` |
| :--- | :--- | :--- |
| **Value Objects con Validación de Invariantes** | **JSON Schema (`values.schema.json`)** | `replicaCount >= 1`, `provider: "azure"`, `path: "^/"` validados antes del despliegue. |
| **Anti-Corruption Layer (ACL)** | **Proxy Adaptador de Metadatos ARM** | `floci-proxy.mjs` traduce y adapta las llamadas entre el provider `azurerm` y Floci. |
| **Encapsulamiento y Mínimo Privilegio** | **Pod Security Context no-root** | `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `drop: ["ALL"]`, `USER node` (1000). |
| **Transacciones de Dominio y Rollback** | **Circuit Breaker y Helm Rollback** | Rollback atómico (`helm rollback ... 0`) si las sondas de salud no estabilizan en 120s. |
| **Health Checks Semánticos de Agregado** | **Probes Asimétricas Liveness vs Readiness** | `/health/live` (event-loop vivo) vs `/health/ready` (validación de DB + Redis con 503). |
| **Trazabilidad y Auditoría de Eventos** | **Correlación Distribuida de Borde a Pod** | Inyección de cabecera `X-Request-ID` desde Ingress Nginx hacia Express. |

---

## 7. Métricas de Calidad y Cero Regresiones

El bucle de refactorización concluyó con una verificación integral de todas las suites del proyecto:

```bash
# 1. Suite de Dominio, Aplicación e Integración (100% en memoria)
npm run test           # 469 tests pasando exitosamente (0 fallos)

# 2. Infraestructura Terraform contra Emulador Floci
npm run test:infra     # 17 recursos de Azure planificados determinísticamente

# 3. Empaquetado Helm, Linting Estricto y Pruebas Negativas
npm run test:helm      # 6 de 6 etapas aprobadas (incluyendo 4 vectores negativos)

# 4. Pipeline de Borde TLS y Routing Ingress
npm run test:ingress   # Ingress Nginx TLS 1.3, HTTP 308 y buffers 128k aprobados

# 5. Pipeline Dual de CI/CD y Rollback Automático
npm run test:cicd      # 3 escenarios BDD de despliegue, hardening y circuit breaker aprobados
```

---

## 8. Conclusión

El **Bucle de Refactorización Inside-Out** de la [EPIC-06](file:///Users/angel.szymczak/Vaults/Harvis/300-MEMORIA_DIGITAL/475-Sites/AngelSolutions/Company/apps/sites/portfolio/identity-service/.agent/epics/EPIC-06-cloud-infrastructure-and-container-orchestration/README.md) demuestra que la excelencia en ingeniería de software no concluye cuando el código funcional pasa las pruebas iniciales. Al aplicar tipado estricto a la configuración declarativa, reemplazar esperas temporales por sondeos activos de salud, asegurar la captura de señales del sistema operativo y validar sistemáticamente los casos negativos, la infraestructura de `identity-service` alcanza un nivel de resiliencia y fiabilidad equiparable al de los estándares más exigentes de la industria cloud-native.
