import { DomainValidationError } from '../../exceptions/user/error';

/**
 * Value Object: OriginDomain
 * Representa y valida un origen web autorizado (esquema + host + puerto opcional), sin paths subordinados.
 */
export class OriginDomain {
  private readonly value: string;

  private constructor(value: string) {
    this.value = Object.freeze(value);
    Object.freeze(this);
  }

  public static create(rawOrigin: string): OriginDomain {
    if (!rawOrigin || typeof rawOrigin !== 'string') {
      throw new DomainValidationError('OriginDomain must be a non-empty string');
    }

    const trimmed = rawOrigin.trim();
    if (trimmed.length === 0) {
      throw new DomainValidationError('OriginDomain cannot be empty or whitespace');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new DomainValidationError(`Invalid OriginDomain format: "${trimmed}". Must be a valid URL.`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new DomainValidationError(
        `Invalid OriginDomain protocol: "${parsedUrl.protocol}". Only "http:" and "https:" are allowed.`
      );
    }

    if (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') {
      throw new DomainValidationError(
        `OriginDomain cannot include a path: "${trimmed}". Origins must consist only of protocol, host and port.`
      );
    }

    // Normalizar: origin estándar sin trailing slash
    const normalized = `${parsedUrl.protocol}//${parsedUrl.host}`;
    return new OriginDomain(normalized);
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: OriginDomain): boolean {
    if (!other || !(other instanceof OriginDomain)) {
      return false;
    }
    return this.value === other.getValue();
  }

  public toString(): string {
    return this.value;
  }
}

