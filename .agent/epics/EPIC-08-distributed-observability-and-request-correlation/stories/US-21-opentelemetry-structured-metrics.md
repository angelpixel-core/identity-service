---
id: US-21
title: "OpenTelemetry SDK Integration & Structured Metrics (Golden Signals)"
epic:
  id: EPIC-08
  name: "Distributed Observability & Request Correlation"
status: completed
priority: P1
bounded_context: observability
subdomain: metrics
slice_type: structured-metrics
regulatory_standards:
  - "OpenTelemetry Specification (Metrics API & SDK)"
  - "OpenMetrics / Prometheus Exposition Format"
  - "Google SRE Golden Signals"
  - "PCI-DSS v4.0 Requirement 10.2 & 10.5"
  - "SOC 2 Type II CC7.2"
timestamps:
  created_at: "2026-11-16T14:50:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-22-opentelemetry-structured-metrics.md
  publications:
    - .agent/publications/ARTICLE-18-opentelemetry-structured-metrics.md
tags:
  - opentelemetry
  - prometheus
  - golden-signals
  - metrics
  - latency
  - error-rate
  - saturation
  - openmetrics
---

# US-21: OpenTelemetry SDK Integration & Structured Metrics (Golden Signals)

**Epic:** [EPIC-08: Distributed Observability & Request Correlation](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `observability` / `metrics`  
**Slice Type:** Structured Metrics & Golden Signals Telemetry Slice  
**Regulatory Framework:** OpenTelemetry Specification · OpenMetrics · Google SRE Golden Signals · PCI-DSS v4.0 · SOC 2 Type II  

---

## 1. Descripción

**Como** Ingeniero de Confiabilidad del Sitio (SRE) y Desarrollador de Plataforma,  
**Quiero** que `identity-service` recolecte, agregue y exponga métricas estandarizadas de rendimiento y telemetría de negocio utilizando el SDK oficial de OpenTelemetry y las cuatro Golden Signals de Google SRE (Latencia, Tráfico, Errores y Saturación),  
**Para** permitir la detección proactiva de anomalías, el monitoreo continuo de SLOs y el scrapeo de infraestructura mediante Prometheus / Datadog Agent a través del endpoint canónico `/metrics` sin acoplamiento a soluciones de observabilidad propietarias.

---

## 2. Reglas Técnicas e Invariantes de Seguridad

1. **Implementación de las Cuatro Golden Signals (Google SRE / OpenTelemetry):**
   - **Latencia (Latency):** Histograma `http_request_duration_seconds` con buckets logarítmicos calibrados para servicios de autenticación de alta velocidad: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`.
   - **Tráfico (Traffic / Rate):** Contador monotónico `http_requests_total` etiquetado por método HTTP (`http_method`), ruta parametrizada normalizada (`http_route`) y código de estado (`http_status_code`).
   - **Errores (Errors / Error Rate):** Contador `http_errors_total` clasificado por status code (4xx y 5xx) y tipo de error (`error_type`).
   - **Saturación (Saturation):** Medidores observables (*ObservableGauges*) para uso de memoria de Node.js (`process_memory_heap_bytes`), retraso del Event Loop (`nodejs_eventloop_lag_seconds`) y conexiones activas del pool de PostgreSQL (`db_pool_connections_active`).

2. **Control Estricto de Cardinalidad (Anti-Cardinality Explosion):**
   - En las etiquetas de métricas HTTP, la ruta `http_route` debe registrarse normalizada conforme a la plantilla de Express (ej. `/api/v1/users/:id` o `/oauth2/token`), evitando registrar identificadores dinámicos (UUIDs, tokens o emails) que generarían explosión de memoria en los colectores de métricas.

3. **Métricas de Negocio Multi-Tenant:**
   - Registro de intentos de autenticación (`auth_attempts_total`) clasificados por inquilino (`tenant_id`), método de autenticación y resultado (`success` / `failure`).
   - Registro de emisión de credenciales y tokens (`auth_tokens_issued_total`).

4. **Endpoint Canónico de Scrapeo (`GET /metrics`):**
   - Exponer un endpoint de infraestructura no autenticado para scraping por Prometheus Operator o Datadog Agent en la red interna de Kubernetes.
   - Cabecera de respuesta obligatoria: `Content-Type: text/plain; version=0.0.4; charset=utf-8` (OpenMetrics / Prometheus exposition format).

5. **Correlación Trace-to-Metrics:**
   - Compatibilidad total con el `TraceContext` y `CorrelationContextStorage` implementados en **US-20**, permitiendo correlación bidireccional entre trazas y métricas (*Exemplars*).

---

## 3. Escenarios de Aceptación BDD (Living Documentation)

```gherkin
Feature: Métricas Estructuradas OpenTelemetry y Golden Signals

  Scenario: Recolección de Golden Signals de Tráfico y Latencia en solicitudes HTTP
    Given el servicio HTTP está en ejecución con el middleware de OpenTelemetry activo
    When se envía una solicitud "GET" al endpoint "/health/live"
    Then el contador "http_requests_total" se incrementa con método "GET" y ruta "/health/live"
    And se registra una observación en el histograma "http_request_duration_seconds"
    And la duración registrada es mayor a cero segundos

  Scenario: Registro y clasificación de Errores HTTP 4xx y 5xx
    Given una solicitud HTTP que provoca un error de validación con código 400
    When la solicitud es completada por el servidor
    Then el contador "http_errors_total" se incrementa con código "400"
    And el contador "http_requests_total" registra el status "400"

  Scenario: Exposición canónica de métricas en formato OpenMetrics / Prometheus
    Given se han procesado múltiples transacciones HTTP en la plataforma
    When se realiza una petición "GET" al endpoint "/metrics"
    Then la respuesta HTTP tiene código 200
    And el encabezado "Content-Type" contiene "text/plain"
    And el payload de la respuesta incluye las métricas "http_requests_total" y "http_request_duration_seconds"

  Scenario: Observabilidad de Saturación del Runtime de Node.js
    Given el exportador de OpenTelemetry está configurado con medidores observables
    When se solicita la lectura de métricas de saturación
    Then se exponen valores válidos para "process_memory_heap_bytes"
    And se expone el medidor de latencia del Event Loop "nodejs_eventloop_lag_seconds"
```

---

## 4. Definición de Hecho (Definition of Done)

- [x] Puerto de telemetría `MetricsPort` definido en la capa de dominio compartido (`src/contexts/shared/domain/telemetry/`).
- [x] Adaptador `OpenTelemetryMetricsAdapter` implementado con `@opentelemetry/api`, `@opentelemetry/sdk-metrics` y `@opentelemetry/exporter-prometheus`.
- [x] Middleware HTTP `metricsMiddleware` implementado y registrado en `interfaces/http/server.ts`.
- [x] Endpoint de infraestructura `GET /metrics` operativo y respondiendo en formato OpenMetrics / Prometheus.
- [x] Instrumentos de saturación de runtime (memoria heap, event loop lag) configurados y reportando valores en tiempo real.
- [x] Instrumentación de base de datos conectada con `TenantAwareTransactionRunner`.
- [x] Pruebas unitarias para contratos de telemetría, adaptadores y middleware pasando al 100%.
- [x] Pruebas de integración para el endpoint `/metrics` y métricas de base de datos pasando al 100%.
- [x] Escenarios BDD Cucumber certificados y en verde (4/4 escenarios).
- [x] Manifiestos Helm actualizados con anotaciones Prometheus (`prometheus.io/scrape`).
- [x] Guía canónica de ingeniería redactada en `.agent/guidelines/GUIDELINE-22-opentelemetry-structured-metrics.md`.
- [x] Publicación técnica oficial redactada en `.agent/publications/ARTICLE-18-opentelemetry-structured-metrics.md`.
- [x] Integración Trunk-Based completada mediante Pull Request con cero regresiones en la suite completa de pruebas.
