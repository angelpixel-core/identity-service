# language: en
@epic-08 @us-21 @observability @opentelemetry @golden-signals
Feature: OpenTelemetry SDK Integration & Structured Metrics (Golden Signals)

  As an SRE Engineer, Infrastructure Operator, and Security Auditor,
  I want standardized OpenTelemetry metrics exposed via an OpenMetrics/Prometheus endpoint,
  So that latency, traffic, errors, saturation, and authentication attempts are transparently monitored across cluster environments.

  Scenario: Exposición del endpoint de métricas Prometheus con Content-Type canónico
    Given un servidor HTTP identity-service en ejecución
    When un agente de telemetría solicita "GET /metrics"
    Then la respuesta tiene status 200 OK
    And el Content-Type es "text/plain; version=0.0.4; charset=utf-8"

  Scenario: Monitoreo de Golden Signals de Tráfico y Latencia
    Given una petición legítima procesada por el servidor
    When se consulta el endpoint "/metrics"
    Then el contador "http_requests_total" refleja la petición procesada
    And el histograma "http_request_duration_seconds" registra la latencia con buckets SRE

  Scenario: Monitoreo de Golden Signals de Errores HTTP
    Given una petición que falla con error 4xx o 5xx
    When se consulta el endpoint "/metrics"
    Then el contador "http_errors_total" se incrementa con el "error_type" y "status_code" correspondientes

  Scenario: Prevención de explosión de cardinalidad en rutas dinámicas
    Given peticiones enviadas a rutas con UUIDs y parámetros dinámicos
    When se consulta el endpoint "/metrics"
    Then las etiquetas "route" se exponen normalizadas y colapsadas sin filtrar identificadores únicos

  Scenario: Monitoreo de Saturación de Runtime Node.js
    Given el servicio operando con el SDK de OpenTelemetry
    When se consulta el endpoint "/metrics"
    Then se reporta el medidor "process_memory_heap_bytes" con el uso de memoria heap
    And se reporta el medidor "nodejs_eventloop_lag_seconds" con la latencia del event loop
