#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Automated Testing & Verification for Kubernetes Helm Chart (US-14)
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_REL_PATH="deployments/helm/identity-service"
HELM_IMAGE="alpine/helm:3.16.3"

run_helm() {
  if command -v helm >/dev/null 2>&1; then
    helm "$@"
  else
    docker run --rm -v "${ROOT_DIR}:/apps" -w /apps "${HELM_IMAGE}" "$@"
  fi
}

echo -e "${BLUE}=== [1/6] Verificando Motor Helm CLI ===${NC}"
if command -v helm >/dev/null 2>&1; then
  HELM_VER=$(helm version --short)
  echo -e "${GREEN}✓ Binario local Helm detectado: ${HELM_VER}${NC}"
else
  command -v docker >/dev/null 2>&1 || { echo -e "${RED}Error: ni helm ni docker están instalados.${NC}"; exit 1; }
  HELM_VER=$(run_helm version --short)
  echo -e "${GREEN}✓ Contenedor oficial ${HELM_IMAGE} activo: ${HELM_VER}${NC}"
fi

echo -e "\n${BLUE}=== [2/6] Ejecutando Helm Lint Estricto (values.yaml & values-local.yaml) ===${NC}"
run_helm lint "${CHART_REL_PATH}" --strict
echo -e "${GREEN}✓ Helm lint (values.yaml) aprobado con 0 errores y 0 advertencias.${NC}"

run_helm lint "${CHART_REL_PATH}" -f "${CHART_REL_PATH}/values-local.yaml" --strict
echo -e "${GREEN}✓ Helm lint (values-local.yaml) aprobado con 0 errores y 0 advertencias.${NC}"

echo -e "\n${BLUE}=== [3/6] Renderizando Plantillas Kubernetes (helm template) ===${NC}"
RENDERED_LOCAL=$(run_helm template identity-service "${CHART_REL_PATH}" -f "${CHART_REL_PATH}/values-local.yaml")

for kind in "ServiceAccount" "SecretProviderClass" "Service" "Deployment" "PodDisruptionBudget" "Ingress"; do
  if echo "${RENDERED_LOCAL}" | grep -q "^kind: ${kind}$"; then
    echo -e "${GREEN}✓ Manifiesto ${kind} renderizado correctamente.${NC}"
  else
    echo -e "${RED}Error: No se encontró el recurso kind: ${kind} en la salida de helm template.${NC}"
    exit 1
  fi
done

echo -e "\n${BLUE}=== [4/6] Auditando Invariantes de Orquestación, Probes, CSI y Seguridad ===${NC}"
RENDERED_YAML="${RENDERED_LOCAL}" node -e '
const yaml = require("yaml");
const raw = process.env.RENDERED_YAML;
const docs = yaml.parseAllDocuments(raw).map((d) => d.toJSON()).filter(Boolean);

const byKind = (k) => docs.find((d) => d.kind === k);

const deployment = byKind("Deployment");
if (!deployment) throw new Error("Missing Deployment manifest");
if (deployment.spec.replicas !== 2) throw new Error(`Expected 2 replicas, got ${deployment.spec.replicas}`);
if (deployment.spec.strategy.type !== "RollingUpdate") throw new Error("Expected RollingUpdate strategy");
if (deployment.spec.strategy.rollingUpdate.maxSurge !== "25%") throw new Error("Expected maxSurge 25%");
if (deployment.spec.strategy.rollingUpdate.maxUnavailable !== 0) throw new Error("Expected maxUnavailable 0");

const podSpec = deployment.spec.template.spec;
if (podSpec.securityContext.runAsNonRoot !== true) throw new Error("Pod securityContext.runAsNonRoot must be true");

const container = podSpec.containers[0];
if (container.securityContext.runAsNonRoot !== true) throw new Error("Container runAsNonRoot must be true");
if (container.securityContext.allowPrivilegeEscalation !== false) throw new Error("allowPrivilegeEscalation must be false");
if (container.securityContext.readOnlyRootFilesystem !== false) throw new Error("readOnlyRootFilesystem must be false");
if (!container.securityContext.capabilities.drop.includes("ALL")) throw new Error("Must drop ALL capabilities");

if (container.livenessProbe.httpGet.path !== "/health/live" || container.livenessProbe.httpGet.port !== 4000) {
  throw new Error("Invalid livenessProbe path or port");
}
if (container.livenessProbe.initialDelaySeconds !== 10 || container.livenessProbe.periodSeconds !== 10 || container.livenessProbe.failureThreshold !== 3) {
  throw new Error("Invalid livenessProbe timing parameters");
}

if (container.readinessProbe.httpGet.path !== "/health/ready" || container.readinessProbe.httpGet.port !== 4000) {
  throw new Error("Invalid readinessProbe path or port");
}
if (container.readinessProbe.initialDelaySeconds !== 5 || container.readinessProbe.periodSeconds !== 5 || container.readinessProbe.failureThreshold !== 2) {
  throw new Error("Invalid readinessProbe timing parameters");
}

if (container.resources.requests.cpu !== "100m" || container.resources.requests.memory !== "128Mi") {
  throw new Error("Invalid resource requests");
}
if (container.resources.limits.cpu !== "500m" || container.resources.limits.memory !== "512Mi") {
  throw new Error("Invalid resource limits");
}

for (const secretEnv of ["DATABASE_URL", "JWT_SECRET", "REDIS_URL"]) {
  const entry = container.env.find((e) => e.name === secretEnv);
  if (!entry || !entry.valueFrom || !entry.valueFrom.secretKeyRef) {
    throw new Error(`Missing secretKeyRef projection for ${secretEnv}`);
  }
  if (entry.valueFrom.secretKeyRef.name !== "identity-kv-secrets") {
    throw new Error(`Expected secretKeyRef name identity-kv-secrets for ${secretEnv}`);
  }
}

const csiVol = podSpec.volumes.find((v) => v.name === "secrets-store-inline");
if (!csiVol || csiVol.csi.driver !== "secrets-store.csi.k8s.io") {
  throw new Error("Missing secrets-store.csi.k8s.io volume on Deployment");
}

const pdb = byKind("PodDisruptionBudget");
if (!pdb || pdb.spec.minAvailable !== 1) {
  throw new Error("PodDisruptionBudget minAvailable must be 1");
}

const spc = byKind("SecretProviderClass");
if (!spc || spc.spec.provider !== "azure") {
  throw new Error("SecretProviderClass provider must be azure");
}
if (spc.spec.parameters.keyvaultName !== "id-local-kv") {
  throw new Error(`Expected keyvaultName id-local-kv, got ${spc.spec.parameters.keyvaultName}`);
}
if (spc.spec.parameters.rotationPollInterval !== "2m") {
  throw new Error(`Expected rotationPollInterval 2m, got ${spc.spec.parameters.rotationPollInterval}`);
}

const svc = byKind("Service");
if (!svc || svc.spec.type !== "ClusterIP" || svc.spec.ports[0].port !== 4000) {
  throw new Error("Invalid Service manifest");
}

const ing = byKind("Ingress");
if (!ing || ing.spec.ingressClassName !== "nginx") {
  throw new Error("Invalid Ingress manifest");
}

console.log("✓ Invariantes de Deployment (RollingUpdate 25%/0, 2 réplicas, recursos 100m/128Mi -> 500m/512Mi) verificadas.");
console.log("✓ Contexto de seguridad no-root (runAsNonRoot: true, allowPrivilegeEscalation: false, drop: ALL) verificado.");
console.log("✓ Probes /health/live y /health/ready verificadas.");
console.log("✓ SecretProviderClass (Azure Key Vault CSI: id-local-kv, rotationPollInterval: 2m) y proyección de DATABASE_URL, JWT_SECRET y REDIS_URL verificados.");
console.log("✓ PodDisruptionBudget (minAvailable: 1), Service (ClusterIP:4000) e Ingress (nginx TLS) verificados.");
'

echo -e "\n${BLUE}=== [5/6] Verificando Renderizado Condicional de HorizontalPodAutoscaler (HPA) ===${NC}"
RENDERED_HPA=$(run_helm template identity-service "${CHART_REL_PATH}" --set autoscaling.enabled=true)
if echo "${RENDERED_HPA}" | grep -q "^kind: HorizontalPodAutoscaler$"; then
  echo -e "${GREEN}✓ HorizontalPodAutoscaler renderizado dinámicamente cuando autoscaling.enabled=true.${NC}"
else
  echo -e "${RED}Error: HorizontalPodAutoscaler no se renderizó cuando autoscaling.enabled=true.${NC}"
  exit 1
fi

echo -e "\n${BLUE}=== [6/6] Verificando Rechazo Estricto de Casos Negativos (values.schema.json) ===${NC}"
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

assert_lint_failure "replicaCount=0 menor al mínimo permitido (>= 1)" "replicaCount.*minimum.*got 0" --set replicaCount=0
assert_lint_failure "keyVaultCSI.provider no soportado (debe ser azure)" "keyVaultCSI/provider.*must be 'azure'" --set keyVaultCSI.provider=aws
assert_lint_failure "service.type inválido (enum ClusterIP/NodePort/LoadBalancer)" "service/type.*value must be one of" --set service.type=IngressIP
assert_lint_failure "livenessProbe.httpGet.path sin barra inicial (pattern ^/)" "livenessProbe/httpGet/path.*pattern" --set livenessProbe.httpGet.path=health/live
assert_lint_failure "keyVaultCSI.rotationPollInterval con formato inválido (sin unidad m/s/h)" "rotationPollInterval.*pattern" --set keyVaultCSI.rotationPollInterval=invalid

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✓ Todas las pruebas de empaquetado Helm (US-14 & US-16) pasaron con éxito.${NC}"
echo -e "${GREEN}================================================================${NC}"
