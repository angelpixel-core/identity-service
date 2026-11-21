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

  public status = (_req: Request, res: Response): void => {
    const googleConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    );
    const microsoftConfigured = Boolean(
      process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
    );

    res.status(200).json({
      environment: process.env.NODE_ENV || 'development',
      providers: {
        google: {
          configured: googleConfigured,
          mode: googleConfigured ? 'live' : 'dev_emulator',
          envVar: 'GOOGLE_CLIENT_ID',
        },
        microsoft: {
          configured: microsoftConfigured,
          mode: microsoftConfigured ? 'live' : 'dev_emulator',
          envVar: 'MICROSOFT_CLIENT_ID',
        },
      },
    });
  };

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

      const responsePayload = {
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
      };

      const acceptsHtml =
        req.method === 'GET' &&
        req.query.format !== 'json' &&
        Boolean(req.headers.accept?.includes('text/html'));

      if (acceptsHtml) {
        const serializedPayload = JSON.stringify(responsePayload).replace(/</g, '\\u003c');
        res.status(200).type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Autenticación Federada Completada</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f4f7fb; color: #1a1c1e; }
    .card { background: #fff; border-radius: 16px; padding: 24px 28px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 420px; text-align: center; }
    .btn { display: inline-block; margin-top: 16px; padding: 10px 20px; border-radius: 999px; background: #0b57d0; color: #fff; text-decoration: none; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Autenticación completada</h2>
    <p>Identidad verificada correctamente. Redirigiendo al portal...</p>
    <a class="btn" href="/auth">Volver al Portal</a>
  </div>
  <script>
    (function () {
      var payload = ${serializedPayload};
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage({ type: 'identity-service:federation-callback', payload: payload }, window.location.origin);
          window.close();
          return;
        } catch (e) {}
      }
      try {
        sessionStorage.setItem('identity_federation_last_result', JSON.stringify(payload));
        if (payload.tokens && payload.tokens.access_token && payload.user) {
          localStorage.setItem('identity_session', JSON.stringify({
            token: payload.tokens.access_token,
            userId: payload.user.id,
            email: payload.user.email,
            tenantId: payload.user.tenantId,
            roles: payload.user.roles,
            name: payload.userProfile && payload.userProfile.name,
            picture: payload.userProfile && payload.userProfile.picture,
            provider: (payload.userProfile && payload.userProfile.provider) || (payload.statePayload && payload.statePayload.provider)
          }));
        }
      } catch (e) {}
      window.location.replace('/auth');
    })();
  </script>
</body>
</html>`);
        return;
      }

      res.status(200).json(responsePayload);
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
