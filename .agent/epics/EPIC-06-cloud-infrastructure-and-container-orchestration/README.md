# EPIC-06: Cloud Infrastructure & Container Orchestration (Azure & Floci)

* **ID:** EPIC-06
* **Bounded Context:** `infrastructure` / `cloud-orchestration`
* **Estado:** Completed
* **Arquitectura:** Infrastructure as Code (IaC) / Cloud-Native Kubernetes / Azure Emulation / GitOps & CI/CD
* **Topología de Referencia:** [`.agent/TREE.txt`](../../TREE.txt)
* **Plataforma de Emulación:** [Floci (floci-az)](https://github.com/floci-io/floci)

---

## 1. Visión y Definición de Infraestructura

Esta épica posiciona a `identity-service` dentro de un ecosistema de nube enterprise de alta disponibilidad, resiliencia y seguridad sobre **Microsoft Azure**, resolviendo los requerimientos clave de la Job Description de Cloud / Full Stack Engineer.

Para permitir el desarrollo, prueba y validación continua en local sin incurrir en costes de suscripción ni depender de conectividad a la nube pública, la solución implementa una topología híbrida:
1. **Azure ARM Control Plane:** Emulado en local mediante **Floci** (`floci-az`), permitiendo que el provider oficial de Terraform `azurerm` descubra y gestione metadatos de recursos de Azure (AKS, PostgreSQL Flexible Server, Azure Key Vault, ACR, Azure Storage Account y Log Analytics Workspace) a través de `http://localhost:4577`.
2. **Kubernetes Runtime Execution:** Clúster Kubernetes ligero local (k3d o kind) donde se despliegan y ejecutan los Pods reales de `identity-service`, los servicios de red, probes de salud, controladores Ingress-Nginx y montaje de secretos.

---

## 2. Alcance y Vertical Slices

### 2.1. Aprovisionamiento de Recursos Azure con Terraform (US-12)
* **User Story:** [`US-12: Terraform Azure Resources Provisioning over Floci`](stories/US-12-terraform-azure-resources-provisioning.md)
* **Alcance:**
  * Arquitectura modular en `infrastructure/terraform/modules/` (`aks`, `postgres`, `keyvault`, `acr`, `storage`, `log_analytics`).
  * Configuración de entorno en `infrastructure/terraform/environments/local/` con `metadata_host = "localhost:4577"` y registro de proveedores `none`.
  * Generación declarativa de credenciales y secretos de aplicación dentro de Azure Key Vault.
* **Artefactos Principales:**
  * `infrastructure/local/floci/docker-compose.floci.yml`
  * `infrastructure/terraform/modules/*`
  * `infrastructure/terraform/environments/local/main.tf`, `variables.tf`, `outputs.tf`

### 2.2. Ingress Controller Nginx con Terminación TLS (US-13)
* **User Story:** [`US-13: Nginx Ingress Controller with TLS Termination & Local Routing`](stories/US-13-nginx-ingress-tls-routing.md)
* **Alcance:**
  * Enrutamiento de borde con Nginx Ingress Controller para el host `auth.angelpixel.local`.
  * Terminación TLS mediante Kubernetes Secret tipo `kubernetes.io/tls`.
  * Propagación de cabeceras de proxy (`X-Forwarded-Proto`, `X-Forwarded-For`, `X-Request-ID`) hacia los servicios backend de Node.js.
* **Artefactos Principales:**
  * `deployments/helm/identity-service/templates/ingress.yaml`
  * `deployments/tls/generate-local-certs.sh`

### 2.3. Empaquetado y Despliegue en Kubernetes con Helm (US-14)
* **User Story:** [`US-14: Kubernetes Deployment with Parametric Helm Chart`](stories/US-14-k8s-deployment-helm-manifests.md)
* **Alcance:**
  * Chart parametrizable en `deployments/helm/identity-service/` con `values.yaml` y `values-local.yaml`.
  * Probes de salud HTTP: Liveness (`/health/live`) y Readiness (`/health/ready`) comprobando dependencias críticas (PostgreSQL con RLS y Redis).
  * Inyección segura de secretos mediante Azure Key Vault Secrets Store CSI Driver (`SecretProviderClass`).
  * Configuración de alta disponibilidad: réplicas mínimas, `poddisruptionbudget.yaml` y `RollingUpdate`.
* **Artefactos Principales:**
  * `deployments/helm/identity-service/Chart.yaml`
  * `deployments/helm/identity-service/values.yaml`
  * `deployments/helm/identity-service/templates/deployment.yaml`
  * `deployments/helm/identity-service/templates/service.yaml`
  * `deployments/helm/identity-service/templates/secret-provider-class.yaml`

### 2.4. Automatización CI/CD Multiplataforma (US-15)
* **User Story:** [`US-15: CI/CD Pipeline Automation (GitHub Actions & CircleCI)`](stories/US-15-cicd-pipeline-azure-integration.md)
* **Alcance:**
  * Extensión del workflow de GitHub Actions (`.github/workflows/cd.yml`) para containerización Docker multi-etapa, etiquetado/push a ACR y despliegue automatizado con Helm.
  * Plantilla completa y funcional de CircleCI (`.circleci/config.yml`) estructurada con Orbs y jobs equivalentes para satisfacer al 100% los requisitos de la Job Description.
  * Verificación de despliegue mediante comprobación de rollout en Kubernetes.
* **Artefactos Principales:**
  * `Dockerfile.production`
  * `.github/workflows/cd.yml`
  * `.circleci/config.yml`

---

## 3. Hoja de Ruta de Implementación

1. **Topología de Emulación Floci:**
   * Desplegar servicio contenedorizado de Floci y verificar endpoint de metadatos ARM en `:4577`.
2. **Módulos de Terraform e IaC Local:**
   * Diseñar módulos limpios reutilizables y ejecutar `terraform plan` contra Floci.
3. **Networking y Certificados TLS Locales:**
   * Script de generación de certificados y manifiesto Ingress-Nginx.
4. **Empaquetado Helm y Health Endpoints:**
   * Desarrollar Chart y endpoints `/health/live` y `/health/ready` en el servidor HTTP Express.
5. **Pipelines Duales CI/CD:**
   * Configurar GitHub Actions CD y CircleCI config con pasos de containerización y Helm upgrade.
6. **Verificación Integral y Documentación:**
   * Validar despliegue integral y publicar artículo técnico de referencia.

---

## 4. Definición de Hecho (Definition of Done - DoD)

- [x] Terraform valida y planifica sin errores los recursos de Azure sobre Floci (`npm run test:infra`).
- [x] Ingress-Nginx enruta tráfico HTTPS hacia `auth.angelpixel.local` con certificado TLS válido (`npm run test:ingress`).
- [x] Chart de Helm despliega réplicas de `identity-service` con health probes y CSI SecretProviderClass (`npm run test:helm`).
- [x] Pipelines duales (GitHub Actions + CircleCI) sintáctica y estructuralmente validados (`npm run test:cicd`).
- [x] Trazabilidad completa en [`TRACEABILITY_MATRIX.md`](../../memory/TRACEABILITY_MATRIX.md) con estado `Completed`.
- [x] Artículo técnico documentado en `.agent/publications/` (`ARTICLE-12-cloud-infrastructure-azure-floci.md`).
