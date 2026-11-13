---
id: US-14
title: "Kubernetes Deployment with Parametric Helm Chart"
epic:
  id: EPIC-06
  name: "Cloud Infrastructure & Container Orchestration (Azure & Floci)"
status: completed
priority: P1
bounded_context: infrastructure
subdomain: kubernetes-workloads
slice_type: orchestration
timestamps:
  created_at: "2026-11-10T14:15:00-03:00"
  started_at: "2026-11-13T00:08:00-03:00"
  completed_at: "2026-11-13T01:08:00-03:00"
  updated_at: "2026-11-13T01:08:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-15-helm-k8s-deployment.md
  publications:
    - .agent/publications/ARTICLE-12-cloud-infrastructure-azure-floci.md
  commits:
    - "b9eac33"
    - "1162cd3"
    - "1f38651"
    - "4466245"
    - "4e0e10f"
tags:
  - helm
  - kubernetes
  - aks
  - k3d
  - liveness-probe
  - readiness-probe
  - secrets-store-csi
  - zero-downtime
---

# US-14: Kubernetes Deployment with Parametric Helm Chart

**Epic:** [EPIC-06: Cloud Infrastructure & Container Orchestration (Azure & Floci)](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `infrastructure` / `kubernetes-workloads`  
**Slice Type:** Container Orchestration & Workload Packaging Slice  
**Referencia Estructural:** [`.agent/TREE.txt`](../../../TREE.txt)  

---

## 1. Descripción

**Como** Ingeniero Cloud / DevOps y Desarrollador Full Stack,  
**Quiero** empaquetar y orquestar el despliegue de `identity-service` en Kubernetes mediante un Helm Chart parametrizable con liveness/readiness probes y montaje seguro de secretos vía Azure Key Vault Secrets Store CSI Driver,  
**Para** garantizar despliegues reproducibles, alta disponibilidad sin tiempo de inactividad (*zero-downtime rolling updates*) y gestión centralizada de configuraciones tanto en entornos cloud (AKS) como locales (k3d/kind).

---

## 2. Reglas Técnicas e Invariantes de Orquestación

1. **Estructura Canónica del Helm Chart (`deployments/helm/identity-service/`):**
   * `Chart.yaml`: Especificación versión API `v2`, nombre `identity-service`, versión de aplicación sincronizada con `package.json`.
   * `values.yaml`: Valores por defecto con tipado estricto y documentación de cada parámetro (réplicas, imagen, recursos, probes, annotations).
   * `values-local.yaml`: Valores específicos para desarrollo local sobre clúster k3d y emulador Floci.
   * `templates/_helpers.tpl`: Generador de etiquetas estándar Kubernetes (`app.kubernetes.io/name`, `app.kubernetes.io/instance`, `app.kubernetes.io/version`, `app.kubernetes.io/managed-by: Helm`).
2. **Estrategia de Despliegue y Resiliencia:**
   * Despliegue con estrategia `RollingUpdate` (`maxSurge: 25%`, `maxUnavailable: 0`).
   * Recurso `PodDisruptionBudget` configurado con `minAvailable: 1` para salvaguardar la disponibilidad durante drenados de nodos o upgrades de clúster.
   * Solicitud y límites de recursos definidos para prevenir saturación de nodos (`requests: cpu 100m, memory 128Mi` y `limits: cpu 500m, memory 512Mi`).
3. **Probes de Salud Estandarizadas (Health Endpoints):**
   * `livenessProbe`: Verificación de vitalidad del proceso Node.js mediante `GET /health/live` en el puerto 4000 (`initialDelaySeconds: 10`, `periodSeconds: 10`, `failureThreshold: 3`).
   * `readinessProbe`: Verificación de preparación operativa mediante `GET /health/ready`, validando la conectividad activa del pool PostgreSQL y Redis (`initialDelaySeconds: 5`, `periodSeconds: 5`, `failureThreshold: 2`). Si una dependencia crítica falla, el pod se retira del balanceo de tráfico sin reiniciarse abruptamente.
4. **Montaje de Secretos con SecretProviderClass:**
   * Definición de plantilla `templates/secret-provider-class.yaml` para interactuar con Azure Key Vault CSI Driver.
   * Proyección de secretos sensibles (`DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`) directamente como variables de entorno o archivos dentro del contenedor, eliminando credenciales estáticas en manifiestos.
5. **Separación de Responsabilidades y Seguridad de Contenedores:**
   * Ejecución bajo contexto de seguridad no-root (`runAsNonRoot: true`, `readOnlyRootFilesystem: false`, `allowPrivilegeEscalation: false`).

---

## 3. Criterios de Aceptación (BDD - Gherkin)

```gherkin
Feature: Parametric Helm Chart and Kubernetes Deployment
  As a DevOps Engineer
  I want to package identity-service into a Helm Chart
  So that deployments are resilient, zero-downtime, and configurable across environments

  Scenario: Linting and rendering Helm chart templates
    Given the Helm Chart in "deployments/helm/identity-service"
    When I run "helm lint deployments/helm/identity-service"
    Then the lint command should exit with 0 errors
    And running "helm template identity-service deployments/helm/identity-service -f deployments/helm/identity-service/values-local.yaml"
    Then it must render valid Kubernetes Deployment, Service, Ingress, and SecretProviderClass manifests

  Scenario: Health and Readiness Probes behavior
    Given identity-service is deployed with liveness and readiness probes
    When the database connection pool is healthy
    Then "GET /health/ready" must return HTTP 200 with status "UP"
    And Kubernetes must keep the Pod in the Service endpoints
    When the database becomes temporarily unreachable
    Then "GET /health/ready" must return HTTP 503 with status "DOWN"
    And Kubernetes must stop routing incoming traffic to that specific Pod until it recovers
```

---

## 4. Definición de Hecho (DoD)

- [x] Helm Chart en `deployments/helm/identity-service/` completo y documentado.
- [x] Endpoints HTTP `/health/live` y `/health/ready` implementados en el servidor Express (incluyendo degradación HTTP 503 `DOWN`).
- [x] Plantilla `templates/secret-provider-class.yaml` integrada.
- [x] `helm lint` y `helm template` ejecutados sin advertencias ni errores (`npm run test:helm`).
- [x] Registro en `TRACEABILITY_MATRIX.md`.
