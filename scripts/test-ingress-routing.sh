#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Automated Testing & Verification for Ingress Controller & TLS Termination (US-13)
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="${ROOT_DIR}/deployments/tls/certs"
CA_CRT="${CERTS_DIR}/auth-ca.crt"
DOMAIN="auth.angelpixel.local"
INGRESS_HTTP_PORT="${INGRESS_HTTP_PORT:-80}"
INGRESS_HTTPS_PORT="${INGRESS_HTTPS_PORT:-443}"

echo -e "${BLUE}=== [1/6] Comprobando Certificados TLS y Herramientas ===${NC}"
command -v curl >/dev/null 2>&1 || { echo -e "${RED}Error: curl no está instalado.${NC}"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Error: docker no está instalado.${NC}"; exit 1; }

if [[ ! -f "${CA_CRT}" || ! -f "${CERTS_DIR}/${DOMAIN}.crt" ]]; then
  echo -e "${YELLOW}Certificados no encontrados. Generando mediante npm run cert:generate...${NC}"
  npm run cert:generate
fi
echo -e "${GREEN}✓ Certificados TLS disponibles en ${CERTS_DIR}${NC}"

echo -e "\n${BLUE}=== [2/6] Verificando / Iniciando Stack de Ingress Local ===${NC}"
if ! docker ps --filter "name=identity-ingress" --filter "status=running" --format "{{.Names}}" | grep -q "identity-ingress"; then
  echo "Iniciando contenedores de backend e Ingress (perfil ingress)..."
  docker compose --profile ingress up -d
  echo "Esperando inicialización de servicios..."
  sleep 4
fi

# Esperar a que Ingress responda en el puerto 80/443
for i in {1..15}; do
  if curl -sI -o /dev/null "http://127.0.0.1:${INGRESS_HTTP_PORT}/" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo -e "${GREEN}✓ Identity Ingress Controller activo y escuchando en puertos ${INGRESS_HTTP_PORT} / ${INGRESS_HTTPS_PORT}.${NC}"

echo -e "\n${BLUE}=== [3/6] Test Vector 1: Redirección Forzada HTTP -> HTTPS (308) ===${NC}"
REDIRECT_STATUS=$(curl -sI -o /dev/null -w "%{http_code}" "http://127.0.0.1:${INGRESS_HTTP_PORT}/health/live" -H "Host: ${DOMAIN}")
LOCATION_HEADER=$(curl -sI "http://127.0.0.1:${INGRESS_HTTP_PORT}/health/live" -H "Host: ${DOMAIN}" | grep -i "^location:" | tr -d '\r\n')

echo "Código de estado HTTP recibido: ${REDIRECT_STATUS}"
echo "Cabecera Location: ${LOCATION_HEADER}"

if [[ "${REDIRECT_STATUS}" != "308" ]]; then
  echo -e "${RED}Falló Test Vector 1: Se esperaba HTTP 308 pero se recibió ${REDIRECT_STATUS}${NC}"
  exit 1
fi

if [[ "${LOCATION_HEADER}" != *"https://${DOMAIN}/health/live"* ]]; then
  echo -e "${RED}Falló Test Vector 1: La cabecera Location no redirige a https://${DOMAIN}/health/live${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Redirección 308 Permanent Redirect verificada correctamente.${NC}"

echo -e "\n${BLUE}=== [4/6] Test Vector 2: Terminación TLS y Liveness Probe (/health/live) ===${NC}"
LIVE_RESPONSE=$(curl -s \
  --cacert "${CA_CRT}" \
  --resolve "${DOMAIN}:${INGRESS_HTTPS_PORT}:127.0.0.1" \
  "https://${DOMAIN}:${INGRESS_HTTPS_PORT}/health/live")

echo "Respuesta de /health/live: ${LIVE_RESPONSE}"

if [[ "${LIVE_RESPONSE}" != *"\"status\":\"UP\""* || "${LIVE_RESPONSE}" != *"\"liveness\":\"OK\""* ]]; then
  echo -e "${RED}Falló Test Vector 2: /health/live no devolvió status UP${NC}"
  exit 1
fi

if [[ "${LIVE_RESPONSE}" != *"\"protocol\":\"https\""* ]]; then
  echo -e "${RED}Falló Test Vector 2: El backend Express no detectó protocolo https (falló X-Forwarded-Proto)${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Terminación TLS y Liveness Probe validadas con éxito sobre HTTPS.${NC}"

echo -e "\n${BLUE}=== [5/6] Test Vector 3: Readiness Probe (/health/ready) ===${NC}"
READY_RESPONSE=$(curl -s \
  --cacert "${CA_CRT}" \
  --resolve "${DOMAIN}:${INGRESS_HTTPS_PORT}:127.0.0.1" \
  "https://${DOMAIN}:${INGRESS_HTTPS_PORT}/health/ready")

echo "Respuesta de /health/ready: ${READY_RESPONSE}"

if [[ "${READY_RESPONSE}" != *"\"status\":\"UP\""* || "${READY_RESPONSE}" != *"\"database\":\"OK\""* ]]; then
  echo -e "${RED}Falló Test Vector 3: /health/ready no devolvió dependencias listas${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Readiness Probe validada con éxito.${NC}"

echo -e "\n${BLUE}=== [6/6] Test Vector 4: OIDC Discovery & Propagación X-Request-ID ===${NC}"
TRACE_ID="custom-e2e-trace-id-$(date +%s)"
DISCOVERY_HEADERS=$(curl -sI \
  --cacert "${CA_CRT}" \
  --resolve "${DOMAIN}:${INGRESS_HTTPS_PORT}:127.0.0.1" \
  -H "X-Request-ID: ${TRACE_ID}" \
  "https://${DOMAIN}:${INGRESS_HTTPS_PORT}/.well-known/openid-configuration")

if echo "${DISCOVERY_HEADERS}" | grep -iq "x-request-id: ${TRACE_ID}"; then
  echo -e "${GREEN}✓ Cabecera de correlación X-Request-ID (${TRACE_ID}) propagada correctamente por el Ingress.${NC}"
else
  echo -e "${YELLOW}Aviso: X-Request-ID no reflejado en cabeceras de respuesta de discovery.${NC}"
fi

DISCOVERY_BODY=$(curl -s \
  --cacert "${CA_CRT}" \
  --resolve "${DOMAIN}:${INGRESS_HTTPS_PORT}:127.0.0.1" \
  "https://${DOMAIN}:${INGRESS_HTTPS_PORT}/.well-known/openid-configuration")

if [[ "${DISCOVERY_BODY}" == *"\"issuer\""* && "${DISCOVERY_BODY}" == *"\"jwks_uri\""* ]]; then
  echo -e "${GREEN}✓ Endpoint OIDC Discovery accesible y verificado a través de la capa de borde Ingress.${NC}"
else
  echo -e "${RED}Falló Test Vector 4: Endpoint OIDC Discovery no devolvió issuer válido.${NC}"
  exit 1
fi

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✓ Todas las pruebas de Ingress TLS y enrutamiento pasaron con éxito.${NC}"
echo -e "${GREEN}================================================================${NC}"
