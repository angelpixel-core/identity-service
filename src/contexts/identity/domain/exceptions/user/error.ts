/**
 * Clases base y específicas de excepciones de dominio para el contexto de identidad.
 * Cero dependencias externas conforme a las reglas de Clean Architecture y DDD.
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

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

