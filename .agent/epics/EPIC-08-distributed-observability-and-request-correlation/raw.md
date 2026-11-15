# EPIC-08: Distributed Observability & Request Correlation

Objetivo: Garantizar la trazabilidad de peticiones distribuidas y el monitoreo de salud de la infraestructura sin depender de APMs propietarios externos.

- US-20: US-20-distributed-request-id-tracing.md(Inyección y propagación del header X-Request-ID / traceparent desde el Ingress Controller hacia el Express Handler y PostgreSQL)

- US-21: US-21-opentelemetry-structured-metrics.md(Instrumentación de OpenTelemetry en Node.js para emisión de métricas estándar de performance y Golden Signals)

- US-22: US-22-infrastructure-health-readiness-probes.md(Implementación del sub-sistema /health/liveness y /health/readiness con verificación activa de dependencias - PostgreSQL/KeyVault)
