import { Request, Response, NextFunction } from 'express';
import { IssueAuthorizationCodeCommandHandler } from '../../../../../src/contexts/identity/application/commands/issue_authorization_code/handler';
import { ResolveClientTenantContextQueryHandler } from '../../../../../src/contexts/identity/application/queries/resolve_client_tenant_context/handler';
import { ClientTenantBindingRepositoryPort } from '../../../../../src/contexts/identity/domain/ports/client_tenant_binding_repository_port';
import { ClientId } from '../../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OAuth2AuthenticationError } from '../../../../../src/contexts/identity/domain/exceptions/oauth2/error';

/**
 * Driver Controller: OAuth2AuthorizeController
 * Maneja solicitudes interactivas de autorización (GET y POST /oauth2/authorize).
 */
export class OAuth2AuthorizeController {
  constructor(
    private readonly issueAuthCodeHandler: IssueAuthorizationCodeCommandHandler,
    private readonly resolveContextHandler?: ResolveClientTenantContextQueryHandler,
    private readonly bindingRepository?: ClientTenantBindingRepositoryPort
  ) {}

  public authorize = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clientId =
        (req.query.client_id as string) || (req.body && req.body.client_id) || '';
      const redirectUri =
        (req.query.redirect_uri as string) || (req.body && req.body.redirect_uri) || '';
      const responseType =
        (req.query.response_type as string) || (req.body && req.body.response_type) || '';
      const scope =
        (req.query.scope as string) || (req.body && req.body.scope) || undefined;
      const state =
        (req.query.state as string) || (req.body && req.body.state) || undefined;
      const codeChallenge =
        (req.query.code_challenge as string) || (req.body && req.body.code_challenge) || undefined;
      const codeChallengeMethod =
        (req.query.code_challenge_method as string) ||
        (req.body && req.body.code_challenge_method) ||
        undefined;
      const nonce =
        (req.query.nonce as string) || (req.body && req.body.nonce) || undefined;

      // Extracción del contexto de usuario (sesión activa o parámetros de contexto)
      const user = (req as any).user;
      const userId =
        user?.id ||
        user?.userId ||
        (req.body && req.body.user_id) ||
        (req.query.user_id as string) ||
        'user-session-default';

      const tenantId =
        user?.tenantId ||
        (req as any).tenantId ||
        (req.body && req.body.tenant_id) ||
        (req.query.tenant_id as string) ||
        'tenant-session-default';

      if (!clientId) {
        throw new OAuth2AuthenticationError('invalid_request', 'Missing client_id parameter', 400);
      }

      if (!redirectUri) {
        throw new OAuth2AuthenticationError('invalid_request', 'Missing redirect_uri parameter', 400);
      }

      const explicitTenantParam =
        (req.query.tenant_id as string) || (req.body && req.body.tenant_id) || undefined;
      const explicitDomainParam =
        (req.query.domain as string) || (req.body && req.body.domain) || undefined;

      let resolvedTenantId = tenantId;
      if (this.resolveContextHandler && this.bindingRepository) {
        const existingBindings = await this.bindingRepository.findByClientId(ClientId.create(clientId));
        if (explicitTenantParam || explicitDomainParam || existingBindings.length > 0) {
          const resolved = await this.resolveContextHandler.execute({
            clientId,
            tenantId: explicitTenantParam,
            domain: explicitDomainParam,
            redirectUri,
            origin: (req.headers.origin as string) || undefined,
            ip: req.ip,
          });
          resolvedTenantId = resolved.tenantId;
        }
      }

      const result = await this.issueAuthCodeHandler.execute({
        clientId,
        redirectUri,
        responseType,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        userId,
        tenantId: resolvedTenantId,
        nonce,
      });

      // Si el cliente solicita explícitamente JSON o para aserciones de integración
      if (req.headers.accept?.includes('application/json')) {
        res.setHeader('Location', result.callbackUrl);
        res.status(200).json({
          code: result.code,
          redirect_uri: result.redirectUri,
          state: result.state,
          callback_url: result.callbackUrl,
        });
        return;
      }

      // Redirección HTTP 302 estándar según RFC 6749
      res.redirect(302, result.callbackUrl);
    } catch (error: any) {
      if (error instanceof OAuth2AuthenticationError || (error && typeof error === 'object' && error.errorCode)) {
        res.status(error.statusCode || 400).json({
          error: error.errorCode,
          error_description: error.errorDescription,
        });
        return;
      }
      next(error);
    }
  };
}