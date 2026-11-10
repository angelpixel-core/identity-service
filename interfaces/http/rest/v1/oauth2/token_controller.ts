import { Request, Response, NextFunction } from 'express';
import { AuthenticateClientM2MCommandHandler } from '../../../../../src/contexts/identity/application/commands/authenticate_client_m2m/handler';
import { ExchangeAuthorizationCodeCommandHandler } from '../../../../../src/contexts/identity/application/commands/exchange_authorization_code/handler';
import { RotateRefreshTokenCommandHandler } from '../../../../../src/contexts/identity/application/commands/rotate_refresh_token/handler';
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
  code?: string;
  redirectUri?: string;
  codeVerifier?: string;
  refreshToken?: string;
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
      'Multiple client authentication methods detected: cannot mix HTTP Basic Authentication and request body credentials',
      400
    );
  }

  const clientId = hasBasicAuth ? basicClientId : bodyClientId;
  const clientSecret = hasBasicAuth ? basicClientSecret : bodyClientSecret;
  const grantType = (req.body && req.body.grant_type) || (req.query && (req.query.grant_type as string)) || '';
  const scope = (req.body && req.body.scope) || (req.query && (req.query.scope as string));
  const code = (req.body && req.body.code) || (req.query && (req.query.code as string)) || undefined;
  const redirectUri =
    (req.body && (req.body.redirect_uri || req.body.redirectUri)) ||
    (req.query && (req.query.redirect_uri as string)) ||
    undefined;
  const codeVerifier =
    (req.body && (req.body.code_verifier || req.body.codeVerifier)) ||
    (req.query && (req.query.code_verifier as string)) ||
    undefined;
  const refreshToken =
    (req.body && (req.body.refresh_token || req.body.refreshToken)) ||
    (req.cookies && req.cookies.refresh_token) ||
    (req.query && (req.query.refresh_token as string)) ||
    undefined;

  return {
    grantType,
    clientId,
    clientSecret,
    scope,
    code,
    redirectUri,
    codeVerifier,
    refreshToken,
    ip: req.ip || (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress,
  };
}

/**
 * REST Driver Controller: OAuth2TokenController
 * Implementa el endpoint de emisión de tokens OAuth2 / OIDC conforme a RFC 6749 y RFC 7636.
 */
export class OAuth2TokenController {
  constructor(
    private readonly authenticateM2MHandler: AuthenticateClientM2MCommandHandler,
    private readonly exchangeAuthCodeHandler?: ExchangeAuthorizationCodeCommandHandler,
    private readonly rotateRefreshTokenHandler?: RotateRefreshTokenCommandHandler
  ) {}

  public issueToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawParams = extractOAuth2TokenParams(req);
      const validatedParams = validateOAuth2TokenRequest(rawParams);

      let tokenResponse: any;

      if (validatedParams.grantType === 'client_credentials') {
        tokenResponse = await this.authenticateM2MHandler.execute({
          grantType: validatedParams.grantType,
          clientId: validatedParams.clientId,
          clientSecret: validatedParams.clientSecret,
          scope: validatedParams.scope,
          ip: validatedParams.ip,
        });
      } else if (validatedParams.grantType === 'authorization_code') {
        if (!this.exchangeAuthCodeHandler) {
          throw new OAuth2AuthenticationError(
            'unsupported_grant_type',
            'authorization_code grant handler is not configured on this server instance',
            500
          );
        }

        tokenResponse = await this.exchangeAuthCodeHandler.execute({
          grantType: validatedParams.grantType,
          clientId: validatedParams.clientId,
          clientSecret: validatedParams.clientSecret || undefined,
          code: validatedParams.code || '',
          redirectUri: validatedParams.redirectUri || '',
          codeVerifier: validatedParams.codeVerifier,
          ip: validatedParams.ip,
        });
      } else if (validatedParams.grantType === 'refresh_token') {
        if (!this.rotateRefreshTokenHandler) {
          throw new OAuth2AuthenticationError(
            'unsupported_grant_type',
            'refresh_token grant handler is not configured on this server instance',
            500
          );
        }

        const refreshToken = validatedParams.refreshToken;
        if (!refreshToken) {
          throw new OAuth2AuthenticationError(
            'invalid_request',
            'Missing refresh_token parameter',
            400
          );
        }

        const rotateResult = await this.rotateRefreshTokenHandler.execute({
          refreshToken,
          clientId: validatedParams.clientId || undefined,
          ip: validatedParams.ip,
        });

        const isProduction = process.env.NODE_ENV === 'production';
        const isV1 = req.originalUrl?.includes('/api/v1') || req.baseUrl?.includes('/api/v1');
        const cookiePath = isV1 ? '/api/v1/oauth2' : '/oauth2';

        res.cookie('refresh_token', rotateResult.new_refresh_token, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict',
          path: cookiePath,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        tokenResponse = {
          access_token: rotateResult.access_token,
          token_type: rotateResult.token_type,
          expires_in: rotateResult.expires_in,
          refresh_token: rotateResult.new_refresh_token,
          ...(rotateResult.id_token ? { id_token: rotateResult.id_token } : {}),
        };
      }

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
