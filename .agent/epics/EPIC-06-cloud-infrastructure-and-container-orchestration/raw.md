# EPIC-06: Cloud Infrastructure & Container Orchestration (Azure & Floci)

Objetivo: Desplegar y orquestar el ecosistema del identity-service sobre servicios emulados de Azure mediante Terraform y Kubernetes.

- US-12: US-12-terraform-azure-resources-provisioning.md(Aprovisionamiento con Terraform de AKS, PostgreSQL Flexible Server, Key Vault, ACR y Storage Account sobre Flossie)

- US-13: US-13-nginx-ingress-tls-routing.md(Configuración de Nginx Ingress Controller con terminación TLS y enrutamiento de dominios locales/DNS)

- US-14: US-14-k8s-deployment-helm-manifests.md(Empaquetado y despliegue del identity-service en AKS mediante Manifests/Helm Charts con probes de liveness/readiness)

- US-15: US-15-cicd-pipeline-azure-integration.md(Automatización del pipeline de CI/CD para construcción en ACR y despliegue automatizado en AKS)
