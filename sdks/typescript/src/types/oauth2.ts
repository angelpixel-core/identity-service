export interface RequestTokenParams {
  grantType?: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export type OAuth2TokenRequestParams = RequestTokenParams;

export interface OAuth2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface OAuth2ErrorResponse {
  error: string;
  error_description?: string;
}

export interface OAuth2ClientError {
  status: number;
  error: string;
  error_description?: string;
}

export interface ValidateClientOriginParams {
  clientId: string;
  origin?: string;
}

export interface ValidateClientOriginResponse {
  authorized: boolean;
  clientId: string;
  clientName: string;
  clientType: 'confidential' | 'public';
  allowedOrigins: string[];
  scopes: string[];
}

