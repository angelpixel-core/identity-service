import { Request, Response } from 'express';
import { GenerateFederatedLoginUrlQueryHandler } from '../../../../../src/contexts/identity/application/queries/generate_federated_login_url/handler';
import { ProcessFederatedCallbackCommandHandler } from '../../../../../src/contexts/identity/application/commands/process_federated_callback/handler';
import { LinkOrProvisionFederatedUserCommandHandler } from '../../../../../src/contexts/identity/application/commands/link_or_provision_federated_user/handler';
import {
  FederatedLoginQuerySchema,
  FederatedCallbackQuerySchema,
  ProviderParamSchema,
} from './schemas';
import { FederatedProviderId } from '../../../../../src/contexts/identity/domain/ports/external_identity_provider_port';

export class FederationController {
  constructor(
    private readonly generateLoginUrlHandler: GenerateFederatedLoginUrlQueryHandler,
    private readonly processCallbackHandler: ProcessFederatedCallbackCommandHandler,
    private readonly linkOrProvisionHandler?: LinkOrProvisionFederatedUserCommandHandler
  ) { }

  public login = async (req: Request, res: Response): Promise<void> => {
    try {
      const providerResult = ProviderParamSchema.safeParse(req.params.provider);
      if (!providerResult.success) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: `Unsupported identity provider: "${req.params.provider}". Allowed: google, microsoft`,
        });
        return;
      }

      const queryResult = FederatedLoginQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: queryResult.error.issues.map((e) => e.message).join('; '),
        });
        return;
      }

      const { tenant_id, client_id, redirect_uri, prompt, login_hint, format } = queryResult.data;

      const result = await this.generateLoginUrlHandler.execute({
        provider: providerResult.data as FederatedProviderId,
        tenantId: tenant_id,
        clientId: client_id,
        redirectUri: redirect_uri,
        prompt,
        loginHint: login_hint,
      });

      const wantsJson = format === 'json' || req.headers.accept?.includes('application/json');
      if (wantsJson) {
        res.status(200).json({
          url: result.url,
          state: result.state,
          nonce: result.nonce,
        });
        return;
      }

      res.redirect(302, result.url);
    } catch (err: any) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: err.message,
      });
    }
  };

  public callback = async (req: Request, res: Response): Promise<void> => {
    try {
      let provider: FederatedProviderId | undefined;
      if (req.params.provider) {
        const providerResult = ProviderParamSchema.safeParse(req.params.provider);
        if (!providerResult.success) {
          res.status(400).json({
            error: 'invalid_request',
            error_description: `Unsupported identity provider: "${req.params.provider}"`,
          });
          return;
        }
        provider = providerResult.data as FederatedProviderId;
      }

      const params = {
        ...req.query,
        ...(req.body || {}),
      };

      const queryResult = FederatedCallbackQuerySchema.safeParse(params);
      if (!queryResult.success) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: queryResult.error.issues.map((e) => e.message).join('; '),
        });
        return;
      }

      const { code, state } = queryResult.data;

      const result = await this.processCallbackHandler.execute({
        code,
        state,
        provider,
      });

      let sessionData: any = undefined;
      if (this.linkOrProvisionHandler) {
        const sessionResult = await this.linkOrProvisionHandler.execute({
          userProfile: result.userProfile,
          tenantId: result.statePayload.tenantId,
          clientId: result.statePayload.clientId,
          ip: req.ip || (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress,
        });

        const isProduction = process.env.NODE_ENV === 'production';
        const isV1 = req.originalUrl?.includes('/api/v1') || req.baseUrl?.includes('/api/v1');
        const cookiePath = isV1 ? '/api/v1/oauth2' : '/oauth2';

        res.cookie('refresh_token', sessionResult.refreshToken, {
          httpOnly: true,
          secure: isProduction,
          sameSite: 'strict',
          path: cookiePath,
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });

        sessionData = sessionResult;
      }

      res.status(200).json({
        status: 'success',
        ...(sessionData
          ? {
              tokens: {
                access_token: sessionData.accessToken,
                token_type: sessionData.tokenType,
                expires_in: sessionData.expiresIn,
                refresh_token: sessionData.refreshToken,
              },
              user: sessionData.user,
              isNewUser: sessionData.isNewUser,
              linked: sessionData.linked,
            }
          : {}),
        userProfile: result.userProfile,
        statePayload: {
          tenantId: result.statePayload.tenantId,
          clientId: result.statePayload.clientId,
          redirectUri: result.statePayload.redirectUri,
          provider: result.statePayload.provider,
        },
      });
    } catch (err: any) {
      const message = err.message || 'Federation callback processing failed';
      const status = message.includes('Anti-CSRF') || message.includes('state') || message.includes('required')
        ? 400
        : 401;

      res.status(status).json({
        error: status === 400 ? 'invalid_request' : 'invalid_grant',
        error_description: message,
      });
    }
  };
}
