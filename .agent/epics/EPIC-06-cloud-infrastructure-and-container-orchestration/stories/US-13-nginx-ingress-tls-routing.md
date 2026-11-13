---
id: US-13
title: "Nginx Ingress Controller with TLS Termination & Local Routing"
epic:
  id: EPIC-06
  name: "Cloud Infrastructure & Container Orchestration (Azure & Floci)"
status: planned
priority: P1
bounded_context: infrastructure
subdomain: ingress-networking
slice_type: networking
timestamps:
  created_at: "2026-11-10T14:15:00-03:00"
  started_at: null
  completed_at: null
  updated_at: "2026-11-10T14:15:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-14-nginx-ingress-tls-setup.md
  publications:
    - .agent/publications/ARTICLE-12-cloud-infrastructure-azure-floci.md
  commits: []
tags:
  - nginx
  - ingress
  - tls
  - ssl
  - certificates
  - routing
  - kubernetes
---

# US-13: Nginx Ingress Controller with TLS Termination & Local Routing

**Epic:** [EPIC-06: Cloud Infrastructure & Container Orchestration (Azure & Floci)](../README.md)  
**Status:** Planned  
**Domain / Bounded Context:** `infrastructure` / `ingress-networking`  
**Slice Type:** Networking & Edge Security Slice  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  

---

## 1. Descripción

**Como** Ingeniero de Plataforma / DevOps y Desarrollador Full Stack,  
**Quiero** desplegar y configurar un Nginx Ingress Controller con terminación TLS y enrutamiento hacia el host local `auth.angelpixel.local`,  
**Para** garantizar una capa de borde HTTP segura con cifrado SSL/TLS, redirección HTTPS obligatoria y propagación confiable de cabeceras de proxy (`X-Forwarded-*`) hacia los pods de `identity-service`.

---

## 2. Reglas Técnicas e Invariantes de Red

1. **Ingress Resource Estandarizado (`ingressClassName: nginx`):**
   * El tráfico de entrada se gestiona mediante un recurso `Ingress` estándar de Kubernetes compatible con el controlador oficial Ingress-Nginx.
2. **Terminación TLS mediante Kubernetes Secret:**
   * La terminación SSL/TLS ocurre en el borde del clúster (Ingress Controller).
   * El certificado y la clave privada se almacenan en un recurso `Secret` de Kubernetes tipo `kubernetes.io/tls` denominado `identity-tls-secret`.
   * Se provee un script automatizado `deployments/tls/generate-local-certs.sh` para emitir certificados locales con extensiones SAN (*Subject Alternative Name*) para `auth.angelpixel.local` y `localhost`.
3. **Reglas de Enrutamiento y Mapeo de Servicios:**
   * Host principal: `auth.angelpixel.local`.
   * Enrutamiento de todas las rutas de la API (`/api/v1/auth`, `/api/v1/oauth2`, `/api/v1/users`, `/federation`, `/.well-known/`) hacia el Service `identity-service` en el puerto `4000`.
   * Exposición directa de probes de diagnóstico (`/health/live`, `/health/ready`).
4. **Endurecimiento de Cabeceras y Políticas Nginx:**
   * Forzar redirección HTTPS (`nginx.ingress.kubernetes.io/ssl-redirect: "true"`).
   * Propagación de cabeceras de cliente real: `X-Forwarded-For`, `X-Forwarded-Proto: https`, `X-Forwarded-Host`, `X-Real-IP`.
   * Buffer de cabeceras optimizado para tokens JWT y cabeceras de federación (`proxy-buffer-size: "128k"`).
   * Inyección o preservación de `X-Request-ID` para correlación distribuida de trazas.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Nginx Ingress Controller with TLS Termination
  As a Platform Engineer
  I want to route incoming HTTPS traffic through Nginx Ingress to identity-service
  So that edge traffic is encrypted and reverse-proxy headers are preserved

  Scenario: Generating local TLS certificates and Secret
    Given the certificate generation script "deployments/tls/generate-local-certs.sh"
    When the script is executed for domain "auth.angelpixel.local"
    Then it must output a valid x509 certificate and private key
    And the certificate must include SAN for "auth.angelpixel.local"
    And a Kubernetes TLS Secret "identity-tls-secret" should be creatable from the files

  Scenario: HTTPS Routing and TLS termination
    Given the Ingress resource is deployed targeting "auth.angelpixel.local"
    When an HTTP request is made to "http://auth.angelpixel.local/health/live"
    Then Ingress-Nginx must return a 308 Permanent Redirect to "https://auth.angelpixel.local/health/live"
    And an HTTPS request to "https://auth.angelpixel.local/health/live" must return HTTP 200 OK
    And the downstream pod must receive the "X-Forwarded-Proto: https" header
```

---

## 4. Definición de Hecho (DoD)

- [ ] Script `deployments/tls/generate-local-certs.sh` funcional con SAN para `auth.angelpixel.local`.
- [ ] Plantilla Ingress en el Helm Chart (`deployments/helm/identity-service/templates/ingress.yaml`).
- [ ] Redirección forzada de HTTP a HTTPS verificada.
- [ ] Cabeceras `X-Forwarded-*` correctamente recibidas en el servidor Express.
- [ ] Registro en `TRACEABILITY_MATRIX.md`.
