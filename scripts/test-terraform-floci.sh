#!/usr/bin/env bash
set -eo pipefail

# ==============================================================================
# Automated Testing & Validation for Terraform Provisioning on Floci (Azure ARM)
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_ENV_DIR="${ROOT_DIR}/infrastructure/terraform/environments/local"
TLS_DIR="${ROOT_DIR}/infrastructure/local/floci/.tls"
PROXY_SCRIPT="${ROOT_DIR}/scripts/floci-proxy.mjs"

echo -e "${BLUE}=== [1/5] Checking Prerequisites & Formatting ===${NC}"
command -v terraform >/dev/null 2>&1 || { echo -e "${RED}Error: terraform CLI is not installed.${NC}"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Error: docker is not installed.${NC}"; exit 1; }
command -v node >/dev/null 2>&1 || { echo -e "${RED}Error: node is not installed.${NC}"; exit 1; }

echo -e "Validating Terraform code formatting across infrastructure/terraform..."
TF_CLI_CONFIG_FILE=/dev/null terraform fmt -check -recursive "${ROOT_DIR}/infrastructure/terraform"
echo -e "${GREEN}✓ Terraform formatting is pristine.${NC}"

echo -e "\n${BLUE}=== [2/5] Checking Floci Azure ARM Emulator Container ===${NC}"
if ! docker ps --filter "name=floci-azure-arm" --filter "status=running" --format "{{.Names}}" | grep -q "floci-azure-arm"; then
  echo -e "${YELLOW}Floci container is not running. Starting via npm run docker:cloud...${NC}"
  npm run docker:cloud
  sleep 4
fi

# Verify health endpoint on port 4577
echo "Verifying Floci HTTP health endpoint..."
if ! curl -sf http://localhost:4577/_floci/health >/dev/null 2>&1; then
  echo -e "${RED}Error: Floci healthcheck failed on http://localhost:4577/_floci/health${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Floci Azure ARM emulator is healthy on port 4577.${NC}"

echo -e "\n${BLUE}=== [3/5] Setting up Floci ARM Proxy & TLS ===${NC}"
mkdir -p "${TLS_DIR}"
if [[ ! -f "${TLS_DIR}/floci-az.crt" || ! -f "${TLS_DIR}/floci-az.key" ]]; then
  echo "Extracting TLS certificates from floci-azure-arm container..."
  docker exec floci-azure-arm cat /app/data/tls/floci-az-selfsigned.crt > "${TLS_DIR}/floci-az.crt"
  docker exec floci-azure-arm cat /app/data/tls/floci-az-selfsigned.key > "${TLS_DIR}/floci-az.key"
fi

PROXY_PID=""
# Check if port 4578 is already listening
if ! lsof -i :4578 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Starting background Floci ARM proxy on port 4578..."
  node "${PROXY_SCRIPT}" &
  PROXY_PID=$!
  sleep 2
else
  echo "Proxy already active on port 4578."
fi

cleanup() {
  if [[ -n "${PROXY_PID}" ]]; then
    echo "Stopping test proxy process (PID ${PROXY_PID})..."
    kill "${PROXY_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo -e "${GREEN}✓ Floci ARM Proxy is ready.${NC}"

echo -e "\n${BLUE}=== [4/5] Validating Terraform Modules & Providers ===${NC}"
TF_CLI_CONFIG_FILE=/dev/null terraform -chdir="${TF_ENV_DIR}" validate
echo -e "${GREEN}✓ Terraform configuration is valid.${NC}"

echo -e "\n${BLUE}=== [5/5] Executing Terraform Plan against Floci Emulator ===${NC}"
TF_CLI_CONFIG_FILE=/dev/null terraform -chdir="${TF_ENV_DIR}" plan -no-color

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✓ All infrastructure tests passed! US-12 verification complete.${NC}"
echo -e "${GREEN}================================================================${NC}"
