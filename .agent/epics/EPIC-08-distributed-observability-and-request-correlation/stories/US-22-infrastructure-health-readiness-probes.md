---
id: US-22
title: "Infrastructure Health & Readiness Probes"
epic:
  id: EPIC-08
  name: "Distributed Observability & Request Correlation"
status: in-progress
priority: P1
bounded_context: observability
subdomain: health-probes
slice_type: infrastructure-health-probes
regulatory_standards:
  - "Kubernetes Container Probes Specification (v1.28+)"
  - "RFC 7231 (HTTP/1.1 Semantics: 200 OK vs 503 Service Unavailable)"
  - "Google SRE Principles (Graceful Degradation & Overload Protection)"
  - "PCI-DSS v4.0 Requirement 10.2 & 10.5"
  - "SOC 2 Type II CC7.2 & CC7.3"
timestamps:
  created_at: "2026-11-17T07:22:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-23-infrastructure-health-readiness-probes.md
  publications:
    - .agent/publications/ARTICLE-19-infrastructure-health-readiness-probes.md
tags:
  - health-probes
  - liveness-probe
  - readiness-probe
  - kubernetes
  - postgresql-probe
  - keyvault-probe
  - graceful-degradation
---

# US-22: Infrastructure Health & Readiness Probes

**Epic:** [EPIC-08: Distributed Observability & Request Correlation](../README.md)  
**Status:** In Progress  
**Domain / Bounded Context:** `observability` / `health-probes`  
**Slice Type:** Infrastructure Health & Readiness Probes Slice  
**Regulatory Framework:** Kubernetes Container Probes Spec · RFC 7231 · Google SRE · PCI-DSS v4.0 · SOC 2 Type II  

---

## 1. Descripción

**Como** Ingeniero de Confiabilidad del Sitio (SRE) y Operador de Infraestructura Kubernetes,  
**Quiero** que `identity-service` exponga un subsistema desacoplado y resiliente de sondas de salud (`/health/liveness`, `/health/readiness` y `/health`),  
**Para** permitir que el kubelet y los controladores de ingress enruten tráfico exclusivamente a instancias sanas, aislen pods ante caídas de dependencias sin provocar reinicios destructivos, y diagnostiquen el estado de PostgreSQL, Cache y Azure Key Vault en tiempo real.

---

## 2. Reglas Técnicas e Invariantes de Seguridad

1. **Aislamiento Estricto entre Liveness y Readiness:**
   - **Liveness (`/health/liveness` & `/health/live`):** Evalúa exclusivamente la salud del proceso Node.js y la receptividad del bucle de eventos. **Bajo ninguna circunstancia debe chequear dependencias externas** (como base de datos o caché). Si el proceso responde, retorna HTTP 200 con `status: "UP"`. Si el bucle de eventos está congelado, el kubelet reiniciará el pod.
   - **Readiness (`/health/readiness` & `/health/ready`):** Evalúa activamente las dependencias requeridas para procesar transacciones:
     - Conectividad activa y autenticada a PostgreSQL (`SELECT 1`).
     - Disponibilidad de la capa de caché en memoria / Redis.
     - Disponibilidad y frescura de las claves criptográficas de firma de tokens (Azure Key Vault / JWKS).
   - Si todas las dependencias están operativas, retorna HTTP 200 con `status: "UP"`. Si alguna dependencia obligatoria falla, retorna HTTP 503 (`Service Unavailable`) con `status: "DOWN"`, aislando el pod del balanceador de carga sin reiniciar el contenedor.

2. **Timeouts Defensivos y Prevención de Bloqueos en Cascada (Cascading Timeouts):**
   - Cada sonda individual a dependencias debe tener un timeout estricto e innegociable (máximo `1500 ms`).
   - Si una dependencia tarda más del timeout, la sonda debe fallar de inmediato como `DOWN` con `reason: "timeout"`, evitando que las peticiones del kubelet se acumulen y consuman los sockets del servidor.

3. **Endpoint Agregado de Diagnóstico Operacional (`/health`):**
   - Devuelve un informe estructurado y legible con el estado consolidado (`UP` o `DOWN`), el desglose de cada sonda, latencia de verificación individual y marcas de tiempo UTC.

4. **Prevención de Contaminación de Métricas:**
   - Los endpoints de health probes deben ser ignorados por el middleware de métricas HTTP de US-21 para no distorsionar las tasas de tráfico ni de errores de negocio.

5. **Alineación con el Helm Chart:**
   - `templates/deployment.yaml` debe parametrizar `livenessProbe` apuntando a `/health/live` o `/health/liveness` y `readinessProbe` apuntando a `/health/ready` o `/health/readiness`.

---

## 3. Escenarios de Aceptación BDD (Living Documentation)

```gherkin
Feature: Infrastructure Health and Readiness Probes
  As a Site Reliability Engineer (SRE) and Kubernetes Controller
  I want the identity service to provide liveness and readiness probe endpoints
  So that traffic is routed only to healthy pods and degraded instances are isolated safely

  Scenario: Liveness probe succeeds when the Node.js process is responsive
    Given the identity service is running
    When a probe request is made to "/health/live"
    Then the response status code should be 200
    And the response body should contain status "UP"
    And the response body should contain check "liveness" as "OK"

  Scenario: Readiness probe succeeds when all critical dependencies are healthy
    Given the identity service is connected to PostgreSQL and Key Vault
    When a probe request is made to "/health/ready"
    Then the response status code should be 200
    And the response body should contain status "UP"
    And the database check should be "OK"
    And the keyvault check should be "OK"

  Scenario: Readiness probe returns 503 when PostgreSQL dependency is unavailable
    Given the PostgreSQL database connection is down or unreachable
    When a probe request is made to "/health/ready"
    Then the response status code should be 503
    And the response body should contain status "DOWN"
    And the database check should be "DOWN"

  Scenario: Readiness probe fails fast on dependency timeout
    Given a critical dependency takes longer than 1500 milliseconds to respond
    When a probe request is made to "/health/ready"
    Then the probe should abort within 1500 milliseconds
    And the response status code should be 503
    And the response body should contain status "DOWN"

  Scenario: Aggregated health diagnostic endpoint exposes detailed dependency report
    Given the identity service is operational
    When an operator sends a GET request to "/health"
    Then the response status code should be 200
    And the response body should contain overall status "UP"
    And the response body should include individual latencies for each probe
```

---

## 4. Definición de Hecho (Definition of Done)

- [ ] Puerto de dominio `HealthCheckPort` e interfaz `DependencyProbe` definidos en `src/contexts/shared/domain/health/`.
- [ ] Adaptadores de sondas de dependencias implementados con timeout defensivo (`PostgresProbe`, `CacheProbe`, `KeyVaultProbe`).
- [ ] Adaptador en memoria `InMemoryHealthAdapter` para pruebas unitarias herméticas.
- [ ] Middlewares y endpoints `/health/liveness`, `/health/readiness` y `/health` expuestos en Express con códigos 200 y 503.
- [ ] Pruebas unitarias para contratos de salud y sondas individuales pasando al 100%.
- [ ] Pruebas de integración HTTP para códigos de estado y fallos simulados pasando al 100%.
- [ ] Escenarios BDD Cucumber certificados en `tests/acceptance/features/health_readiness_probes.feature`.
- [ ] Manifiestos Helm (`deployment.yaml`, `values.yaml`) alineados con las sondas de Kubernetes.
- [ ] Guía canónica de ingeniería redactada en `.agent/guidelines/GUIDELINE-23-infrastructure-health-readiness-probes.md`.
- [ ] Publicación técnica oficial redactada en `.agent/publications/ARTICLE-19-infrastructure-health-readiness-probes.md`.
- [ ] Pull Request integrado a `main` y sincronizado con `development` con cero regresiones en la plataforma (674+ pruebas).
