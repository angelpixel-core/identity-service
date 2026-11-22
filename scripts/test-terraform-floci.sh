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

TF_ACTION="plan"
if [[ "${1:-}" == "--apply" ]]; then
  TF_ACTION="apply"
elif [[ -n "${1:-}" ]]; then
  echo -e "${RED}Error: Unknown option '${1}'. Usage: $0 [--apply]${NC}"
  exit 1
fi

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
echo "Syncing TLS certificates from floci-azure-arm container..."
docker exec floci-azure-arm cat /app/data/tls/floci-az-selfsigned.crt > "${TLS_DIR}/floci-az.crt"
docker exec floci-azure-arm cat /app/data/tls/floci-az-selfsigned.key > "${TLS_DIR}/floci-az.key"
if docker exec floci-azure-arm test -f /app/data/tls/floci-az-selfsigned-ca.crt; then
  docker exec floci-azure-arm cat /app/data/tls/floci-az-selfsigned-ca.crt > "${TLS_DIR}/floci-az-ca.crt"
else
  cp "${TLS_DIR}/floci-az.crt" "${TLS_DIR}/floci-az-ca.crt"
fi

CA_BUNDLE="${TLS_DIR}/floci-ca-bundle.pem"
if [[ -f "/etc/ssl/cert.pem" ]]; then
  cat /etc/ssl/cert.pem "${TLS_DIR}/floci-az-ca.crt" > "${CA_BUNDLE}"
elif [[ -f "/etc/ssl/certs/ca-certificates.crt" ]]; then
  cat /etc/ssl/certs/ca-certificates.crt "${TLS_DIR}/floci-az-ca.crt" > "${CA_BUNDLE}"
else
  cp "${TLS_DIR}/floci-az-ca.crt" "${CA_BUNDLE}"
fi

# On macOS, Go's azurerm provider validates TLS against Security.framework Keychain.
if [[ "$(uname -s)" == "Darwin" ]] && command -v security >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1; then
  CA_SHA256="$(openssl x509 -in "${TLS_DIR}/floci-az-ca.crt" -noout -fingerprint -sha256 | sed 's/.*=//;s/://g')"
  if ! security find-certificate -a -Z -c "floci-az-ca" "${HOME}/Library/Keychains/login.keychain-db" 2>/dev/null | grep -qi "${CA_SHA256}"; then
    echo "Trusting Floci CA certificate in macOS login Keychain (may prompt for Touch ID / password)..."
    security add-trusted-cert -r trustRoot -k "${HOME}/Library/Keychains/login.keychain-db" "${TLS_DIR}/floci-az-ca.crt"
  fi
fi

PROXY_PID=""
# Check if port 4578 is already listening
if ! lsof -i :4578 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Starting background Floci ARM proxy on port 4578..."
  node "${PROXY_SCRIPT}" &
  PROXY_PID=$!
  
  # Wait for proxy liveness via dedicated diagnostic endpoint
  READY=false
  for _ in {1..20}; do
    if curl -sk https://localhost:4578/__proxy_health >/dev/null 2>&1; then
      READY=true
      break
    fi
    sleep 0.2
  done
  if [[ "${READY}" != "true" ]]; then
    echo -e "${RED}Error: Floci ARM proxy failed to start within timeout.${NC}"
    exit 1
  fi
else
  echo "Proxy already active on port 4578."
fi

cleanup() {
  local exit_code=$?
  if [[ -n "${PROXY_PID}" ]]; then
    echo "Stopping test proxy process (PID ${PROXY_PID})..."
    kill -TERM "${PROXY_PID}" 2>/dev/null || true
    wait "${PROXY_PID}" 2>/dev/null || true
  fi
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM HUP

echo -e "${GREEN}✓ Floci ARM Proxy is ready and verified via /__proxy_health.${NC}"

echo -e "\n${BLUE}=== [4/5] Validating Terraform Modules & Providers ===${NC}"
TF_CLI_CONFIG_FILE=/dev/null terraform -chdir="${TF_ENV_DIR}" validate
echo -e "${GREEN}✓ Terraform configuration is valid.${NC}"

echo -e "\n${BLUE}=== [5/5] Executing Terraform ${TF_ACTION} against Floci Emulator ===${NC}"
if [[ "${TF_ACTION}" == "apply" ]]; then
  SSL_CERT_FILE="${CA_BUNDLE}" TF_CLI_CONFIG_FILE=/dev/null terraform -chdir="${TF_ENV_DIR}" apply -auto-approve -no-color
else
  SSL_CERT_FILE="${CA_BUNDLE}" TF_CLI_CONFIG_FILE=/dev/null terraform -chdir="${TF_ENV_DIR}" plan -no-color
fi

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✓ All infrastructure tests passed! US-12 verification complete.${NC}"
echo -e "${GREEN}================================================================${NC}"
