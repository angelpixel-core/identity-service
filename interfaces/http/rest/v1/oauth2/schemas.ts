import { z } from 'zod';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';

/**
 * Esquema Zod declarativo para validar los parámetros de entrada del endpoint de emisión de tokens (RFC 6749).
 */
export const OAuth2TokenRequestSchema = z.object({
  grantType: z.string().trim().min(1, 'Missing grant_type parameter'),
  clientId: z.string().trim().min(1, 'Missing client_id parameter'),
  clientSecret: z.string().optional().default(''),
  scope: z.string().optional(),
  ip: z.string().optional(),
});

export type OAuth2TokenRequestDTO = z.infer<typeof OAuth2TokenRequestSchema>;

/**
 * Función helper que ejecuta la validación Zod y traduce cualquier violación a una excepción
 * estándar de protocolo OAuth2 (RFC 6749 Sección 5.2):
 * - Falta de parámetros obligatorios o formato inválido -> 400 invalid_request
 * - Tipo de concesión no soportado -> 400 unsupported_grant_type
 */
export function validateOAuth2TokenRequest(rawParams: unknown): OAuth2TokenRequestDTO {
  const result = OAuth2TokenRequestSchema.safeParse(rawParams);

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path[0];

    if (path === 'grantType') {
      throw new OAuth2AuthenticationError(
        'invalid_request',
        firstIssue?.message || 'Missing grant_type parameter',
        400
      );
    }

    if (path === 'clientId') {
      throw new OAuth2AuthenticationError(
        'invalid_request',
        firstIssue?.message || 'Missing client_id parameter',
        400
      );
    }

    throw new OAuth2AuthenticationError(
      'invalid_request',
      firstIssue?.message || 'Invalid OAuth2 token request parameters',
      400
    );
  }

  if (result.data.grantType !== 'client_credentials') {
    throw new OAuth2AuthenticationError(
      'unsupported_grant_type',
      `Unsupported grant_type: "${result.data.grantType}". Only "client_credentials" is supported on this endpoint.`,
      400
    );
  }

  return result.data;
}