# EPIC-06: Cloud Infrastructure & Container Orchestration (Azure & Floci)

* **ID:** EPIC-06
* **Bounded Context:** `infrastructure` / `cloud-orchestration` / `security` / `devops`
* **Estado:** Completed
* **Arquitectura:** Infrastructure as Code (IaC) / Cloud-Native Kubernetes / Azure Emulation / GitOps & CI/CD / Inside-Out Hardening
* **Topología de Referencia:** [`.agent/TREE.txt`](../../TREE.txt)
* **Plataforma de Emulación:** [Floci (floci-az)](https://github.com/floci-io/floci)

> **Objetivo Estratégico (Requerimiento Original):**  
> Desplegar y orquestar el ecosistema del `identity-service` sobre servicios emulados de Azure mediante Terraform y Kubernetes.

---

## 1. Resumen Ejecutivo de Historias de Usuario

| Historia | Archivo de Especificación | Alcance y Entregable Principal | Estado |
| :--- | :--- | :--- | :--- |
| **US-12** | [`US-12-terraform-azure-resources-provisioning.md`](stories/US-12-terraform-azure-resources-provisioning.md) | Aprovisionamiento con Terraform de AKS, PostgreSQL Flexible Server, Key Vault, ACR y Storage Account sobre Floci ARM. | Completed |
| **US-13** | [`US-13-nginx-ingress-tls-routing.md`](stories/US-13-nginx-ingress-tls-routing.md) | Configuración de Nginx Ingress Controller con terminación TLS y enrutamiento de dominios locales/DNS (`auth.angelpixel.local`). | Completed |
| **US-14** | [`US-14-k8s-deployment-helm-manifests.md`](stories/US-14-k8s-deployment-helm-manifests.md) | Empaquetado y despliegue del identity-service en AKS mediante Helm Chart con probes de liveness/readiness y SecretProviderClass CSI. | Completed |
| **US-15** | [`US-15-cicd-pipeline-azure-integration.md`](stories/US-15-cicd-pipeline-azure-integration.md) | Automatización del pipeline de CI/CD para construcción en ACR y despliegue automatizado en AKS con rollback circuit breaker. | Completed |

---

## 2. Visión y Topología de Infraestructura

Esta épica posiciona a `identity-service` dentro de un ecosistema de nube enterprise de alta disponibilidad, resiliencia y seguridad sobre **Microsoft Azure**, resolviendo los requerimientos clave de la Job Description de Cloud / Full Stack Engineer.

Para permitir el desarrollo, prueba y validación continua en local sin incurrir en costes de suscripción ni depender de conectividad a la nube pública, la solución implementa una topología híbrida:
1. **Azure ARM Control Plane:** Emulado en local mediante **Floci** (`floci-az`), permitiendo que el provider oficial de Terraform `azurerm` descubra y gestione metadatos de 17 recursos de Azure (AKS, PostgreSQL Flexible Server, Azure Key Vault, ACR, Azure Storage Account y Log Analytics Workspace) a través de `https://localhost:4578` (proxy intermedio con endpoint `/__proxy_health`).
2. **Kubernetes Runtime Execution:** Clúster Kubernetes ligero local (k3d o kind) donde se despliegan y ejecutan los Pods reales de `identity-service`, los servicios de red, probes de salud, controladores Ingress-Nginx y montaje de secretos.

---

## 3. Alcance Detallado por Vertical Slice

### 3.1. Aprovisionamiento de Recursos Azure con Terraform (US-12)
* **User Story:** [`US-12: Terraform Azure Resources Provisioning over Floci`](stories/US-12-terraform-azure-resources-provisioning.md)
* **Alcance:**
  * Arquitectura modular en `infrastructure/terraform/modules/` (`aks`, `postgres`, `keyvault`, `acr`, `storage`, `log_analytics`).
  * Configuración de entorno en `infrastructure/terraform/environments/local/` con `metadata_host = "localhost:4577"` y registro de proveedores `none`.
  * Generación declarativa de credenciales y secretos de aplicación dentro de Azure Key Vault.
* **Artefactos Principales:**
  * `infrastructure/local/floci/docker-compose.floci.yml`
  * `infrastructure/terraform/modules/*`
  * `infrastructure/terraform/environments/local/main.tf`, `variables.tf`, `outputs.tf`
  * `scripts/floci-proxy.mjs` & `scripts/test-terraform-floci.sh`

### 3.2. Ingress Controller Nginx con Terminación TLS (US-13)
* **User Story:** [`US-13: Nginx Ingress Controller with TLS Termination & Local Routing`](stories/US-13-nginx-ingress-tls-routing.md)
* **Alcance:**
  * Enrutamiento de borde con Nginx Ingress Controller para el host canónico `auth.angelpixel.local`.
  * Terminación TLS mediante Kubernetes Secret tipo `kubernetes.io/tls`.
  * Redirección forzada HTTP -> HTTPS (`HTTP 308 Permanent Redirect`).
  * Dimensionamiento de buffers de proxy a 128k para tokens OIDC voluminosos y propagación de trazas `X-Request-ID`.
* **Artefactos Principales:**
  * `deployments/helm/identity-service/templates/ingress.yaml`
  * `deployments/tls/generate-local-certs.sh`
  * `deployments/ingress/nginx-ingress-values.yaml`
  * `scripts/test-ingress-routing.sh`

### 3.3. Empaquetado y Despliegue en Kubernetes con Helm (US-14)
* **User Story:** [`US-14: Kubernetes Deployment with Parametric Helm Chart`](stories/US-14-k8s-deployment-helm-manifests.md)
* **Alcance:**
  * Chart parametrizable en `deployments/helm/identity-service/` con `values.yaml` y `values-local.yaml`.
  * Probes de salud HTTP asimétricas: Liveness (`/health/live`) para event loop y Readiness (`/health/ready`) comprobando dependencias críticas (PostgreSQL con RLS y Redis) con degradación `HTTP 503 DOWN`.
  * Inyección segura de secretos mediante Azure Key Vault Secrets Store CSI Driver (`SecretProviderClass`).
  * Configuración de alta disponibilidad: réplicas mínimas (2), `PodDisruptionBudget` (`minAvailable: 1`) y estrategia `RollingUpdate` (25%/0).
* **Artefactos Principales:**
  * `deployments/helm/identity-service/Chart.yaml`
  * `deployments/helm/identity-service/values.yaml`
  * `deployments/helm/identity-service/templates/deployment.yaml`
  * `deployments/helm/identity-service/templates/service.yaml`
  * `deployments/helm/identity-service/templates/secret-provider-class.yaml`
  * `deployments/helm/identity-service/templates/poddisruptionbudget.yaml`
  * `scripts/test-helm-chart.sh`

### 3.4. Automatización CI/CD Multiplataforma (US-15)
* **User Story:** [`US-15: CI/CD Pipeline Automation (GitHub Actions & CircleCI)`](stories/US-15-cicd-pipeline-azure-integration.md)
* **Alcance:**
  * Workflow de GitHub Actions (`.github/workflows/cd.yml`) para containerización multi-etapa, etiquetado inmutable en ACR (`sha-<commit>` y `v<semver>`) y despliegue Helm.
  * Pipeline declarativo en CircleCI 2.1 (`.circleci/config.yml`) estructurado con Orbs oficiales y manual approval gate para producción.
  * Imagen Docker optimizada y endurecida (`Dockerfile.production` multi-etapa no-root UID 1000, 161 MB).
  * Orquestador de despliegue con circuit breaker y rollback automático (`scripts/deploy-helm-rollout.sh`).
* **Artefactos Principales:**
  * `Dockerfile.production`
  * `.github/workflows/cd.yml`
  * `.circleci/config.yml`
  * `scripts/deploy-helm-rollout.sh`
  * `scripts/test-cicd-pipeline.sh`

---

## 4. Bucle de Refactorización Inside-Out & Hardening

Tras la entrega funcional de las cuatro historias, se ejecutó un bucle de refactorización para garantizar resiliencia operativa y contratos estrictos:

1. **Contratos Formales JSON Schema Draft-07 (`values.schema.json`):**
   - Validación temprana estricta de tipos en Helm durante `lint`, `template`, `install` y `upgrade`.
   - Invariantes garantizadas: `replicaCount >= 1`, enums para `image.pullPolicy` y `strategy.type`, contexto de seguridad no-root, regex para paths de probes (`^/`) y restricción de proveedor CSI a `"azure"`.
2. **Hardening del Proxy ARM Floci (`floci-proxy.mjs`):**
   - Incorporación del endpoint de diagnóstico `/__proxy_health`.
   - Reemplazo de esperas arbitrarias (`sleep 2`) por sondeo activo en `scripts/test-terraform-floci.sh`.
   - Manejo de `clientError`, timeouts de 30s y apagado ordenado (`SIGINT`/`SIGTERM`) con drenado de sockets.
3. **Protección de Rollouts con Traps POSIX:**
   - Intercepción de señales `INT`/`TERM` en `scripts/deploy-helm-rollout.sh` para disparar automáticamente `helm rollback` ante cancelaciones abruptas.
4. **Negative Schema Testing:**
   - Ampliación de `scripts/test-helm-chart.sh` a 6 etapas con `assert_lint_failure` validando el rechazo estricto de configuraciones corruptas.

---

## 5. Índice Canónico de Guías y Publicaciones

### Decisiones de Arquitectura (ADR)
* [ADR 0007: Cloud Infrastructure Topology](../../docs/adr/0007-cloud-infrastructure-topology.md)

### Guías Técnicas de Operación y Troubleshooting
* [GUIDELINE-13: Terraform Azure Provisioning over Floci](../../guidelines/GUIDELINE-13-terraform-floci-provisioning.md)
* [GUIDELINE-14: Nginx Ingress TLS Setup & Local Routing](../../guidelines/GUIDELINE-14-nginx-ingress-tls-setup.md)
* [GUIDELINE-15: Helm Packaging & Kubernetes Orchestration](../../guidelines/GUIDELINE-15-helm-k8s-deployment.md)
* [GUIDELINE-16: CI/CD Azure Container Delivery & Rollback Guard](../../guidelines/GUIDELINE-16-cicd-azure-container-delivery.md)

### Publicaciones Técnicas Oficiales
* [ARTICLE-12: Arquitectura Cloud-Native en Azure y Floci](../../publications/ARTICLE-12-cloud-infrastructure-azure-floci.md)
* [ARTICLE-12-B: Bucle de Refactorización Inside-Out en Infraestructura Cloud](../../publications/ARTICLE-12-B-refactoring-cloud-infrastructure.md)

---

## 6. Definición de Hecho (Definition of Done - DoD)

- [x] **Aprovisionamiento IaC:** Terraform valida y planifica sin errores 17 recursos de Azure sobre Floci (`npm run test:infra`).
- [x] **Capa de Borde TLS:** Ingress-Nginx enruta tráfico HTTPS hacia `auth.angelpixel.local` con certificado TLS válido y HTTP 308 (`npm run test:ingress`).
- [x] **Orquestación Kubernetes:** Helm Chart despliega réplicas con health probes, PDB, contexto no-root y Azure Key Vault CSI Driver (`npm run test:helm`).
- [x] **Contratos de Esquema:** `values.schema.json` valida tipos e invariantes, rechazando casos negativos en CI (`npm run test:helm`).
- [x] **Entrega Continua Dual:** Pipelines duales (GitHub Actions + CircleCI) con imagen no-root (161MB) y circuit breaker de rollback validados (`npm run test:cicd`).
- [x] **Trazabilidad Completa:** Registros sincronizados en [`TRACEABILITY_MATRIX.md`](../../memory/TRACEABILITY_MATRIX.md) con estado `Completed`.
- [x] **Publicaciones Técnicas:** Documentación de arquitectura (`ARTICLE-12`) y refactor (`ARTICLE-12-B`) publicadas y enlazadas.
