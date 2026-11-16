---
id: US-20
title: "Distributed Request-ID & W3C Traceparent Tracing"
epic:
  id: EPIC-08
  name: "Distributed Observability & Request Correlation"
status: completed
priority: P1
bounded_context: observability
subdomain: request-tracing
slice_type: distributed-tracing
regulatory_standards:
  - "W3C Trace Context (Recommendation 2021)"
  - "RFC 7230 / RFC 7231 (HTTP/1.1 Message Syntax and Routing)"
  - "OpenTelemetry Semantic Conventions"
timestamps:
  created_at: "2026-11-16T04:40:00-03:00"
  closed_at: "2026-11-16T14:30:00-03:00"
traceability:
  adrs:
    - docs/adr/0007-cloud-infrastructure-topology.md
  guidelines:
    - .agent/guidelines/GUIDELINE-21-distributed-request-tracing.md
  publications:
    - .agent/publications/ARTICLE-17-distributed-request-tracing.md
  pull_requests:
    - https://github.com/angelpixel-core/identity-service/pull/11
tags:
  - distributed-tracing
  - w3c-trace-context
  - traceparent
  - x-request-id
  - async-local-storage
  - postgresql-tracing
---

# US-20: Distributed Request-ID & W3C Traceparent Tracing

**Epic:** [EPIC-08: Distributed Observability & Request Correlation](../README.md)  
**Status:** Completed  
**Domain / Bounded Context:** `observability` / `request-tracing`  
**Slice Type:** Distributed Tracing & Correlation Slice  
**Regulatory Framework:** W3C Trace Context · OpenTelemetry · RFC 7230/7231  

---

## 1. Descripción

**Como** Ingeniero de Confiabilidad de Sitio (SRE) y Desarrollador de Microservicios,  
**Quiero** que `identity-service` capture, valide y propague identificadores de correlación estandarizados (`X-Request-ID` y W3C `traceparent`) a través de todas sus capas —desde el balanceador de carga L7, pasando por el ciclo de vida asíncrono de Node.js mediante `AsyncLocalStorage`, hasta las transacciones de PostgreSQL y las cabeceras de respuesta HTTP—,  
**Para** permitir la trazabilidad unificada y la depuración forense de peticiones distribuidas de extremo a extremo sin acoplamiento a herramientas propietarias de APM.

---

## 2. Reglas Técnicas e Invariantes de Seguridad

1. **Cumplimiento Estricto de W3C Trace Context:**
   - La cabecera `traceparent` debe adherirse al formato formal: `version-trace_id-parent_id-trace_flags` (ej. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`).
   - Versión actual soportada: `00`. Cualquier versión no reconocida o malformada debe descartarse silenciosamente, generando una nueva traza válida.
   - `trace_id` debe ser un string hexadecimal de 32 caracteres (16 bytes) no nulo (no puede ser solo ceros).
   - `parent_id` / `span_id` debe ser un string hexadecimal de 16 caracteres (8 bytes) no nulo.
   - Cuando una petición entrante incluye un `traceparent` válido, el microservicio debe conservar el `trace_id` original y derivar un nuevo `span_id` para representar su propio ámbito de ejecución (*child span*).

2. **Compatibilidad con `X-Request-ID` y `X-Correlation-ID`:**
   - Si la petición incluye `X-Request-ID`, se preserva; si no, se genera un UUID v4 criptográfico.
   - Las cabeceras `X-Request-ID`, `X-Correlation-ID` y `traceparent` deben reflejarse de forma obligatoria en las cabeceras de respuesta HTTP (`res.setHeader`).

3. **Almacenamiento de Contexto Asíncrono (`AsyncLocalStorage`):**
   - El contexto de traza (`TraceContext`) debe persistir en el hilo de ejecución mediante Node.js `AsyncLocalStorage`, permitiendo que middlewares de logging, constructores de auditoría y repositorios accedan a los identificadores sin requerir que el objeto `req` de Express sea transmitido como argumento.

4. **Propagación a Base de Datos (PostgreSQL):**
   - El runner transaccional `TenantAwareTransactionRunner` debe inyectar el `traceparent` y el `requestId` en la sesión local de PostgreSQL (`SET LOCAL app.traceparent = $1; SET LOCAL app.request_id = $2;`), permitiendo su visibilidad en `pg_stat_activity` y en las bitácoras del servidor de base de datos.

---

## 3. Escenarios de Aceptación BDD (Living Documentation)

```gherkin
Feature: Trazabilidad Distribuida y Propagación de Contexto W3C Traceparent

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
```

---

## 4. Definición de Hecho (Definition of Done)

- [x] Value Object `TraceContext` implementado en `src/contexts/shared/domain/tracing/` con validación W3C estricta.
- [x] Adaptador `CorrelationContextStorage` implementado con Node.js `AsyncLocalStorage`.
- [x] `TraceContextMiddleware` integrado en `interfaces/http/server.ts` reemplazando el middleware inline anterior.
- [x] `TenantAwareTransactionRunner` enriquecido con `SET LOCAL app.traceparent` y `app.request_id`.
- [x] Pruebas unitarias para `TraceContext` y `TraceContextMiddleware` pasando al 100%.
- [x] Pruebas de integración verificando la propagación a PostgreSQL y eventos de auditoría.
- [x] Escenarios BDD Cucumber certificados y en verde (4/4 escenarios en `distributed_request_tracing.feature`).
- [x] Helm Chart actualizado (`deployments/helm/identity-service/values.yaml`) con snippets de proxy NGINX Ingress.
- [x] Guía canónica de ingeniería elaborada en `.agent/guidelines/GUIDELINE-21-distributed-request-tracing.md`.
- [x] Publicación técnica especializada redactada en `.agent/publications/ARTICLE-17-distributed-request-tracing.md`.
- [x] Integración Trunk-Based completada vía Pull Request #11 (`commit 0d5c086`) con cero regresiones en los 623 tests de la plataforma.

---

## 5. Cierre Formal y Pull Request

* **Pull Request:** [#11 - feat(observability): distributed request-id & W3C traceparent tracing (US-20)](https://github.com/angelpixel-core/identity-service/pull/11)
* **Commit de Integración (Squash & Merge a `main`):** `0d5c086`
* **Commit de Sincronización a `development`:** `a84c941`
* **Rama de Trabajo Preservada:** `feat/us-20-distributed-request-id-tracing`
* **Fecha de Cierre:** 16 de Noviembre de 2026
* **Certificación Global:** 623/623 tests aprobados (444 unitarios, 136 integración, 43 aceptación BDD), Helm lint/template 6/6 etapas, Docker 161MB.
