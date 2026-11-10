import { HttpTransport, RequestOptions } from '../types/common';

export interface FederatedLoginParams {
  tenantId: string;
  redirectUri: string;
  clientId?: string;
  prompt?: string;
  loginHint?: string;
}

export interface FederatedLoginResponse {
  url: string;
  state: string;
  nonce: string;
}

export interface FederatedCallbackParams {
  code: string;
  state: string;
}

export interface FederatedCallbackResponse {
  status: string;
  userProfile: {
    provider: 'google' | 'microsoft';
    externalSubjectId: string;
    email: string;
    emailVerified: boolean;
    name?: string;
    picture?: string;
    rawClaims?: Record<string, unknown>;
  };
  statePayload: {
    tenantId: string;
    clientId?: string;
    redirectUri: string;
    provider: string;
  };
}

export class FederationResource {
  constructor(private readonly transport: HttpTransport) { }

  /**
   * Retrieves authorization URL and cryptographic state/nonce for external provider login
   */
  public async getLoginUrl(
    provider: 'google' | 'microsoft',
    params: FederatedLoginParams,
    options?: RequestOptions
  ): Promise<FederatedLoginResponse> {
    if (!this.transport.get) {
      throw new Error('Current HTTP transport does not implement GET method');
    }

    const query = new URLSearchParams({
      tenant_id: params.tenantId,
      redirect_uri: params.redirectUri,
      format: 'json',
    });

    if (params.clientId) {
      query.set('client_id', params.clientId);
    }
    if (params.prompt) {
      query.set('prompt', params.prompt);
    }
    if (params.loginHint) {
      query.set('login_hint', params.loginHint);
    }

    const response = await this.transport.get<FederatedLoginResponse>(
      `/api/v1/auth/federation/${provider}/login?${query.toString()}`,
      options
    );
    return response.data;
  }

  /**
   * Processes the external IdP callback authorization code
   */
  public async processCallback(
    provider: 'google' | 'microsoft',
    params: FederatedCallbackParams,
    options?: RequestOptions
  ): Promise<FederatedCallbackResponse> {
    if (!this.transport.get) {
      throw new Error('Current HTTP transport does not implement GET method');
    }

    const query = new URLSearchParams({
      code: params.code,
      state: params.state,
    });

    const response = await this.transport.get<FederatedCallbackResponse>(
      `/api/v1/auth/federation/${provider}/callback?${query.toString()}`,
      options
    );
    return response.data;
  }
}
