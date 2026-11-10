import {
  ExternalIdentityProviderPort,
  FederatedProviderId,
  FederatedUserProfile,
  GenerateAuthUrlParams,
  ExchangeCallbackParams,
} from '../../domain/ports/external_identity_provider_port';
import { JwksTokenVerifier, HttpFetchFn } from './jwks_token_verifier';

export interface GoogleOidcAdapterOptions {
  clientId?: string;
  clientSecret?: string;
  authUrl?: string;
  tokenUrl?: string;
  jwksUri?: string;
  httpClient?: HttpFetchFn;
  tokenVerifier?: JwksTokenVerifier;
}

export class GoogleOidcAdapter implements ExternalIdentityProviderPort {
  public readonly providerId: FederatedProviderId = 'google';
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly authUrl: string;
  private readonly tokenUrl: string;
  private readonly httpClient: HttpFetchFn;
  private readonly tokenVerifier: JwksTokenVerifier;

  constructor(options?: GoogleOidcAdapterOptions) {
    this.clientId = options?.clientId || process.env.GOOGLE_CLIENT_ID || 'mock-google-client-id';
    this.clientSecret = options?.clientSecret || process.env.GOOGLE_CLIENT_SECRET || 'mock-google-client-secret';
    this.authUrl = options?.authUrl || 'https://accounts.google.com/o/oauth2/v2/auth';
    this.tokenUrl = options?.tokenUrl || 'https://oauth2.googleapis.com/token';

    const jwksUri = options?.jwksUri || 'https://www.googleapis.com/oauth2/v3/certs';
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
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', params.prompt || 'consent');

    if (params.loginHint) {
      url.searchParams.set('login_hint', params.loginHint);
    }

    return url.toString();
  }

  public async exchangeCodeAndVerifyToken(params: ExchangeCallbackParams): Promise<FederatedUserProfile> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
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
      throw new Error('Google token response did not contain an id_token');
    }

    // Verify token using Google's JWKS
    const payload = await this.tokenVerifier.verifyIdToken<any>(
      idToken,
      this.clientId,
      ['https://accounts.google.com', 'accounts.google.com']
    );

    // Validate nonce if provided
    if (params.nonce && payload.nonce !== params.nonce) {
      throw new Error('ID Token nonce does not match original request nonce');
    }

    // Business rule: Mandatory email verification
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (!emailVerified) {
      throw new Error('Google account email is not verified');
    }

    if (!payload.email) {
      throw new Error('Google account profile did not include an email');
    }

    return {
      provider: 'google',
      externalSubjectId: payload.sub,
      email: payload.email,
      emailVerified: true,
      name: payload.name,
      picture: payload.picture,
      rawClaims: payload,
    };
  }

  public getTokenVerifier(): JwksTokenVerifier {
    return this.tokenVerifier;
  }
}

