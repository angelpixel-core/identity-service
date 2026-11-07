import { DomainError } from '../user/error';

export type OAuth2ErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope';

/**
 * Excepción de dominio y aplicación para errores en flujos OAuth2 (RFC 6749 Sección 5.2).
 */
export class OAuth2AuthenticationError extends DomainError {
  constructor(
    public readonly errorCode: OAuth2ErrorCode,
    public readonly errorDescription: string,
    public readonly statusCode: number = 400
  ) {
    super(errorDescription);
  }
}

