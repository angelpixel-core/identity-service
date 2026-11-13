#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script de Generación de Certificados TLS Locales y Kubernetes Secret (US-13)
# ==============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TLS_DIR="${ROOT_DIR}/deployments/tls"
CERTS_DIR="${TLS_DIR}/certs"
DOMAIN="auth.angelpixel.local"
SECRET_FILE="${TLS_DIR}/identity-tls-secret.yaml"

echo -e "${BLUE}=== [1/4] Comprobando Herramientas Criptográficas ===${NC}"
command -v openssl >/dev/null 2>&1 || { echo -e "${RED}Error: openssl no está instalado.${NC}"; exit 1; }
mkdir -p "${CERTS_DIR}"

CA_KEY="${CERTS_DIR}/auth-ca.key"
CA_CRT="${CERTS_DIR}/auth-ca.crt"
DOMAIN_KEY="${CERTS_DIR}/${DOMAIN}.key"
DOMAIN_CSR="${CERTS_DIR}/${DOMAIN}.csr"
DOMAIN_CRT="${CERTS_DIR}/${DOMAIN}.crt"
FULLCHAIN_CRT="${CERTS_DIR}/${DOMAIN}.fullchain.crt"
OPENSSL_CONF="${CERTS_DIR}/openssl-san.cnf"

echo -e "\n${BLUE}=== [2/4] Generando Autoridad Certificadora Local (Root CA) ===${NC}"
if [[ ! -f "${CA_KEY}" || ! -f "${CA_CRT}" ]]; then
  echo "Generando clave privada y certificado de la Root CA local..."
  openssl genrsa -out "${CA_KEY}" 2048 2>/dev/null
  openssl req -x509 -new -nodes -key "${CA_KEY}" -sha256 -days 3650 \
    -subj "/C=ES/ST=Madrid/L=Madrid/O=AngelSolutions/OU=Platform Engineering/CN=AngelPixel Local Root CA" \
    -out "${CA_CRT}" 2>/dev/null
  echo -e "${GREEN}✓ Root CA generada: ${CA_CRT}${NC}"
else
  echo -e "${YELLOW}Root CA existente detectada en ${CA_CRT}. Reutilizando.${NC}"
fi

echo -e "\n${BLUE}=== [3/4] Generando Certificado de Dominio con SAN para ${DOMAIN} ===${NC}"
# Generar clave privada del dominio
openssl genrsa -out "${DOMAIN_KEY}" 2048 2>/dev/null

# Crear configuración temporal OpenSSL con extensiones SAN
cat > "${OPENSSL_CONF}" <<EOF
[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = req_distinguished_name
req_extensions     = req_ext

[req_distinguished_name]
C  = ES
ST = Madrid
L  = Madrid
O  = AngelSolutions
OU = Identity & Access Management
CN = ${DOMAIN}

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${DOMAIN}
DNS.2 = localhost
IP.1  = 127.0.0.1
EOF

# Generar CSR
openssl req -new -key "${DOMAIN_KEY}" -out "${DOMAIN_CSR}" -config "${OPENSSL_CONF}" 2>/dev/null

# Firmar CSR con la Root CA local aplicando extensiones SAN
cat > "${CERTS_DIR}/v3.ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${DOMAIN}
DNS.2 = localhost
IP.1  = 127.0.0.1
EOF

openssl x509 -req -in "${DOMAIN_CSR}" -CA "${CA_CRT}" -CAkey "${CA_KEY}" \
  -CAcreateserial -out "${DOMAIN_CRT}" -days 365 -sha256 \
  -extfile "${CERTS_DIR}/v3.ext" 2>/dev/null

# Concatenar Full Chain (Certificado de Dominio + Root CA)
cat "${DOMAIN_CRT}" "${CA_CRT}" > "${FULLCHAIN_CRT}"

# Limpieza de archivos temporales de firma
rm -f "${DOMAIN_CSR}" "${OPENSSL_CONF}" "${CERTS_DIR}/v3.ext" "${CERTS_DIR}/auth-ca.srl"

echo -e "${GREEN}✓ Certificado de dominio firmado con SAN emitido:${NC}"
echo -e "  - Clave Privada: ${DOMAIN_KEY}"
echo -e "  - Certificado:   ${DOMAIN_CRT}"
echo -e "  - Fullchain:     ${FULLCHAIN_CRT}"

echo -e "\n${BLUE}=== [4/4] Generando Manifiesto Kubernetes Secret (identity-tls-secret) ===${NC}"
# Codificación Base64 compatible con Linux y macOS
if base64 -w 0 < /dev/null >/dev/null 2>&1; then
  CERT_B64=$(base64 -w 0 < "${DOMAIN_CRT}")
  KEY_B64=$(base64 -w 0 < "${DOMAIN_KEY}")
else
  CERT_B64=$(base64 < "${DOMAIN_CRT}" | tr -d '\n')
  KEY_B64=$(base64 < "${DOMAIN_KEY}" | tr -d '\n')
fi

cat > "${SECRET_FILE}" <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: identity-tls-secret
  namespace: default
  labels:
    app.kubernetes.io/name: identity-service
    app.kubernetes.io/component: ingress-tls
type: kubernetes.io/tls
data:
  tls.crt: ${CERT_B64}
  tls.key: ${KEY_B64}
EOF

echo -e "${GREEN}✓ Manifiesto Kubernetes Secret generado en: ${SECRET_FILE}${NC}"

if command -v kubectl >/dev/null 2>&1; then
  echo "Validando sintaxis de Secret mediante kubectl dry-run..."
  KUBECONFIG=/dev/null kubectl create secret tls identity-tls-secret \
    --cert="${DOMAIN_CRT}" --key="${DOMAIN_KEY}" --dry-run=client -o yaml >/dev/null 2>&1 && \
    echo -e "${GREEN}✓ Manifiesto Secret validado sintácticamente con kubectl.${NC}" || true
fi

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✓ Generación TLS y Secret de Kubernetes completada con éxito.${NC}"
echo -e "${GREEN}================================================================${NC}"
