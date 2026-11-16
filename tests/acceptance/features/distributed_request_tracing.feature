# language: en
@epic-08 @us-20 @observability @w3c-tracing
Feature: Distributed Request Tracing and W3C Trace Context Propagation

  As an API Consumer, SRE Engineer, and Security Auditor,
  I want every HTTP request to carry and propagate standardized W3C traceparent and correlation identifiers,
  So that distributed transactions, database queries, and security audit logs can be end-to-end correlated across microservices.

  Scenario: Propagación de traza W3C existente con derivación de nuevo span
    Given una petición entrante con cabecera "traceparent" válida "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    And cabecera "X-Request-ID" con valor "req-legit-uuid-1234"
    When el TraceContextMiddleware procesa la solicitud
    Then la respuesta HTTP contiene el header "X-Request-ID" con "req-legit-uuid-1234"
    And la respuesta HTTP contiene un header "traceparent" con el mismo trace_id "4bf92f3577b34da6a3ce929d0e0e4736"
    And el span_id en la respuesta es diferente del span entrante "00f067aa0ba902b7"
    And el contexto está disponible en AsyncLocalStorage

  Scenario: Generación automática de traza W3C ante petición huérfana de headers
    Given una petición entrante sin cabeceras de trazabilidad
    When la petición es recibida por el servidor HTTP
    Then se genera un nuevo "X-Request-ID" en formato UUID v4
    And se genera un nuevo "traceparent" W3C versión "00" válido
    And ambos identificadores se retornan en las cabeceras de la respuesta

  Scenario: Manejo defensivo ante cabecera traceparent malformada
    Given una petición entrante con "traceparent" inválido "invalid-trace-header"
    When el TraceContextMiddleware valida la cabecera
    Then la cabecera corrupta es descartada sin provocar error 500
    And se genera una nueva traza W3C legítima retornada en la respuesta

  Scenario: Propagación de contexto de traza a PostgreSQL dentro de transacción
    Given una petición HTTP procesada dentro de un contexto de traza activo
    When el TenantAwareTransactionRunner inicia una transacción en base de datos
    Then se ejecutan las sentencias "SET LOCAL app.traceparent" y "SET LOCAL app.request_id"
    And los valores coinciden con el contexto activo de la petición
