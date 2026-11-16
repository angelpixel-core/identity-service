# ARTICLE-18: Telemetría Cuantitativa en Tiempo Real con OpenTelemetry Metrics SDK, Google SRE Golden Signals y Prevención Activa de Cardinalidad — Cumplimiento PCI-DSS v4.0 & SOC 2 Type II

* **Artículo ID:** ARTICLE-18
* **User Story Asociada:** [US-21: OpenTelemetry SDK Integration & Structured Metrics (Golden Signals)](../epics/EPIC-08-distributed-observability-and-request-correlation/stories/US-21-opentelemetry-structured-metrics.md)
* **Épica:** [EPIC-08: Distributed Observability & Request Correlation](../epics/EPIC-08-distributed-observability-and-request-correlation/README.md)
* **Bounded Context:** `observability` / `shared` / `telemetry`
* **Tipo de Slice:** Full-Stack Observability & Metrics Slice (Domain Hexagonal Port, OpenTelemetry SDK v3.x Infrastructure Adapter, Prometheus Exporter, HTTP Metrics Middleware, PostgreSQL Persistence Instrumentation, OAuth2 Handlers, Helm Scrape Config, BDD Acceptance)
* **Rama de Trabajo:** `feat/us-21-opentelemetry-structured-metrics`
* **Pull Request de Integración:** [PR #12](https://github.com/angelpixel-core/identity-service/pull/12) (Squash & Merge a `main`, commit `f27b2d3`)
* **ADR Relacionado:** [ADR 0007: Cloud Infrastructure Topology](../../docs/adr/0007-cloud-infrastructure-topology.md)
* **Guía Canónica Asociada:** [GUIDELINE-22: OpenTelemetry SDK Integration, Structured Metrics y Google SRE Golden Signals](../guidelines/GUIDELINE-22-opentelemetry-structured-metrics.md)
* **Fecha:** Noviembre 2026
* **Autor / Tech Lead:** AngelSolutions Platform & Observability Engineering Team (Pair Programming)

---

## 1. Motivación y Resumen Ejecutivo

En la ingeniería de plataformas de identidad de misión crítica, autenticación federada y autorización delegada (*Identity-as-a-Service - IDaaS*) en el ecosistema bancario y financiero, la observabilidad no puede depender exclusivamente de trazas distribuidas o de la inspección reactiva de registros en archivos de log. Mientras que la trazabilidad distribuida (abordada en [ARTICLE-17](ARTICLE-17-distributed-request-tracing.md)) permite reconstruir el ciclo de vida de una transacción individual, la **telemetría cuantitativa en tiempo real** es la única herramienta capaz de ofrecer una visión estadística, agregada y predictiva de la salud del sistema.

En un entorno multi-inquilino (*multi-tenant*) de alta concurrencia que soporta miles de transacciones por segundo (TPS), los ingenieros de confiabilidad del sitio (*Site Reliability Engineers - SRE*), los operadores de plataforma y los auditores de seguridad deben poder responder de inmediato a interrogantes críticas:
- ¿Cuál es la latencia percentil real ($p_{95}$, $p_{99}$) en los intercambios de código de autorización PKCE frente al tráfico habitual de credenciales de cliente M2M?
- ¿Está el runtime monohilo de Node.js experimentando demoras (*Event Loop lag*) provocadas por cálculos criptográficos síncronos o consultas lentas a bases de datos?
- ¿Qué proporción de transacciones de negocio están fallando por errores 4xx (credenciales inválidas, tokens revocados) frente a fallos 5xx (errores internos de servidor o saturación del pool de conexiones)?
- ¿Cuál es el consumo de memoria heap por inquilino y cómo impacta el aislamiento estricto en PostgreSQL con *Row-Level Security* (RLS)?

Para responder a estos retos sin incurrir en soluciones artesanales ni acoplarse rígidamente a tecnologías propietarias, la historia de usuario **US-21** introdujo una arquitectura de instrumentación basada en los estándares internacionales abiertos **OpenTelemetry Metrics API & SDK v3.x** y **OpenMetrics / Prometheus**, guiada estrictamente por los **4 Golden Signals** de Google SRE.

---

### 1.1 El Desafío de la Observabilidad Cuantitativa en Plataformas FinTech Multi-Tenant

La arquitectura de microservicios contenerizados en Kubernetes plantea un conjunto único de restricciones cuando se trata de recopilar métricas en aplicaciones financieras:

1. **Garantía Innegociable de Acuerdos de Nivel de Servicio (SLAs / SLOs):**
   Los sistemas de identidad bancaria operan bajo compromisos contractuales de alta disponibilidad (típicamente $99.99\%$ o $99.95\%$) con presupuestos de error (*error budgets*) mínimos. Una degradación sutil en la latencia de respuesta puede desencadenar caídas en cascada a través de los microservicios downstream de la banca móvil y web. El cálculo preciso de percentiles a través de histogramas de cubos explícitos (*explicit bucket histograms*) es indispensable para detectar estas desviaciones mucho antes de que el usuario final perciba una denegación de servicio.

2. **Aislamiento Multi-Inquilino y Cero Fuga de Telemetría:**
   En una arquitectura SaaS bancaria donde múltiples entidades financieras comparten la misma infraestructura de cómputo, las métricas deben permitir desglosar el comportamiento por inquilino (`tenant_id`) en operaciones clave, pero garantizando de forma absoluta que ninguna información de identificación personal (*Personally Identifiable Information - PII*), secretos de clientes o credenciales sea serializada en los metadatos de las métricas.

3. **Sobrecarga de Ejecución Despreciable (Sub-millisecond Overhead):**
   El acto de medir no debe degradar el rendimiento del sistema que se mide. El cálculo de duraciones debe apoyarse en temporizadores de hardware de alta resolución en nanosegundos (`process.hrtime.bigint()`), evitando la instanciación innecesaria de objetos en la memoria dinámica (*heap allocation*) y garantizando que el middleware de telemetría añada una sobrecarga inferior a $0.05\,\text{ms}$ por solicitud HTTP.

---

### 1.2 Las Tres Fallas Estructurales de la Observabilidad Tradicional en Microservicios

Históricamente, los sistemas de software empresariales han abordado la emisión de métricas mediante patrones fragmentados, bibliotecas ad-hoc y suposiciones ingenuas que conducen a fallos catastróficos en producción:

```
+---------------------------------------------------------------------------------------------------------+
| LAS TRES FALLAS ESTRUCTURALES DE LA OBSERVABILIDAD CUANTITATIVA TRADICIONAL                             |
|                                                                                                         |
|  1. FRAGMENTACIÓN Y CEGUERA DE RENDIMIENTO INTERNO (BLACK-BOX METRICS)                                  |
|     - Dependencia exclusiva de métricas de infraestructura (CPU de contenedor, pods y red).             |
|     - Desconocimiento total de la latencia de casos de uso de negocio y transacciones relacionales RLS. |
|     - Acoplamiento directo del código de aplicación a SDKs propietarios (Datadog, New Relic, etc.).    |
|                                                                                                         |
|  2. EXPLOSIÓN DESCONTROLADA DE CARDINALIDAD (CARDINALITY EXPLOSION)                                     |
|     - Inclusión inadvertida de UUIDs, IDs de usuario o URLs sin procesar en etiquetas de métricas.      |
|     - Multiplicación exponencial de series temporales en memoria dentro del clúster de Prometheus.     |
|     - Colapso por Out-Of-Memory (OOM) en los colectores de métricas y denegación de telemetría.         |
|                                                                                                         |
|  3. LISTENERS HTTP REDUNDANTES Y VULNERABILIDADES DE RED (PORT POLLUTION)                               |
|     - Inicialización automática de servidores HTTP adicionales (puerto 9464) por plugins de exportación.|
|     - Complejidad en la topología de red Kubernetes (doble puerto en Services y NetworkPolicies).       |
|     - Superficie de ataque ampliada y falta de reutilización del ciclo de vida del servidor Express.    |
+---------------------------------------------------------------------------------------------------------+
```

#### Falla 1: Fragmentación y Ceguera de Rendimiento Interno
Los monitores basados únicamente en infraestructura de red o Kubernetes observan los pods como cajas negras: registran si un contenedor consume $40\%$ o $90\%$ de CPU, pero son ciegos ante la causa raíz. Si una transacción de autorización tarda $2.5\,\text{segundos}$, la métrica de red del Ingress Controller atribuye el retraso a la aplicación de forma opaca. Es imposible discernir si la demora ocurrió durante el parsing criptográfico de llaves JWKS, en la ejecución de la consulta PostgreSQL bajo aislamiento RLS o en el bloqueo del bucle de eventos monohilo de Node.js. 

Asimismo, acoplar el código de dominio a clientes de métricas específicos genera una deuda técnica colosal que impide migrar de proveedores de observabilidad sin reescribir docenas de controladores y casos de uso.

#### Falla 2: Explosión Descontrolada de Cardinalidad
En los motores de series temporales como Prometheus, Cortex o Thanos, cada combinación única de nombres de métricas y pares clave-valor de etiquetas (*labels*) genera una serie temporal independiente que consume memoria indexada de forma continua. Cuando una aplicación ingenua etiqueta sus solicitudes HTTP con la URL en bruto:
```
http_requests_total{route="/api/v1/users/550e8400-e29b-41d4-a716-446655440000/profile"}
```
Cada usuario que interactúa con la plataforma genera una serie temporal distinta. En un sistema con $100{,}000$ usuarios diarios realizando 10 operaciones distintas, el servidor de Prometheus se ve forzado a indexar instantáneamente más de un millón de series temporales, provocando un consumo desmedido de memoria RAM, saturación del disco por compresión de bloques TSDB y, finalmente, un colapso total del clúster de monitoreo (*OOM Kill*).

#### Falla 3: Listeners HTTP Redundantes y Riesgos Operacionales
La mayoría de los SDKs de exportación de métricas (incluyendo el exportador estándar de Prometheus para OpenTelemetry) arrancan por defecto un servidor HTTP independiente en un puerto efímero (habitualmente el puerto `9464`). En un entorno Kubernetes gobernado por políticas estrictas de Zero-Trust Network Policies ([ARTICLE-15](ARTICLE-15-k8s-zero-trust-network-policies.md)) y configuración declarativa en Helm, esta práctica introduce gravísimos problemas:
- Requiere abrir y exponer puertos adicionales en los manifiestos de `Service`, `PodSpec` y `NetworkPolicy`.
- Impide reutilizar los middlewares globales de seguridad, autenticación interna y control de acceso ya establecidos en Express.
- Dificulta el apagado limpio y la terminación elegante (*graceful shutdown*) al existir múltiples sockets de escucha compitiendo durante las señales `SIGTERM` / `SIGINT`.

---

### 1.3 Marco de Cumplimiento Normativo Internacional

Para superar estas limitaciones dentro de un marco de ingeniería bancaria verificable, la arquitectura implementada en **US-21** fue diseñada en estricto cumplimiento de los estándares internacionales más rigurosos:

| Regulación / Estándar | Requerimiento Mandatorio | Implementación Canónica en `identity-service` |
| :--- | :--- | :--- |
| **OpenTelemetry Metrics Spec v3.x** | Desacoplamiento de la API e implementación del SDK, soporte para vistas de agregación explícita y modelo semántico OpenMetrics. | `MetricsPort` hexagonal abstracto; `OpenTelemetryMetricsAdapter` basado en `MeterProvider`, `ExplicitBucketHistogramAggregation` y `PrometheusSerializer`. |
| **Google SRE 4 Golden Signals** | Medición continua y estandarizada de Tráfico, Latencia, Errores y Saturación en todos los servicios de producción. | Cobertura integral: `http_requests_total` (Tráfico), `http_request_duration_seconds` y `db_query_duration_seconds` (Latencia), `http_requests_errors_total` (Errores), y `process_memory_heap_bytes` / `nodejs_eventloop_lag_seconds` (Saturación). |
| **PCI-DSS v4.0** | **Req 10.2.1, 10.2.2 & 10.2.4:** Monitoreo y registro cuantitativo de todas las acciones de acceso a recursos lógicos, intentos de autenticación válidos e inválidos y emisión de credenciales. | Contadores estructurados `auth_attempts_total` y `auth_tokens_issued_total` etiquetados con `client_id`, `flow_type` y `outcome` en todos los comandos de autenticación OAuth 2.0 y OIDC. |
| **SOC 2 Type II** | **Criterio CC7.2:** Monitoreo continuo de la disponibilidad de la infraestructura y capacidad de detección inmediata de anomalías operacionales y cuellos de botella. | Exposición estandarizada de métricas a través de `GET /metrics`, raspado periódico cada 15 segundos por Prometheus y cálculo dinámico de percentiles $p_{95}$ y $p_{99}$. |
| **Zero-Trust & Data Privacy** | **GDPR (Art. 32) / CCPA / Bank Secrecy:** Prohibición estricta de fuga de datos personales, hashes de contraseñas, tokens JWT o identificadores de usuario en canales de monitoreo. | `RouteNormalizer` elimina query strings y ofusca dinámicamente identificadores numéricos y UUIDs transformándolos en tokens genéricos `:id`. Exclusión estricta de PII en los labels. |

---

### 1.4 Topología End-to-End de Recolección de Métricas FinTech

La arquitectura implementada conecta sin fisuras el ciclo de vida de la solicitud HTTP con el motor de persistencia PostgreSQL, el recolector OpenTelemetry y los sistemas centrales de monitoreo y alerta:

```
+---------------------------------------------------------------------------------------------------------+
| TOPOLOGÍA DE RECOLECCIÓN DE MÉTRICAS EN TIEMPO REAL (US-21: GOLDEN SIGNALS SLICE)                       |
|                                                                                                         |
|  [POD KUBERNETES: identity-service (:3000)]                                                             |
|                                                                                                         |
|  Inbound HTTP Request                                                                                   |
|         │                                                                                               |
|         ▼                                                                                               |
|  [traceContextMiddleware (US-20)]  ───> Genera / propaga W3C traceparent y X-Request-ID                 |
|         │                                                                                               |
|         ▼                                                                                               |
|  [metricsMiddleware (US-21)]                                                                            |
|         │  - Captura tiempo inicial con process.hrtime.bigint() en nanosegundos                          |
|         │  - Sanitiza URL mediante RouteNormalizer (prevención anti-cardinalidad)                        |
|         │  - Escucha evento finish de Response                                                          |
|         │                                                                                               |
|         ├─────────────────────────────────┐                                                             |
|         ▼                                 ▼                                                             |
|  [CAPA DE NEGOCIO / HANDLERS]     [CAPA DE PERSISTENCIA / DB]                                           |
|  - AuthenticateClientM2MHandler   - TenantAwareTransactionRunner                                        |
|  - ExchangeAuthCodeHandler        - Mide duración de transacciones y savepoints                         |
|  - RotateRefreshTokenHandler      - Emite db_query_duration_seconds                                     |
|  - Emite auth_attempts_total                                                                            |
|  - Emite auth_tokens_issued_total                                                                       |
|         │                                 │                                                             |
|         └────────────────┬────────────────┘                                                             |
|                          ▼                                                                              |
|            [HEXAGONAL PORT: MetricsPort]                                                                |
|                          │                                                                              |
|                          ▼                                                                              |
|            [OpenTelemetryMetricsAdapter]                                                                |
|              ├── MeterProvider (Explicit Views con DEFAULT_LATENCY_BUCKETS)                             |
|              ├── Event Loop Delay Monitor (perf_hooks.monitorEventLoopDelay)                            |
|              ├── Process Memory Monitor (process.memoryUsage)                                           |
|              └── PrometheusExporter (preventServerStart: true)                                          |
|                          │                                                                              |
|                          ▼                                                                              |
|            [EXPRESS ROUTE: GET /metrics]                                                                |
|              └── Serializa métricas en formato OpenMetrics con PrometheusSerializer                     |
+--------------------------│------------------------------------------------------------------------------+
                           │
                           │ Scrape periódico cada 15 segundos (Service / Pod annotations)
                           ▼
          [PROMETHEUS SERVER / THANOS SCRAPER]
             ├── Almacenamiento en Series Temporales (TSDB)
             ├── Evaluación de Alertas (Alertmanager / PagerDuty)
             └── Dashboards Ejecutivos y Operativos (Grafana)
```

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Cliente API / Gateway
    participant Express as Servidor Express (:3000)
    participant MetricsMid as MetricsMiddleware
    participant Normalizer as RouteNormalizer
    participant UseCase as Caso de Uso (Auth / Token)
    participant TxRunner as TenantAwareTransactionRunner
    participant Port as MetricsPort (Otel Adapter)
    participant Otel as MeterProvider & Exporter
    actor Prometheus as Prometheus Scraper

    Note over Express,MetricsMid: Flujo de Petición HTTP de Negocio
    Cliente->>Express: POST /oauth/v2/token (Client Credentials)
    Express->>MetricsMid: Intercepta Solicitud
    MetricsMid->>MetricsMid: Registra startHrTime = process.hrtime.bigint()
    MetricsMid->>UseCase: Delega ejecución del comando
    
    UseCase->>Port: recordAuthAttempt(clientId, 'client_credentials', 'success')
    Port->>Otel: Incrementa contador auth_attempts_total
    
    UseCase->>TxRunner: executeUnderTenant(tenantId, txCallback)
    activate TxRunner
    Note over TxRunner: Cronometra ejecución de la transacción RLS
    TxRunner-->>UseCase: Transacción confirmada exitosamente
    TxRunner->>Port: recordDbQuery('transaction', 'multi_tenant_tx', duration)
    Port->>Otel: Registra observación en db_query_duration_seconds
    deactivate TxRunner

    UseCase->>Port: recordTokenIssued('client_credentials')
    Port->>Otel: Incrementa contador auth_tokens_issued_total
    UseCase-->>Express: Retorna respuesta 200 OK con Access Token
    
    Express->>MetricsMid: Dispara evento res.on('finish')
    MetricsMid->>Normalizer: normalize(req.originalUrl)
    Normalizer-->>MetricsMid: Ruta canónica "/oauth/v2/token"
    MetricsMid->>Port: recordHttpRequest('POST', '/oauth/v2/token', 200, duration)
    Port->>Otel: Incrementa http_requests_total y observa http_request_duration_seconds
    Express-->>Cliente: HTTP 200 OK (Token emitido)

    Note over Prometheus,Express: Flujo Asíncrono de Scrape de Telemetría
    Prometheus->>Express: GET /metrics (HTTP Scrape cada 15s)
    Express->>Port: getMetrics()
    Port->>Otel: exporter.collect() & serializer.serialize()
    Otel-->>Port: Payload en formato OpenMetrics (texto plano)
    Port-->>Express: Texto formateado con contadores, histogramas y gauges
    Express-->>Prometheus: HTTP 200 (text/plain; version=0.0.4)
```
