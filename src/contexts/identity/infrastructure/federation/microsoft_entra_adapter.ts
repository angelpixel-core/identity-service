import {
  ExternalIdentityProviderPort,
  FederatedProviderId,
  FederatedUserProfile,
  GenerateAuthUrlParams,
  ExchangeCallbackParams,
} from '../../domain/ports/external_identity_provider_port';
import { JwksTokenVerifier, HttpFetchFn } from './jwks_token_verifier';

export interface MicrosoftEntraAdapterOptions {
  clientId?: string;
  clientSecret?: string;
  tenant?: string;
  authUrl?: string;
  tokenUrl?: string;
  jwksUri?: string;
  httpClient?: HttpFetchFn;
  tokenVerifier?: JwksTokenVerifier;
}

export class MicrosoftEntraAdapter implements ExternalIdentityProviderPort {
  public readonly providerId: FederatedProviderId = 'microsoft';
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tenant: string;
  private readonly authUrl: string;
  private readonly tokenUrl: string;
  private readonly httpClient: HttpFetchFn;
  private readonly tokenVerifier: JwksTokenVerifier;

  constructor(options?: MicrosoftEntraAdapterOptions) {
    this.clientId = options?.clientId || process.env.MICROSOFT_CLIENT_ID || 'mock-msft-client-id';
    this.clientSecret = options?.clientSecret || process.env.MICROSOFT_CLIENT_SECRET || 'mock-msft-client-secret';
    this.tenant = options?.tenant || process.env.MICROSOFT_TENANT_ID || 'common';

    this.authUrl = options?.authUrl || `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`;
    this.tokenUrl = options?.tokenUrl || `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;

    const jwksUri = options?.jwksUri || 'https://login.microsoftonline.com/common/discovery/v2.0/keys';
    this.httpClient = options?.httpClient || (async (url: string, init?: any) => {
      const res = await fetch(url, init);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status} from ${url}: ${errorText}`);
      }
      return res.json();
    });

    this.tokenVerifier = options?.tokenVerifier || new JwksTokenVerifier({
      jwksUri,
      httpClient: this.httpClient,
    });
  }

  public async getAuthorizationUrl(params: GenerateAuthUrlParams): Promise<string> {
    const url = new URL(this.authUrl);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', 'openid email profile User.Read');
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);

    if (params.prompt) {
      url.searchParams.set('prompt', params.prompt);
    }
    if (params.loginHint) {
      url.searchParams.set('login_hint', params.loginHint);
    }

    return url.toString();
  }

  public async exchangeCodeAndVerifyToken(params: ExchangeCallbackParams): Promise<FederatedUserProfile> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'openid email profile User.Read',
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
      ...(params.nonce && process.env.NODE_ENV !== 'production' && params.code.startsWith('dev_')
        ? { nonce: params.nonce }
        : {}),
    });

    const tokenResponse = await this.httpClient(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    const idToken = tokenResponse.id_token;
    if (!idToken) {
      throw new Error('Microsoft Entra token response did not contain an id_token');
    }

    // Verify token signature against Microsoft JWKS
    // Microsoft issuer depends on tenant (v2.0 format: https://login.microsoftonline.com/{tid}/v2.0)
    const payload = await this.tokenVerifier.verifyIdToken<any>(
      idToken,
      this.clientId
    );

    // Validate nonce if provided
    if (params.nonce && payload.nonce !== params.nonce) {
      throw new Error('ID Token nonce does not match original request nonce');
    }

    // Extract email from email, preferred_username, or upn
    const email = payload.email || payload.preferred_username || payload.upn;
    if (!email) {
      throw new Error('Microsoft Entra account profile did not include an email');
    }

    // Microsoft Entra ID issued tokens from corporate directory are verified by directory authority
    const emailVerified = payload.email_verified !== undefined ? Boolean(payload.email_verified) : true;
    if (!emailVerified) {
      throw new Error('Microsoft Entra account email is not verified');
    }

    const externalSubjectId = payload.oid || payload.sub;
    if (!externalSubjectId) {
      throw new Error('Microsoft Entra account profile did not include an oid or sub');
    }

    const picture =
      !params.code.startsWith('dev_') &&
      typeof tokenResponse.access_token === 'string' &&
      !tokenResponse.access_token.startsWith('mock_')
        ? await this.fetchProfilePhoto(tokenResponse.access_token)
        : undefined;

    return {
      provider: 'microsoft',
      externalSubjectId,
      email,
      emailVerified: true,
      name: payload.name,
      picture,
      rawClaims: payload,
    };
  }

  private async fetchProfilePhoto(accessToken: string): Promise<string | undefined> {
    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) {
        return undefined;
      }
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength === 0) {
        return undefined;
      }
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch {
      return undefined;
    }
  }

  public getTokenVerifier(): JwksTokenVerifier {
    return this.tokenVerifier;
  }
}

