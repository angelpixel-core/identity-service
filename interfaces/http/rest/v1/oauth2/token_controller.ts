import { Request, Response, NextFunction } from 'express';
import { AuthenticateClientM2MCommandHandler } from '../../../../../src/contexts/identity/application/commands/authenticate_client_m2m/handler';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { validateOAuth2TokenRequest } from './schemas';

/**
 * Extrae credenciales y parámetros de la solicitud según RFC 6749 (HTTP Basic Auth o Request Body).
 * Aplica las reglas de seguridad de RFC 6749 Sección 2.3.1:
 * 1. Prohibido mezclar múltiples métodos de autenticación (Basic Auth + Body).
 * 2. Validación estricta del formato de la cabecera Basic (no silenciar errores de parsing).
 */
export function extractOAuth2TokenParams(req: Request): {
  grantType: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  ip?: string;
} {
  const bodyClientId = (req.body && req.body.client_id) || (req.query && (req.query.client_id as string)) || '';
  const bodyClientSecret = (req.body && req.body.client_secret) || (req.query && (req.query.client_secret as string)) || '';

  const authHeader = req.headers.authorization;
  let basicClientId = '';
  let basicClientSecret = '';
  let hasBasicAuth = false;

  if (authHeader && authHeader.startsWith('Basic ')) {
    hasBasicAuth = true;
    const rawCredentials = authHeader.slice(6).trim();
    if (!rawCredentials) {
      throw new OAuth2AuthenticationError(
        'invalid_client',
        'Malformed HTTP Basic Authorization header: credentials missing',
        401
      );
    }

    try {
      const decoded = Buffer.from(rawCredentials, 'base64').toString('utf-8');
      const delimiterIndex = decoded.indexOf(':');
      if (delimiterIndex === -1) {
        throw new OAuth2AuthenticationError(
          'invalid_client',
          'Malformed HTTP Basic Authorization header: missing secret delimiter',
          401
        );
      }
      basicClientId = decoded.slice(0, delimiterIndex);
      basicClientSecret = decoded.slice(delimiterIndex + 1);
    } catch (err: unknown) {
      if (err instanceof OAuth2AuthenticationError) {
        throw err;
      }
      throw new OAuth2AuthenticationError(
        'invalid_client',
        'Malformed HTTP Basic Authorization header: invalid base64 encoding',
        401
      );
    }
  }

  // RFC 6749 Sección 2.3.1: "The authorization server MUST NOT accept more than one form of client authentication on a given request."
  const hasBodyAuth = Boolean(bodyClientId || bodyClientSecret);
  if (hasBasicAuth && hasBodyAuth) {
    throw new OAuth2AuthenticationError(
      'invalid_request',
      'Multiple client authentication methods detected. Client credentials must be provided via HTTP Basic OR request body, not both.',
      400
    );
  }

  const clientId = hasBasicAuth ? basicClientId : bodyClientId;
  const clientSecret = hasBasicAuth ? basicClientSecret : bodyClientSecret;
  const grantType = (req.body && req.body.grant_type) || (req.query && (req.query.grant_type as string)) || '';
  const scope = (req.body && req.body.scope) || (req.query && (req.query.scope as string)) || undefined;

  return {
    grantType,
    clientId,
    clientSecret,
    scope,
    ip: req.ip || (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress,
  };
}

/**
 * REST Driver Controller: OAuth2TokenController
 * Implementa el endpoint de emisión de tokens OAuth2 / OIDC conforme a RFC 6749.
 */
export class OAuth2TokenController {
  constructor(private readonly authenticateM2MHandler: AuthenticateClientM2MCommandHandler) { }

  public issueToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawParams = extractOAuth2TokenParams(req);
      const validatedParams = validateOAuth2TokenRequest(rawParams);

      const tokenResponse = await this.authenticateM2MHandler.execute({
        grantType: validatedParams.grantType,
        clientId: validatedParams.clientId,
        clientSecret: validatedParams.clientSecret,
        scope: validatedParams.scope,
        ip: validatedParams.ip,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.status(200).json(tokenResponse);
    } catch (error: unknown) {
      if (error instanceof OAuth2AuthenticationError) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        if (error.statusCode === 401 && req.headers.authorization?.startsWith('Basic ')) {
          res.setHeader('WWW-Authenticate', 'Basic realm="OAuth2"');
        }
        res.status(error.statusCode).json({
          error: error.errorCode,
          error_description: error.errorDescription,
        });
        return;
      }
      next(error);
    }
  };
}

