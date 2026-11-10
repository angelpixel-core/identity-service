export type FederatedProviderId = 'google' | 'microsoft';

export interface FederatedUserProfile {
  provider: FederatedProviderId;
  externalSubjectId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  rawClaims?: Record<string, unknown>;
}

export interface FederationStatePayload {
  tenantId: string;
  clientId?: string;
  redirectUri: string;
  provider: FederatedProviderId;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}

export interface GenerateAuthUrlParams {
  tenantId: string;
  clientId?: string;
  redirectUri: string;
  state: string;
  nonce: string;
  prompt?: string;
  loginHint?: string;
}

export interface ExchangeCallbackParams {
  code: string;
  redirectUri: string;
  nonce?: string;
}

export interface ExternalIdentityProviderPort {
  readonly providerId: FederatedProviderId;
  getAuthorizationUrl(params: GenerateAuthUrlParams): Promise<string>;
  exchangeCodeAndVerifyToken(params: ExchangeCallbackParams): Promise<FederatedUserProfile>;
}
