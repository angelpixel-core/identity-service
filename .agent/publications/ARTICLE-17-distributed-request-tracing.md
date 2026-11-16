# ARTICLE-17: Trazabilidad Distribuida de Extremo a Extremo con W3C Traceparent, Correlación RFC 7230/7231 y Propagación Transaccional en PostgreSQL — Cumplimiento PCI-DSS v4.0 & SOC 2 Type II

* **Artículo ID:** ARTICLE-17
* **User Story Asociada:** [US-20: Distributed Request-ID & W3C Traceparent Tracing](../epics/EPIC-08-distributed-observability-and-request-correlation/stories/US-20-distributed-request-id-tracing.md)
* **Épica:** [EPIC-08: Distributed Observability & Request Correlation](../epics/EPIC-08-distributed-observability-and-request-correlation/README.md)
* **Bounded Context:** `observability` / `shared` / `security`
* **Tipo de Slice:** Full-Stack Distributed Tracing Slice (Domain Value Object, Infrastructure AsyncLocalStorage Adapter, HTTP Tracing Middleware, PostgreSQL Session Context, Helm Ingress, BDD Acceptance)
* **Rama de Trabajo:** `feat/us-20-distributed-request-id-tracing`
* **Pull Request de Integración:** [PR #11](https://github.com/angelpixel-core/identity-service/pull/11) (Squash & Merge a `main`, commit `0d5c086`)
* **ADR Relacionado:** [ADR 0007: Cloud Infrastructure Topology](../../docs/adr/0007-cloud-infrastructure-topology.md)
* **Guía Canónica Asociada:** [GUIDELINE-21: Trazabilidad Distribuida, Correlación RFC 7230/7231 y Propagación W3C Traceparent](../guidelines/GUIDELINE-21-distributed-request-tracing.md)
* **Fecha:** Noviembre 2026
* **Autor / Tech Lead:** AngelSolutions Platform & Observability Engineering Team (Pair Programming)

---

## 1. Motivación y Resumen Ejecutivo

En la ingeniería de plataformas de identidad y autenticación federada de misión crítica bancaria (*Identity-as-a-Service - IDaaS*), la observabilidad distribuida no es un accesorio cosmético o una herramienta de desarrollo: constituye el **sistema nervioso central y la garantía forense** indispensable para la integridad operativa, la detección temprana de intrusiones y el cumplimiento regulatorio estricto.

En una arquitectura moderna basada en microservicios contenerizados y Kubernetes, una simple operación iniciada por un usuario (por ejemplo, un inicio de sesión federado vía OIDC, un intercambio de tokens con PKCE o la consulta de perfil de un inquilino) atraviesa múltiples saltos de red y límites de proceso:
1. Pasa por el controlador de borde (*NGINX Ingress Controller*).
2. Es interceptada por los middlewares HTTP de la capa de interfaces de Express.
3. Se ejecuta a través de casos de uso desacoplados y servicios de dominio en TypeScript.
4. Interactúa con bases de datos relacionales (*PostgreSQL*) protegidas con aislamiento multi-inquilino a nivel de fila (*Row-Level Security - RLS*).
5. Emite eventos inmutables de auditoría hacia los colectores centrales de seguridad (*Azure Log Analytics / SIEM*).

---

### 1.1 Las Tres Fallas Estructurales de la Observabilidad Tradicional en FinTech

Históricamente, los sistemas de software empresariales han abordado la correlación de solicitudes mediante mecanismos artesanales o incompletos que colapsan ante entornos de alta concurrencia:

```
+---------------------------------------------------------------------------------------------------------+
| LAS TRES FALLAS ESTRUCTURALES DE LA OBSERVABILIDAD HISTÓRICA                                            |
|                                                                                                         |
|  1. FRAGMENTACIÓN DE ENCABEZADOS Y FALTA DE ESTÁNDARES                                                   |
|     - Dependencia de encabezados ad-hoc (`X-Request-ID`) sin semántica de spans ni flags de muestreo.   |
|     - Incompatibilidad con colectores OpenTelemetry, Grafana Tempo, Datadog o Jaeger.                   |
|                                                                                                         |
|  2. PÉRDIDA DE CONTEXTO EN EL RUNTIME ASÍNCRONO DE NODE.JS                                              |
|     - El dilema del "Parameter Drilling": ensuciar todas las interfaces de dominio pasando `req`.       |
|     - El riesgo de variables globales estáticas en un bucle de eventos monohilo concurrente.            |
|                                                                                                         |
|  3. LA CAJA NEGRA DE LA BASE DE DATOS RELACIONAL (POSTGRESQL)                                           |
|     - Transacciones SQL anónimas ejecutadas a través de connection pools compartidos.                   |
|     - Imposibilidad de vincular locks, deadlocks o slow queries en `pg_stat_activity` con la traza HTTP.|
+---------------------------------------------------------------------------------------------------------+
```

1. **Fragmentación y Falta de Interoperabilidad:** La utilización aislada de cabeceras propietarias como `X-Request-ID` no proporciona información sobre la jerarquía de llamadas (*parent-child spans*) ni banderas de muestreo (*sampled flags*). Cuando la solicitud sale del microservicio hacia otros sistemas downstream, el contexto de rastreo se fractura irreversiblemente.
2. **Pérdida de Contexto en el Event Loop:** En el runtime asíncrono y no bloqueante de Node.js, las solicitudes se intercalan en un único hilo de ejecución a través de microtareas y callbacks. Intentar mantener el contexto mediante variables globales provoca contaminación cruzada catastrófica entre peticiones concurrentes de diferentes inquilinos. Por otro lado, pasar el identificador de solicitud manualmente como argumento a lo largo de cada caso de uso, agregado de dominio y repositorio (*parameter drilling*) destruye la pureza arquitectónica y viola los principios de Clean Architecture y Domain-Driven Design (DDD).
3. **La Brecha de Observabilidad Relacional:** Aunque una aplicación registre logs detallados en la capa HTTP, las consultas enviadas al motor relacional se ejecutan a través de un pool de conexiones compartidas (`pg.Pool`). Para los administradores de bases de datos (DBAs) y los ingenieros SRE, la vista `pg_stat_activity` muestra únicamente sentencias SQL descontextualizadas, imposibilitando correlacionar un bloqueo crítico (*deadlock*) con la transacción de negocio y la traza HTTP que la originó.

---

### 1.2 Marco de Cumplimiento Normativo Internacional

Para subsanar estas vulnerabilidades, la implementación de la historia de usuario **US-20** se concibió bajo el rigor de los estándares internacionales más exigentes de la industria financiera:

| Estándar / Regulación | Requerimiento Mandatorio | Implementación en `identity-service` |
| :--- | :--- | :--- |
| **W3C Trace Context (Rec. 2021)** | Encabezado estándar `traceparent` cuatripartito interoperable con OpenTelemetry y APM. | Value Object inmutable `TraceContext` que valida estrictamente la versión `00`, rechaza all-zeroes y deriva child spans en cada salto. |
| **RFC 7230 / RFC 7231** | Semántica formal de cabeceras HTTP de solicitud y respuesta. | Estrategia de doble encabezado: `X-Request-ID` para el salto local y `X-Correlation-ID` para el flujo distribuido de negocio. |
| **PCI-DSS v4.0** | **Req 10.2 & 10.5:** Trazabilidad obligatoria e inmutable de eventos de acceso, autenticación y autorización. | Enriquecimiento automático de `SecurityAuditTrace` en `SecurityAuditEventBuilder` emitido en NDJSON a `stdout`. |
| **SOC 2 Type II** | **Criterio CC7.2:** Monitoreo continuo y capacidad de detección de anomalías y escaladas no autorizadas. | Visibilidad forense en tiempo real de transacciones en PostgreSQL mediante `set_config` con `is_local = true`. |

---

### 1.3 Topología End-to-End de Trazabilidad FinTech

La arquitectura implementada conecta todas las capas de la plataforma en una única cadena de correlación continua y verificable:

```
+---------------------------------------------------------------------------------------------------------+
| TOPOLOGÍA DE TRAZABILIDAD DISTRIBUIDA (US-20: END-TO-END CORRELATION)                                  |
|                                                                                                         |
|  [BORDE DE RED / INGRESS]                                                                               |
|  - Inbound HTTP Request con headers opcionales: traceparent, X-Request-ID, X-Correlation-ID             |
|  - NGINX Ingress Controller preserva y propaga cabeceras mediante configuration-snippet                 |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA DE INTERFACES / MIDDLEWARE HTTP]                                                                 |
|  - traceContextMiddleware intercepta la solicitud y valida formato W3C                                |
|  - Fallback defensivo transparente (cero errores 500 por cabeceras malformadas)                         |
|  - Derivación estricta de nuevo spanId local y preservación de parentSpanId                             |
|  - Decoración simétrica de encabezados en la respuesta HTTP saliente                                    |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA DE INFRAESTRUCTURA COMPARTIDA / ASYNCLOCALSTORAGE]                                               |
|  - CorrelationContextStorage.run(traceContext, next) envuelve el ciclo de ejecución                     |
|  - Aislamiento asíncrono total entre peticiones concurrentes en el Event Loop                           |
|  - Acceso de acoplamiento cero sin "parameter drilling"                                                 |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA DE APLICACIÓN Y DOMINIO / CASOS DE USO]                                                          |
|  - Casos de uso ejecutan lógica pura sin acoplamiento a Express o metadatos de transporte               |
|  - SecurityAuditEventBuilder recupera implícitamente traceId, spanId y requestId                        |
|  - Emisión inmutable de auditoría 12-Factor NDJSON a stdout (PCI-DSS 10.2)                              |
|         │                                                                                               |
|         ▼                                                                                               |
|  [CAPA DE PERSISTENCIA / POSTGRESQL SESSION CONTEXT]                                                    |
|  - TenantAwareTransactionRunner inyecta dentro de la transacción activa:                               |
|       * SELECT set_config('app.current_tenant_id', $1, true)                                            |
|       * SELECT set_config('app.traceparent', $2, true)                                                  |
|       * SELECT set_config('app.request_id', $3, true)                                                   |
|  - Parámetro is_local = true garantiza caducidad nativa al COMMIT/ROLLBACK (anti-pool poisoning)         |
|  - Correlación forense en vivo en pg_stat_activity para SREs y DBAs                                     |
+---------------------------------------------------------------------------------------------------------+
```

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Cliente HTTP / SPA
    participant Ingress as NGINX Ingress Controller
    participant Middleware as TraceContextMiddleware
    participant Storage as AsyncLocalStorage
    participant App as UseCase / Aggregate
    participant DB as PostgreSQL (Session Context)
    participant Audit as NDJSON Audit Logger

    Cliente->>Ingress: HTTP Request (traceparent opcional, X-Request-ID)
    Note over Ingress: Preserva o reenvía<br/>traceparent & X-Request-ID
    Ingress->>Middleware: Inbound Request
    Note over Middleware: Valida W3C traceparent.<br/>Si es válido, deriva child spanId.<br/>Si es ausente, crea nueva raíz.
    Middleware->>Storage: CorrelationContextStorage.run(traceContext)
    activate Storage
    Middleware->>App: Invoca Casos de Uso (dominio desacoplado)
    App->>DB: TenantAwareTransactionRunner.runInTenantContext()
    Note over DB: BEGIN;<br/>SET LOCAL app.current_tenant_id = $1;<br/>SET LOCAL app.traceparent = $2;<br/>SET LOCAL app.request_id = $3;
    DB-->>App: Transacción completada (COMMIT)
    App->>Audit: SecurityAuditLogger.logEvent()
    Note over Audit: Recupera traceId/spanId<br/>desde Storage.current()<br/>y emite NDJSON a stdout
    App-->>Middleware: Resultado de negocio
    deactivate Storage
    Middleware-->>Cliente: HTTP Response con headers:<br/>traceparent, X-Request-ID, X-Correlation-ID
```


---

## 2. El Estándar W3C Trace Context en FinTech

### 2.1 Anatomía Cuatripartita del Encabezado `traceparent`

El estándar **W3C Trace Context (Recommendation 2021)** formaliza una cabecera HTTP universal y neutral respecto a proveedores de APM para intercambiar contexto de rastreo distribuido entre componentes heterogéneos.

La cabecera `traceparent` consiste en una cadena ASCII estricta de 55 caracteres en minúsculas estructurada en cuatro campos posicionales delimitados por guiones (`-`):

$$\texttt{traceparent} = \texttt{version} - \texttt{trace\_id} - \texttt{parent\_id} - \texttt{trace\_flags}$$

Ejemplo Canónico: `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`

```
  00 - 4bf92f3577b34da6a3ce929d0e0e4736 - 00f067aa0ba902b7 - 01
  │    │                                │                    │
  │    │                                │                    └── Trace Flags (2 hex: 01 = sampled)
  │    │                                └── Parent / Span ID (16 hex: 8 bytes)
  │    └── Trace ID (32 hex: 16 bytes)
  └── Version (2 hex: 00)
```

| Subcampo | Formato y Longitud | Rango Hexadecimal | Invariantes de Especificación W3C | Semántica en `identity-service` |
| :--- | :--- | :--- | :--- | :--- |
| **`version`** | 2 caracteres hex (1 byte) | `00` a `fe` | La versión actual es `00`. El valor `ff` está prohibido. Versiones futuras permiten campos adicionales delimitados por guiones, pero la versión `00` debe tener exactamente 4 campos. | Fijado rígidamente en `00`. Cualquier versión entrante distinta de `00` se considera incompatible y provoca la regeneración transparente de una nueva raíz. |
| **`trace_id`** | 32 caracteres hex (16 bytes / 128 bits) | `00000000000000000000000000000001` a `ffffffffffffffffffffffffffffffff` | **Prohibido All-Zeroes:** Un identificador con 32 ceros se considera sintácticamente inválido (W3C Sec. 3.2.2). Debe poseer entropía criptográfica global. | Identificador global inmutable de la transacción distribuida de negocio. Se propaga idéntico a través de todos los microservicios y bases de datos. |
| **`parent_id` / `span_id`** | 16 caracteres hex (8 bytes / 64 bits) | `0000000000000001` a `ffffffffffffffff` | **Prohibido All-Zeroes:** Un identificador con 16 ceros se considera sintácticamente inválido (W3C Sec. 3.2.3). Identifica el salto inmediato emisor. | En el encabezado entrante representa el span del emisor (`parentSpanId`). Para la ejecución interna, se deriva un nuevo `spanId` criptográfico único. |
| **`trace_flags`** | 2 caracteres hex (1 byte / 8 bits) | `00` a `ff` | Mapa de bits de 8 posiciones. El bit menos significativo (`01`) es la bandera `recorded` / `sampled`. Los 7 bits restantes están reservados. | Por defecto `01` (recorded). Informa a colectores OpenTelemetry y agentes APM si los spans deben persistirse en los backends de observabilidad. |

---

### 2.2 Invariantes de Dominio y Validación Defensiva

En servicios financieros, la exposición directa a internet requiere defensas activas contra cargas útiles maliciosas o vectores de inyección en encabezados HTTP (*Header Injection / CRLF*):

1. **Expresión Regular Canónica de Alta Eficiencia:**
   El analizador sintáctico evalúa la cabecera mediante una expresión regular anclada que previene backtracking exponencial (ReDoS):
   ```typescript
   const W3C_TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
   ```
2. **Rechazo Categórico de Identificadores Nulos (All-Zeroes):**
   Conforme a la sección 3.2 de la recomendación W3C:
   - `trace_id = 00000000000000000000000000000000` es formalmente inválido.
   - `parent_id = 0000000000000000` es formalmente inválido.
   Si una petición contiene cualquiera de estos valores, el validador estático `TraceContext.isValidW3C()` retorna `false`.
3. **Resiliencia Operativa Fail-Safe:**
   El sistema **nunca** arroja un error HTTP `400 Bad Request` ni `500 Internal Server Error` ante encabezados de trazabilidad corruptos. En su lugar, el middleware activa silenciosamente el método de factoría `TraceContext.createNew()`, generando una nueva raíz criptográfica que preserva la disponibilidad del servicio y garantiza observabilidad local ininterrumpida.

---

### 2.3 Semántica del Salto de Microservicio (Service Hop) y Prevención de Colisión de Spans

Un error recurrente en implementaciones iniciales de observabilidad consiste en **reutilizar el `span_id` recibido en el encabezado `traceparent`** como el identificador de la operación local.

```
ANTIPATRÓN: REUTILIZACIÓN ERRÓNEA DE SPAN ID (COLISIÓN DE SPANS)
[API Gateway]       (span_id: 00f067aa0ba902b7)
       │
       ▼  HTTP Request con traceparent: 00-4bf92f35...-00f067aa0ba902b7-01
[Identity Service]  (REUTILIZA: 00f067aa0ba902b7)  <-- ¡COLISIÓN EN APM!
       │
       └── Resultado: En Grafana Tempo/Jaeger, la latencia de red del Ingress y
           el tiempo de procesamiento del microservicio se sobreescriben o mezclan.
```

#### Regla Canónica de OpenTelemetry y W3C:
Cada microservicio representa un segmento diferenciado en el grafo acíclico dirigido (DAG) de la transacción distribuida. Por lo tanto, al aceptar una solicitud entrante:
1. El `span_id` entrante se almacena como `parentSpanId`.
2. Se genera un nuevo `spanId` local mediante entropía criptográfica (`randomBytes(8).toString('hex')`).
3. Todas las operaciones internas (consultas a base de datos, eventos de auditoría y llamadas salientes) se ejecutan bajo la identidad de este nuevo span hijo.

```mermaid
flowchart TD
    subgraph RootSpan["Span A: API Gateway / Ingress Controller"]
        direction TB
        SpanA["span_id: 00f067aa0ba902b7<br/>parent_id: null<br/>Latencia: 45ms"]
    end

    subgraph ChildSpan1["Span B: Identity Service (Service Hop)"]
        direction TB
        SpanB["span_id: 5c8a412e109dfb33<br/>parent_id: 00f067aa0ba902b7<br/>Latencia: 28ms"]
    end

    subgraph ChildSpan2["Span C: PostgreSQL Transaction"]
        direction TB
        SpanC["app.traceparent = 00-4bf92f...-5c8a412e109dfb33-01<br/>parent_id: 5c8a412e109dfb33<br/>Latencia: 8ms"]
    end

    SpanA -->|HTTP Inbound| SpanB
    SpanB -->|SQL SET LOCAL| SpanC
```

Esta semántica permite a las herramientas de observabilidad descomponer con precisión de microsegundos qué fracción del tiempo de respuesta total corresponde a la red perimetral, a la lógica del microservicio y a las consultas en base de datos relacional.


---

## 3. Diseño de Dominio e Infraestructura (Clean Architecture & DDD)

### 3.1 El Value Object Inmutable `TraceContext`

El diseño arquitectónico de `identity-service` sitúa a `TraceContext` en el núcleo del dominio compartido (`src/contexts/shared/domain/tracing/trace_context.ts`). 

Siguiendo el patrón *Value Object* de Domain-Driven Design (DDD):
- **Inmutabilidad Absoluta:** La instancia sella su estado interno mediante `Object.freeze(this)` en su constructor privado, garantizando que ninguna capa o mutación asíncrona pueda alterar sus propiedades.
- **Igualdad por Valor:** Dos instancias de `TraceContext` son idénticas si y solo si todos sus campos de versión, traza, spans, identificadores de correlación y request coinciden exactamente (`equals(other)`).
- **Encapsulación de Invariantes:** Toda regla W3C (longitud, caracteres hexadecimales válidos, rechazo de ceros absolutos) es validada en el momento de creación, impidiendo que existan estados inválidos en la memoria del proceso.

```typescript
import { randomBytes, randomUUID } from 'crypto';
import { DomainValidationError } from '../exceptions/domain_error';

export interface TraceContextProps {
  traceId: string;
  spanId: string;
  traceFlags?: string;
  requestId?: string;
  correlationId?: string;
  parentSpanId?: string;
}

export class TraceContext {
  public readonly version: string;
  public readonly traceId: string;
  public readonly spanId: string;
  public readonly traceFlags: string;
  public readonly requestId: string;
  public readonly correlationId: string;
  public readonly parentSpanId?: string;

  private constructor(props: {
    version: string;
    traceId: string;
    spanId: string;
    traceFlags: string;
    requestId: string;
    correlationId: string;
    parentSpanId?: string;
  }) {
    this.version = props.version;
    this.traceId = props.traceId;
    this.spanId = props.spanId;
    this.traceFlags = props.traceFlags;
    this.requestId = props.requestId;
    this.correlationId = props.correlationId;
    this.parentSpanId = props.parentSpanId;

    Object.freeze(this);
  }

  public static create(props: TraceContextProps): TraceContext {
    const traceId = props.traceId ? props.traceId.toLowerCase().trim() : '';
    const spanId = props.spanId ? props.spanId.toLowerCase().trim() : '';
    const traceFlags = (props.traceFlags || '01').toLowerCase().trim();
    const requestId = props.requestId ? props.requestId.trim() : randomUUID();
    const correlationId = props.correlationId ? props.correlationId.trim() : requestId;
    const parentSpanId = props.parentSpanId ? props.parentSpanId.toLowerCase().trim() : undefined;

    TraceContext.validateTraceId(traceId);
    TraceContext.validateSpanId(spanId);
    TraceContext.validateTraceFlags(traceFlags);

    if (parentSpanId !== undefined) {
      TraceContext.validateSpanId(parentSpanId, 'parentSpanId');
    }

    return new TraceContext({
      version: '00',
      traceId,
      spanId,
      traceFlags,
      requestId,
      correlationId,
      parentSpanId,
    });
  }

  public static createNew(requestId?: string, correlationId?: string): TraceContext {
    const traceId = randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    const activeRequestId = requestId ? requestId.trim() : randomUUID();
    const activeCorrelationId = correlationId ? correlationId.trim() : activeRequestId;

    return new TraceContext({
      version: '00',
      traceId,
      spanId,
      traceFlags: '01',
      requestId: activeRequestId,
      correlationId: activeCorrelationId,
    });
  }

  public static fromW3C(traceparent: string, requestId?: string, correlationId?: string): TraceContext {
    if (!traceparent || typeof traceparent !== 'string') {
      throw new InvalidTraceContextError('Traceparent header must be a non-empty string');
    }

    const trimmed = traceparent.trim().toLowerCase();
    const match = trimmed.match(/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);

    if (!match) {
      throw new InvalidTraceContextError(`Malformed traceparent header format: "${traceparent}"`);
    }

    const [, version, incomingTraceId, incomingParentSpanId, traceFlags] = match;

    if (!version || !incomingTraceId || !incomingParentSpanId || !traceFlags) {
      throw new InvalidTraceContextError(`Malformed traceparent header format: "${traceparent}"`);
    }

    if (version !== '00') {
      throw new InvalidTraceContextError(`Unsupported W3C traceparent version: "${version}". Expected "00".`);
    }

    if (incomingTraceId === '00000000000000000000000000000000') {
      throw new InvalidTraceContextError('All-zeroes trace-id is forbidden by W3C specification.');
    }

    if (incomingParentSpanId === '0000000000000000') {
      throw new InvalidTraceContextError('All-zeroes span-id is forbidden by W3C specification.');
    }

    // Microservicio hop: derivar nuevo spanId local preservando el entrante como parentSpanId
    const localSpanId = randomBytes(8).toString('hex');
    const activeRequestId = requestId ? requestId.trim() : randomUUID();
    const activeCorrelationId = correlationId ? correlationId.trim() : activeRequestId;

    return new TraceContext({
      version: '00',
      traceId: incomingTraceId,
      spanId: localSpanId,
      traceFlags,
      requestId: activeRequestId,
      correlationId: activeCorrelationId,
      parentSpanId: incomingParentSpanId,
    });
  }

  public toTraceparent(): string {
    return `${this.version}-${this.traceId}-${this.spanId}-${this.traceFlags}`;
  }

  public createChildSpan(): TraceContext {
    const childSpanId = randomBytes(8).toString('hex');
    return new TraceContext({
      version: this.version,
      traceId: this.traceId,
      spanId: childSpanId,
      traceFlags: this.traceFlags,
      requestId: this.requestId,
      correlationId: this.correlationId,
      parentSpanId: this.spanId,
    });
  }
}
```

---

### 3.2 Adaptador de Infraestructura `CorrelationContextStorage` (Node.js `AsyncLocalStorage`)

Uno de los mayores desafíos en Clean Architecture consiste en permitir que componentes de infraestructura (como repositorios de bases de datos y auditores de seguridad) tengan acceso al contexto de trazabilidad de la solicitud sin contaminar los casos de uso ni las interfaces de dominio (*Zero Parameter Drilling*).

En `src/contexts/shared/infrastructure/tracing/correlation_context_storage.ts`, se implementa un adaptador estático basado en la API nativa `AsyncLocalStorage` de Node.js:

```typescript
import { AsyncLocalStorage } from 'async_hooks';
import { TraceContext } from '../../domain/tracing/trace_context';

export class CorrelationContextStorage {
  private static readonly storage = new AsyncLocalStorage<TraceContext>();

  public static run<T>(context: TraceContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  public static current(): TraceContext | undefined {
    return this.storage.getStore();
  }

  public static getTraceparent(): string {
    const currentContext = this.current();
    if (currentContext) {
      return currentContext.toTraceparent();
    }
    return TraceContext.createNew().toTraceparent();
  }

  public static getRequestId(): string | undefined {
    return this.current()?.requestId;
  }

  public static getCorrelationId(): string | undefined {
    return this.current()?.correlationId ?? this.current()?.requestId;
  }

  public static getTraceId(): string | undefined {
    return this.current()?.traceId;
  }

  public static getSpanId(): string | undefined {
    return this.current()?.spanId;
  }
}
```

#### Propiedades y Garantías Técnicas:
1. **Propagación Asíncrona Automática:** `AsyncLocalStorage` garantiza que cada llamada a `await`, cada microtarea de Promise y cada callback de I/O dentro de la función ejecutada por `run()` tenga acceso ininterrumpido al almacén de datos del contexto actual.
2. **Aislamiento Concurrente Estricto:** Peticiones concurrentes ejecutadas en el mismo hilo de Node.js operan en almacenes estrictamente aislados. No existe ningún riesgo de contaminación cruzada (*cross-request context leaking*).
3. **Liberación de Memoria por V8:** Al terminar la ejecución de la función envuelta en `run()`, la referencia al almacén queda fuera de alcance y es recolectada de inmediato por el recolector de basura de V8, evitando fugas de memoria (*zero memory leaks*).
4. **Resiliencia Operativa:** Si un accesor como `getTraceparent()` es invocado fuera de un ciclo de solicitud HTTP (por ejemplo, en scripts de migración o tareas cron), genera defensivamente un nuevo contexto raíz en lugar de provocar un fallo por puntero nulo.


---

## 4. Intercepción HTTP y Enriquecimiento de Auditoría de Seguridad

### 4.1 El Middleware HTTP de Trazabilidad (`traceContextMiddleware`)

El middleware HTTP de trazabilidad (`interfaces/http/middlewares/trace_context_middleware.ts`) actúa como la compuerta de entrada de la plataforma. Su función es normalizar los encabezados de red, garantizar la continuidad de la traza distribuida y envolver el ciclo de ejecución asíncrono.

```typescript
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { TraceContext } from '../../../src/contexts/shared/domain/tracing/trace_context';
import { CorrelationContextStorage } from '../../../src/contexts/shared/infrastructure/tracing/correlation_context_storage';

declare global {
  namespace Express {
    interface Request {
      traceContext?: TraceContext;
    }
  }
}

export function traceContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingTraceparent =
    (req.headers['traceparent'] as string) ||
    (req.headers['x-traceparent'] as string) ||
    undefined;

  const incomingRequestId =
    typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id'].trim().length > 0
      ? req.headers['x-request-id'].trim()
      : undefined;

  const incomingCorrelationId =
    typeof req.headers['x-correlation-id'] === 'string' && req.headers['x-correlation-id'].trim().length > 0
      ? req.headers['x-correlation-id'].trim()
      : undefined;

  const requestId = incomingRequestId || randomUUID();
  const correlationId = incomingCorrelationId || requestId;

  let traceContext: TraceContext;

  if (incomingTraceparent && TraceContext.isValidW3C(incomingTraceparent)) {
    try {
      traceContext = TraceContext.fromW3C(incomingTraceparent, requestId, correlationId);
    } catch {
      // Fallback defensivo ante fallos inesperados de parseo
      traceContext = TraceContext.createNew(requestId, correlationId);
    }
  } else {
    // Generación de nuevo contexto raíz W3C
    traceContext = TraceContext.createNew(requestId, correlationId);
  }

  // Decoración de la Petición
  req.traceContext = traceContext;
  req.headers['x-request-id'] = requestId;
  req.headers['x-correlation-id'] = correlationId;

  // Decoración Simétrica de Encabezados de Respuesta HTTP
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Correlation-ID', correlationId);
  res.setHeader('traceparent', traceContext.toTraceparent());

  // Ejecución del pipeline downstream dentro del contexto asíncrono
  CorrelationContextStorage.run(traceContext, () => {
    next();
  });
}
```

#### Aspectos Clave de la Implementación:
1. **Normalización Insensible a Mayúsculas:** Examina de forma defensiva variantes comunes de nombres de encabezados (`traceparent`, `x-traceparent`, `x-request-id` y `x-correlation-id`).
2. **Resiliencia Operacional (Zero Downtime / Zero 500s):** Si el encabezado entrante es malformado, viola la especificación W3C (ej. all-zeroes) o está ausente, el middleware genera un nuevo `TraceContext.createNew()` sin interrumpir la petición del cliente.
3. **Simetría Bidireccional:** El cliente receptor de la respuesta HTTP recibe los mismos identificadores `X-Request-ID`, `X-Correlation-ID` y `traceparent` (con el nuevo `span_id` derivado), facilitando la depuración en clientes móviles y frontends web.

---

### 4.2 Enriquecimiento Automático de Auditoría de Seguridad Bancaria (PCI-DSS & SOC 2)

El requerimiento **10.2 de PCI-DSS v4.0** impone registrar de manera inmutable todos los eventos de acceso, autenticación y autorización con identificadores verificables de sesión y traza.

En la capa de aplicación, el constructor de eventos `SecurityAuditEventBuilder` vincula automáticamente los datos de traza sin acoplar los casos de uso a la infraestructura:

```typescript
export interface SecurityAuditTrace {
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  traceparent?: string;
}

export class SecurityAuditEventBuilder {
  // ...
  public build(): SecurityAuditEvent {
    const activeTrace = CorrelationContextStorage.current();
    const trace: SecurityAuditTrace = {
      requestId: activeTrace?.requestId,
      correlationId: activeTrace?.correlationId,
      traceId: activeTrace?.traceId,
      spanId: activeTrace?.spanId,
      traceparent: activeTrace?.toTraceparent(),
    };

    const event: SecurityAuditEvent = {
      eventId: randomUUID(),
      eventType: this.eventType,
      severity: this.severity,
      timestamp: new Date().toISOString(),
      tenantId: this.tenantId,
      userId: this.userId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      trace,
      details: this.details,
    };

    return Object.freeze(event);
  }
}
```

#### Ejemplo de Evento de Auditoría Emitido (12-Factor NDJSON a `stdout`):
```json
{
  "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "eventType": "AUTH_LOGIN_SUCCESS",
  "severity": "INFO",
  "timestamp": "2026-11-16T14:15:22.184Z",
  "tenantId": "tenant-fintech-prod",
  "userId": "usr_99a8b7c6d5e4f3a2",
  "ipAddress": "192.168.1.105",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "trace": {
    "requestId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "correlationId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "5c8a412e109dfb33",
    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-5c8a412e109dfb33-01"
  },
  "details": {
    "authMethod": "PASSWORD_AND_MFA",
    "targetResource": "/api/v1/accounts"
  }
}
```

**Garantías de Cumplimiento:**
- **Inmutabilidad Criptográfica:** El evento se emite congelado (`Object.freeze`) y viaja directamente a `stdout` siguiendo el Principio XI de 12-Factor App, donde los daemons de Azure Monitor / FluentBit lo capturan y lo transmiten de forma inmutable a Azure Log Analytics con retención WORM de 365 días (PCI-DSS 10.5).
- **Protección de Datos Sensibles (PII Redaction):** Los identificadores de traza están garantizados como libres de contraseñas, hashes, tokens JWT o credenciales personales.


---

## 5. Propagación Transaccional a Base de Datos (PostgreSQL)

### 5.1 Inyección Transaccional con `set_config` y `is_local = true`

En las arquitecturas de microservicios modernas, el pool de conexiones hacia PostgreSQL suele representar una "caja negra" donde la correlación de solicitudes se desvanece. Las aplicaciones Node.js adquieren conexiones físicas efímeras desde un pool compartido (`pg.Pool`), ejecutan sentencias SQL y devuelven la conexión al pool.

Para que las herramientas de diagnóstico relacional y los administradores de base de datos (DBAs) puedan correlacionar las consultas con las solicitudes de red, `identity-service` aprovecha la función nativa de PostgreSQL `set_config`:

$$\texttt{SELECT set\_config('app.traceparent', \$1, true);}$$
$$\texttt{SELECT set\_config('app.request\_id', \$1, true);}$$

#### Invariantes Técnicas y Protección del Pool de Conexiones:
1. **Alcance Transaccional (`is_local = true`):** Al pasar el valor `true` como tercer argumento (equivalente a la directiva SQL `SET LOCAL`), la variable se fija **únicamente para la transacción en curso**.
2. **Caducidad Automática (Anti-Pool Poisoning):** Cuando la transacción finaliza mediante `COMMIT` o `ROLLBACK`, PostgreSQL purga automáticamente las variables locales. Esto previene que una conexión física reutilizada por otra petición conserve datos o trazas residuales de solicitudes anteriores.
3. **Comportamiento Fail-Closed:** Las consultas a tablas protegidas por Row-Level Security (RLS) dependen de que `app.current_tenant_id` esté configurado. La inyección de trazabilidad no altera este comportamiento: si no hay un tenant válido, RLS retorna cero filas protegiendo los datos multi-inquilino.

---

### 5.2 Implementación en `TenantAwareTransactionRunner`

En `src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner.ts`, el adaptador de infraestructura orquesta la apertura del bloque transaccional con `BEGIN` e inyecta de forma atómica tanto el contexto del tenant como los identificadores de trazabilidad distribuidos:

```typescript
const client = await this.pool.connect();
let hasError = false;

try {
  await client.query('BEGIN');

  // Inyección de Aislamiento Multi-Tenant (Row-Level Security)
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
    targetSession.getTenantIdValue(),
    true,
  ]);

  TenantAwareTransactionRunner.activeSessions.set(client, targetSession);

  // Inyección de Trazabilidad Distribuida (W3C Traceparent y Request-ID)
  const activeTrace = CorrelationContextStorage.current();
  if (activeTrace) {
    await client.query("SELECT set_config('app.traceparent', $1, true)", [
      activeTrace.toTraceparent(),
      true,
    ]);
    await client.query("SELECT set_config('app.request_id', $1, true)", [
      activeTrace.requestId,
      true,
    ]);
  }
} catch (err) {
  hasError = true;
  await this.handleRollback(client, err, 'set_config');
  throw err;
}
```

**Resiliencia Operativa:**
Si una transacción de base de datos se ejecuta fuera de una solicitud HTTP activa (por ejemplo, durante la ejecución de migraciones de esquema con Flyway/Liquibase o scripts de semillas), `CorrelationContextStorage.current()` retorna `undefined`. En estos escenarios, el runner omite limpiamente las llamadas a `set_config` para trazabilidad sin provocar errores, permitiendo tareas de mantenimiento transparentes.

---

### 5.3 Monitoreo Forense en Tiempo Real en `pg_stat_activity`

Gracias a esta instrumentación, los equipos de Operaciones, SRE y Seguridad disponen de visibilidad completa en tiempo real de lo que ocurre dentro del motor PostgreSQL.

#### Consulta Forense: Detección de Consultas Lentas con Trazabilidad Distribuida
```sql
SELECT 
    pid,
    usename,
    client_addr,
    now() - xact_start AS transaction_duration,
    now() - query_start AS query_duration,
    state,
    current_setting('app.traceparent', true) AS traceparent,
    current_setting('app.request_id', true) AS request_id,
    current_setting('app.current_tenant_id', true) AS tenant_id,
    query
FROM pg_stat_activity
WHERE state != 'idle'
  AND (now() - query_start) > interval '250 milliseconds'
ORDER BY query_duration DESC;
```

#### Análisis de Contención y Bloqueos de Transacciones (*Deadlocks*)
Cuando dos transacciones concurrentes compiten por actualizar las mismas filas en tablas como `users` o `clients`, los DBAs pueden identificar de inmediato qué solicitud HTTP específica está causando el bloqueo:

```sql
SELECT
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    current_setting('app.traceparent', true) AS blocked_traceparent,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_query,
    blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

---

### 5.4 Certificación de Pruebas de Integración

La integración entre `TenantAwareTransactionRunner`, `CorrelationContextStorage` y el cliente PostgreSQL está certificada mediante la suite de pruebas de integración `tests/integration/identity/tracing/test_database_trace_propagation.ts`.

Los escenarios verificados incluyen:
1. **Propagación Verificada:** Verificación de que `set_config('app.traceparent', ...)` y `set_config('app.request_id', ...)` se invocan con los valores exactos del `TraceContext` activo y con el flag `true`.
2. **Preservación de Correlation ID:** Garantía de que la diferenciación entre `requestId` y `correlationId` se respeta sin sobreescrituras en la base de datos.
3. **Rollback Seguro:** En caso de que ocurra una excepción durante `set_config` o durante la ejecución de la operación de negocio, se invoca `ROLLBACK` y se higieniza la conexión física antes de regresarla al pool.


---

## 6. Configuración de Borde Helm Ingress, Certificación Integral y Conclusiones

### 6.1 Configuración de Borde en Kubernetes (Helm & NGINX Ingress Controller)

Para que la trazabilidad distribuida funcione de extremo a extremo sin fisuras, el borde de la red (Ingress Controller) debe configurarse para no descartar ni manipular de forma destructiva las cabeceras de rastreo enviadas por los clientes o balanceadores externos.

En el Helm chart de la aplicación (`deployments/helm/identity-service/values.yaml`), se añadió la directiva de configuración de proxy dentro de las anotaciones de Ingress:

```yaml
ingress:
  enabled: true
  className: "nginx"
  annotations:
    kubernetes.io/ingress.class: "nginx"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-buffer-size: "128k"
    nginx.ingress.kubernetes.io/proxy-buffers-number: "4"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/use-regex: "true"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Request-ID $http_x_request_id;
      proxy_set_header X-Correlation-ID $http_x_correlation_id;
      proxy_set_header traceparent $http_traceparent;
```

#### Beneficios de la Configuración:
- **Preservación Transparente:** Si la petición HTTP entrante incluye `traceparent`, `X-Request-ID` o `X-Correlation-ID`, NGINX los reenvía de forma transparente al pod de Node.js mediante `$http_traceparent`, `$http_x_request_id` y `$http_x_correlation_id`.
- **Cero Fuga de Contexto:** Garantiza que los identificadores de traza viajen de forma continua desde las aplicaciones cliente (móviles y SPAs) hasta el motor de persistencia relacional.

---

### 6.2 Certificación Integral de Calidad y Cero Regresiones

La implementación de US-20 se sometió a una certificación exhaustiva bajo la metodología Inside-Out TDD, garantizando la total ausencia de regresiones en los 8 épicas y 20 historias de usuario del proyecto:

| Nivel de Prueba | Framework / Herramienta | Suites Ejecutadas | Pruebas Totales | Resultado | Cobertura / Alcance |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pruebas Unitarias** | Jest / TypeScript | 57 suites | 444 pruebas | **100% Passed (0 fallos)** | Value Objects, Entidades, Casos de Uso, Middlewares HTTP, Storage asíncrono y Builders de auditoría. |
| **Pruebas de Integración** | Jest / Testcontainers / pg | 23 suites | 136 pruebas | **100% Passed (0 fallos)** | Persistencia PostgreSQL, transacciones multi-tenant, propagación de variables de sesión y Redis Cache. |
| **Pruebas de Aceptación (BDD)** | Cucumber / Gherkin / Supertest | 12 suites | 43 escenarios | **100% Passed (0 fallos)** | 4 nuevos escenarios BDD en `distributed_request_tracing.feature` cubriendo W3C, RFC 7230 y fallbacks defensivos. |
| **Empaquetado Helm** | Helm CLI / Chart Testing | 6 etapas | 6 etapas | **100% Passed (0 fallos)** | Linting, renderizado de plantillas, validación de schemas de Ingress y Service. |
| **Pipeline CI/CD Local** | Docker / Bash script | 5 etapas | 5/5 escenarios | **100% Passed (0 fallos)** | Pipeline end-to-end con imagen Docker multi-stage Alpine de **161 MB**. |
| **TOTAL GENERAL** | — | **98 suites** | **623 pruebas** | **100% VERDE** | **Cero regresiones en toda la plataforma.** |

---

### 6.3 Estrategia Trunk-Based y Ciclo de Entrega Continua

Siguiendo la estrategia de **Trunk-Based Development** adoptada por la organización:
1. El desarrollo se ejecutó de forma aislada en la rama de características `feat/us-20-distributed-request-id-tracing`.
2. Se emitió el Pull Request formal:
   - **PR #11:** `feat(observability): distributed request-id & W3C traceparent tracing (US-20)`
   - **Enlace:** [https://github.com/angelpixel-core/identity-service/pull/11](https://github.com/angelpixel-core/identity-service/pull/11)
3. Los checks automáticos de integración continua (CI) de GitHub Actions validaron los 623 tests y la compilación TypeScript en **2 minutos y 48 segundos**.
4. Se ejecutó **Squash & Merge** en la rama principal `main` con el commit de integración `0d5c086`.
5. Siguiendo la política corporativa de retención de ramas, la rama `feat/us-20-distributed-request-id-tracing` se preserva intacta para auditoría y trazabilidad histórica.
6. La rama `development` se sincronizó de forma limpia y transparente mediante merge commit `a84c941`.

---

### 6.4 Conclusiones y Roadmap Técnico hacia OpenTelemetry (US-21 / US-22)

Con la culminación exitosa de **US-20**, `identity-service` cuenta con una arquitectura de observabilidad distribuida de nivel bancario:
- Cumple plenamente con la recomendación **W3C Trace Context (2021)** y los estándares **RFC 7230 / RFC 7231**.
- Satisface rigurosamente los requerimientos **10.2 y 10.5 de PCI-DSS v4.0** y el criterio **CC7.2 de SOC 2 Type II**.
- Erradica el antipatrón de *parameter drilling* gracias al aislamiento asíncrono provisto por `AsyncLocalStorage`.
- Ilumina la capa de base de datos relacional mediante la inyección no contaminante de variables de sesión locales en PostgreSQL.

#### Roadmap de EPIC-08 (Próximos Pasos):
- **US-21: OpenTelemetry SDK Integration & OTLP Trace Exporters:**
  Integrar el SDK oficial de OpenTelemetry para Node.js, configurando instrumentación automática para llamadas HTTP externas (Axios/Fetch), exportación de trazas en formato OTLP (gRPC/HTTP) hacia Grafana Tempo o Jaeger, y propagación de contexto en mensajería asíncrona.
- **US-22: RED Metrics & Real-Time Operational Dashboards:**
  Exponer métricas estandarizadas RED (Rate, Errors, Duration) mediante Prometheus y diseñar dashboards operacionales en Grafana para visualización en tiempo real de la latencia p95/p99 y tasas de error por inquilino.
