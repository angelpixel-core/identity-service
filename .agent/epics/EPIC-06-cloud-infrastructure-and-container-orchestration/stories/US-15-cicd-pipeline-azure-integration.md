---
id: US-15
title: "CI/CD Pipeline Automation (GitHub Actions & CircleCI)"
epic:
  id: EPIC-06
  name: "Cloud Infrastructure & Container Orchestration (Azure & Floci)"
status: planned
priority: P1
bounded_context: infrastructure
subdomain: cicd-automation
slice_type: continuous-delivery
timestamps:
  created_at: "2026-11-10T14:15:00-03:00"
  started_at: null
  completed_at: null
  updated_at: "2026-11-10T14:15:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-16-cicd-azure-container-delivery.md
  publications:
    - .agent/publications/ARTICLE-12-cloud-infrastructure-azure-floci.md
  commits: []
tags:
  - cicd
  - github-actions
  - circleci
  - acr
  - aks
  - docker
  - helm
  - automation
---

# US-15: CI/CD Pipeline Automation (GitHub Actions & CircleCI)

**Epic:** [EPIC-06: Cloud Infrastructure & Container Orchestration (Azure & Floci)](../README.md)  
**Status:** Planned  
**Domain / Bounded Context:** `infrastructure` / `cicd-automation`  
**Slice Type:** Continuous Delivery & Automated Rollout Slice  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  

---

## 1. Descripción

**Como** Ingeniero Cloud / DevOps y Desarrollador Full Stack,  
**Quiero** automatizar el ciclo de entrega continua mediante pipelines duales en GitHub Actions y CircleCI para containerizar, publicar imágenes en Azure Container Registry (ACR) y desplegar en AKS/Kubernetes vía Helm,  
**Para** garantizar entregas de software ágiles, reproducibles, auditadas y con rollback automático ante incidentes, cumpliendo rigurosamente los estándares corporativos exigidos en la Job Description.

---

## 2. Reglas Técnicas e Invariantes del Pipeline

1. **Estrategia Dual de Pipelines (GitHub Actions + CircleCI):**
   * `.github/workflows/cd.yml`: Workflow nativo de GitHub Actions para ejecución continua en el repositorio, gestionando secrets de entorno y despliegue automatizado.
   * `.circleci/config.yml`: Pipeline declarativo de referencia para CircleCI estructurado con Orbs oficiales (Docker, Azure CLI, Kubernetes/Helm) y workflows de aprobación, demostrando paridad funcional y dominio completo de ambas herramientas demandadas en la Job Description.
2. **Containerización Multi-Etapa de Producción (`Dockerfile.production`):**
   * Etapa `builder`: Instalación de dependencias de desarrollo, ejecución de tests y compilación del código fuente TypeScript (`npm run build`).
   * Etapa `runner`: Imagen base mínima y segura (`node:20-alpine`), con usuario sin privilegios de root (`USER node`), exclusión de archivos innecesarios vía `.dockerignore`, y copia única del build transpilado y dependencias productivas (`npm prune --production`).
3. **Etiquetado Inmutable en Azure Container Registry (ACR):**
   * Las imágenes deben publicarse con dos etiquetas obligatorias:
     * El hash corto e inmutable del commit Git (`sha-${GIT_SHA::7}`).
     * La versión semántica de la aplicación (`vX.Y.Z` o número de build).
   * La etiqueta `latest` queda expresamente desaconsejada en entornos productivos para garantizar trazabilidad y reproducibilidad.
4. **Despliegue Atómico y Rollout Verification con Helm:**
   * El pipeline ejecuta `helm upgrade --install identity-service deployments/helm/identity-service --set image.tag=${TAG}`.
   * Paso mandatorio de verificación: `kubectl rollout status deployment/identity-service --timeout=120s`.
5. **Rollback Automático y Circuit Breaking:**
   * En caso de fallo de inicio de los pods, superación del timeout o rechazo en los probes de liveness/readiness, el pipeline activa de inmediato la etapa de contingencia ejecutando `helm rollback identity-service` y notificando el estado fallido.

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: CI/CD Pipeline Automation (GitHub Actions & CircleCI)
  As a DevOps Engineer
  I want automated pipelines for containerization, registry publishing, and Helm deployment
  So that releases are fast, auditable, and resilient to failures

  Scenario: Docker Multi-Stage Production Build
    Given the "Dockerfile.production" specification
    When the container image is built
    Then the final image must not run as the root user
    And the final image must not contain development dependencies or source TypeScript files
    And the container size must be optimized (< 250MB)

  Scenario: Automated CD Pipeline Execution
    Given a commit is pushed to the release branch
    When the CD workflow runs in GitHub Actions or CircleCI
    Then it must build the container image and tag it with the Git commit SHA
    And authenticate against Azure Container Registry (or local registry mock)
    And push the immutable image
    And trigger "helm upgrade --install" against the target Kubernetes cluster
    And verify "kubectl rollout status" finishes successfully within 120 seconds

  Scenario: Automatic Rollback on Failed Health Probes
    Given a deployment contains a configuration error causing readiness probes to fail
    When the pipeline detects that the deployment does not reach ready state within the timeout
    Then the pipeline must trigger an automated "helm rollback" to the previous revision
    And fail the CI/CD job without leaving the application in a degraded state
```

---

## 4. Definición de Hecho (DoD)

- [ ] `Dockerfile.production` multi-etapa optimizado y no-root.
- [ ] Workflow `.github/workflows/cd.yml` implementado y validado.
- [ ] Configuración `.circleci/config.yml` completa, validada sintácticamente y documentada.
- [ ] Mecanismo de rollout check y rollback automático integrado en los scripts/steps.
- [ ] Registro en `TRACEABILITY_MATRIX.md`.
