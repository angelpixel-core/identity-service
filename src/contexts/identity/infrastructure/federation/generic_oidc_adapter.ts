import {
  ExchangeCallbackParams,
  ExternalIdentityProviderPort,
  FederatedProviderId,
  FederatedUserProfile,
  GenerateAuthUrlParams,
} from '../../domain/ports/external_identity_provider_port';
import { HttpFetchFn, JwksTokenVerifier } from './jwks_token_verifier';

export interface OidcDiscoveryMetadata {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly issuer?: string;
}

export interface GenericOidcAdapterOptions {
  readonly providerId: FederatedProviderId;
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes?: readonly string[];
  readonly authorizationEndpoint?: string | null;
  readonly tokenEndpoint?: string | null;
  readonly jwksUri?: string | null;
  readonly discoveryTtlMs?: number;
  readonly httpClient?: HttpFetchFn;
  readonly tokenVerifierFactory?: (jwksUri: string, httpClient: HttpFetchFn) => JwksTokenVerifier;
}

interface CachedDiscovery {
  readonly expiresAt: number;
  readonly metadata: OidcDiscoveryMetadata;
}

/**
 * Secondary Adapter: GenericOidcAdapter (US-34)
 * Implementa ExternalIdentityProviderPort para cualquier proveedor OIDC/OAuth2 por tenant
 * con descubrimiento .well-known/openid-configuration, caché corta y verificación JWKS.
 */
export class GenericOidcAdapter implements ExternalIdentityProviderPort {
  public readonly providerId: FederatedProviderId;
  private readonly issuerUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scopes: readonly string[];
  private readonly explicitAuthEndpoint?: string | null;
  private readonly explicitTokenEndpoint?: string | null;
  private readonly explicitJwksUri?: string | null;
  private readonly discoveryTtlMs: number;
  private readonly httpClient: HttpFetchFn;
  private readonly tokenVerifierFactory: (
    jwksUri: string,
    httpClient: HttpFetchFn
  ) => JwksTokenVerifier;

  private cachedDiscovery: CachedDiscovery | null = null;

  constructor(options: GenericOidcAdapterOptions) {
    this.providerId = options.providerId;
    this.issuerUrl = options.issuerUrl.replace(/\/+$/, '');
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.scopes =
      options.scopes && options.scopes.length > 0
        ? options.scopes
        : ['openid', 'email', 'profile'];
    this.explicitAuthEndpoint = options.authorizationEndpoint;
    this.explicitTokenEndpoint = options.tokenEndpoint;
    this.explicitJwksUri = options.jwksUri;
    this.discoveryTtlMs = options.discoveryTtlMs ?? 300_000;
    this.httpClient =
      options.httpClient ??
      (async (url: string, init?: RequestInit) => {
        const res = await fetch(url, init);
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status} from ${url}: ${errorText}`);
        }
        return res.json();
      });
    this.tokenVerifierFactory =
      options.tokenVerifierFactory ??
      ((jwksUri, httpClient) => new JwksTokenVerifier({ jwksUri, httpClient }));
  }

  public async discoverMetadata(): Promise<OidcDiscoveryMetadata> {
    if (this.explicitAuthEndpoint && this.explicitTokenEndpoint && this.explicitJwksUri) {
      return {
        authorization_endpoint: this.explicitAuthEndpoint,
        token_endpoint: this.explicitTokenEndpoint,
        jwks_uri: this.explicitJwksUri,
        issuer: this.issuerUrl,
      };
    }

    const now = Date.now();
    if (this.cachedDiscovery && now < this.cachedDiscovery.expiresAt) {
      return this.cachedDiscovery.metadata;
    }

    const discoveryUrl = `${this.issuerUrl}/.well-known/openid-configuration`;
    const doc = (await this.httpClient(discoveryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })) as Partial<OidcDiscoveryMetadata>;

    const authorization_endpoint = this.explicitAuthEndpoint || doc.authorization_endpoint;
    const token_endpoint = this.explicitTokenEndpoint || doc.token_endpoint;
    const jwks_uri = this.explicitJwksUri || doc.jwks_uri;

    if (!authorization_endpoint || !token_endpoint || !jwks_uri) {
      throw new Error(
        `OIDC discovery at ${discoveryUrl} is missing authorization_endpoint, token_endpoint, or jwks_uri`
      );
    }

    const metadata: OidcDiscoveryMetadata = {
      authorization_endpoint,
      token_endpoint,
      jwks_uri,
      issuer: doc.issuer || this.issuerUrl,
    };

    this.cachedDiscovery = {
      expiresAt: now + this.discoveryTtlMs,
      metadata,
    };
    return metadata;
  }

  public async getAuthorizationUrl(params: GenerateAuthUrlParams): Promise<string> {
    const metadata = await this.discoverMetadata();
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', this.scopes.join(' '));
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

  public async exchangeCodeAndVerifyToken(
    params: ExchangeCallbackParams
  ): Promise<FederatedUserProfile> {
    const metadata = await this.discoverMetadata();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const tokenResponse = (await this.httpClient(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })) as { id_token?: string };

    const idToken = tokenResponse.id_token;
    if (!idToken) {
      throw new Error(`Provider "${this.providerId}" token response did not contain an id_token`);
    }

    const verifier = this.tokenVerifierFactory(metadata.jwks_uri, this.httpClient);
    const claims = await verifier.verifyIdToken<Record<string, unknown>>(
      idToken,
      this.clientId,
      [metadata.issuer || this.issuerUrl]
    );

    if (params.nonce && claims.nonce !== params.nonce) {
      throw new Error('ID Token nonce does not match original request nonce');
    }

    return {
      provider: this.providerId,
      externalSubjectId: String(claims.sub),
      email: String(claims.email ?? ''),
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: typeof claims.name === 'string' ? claims.name : undefined,
      picture: typeof claims.picture === 'string' ? claims.picture : undefined,
      rawClaims: claims,
    };
  }
}
