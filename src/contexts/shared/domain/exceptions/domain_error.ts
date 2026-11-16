/**
 * Shared domain errors adhering to Clean Architecture and DDD principles.
 */

export abstract class DomainError extends Error {
  public readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class DomainValidationError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}
