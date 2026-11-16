import { randomBytes, randomUUID } from 'crypto';
import { DomainValidationError } from '../exceptions/domain_error';

export class InvalidTraceContextError extends DomainValidationError {
  constructor(message: string) {
    super(`Invalid Trace Context: ${message}`);
  }
}

export interface TraceContextProps {
  traceId: string;
  spanId: string;
  traceFlags?: string;
  requestId?: string;
  correlationId?: string;
  parentSpanId?: string;
}

const W3C_TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ALL_ZEROES_TRACE_ID = '00000000000000000000000000000000';
const ALL_ZEROES_SPAN_ID = '0000000000000000';
const DEFAULT_VERSION = '00';
const DEFAULT_FLAGS = '01';

/**
 * Immutable Value Object encapsulating W3C Trace Context and Request Correlation.
 * Adheres to W3C Trace Context recommendation (version 00).
 */
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

  /**
   * Creates a TraceContext instance validating all W3C invariants.
   */
  public static create(props: TraceContextProps): TraceContext {
    const traceId = props.traceId ? props.traceId.toLowerCase().trim() : '';
    const spanId = props.spanId ? props.spanId.toLowerCase().trim() : '';
    const traceFlags = (props.traceFlags || DEFAULT_FLAGS).toLowerCase().trim();
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
      version: DEFAULT_VERSION,
      traceId,
      spanId,
      traceFlags,
      requestId,
      correlationId,
      parentSpanId,
    });
  }

  /**
   * Generates a completely new root trace context with secure random identifiers.
   */
  public static createNew(requestId?: string, correlationId?: string): TraceContext {
    const traceId = randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    const activeRequestId = requestId ? requestId.trim() : randomUUID();
    const activeCorrelationId = correlationId ? correlationId.trim() : activeRequestId;

    return new TraceContext({
      version: DEFAULT_VERSION,
      traceId,
      spanId,
      traceFlags: DEFAULT_FLAGS,
      requestId: activeRequestId,
      correlationId: activeCorrelationId,
    });
  }

  /**
   * Parses an incoming W3C traceparent header and derives a child span for this service hop.
   */
  public static fromW3C(traceparent: string, requestId?: string, correlationId?: string): TraceContext {
    if (!traceparent || typeof traceparent !== 'string') {
      throw new InvalidTraceContextError('Traceparent header must be a non-empty string');
    }

    const trimmed = traceparent.trim().toLowerCase();
    const match = trimmed.match(W3C_TRACEPARENT_REGEX);

    if (!match) {
      throw new InvalidTraceContextError(`Malformed traceparent header format: "${traceparent}"`);
    }

    const [, version, incomingTraceId, incomingParentSpanId, traceFlags] = match;

    if (!version || !incomingTraceId || !incomingParentSpanId || !traceFlags) {
      throw new InvalidTraceContextError(`Malformed traceparent header format: "${traceparent}"`);
    }

    if (version !== DEFAULT_VERSION) {
      throw new InvalidTraceContextError(`Unsupported W3C traceparent version: "${version}". Expected "${DEFAULT_VERSION}".`);
    }

    if (incomingTraceId === ALL_ZEROES_TRACE_ID) {
      throw new InvalidTraceContextError('All-zeroes trace-id is forbidden by W3C specification.');
    }

    if (incomingParentSpanId === ALL_ZEROES_SPAN_ID) {
      throw new InvalidTraceContextError('All-zeroes span-id is forbidden by W3C specification.');
    }

    // Microservice hop: derive a fresh unique spanId for this service while recording parentSpanId
    const localSpanId = randomBytes(8).toString('hex');
    const activeRequestId = requestId ? requestId.trim() : randomUUID();
    const activeCorrelationId = correlationId ? correlationId.trim() : activeRequestId;

    return new TraceContext({
      version: DEFAULT_VERSION,
      traceId: incomingTraceId,
      spanId: localSpanId,
      traceFlags,
      requestId: activeRequestId,
      correlationId: activeCorrelationId,
      parentSpanId: incomingParentSpanId,
    });
  }

  /**
   * Non-throwing helper to check if a header string is valid W3C traceparent format.
   */
  public static isValidW3C(traceparent?: string | null): boolean {
    if (!traceparent || typeof traceparent !== 'string') {
      return false;
    }

    const trimmed = traceparent.trim().toLowerCase();
    const match = trimmed.match(W3C_TRACEPARENT_REGEX);
    if (!match) {
      return false;
    }

    const [, version, traceId, spanId] = match;
    if (version !== DEFAULT_VERSION) {
      return false;
    }
    if (traceId === ALL_ZEROES_TRACE_ID || spanId === ALL_ZEROES_SPAN_ID) {
      return false;
    }

    return true;
  }

  /**
   * Serializes to canonical W3C traceparent header string: {version}-{trace_id}-{span_id}-{trace_flags}
   */
  public toTraceparent(): string {
    return `${this.version}-${this.traceId}-${this.spanId}-${this.traceFlags}`;
  }

  /**
   * Derives a child span preserving the traceId, requestId, and traceFlags.
   */
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

  /**
   * Equality check by value.
   */
  public equals(other: TraceContext | null | undefined): boolean {
    if (!other || !(other instanceof TraceContext)) {
      return false;
    }

    return (
      this.version === other.version &&
      this.traceId === other.traceId &&
      this.spanId === other.spanId &&
      this.traceFlags === other.traceFlags &&
      this.requestId === other.requestId &&
      this.correlationId === other.correlationId &&
      this.parentSpanId === other.parentSpanId
    );
  }

  private static validateTraceId(traceId: string): void {
    if (!/^[0-9a-f]{32}$/.test(traceId)) {
      throw new InvalidTraceContextError(
        `Invalid traceId: "${traceId}". Must be 32 lowercase hexadecimal characters.`
      );
    }
    if (traceId === ALL_ZEROES_TRACE_ID) {
      throw new InvalidTraceContextError('All-zeroes traceId is forbidden by W3C specification.');
    }
  }

  private static validateSpanId(spanId: string, fieldName = 'spanId'): void {
    if (!/^[0-9a-f]{16}$/.test(spanId)) {
      throw new InvalidTraceContextError(
        `Invalid ${fieldName}: "${spanId}". Must be 16 lowercase hexadecimal characters.`
      );
    }
    if (spanId === ALL_ZEROES_SPAN_ID) {
      throw new InvalidTraceContextError(`All-zeroes ${fieldName} is forbidden by W3C specification.`);
    }
  }

  private static validateTraceFlags(flags: string): void {
    if (!/^[0-9a-f]{2}$/.test(flags)) {
      throw new InvalidTraceContextError(
        `Invalid traceFlags: "${flags}". Must be 2 lowercase hexadecimal characters.`
      );
    }
  }
}
