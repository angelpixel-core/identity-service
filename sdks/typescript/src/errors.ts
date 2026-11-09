/**
 * Jerarquía de excepciones tipadas del SDK de AngelPixel Identity Service.
 * Cumple con RFC 6749 para errores OAuth2 y errores HTTP estándar.
 */
export class IdentitySDKError extends Error {
  public readonly status: number;
  public readonly error: string;
  public readonly error_description?: string;

  constructor(status: number, error: string, errorDescription?: string) {
    super(errorDescription ? `${error}: ${errorDescription}` : error);
    this.name = 'IdentitySDKError';
    this.status = status;
    this.error = error;
    this.error_description = errorDescription;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends IdentitySDKError {
  constructor(error: string = 'invalid_client', errorDescription?: string) {
    super(401, error, errorDescription);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends IdentitySDKError {
  constructor(error: string = 'forbidden', errorDescription?: string) {
    super(403, error, errorDescription);
    this.name = 'AuthorizationError';
  }
}

export class ValidationError extends IdentitySDKError {
  constructor(error: string = 'invalid_request', errorDescription?: string) {
    super(400, error, errorDescription);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends IdentitySDKError {
  constructor(error: string = 'not_found', errorDescription?: string) {
    super(404, error, errorDescription);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends IdentitySDKError {
  constructor(error: string = 'conflict', errorDescription?: string) {
    super(409, error, errorDescription);
    this.name = 'ConflictError';
  }
}

export class OAuth2ProtocolError extends IdentitySDKError {
  constructor(status: number, error: string, errorDescription?: string) {
    super(status, error, errorDescription);
    this.name = 'OAuth2ProtocolError';
  }
}

export function parseHttpError(status: number, data: any): IdentitySDKError {
  const error = data?.error || (status === 401 ? 'unauthorized' : 'request_failed');
  const errorDescription = data?.error_description || data?.message || undefined;

  switch (status) {
    case 400:
      return new ValidationError(error, errorDescription);
    case 401:
      return new AuthenticationError(error, errorDescription);
    case 403:
      return new AuthorizationError(error, errorDescription);
    case 404:
      return new NotFoundError(error, errorDescription);
    case 409:
      return new ConflictError(error, errorDescription);
    default:
      return new IdentitySDKError(status, error, errorDescription);
  }
}

