#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Automated Verification Suite for CI/CD Pipelines & Rollback Guard (US-15)
# Verifies all 3 BDD Acceptance Scenarios:
# 1. Multi-stage production build (non-root user, no .ts/devDeps, < 250MB)
# 2. GitHub Actions (.github/workflows/cd.yml) & CircleCI (.circleci/config.yml)
# 3. Atomic Helm rollout, immutable tag policy & automatic rollback on 503 probe
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

SHORT_SHA="$(git rev-parse --short=7 HEAD 2>/dev/null || echo 'a1b2c3d')"
PKG_VERSION="$(node -p "require('./package.json').version")"
SHA_TAG="sha-${SHORT_SHA}"
SEMVER_TAG="v${PKG_VERSION}"
IMAGE_REPO="idlocalacr.azurecr.io/identity-service"

echo -e "${BLUE}=== [1/5] Escenario BDD 1: Build Multi-Etapa Productivo (Dockerfile.production) ===${NC}"
docker build -f Dockerfile.production \
  -t "${IMAGE_REPO}:${SHA_TAG}" \
  -t "${IMAGE_REPO}:${SEMVER_TAG}" \
  . >/dev/null

EFFECTIVE_USER="$(docker run --rm --entrypoint whoami "${IMAGE_REPO}:${SHA_TAG}")"
if [[ "${EFFECTIVE_USER}" != "node" ]]; then
  echo -e "${RED}Error: El contenedor debe ejecutarse como 'node', pero devolvió '${EFFECTIVE_USER}'${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Usuario no-root verificado dentro de la imagen: ${EFFECTIVE_USER} (UID 1000)${NC}"

TS_FILES="$(docker run --rm --entrypoint sh "${IMAGE_REPO}:${SHA_TAG}" -c "find /app/dist -name '*.ts' | wc -l" | tr -d ' ')"
if [[ "${TS_FILES}" != "0" ]]; then
  echo -e "${RED}Error: Se encontraron ${TS_FILES} archivos fuente .ts en la imagen de producción${NC}"
  exit 1
fi

if docker run --rm --entrypoint sh "${IMAGE_REPO}:${SHA_TAG}" -c "test -d /app/node_modules/typescript || test -d /app/node_modules/jest"; then
  echo -e "${RED}Error: Se detectaron devDependencies (typescript/jest) en la imagen de producción${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Aislamiento de artefactos verificado: 0 archivos .ts y 0 devDependencies en el runner.${NC}"

SIZE_BYTES="$(docker image inspect "${IMAGE_REPO}:${SHA_TAG}" --format '{{.Size}}')"
SIZE_MB=$((SIZE_BYTES / 1024 / 1024))
if [[ "${SIZE_BYTES}" -ge 262144000 ]]; then
  echo -e "${RED}Error: El tamaño de la imagen (${SIZE_MB}MB) supera el límite de 250MB${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Tamaño de imagen optimizado: ${SIZE_MB}MB (< 250MB límite máximo).${NC}"

echo -e "\n${BLUE}=== [2/5] Escenario BDD 2: Validación Estructural de Pipelines (.github/workflows/cd.yml & .circleci/config.yml) ===${NC}"
node -e '
const fs = require("fs");
const yaml = require("yaml");

const ghaRaw = fs.readFileSync(".github/workflows/cd.yml", "utf8");
const gha = yaml.parse(ghaRaw);
if (!gha.jobs["verify-and-lint-helm"] || !gha.jobs["build-and-publish-acr"] || !gha.jobs["deploy-aks-helm"]) {
  throw new Error("Missing required jobs in .github/workflows/cd.yml");
}
if (!ghaRaw.includes("Dockerfile.production") || !ghaRaw.includes("deploy-helm-rollout.sh")) {
  throw new Error(".github/workflows/cd.yml must reference Dockerfile.production and deploy-helm-rollout.sh");
}
console.log("✓ Workflow GitHub Actions (.github/workflows/cd.yml) validado sintáctica y estructuralmente.");

const cciRaw = fs.readFileSync(".circleci/config.yml", "utf8");
const cci = yaml.parse(cciRaw);
if (cci.version !== 2.1) throw new Error("CircleCI config must be version 2.1");
for (const orb of ["node", "docker", "azure-cli", "helm", "kubernetes"]) {
  if (!cci.orbs[orb]) throw new Error(`Missing orb ${orb} in .circleci/config.yml`);
}
if (!cci.jobs["quality-and-helm-gate"] || !cci.jobs["build-and-publish-acr"] || !cci.jobs["deploy-aks-with-rollback"]) {
  throw new Error("Missing required jobs in .circleci/config.yml");
}
const wfJobs = cci.workflows["continuous-delivery-azure-aks"].jobs;
const hasApproval = wfJobs.some((j) => j["hold-production-approval"] && j["hold-production-approval"].type === "approval");
if (!hasApproval) throw new Error("Missing manual approval gate in .circleci/config.yml");
console.log("✓ Pipeline CircleCI 2.1 (.circleci/config.yml) con Orbs y gate de aprobación validado.");
'

echo -e "\n${BLUE}=== [3/5] Verificando Rechazo de Etiqueta Mutable ':latest' ===${NC}"
if bash scripts/deploy-helm-rollout.sh --dry-run --image-tag latest >/dev/null 2>&1; then
  echo -e "${RED}Error: deploy-helm-rollout.sh permitió el tag prohibido 'latest'${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Política de inmutabilidad verificada: tag ':latest' bloqueado correctamente.${NC}"

echo -e "\n${BLUE}=== [4/5] Verificando Rollout Exitoso con Etiqueta Inmutable (${SHA_TAG}) ===${NC}"
bash scripts/deploy-helm-rollout.sh \
  --dry-run \
  --registry "idlocalacr.azurecr.io" \
  --image-tag "${SHA_TAG}" \
  --values "deployments/helm/identity-service/values-local.yaml" \
  --timeout 120s

echo -e "\n${BLUE}=== [5/5] Escenario BDD 3: Verificando Rollback Automático ante Fallo de Health Probes (503 DOWN) ===${NC}"
set +e
ROLLBACK_OUTPUT="$(bash scripts/deploy-helm-rollout.sh \
  --dry-run \
  --simulate-probe-failure \
  --registry "idlocalacr.azurecr.io" \
  --image-tag "${SHA_TAG}" \
  --values "deployments/helm/identity-service/values-local.yaml" 2>&1)"
ROLLBACK_EXIT_CODE=$?
set -e

if [[ "${ROLLBACK_EXIT_CODE}" -eq 0 ]]; then
  echo -e "${RED}Error: El script debía fallar con exit code != 0 tras activar el rollback automático${NC}"
  exit 1
fi

if ! echo "${ROLLBACK_OUTPUT}" | grep -q "helm rollback identity-service 0"; then
  echo -e "${RED}Error: No se invocó 'helm rollback identity-service 0' ante el fallo de health probes${NC}"
  echo "${ROLLBACK_OUTPUT}"
  exit 1
fi
echo -e "${GREEN}✓ Circuit Breaker verificado: Fallo en /health/ready disparó 'helm rollback identity-service 0' y detuvo el pipeline (exit code ${ROLLBACK_EXIT_CODE}).${NC}"

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✓ Todas las pruebas de automatización CI/CD (US-15) pasaron con éxito.${NC}"
echo -e "${GREEN}================================================================${NC}"

