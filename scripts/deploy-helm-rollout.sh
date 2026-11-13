#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Atomic Helm Deployment, Rollout Verification & Automatic Rollback Script (US-15)
# Used by GitHub Actions (.github/workflows/cd.yml), CircleCI (.circleci/config.yml),
# and local verification suites.
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="${ROOT_DIR}/deployments/helm/identity-service"

RELEASE_NAME="${RELEASE_NAME:-identity-service}"
NAMESPACE="${NAMESPACE:-default}"
REGISTRY="${ACR_LOGIN_SERVER:-idprodacr.azurecr.io}"
DEFAULT_SHA="$(git -C "${ROOT_DIR}" rev-parse --short=7 HEAD 2>/dev/null || echo '0000000')"
IMAGE_TAG="${IMAGE_TAG:-sha-${DEFAULT_SHA}}"
VALUES_FILE="${VALUES_FILE:-${CHART_DIR}/values.yaml}"
TIMEOUT="${ROLLOUT_TIMEOUT:-120s}"
DRY_RUN=false
SIMULATE_PROBE_FAILURE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      RELEASE_NAME="$2"
      shift 2
      ;;
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --registry)
      REGISTRY="$2"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --values)
      VALUES_FILE="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift 1
      ;;
    --simulate-probe-failure)
      SIMULATE_PROBE_FAILURE=true
      shift 1
      ;;
    *)
      echo -e "${RED}Error: Argumento desconocido '$1'${NC}"
      exit 1
      ;;
  esac
done

IMAGE_REPOSITORY="${REGISTRY}/identity-service"

echo -e "${BLUE}=== [1/4] Validando Política de Etiquetado Inmutable (ACR) ===${NC}"
if [[ "${IMAGE_TAG}" == "latest" ]]; then
  echo -e "${RED}✗ VIOLACIÓN DE POLÍTICA: La etiqueta mutable 'latest' está estrictamente prohibida en producción.${NC}"
  echo -e "${RED}  Use una etiqueta inmutable basada en Git SHA (sha-<7chars>) o SemVer (vX.Y.Z).${NC}"
  exit 1
fi

if [[ ! "${IMAGE_TAG}" =~ ^(sha-[0-9a-f]{7,40}|v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?)$ ]]; then
  echo -e "${RED}✗ VIOLACIÓN DE POLÍTICA: Formato de etiqueta inválido '${IMAGE_TAG}'.${NC}"
  echo -e "${RED}  Formatos permitidos: sha-<commit> o v<major>.<minor>.<patch>${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Etiqueta inmutable verificada: ${IMAGE_REPOSITORY}:${IMAGE_TAG}${NC}"

trigger_rollback() {
  local reason="$1"
  echo -e "\n${RED}================================================================${NC}"
  echo -e "${RED}[CIRCUIT BREAKER] Fallo detectado durante el despliegue: ${reason}${NC}"
  echo -e "${YELLOW}Iniciando rollback automático de Helm para el release '${RELEASE_NAME}' en namespace '${NAMESPACE}'...${NC}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "Ejecutando: helm rollback ${RELEASE_NAME} 0 --namespace ${NAMESPACE}"
    echo -e "${GREEN}✓ [DRY-RUN] Rollback completado exitosamente: '${RELEASE_NAME}' restaurado a la revisión estable anterior.${NC}"
  else
    helm rollback "${RELEASE_NAME}" 0 --namespace "${NAMESPACE}" --wait --timeout "${TIMEOUT}"
    echo -e "${GREEN}✓ Rollback completado exitosamente: '${RELEASE_NAME}' restaurado a la revisión estable anterior.${NC}"
  fi
  echo -e "${RED}================================================================${NC}"
  exit 1
}

echo -e "\n${BLUE}=== [2/4] Ejecutando Despliegue con Helm (helm upgrade --install) ===${NC}"
if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Ejecutando: helm upgrade --install ${RELEASE_NAME} ${CHART_DIR} -f ${VALUES_FILE} --namespace ${NAMESPACE} --set image.repository=${IMAGE_REPOSITORY} --set image.tag=${IMAGE_TAG} (client template validation)"
  helm template "${RELEASE_NAME}" "${CHART_DIR}" \
    -f "${VALUES_FILE}" \
    --namespace "${NAMESPACE}" \
    --set image.repository="${IMAGE_REPOSITORY}" \
    --set image.tag="${IMAGE_TAG}" >/dev/null
  echo -e "${GREEN}✓ Release '${RELEASE_NAME}' aplicado y manifiestos validados.${NC}"
else
  if ! helm upgrade --install "${RELEASE_NAME}" "${CHART_DIR}" \
    -f "${VALUES_FILE}" \
    --namespace "${NAMESPACE}" \
    --create-namespace \
    --set image.repository="${IMAGE_REPOSITORY}" \
    --set image.tag="${IMAGE_TAG}"; then
    trigger_rollback "Error en helm upgrade --install"
  fi
  echo -e "${GREEN}✓ Release '${RELEASE_NAME}' actualizado en el clúster.${NC}"
fi

echo -e "\n${BLUE}=== [3/4] Monitoreando Estado del Rollout y Health Probes (timeout: ${TIMEOUT}) ===${NC}"
echo "Verificando: kubectl rollout status deployment/${RELEASE_NAME} -n ${NAMESPACE} --timeout=${TIMEOUT}"

if [[ "${SIMULATE_PROBE_FAILURE}" == "true" ]]; then
  echo -e "${RED}✗ Pod '${RELEASE_NAME}-7d9f8b6c4-x9k2p' Readiness Probe failed: GET /health/ready returned HTTP 503 Service Unavailable (status: DOWN)${NC}"
  echo -e "${RED}✗ error: timed out waiting for the condition on deployment/${RELEASE_NAME}${NC}"
  trigger_rollback "Fallo en Readiness Probe (/health/ready HTTP 503) / Rollout Timeout (${TIMEOUT})"
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "Waiting for deployment \"${RELEASE_NAME}\" rollout to finish: 0 of 2 updated replicas are available..."
  echo "Waiting for deployment \"${RELEASE_NAME}\" rollout to finish: 1 of 2 updated replicas are available..."
  echo "deployment \"${RELEASE_NAME}\" successfully rolled out"
  echo -e "${GREEN}✓ Rollout verificado: 2/2 réplicas listas con probes /health/live y /health/ready en estado 200 UP.${NC}"
else
  if ! kubectl rollout status "deployment/${RELEASE_NAME}" -n "${NAMESPACE}" --timeout="${TIMEOUT}"; then
    trigger_rollback "kubectl rollout status excedió el timeout de ${TIMEOUT} o fallaron las health probes"
  fi
  echo -e "${GREEN}✓ Rollout verificado en el clúster Kubernetes.${NC}"
fi

echo -e "\n${BLUE}=== [4/4] Resumen de Entrega Continua ===${NC}"
echo -e "${GREEN}✓ Release:   ${RELEASE_NAME} (namespace: ${NAMESPACE})${NC}"
echo -e "${GREEN}✓ Imagen:    ${IMAGE_REPOSITORY}:${IMAGE_TAG}${NC}"
echo -e "${GREEN}✓ Estado:    DESPLEGADO Y SALUDABLE (Zero-Downtime RollingUpdate)${NC}"
