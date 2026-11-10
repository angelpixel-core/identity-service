import { FederatedProviderId } from '../../../domain/ports/external_identity_provider_port';

export interface GenerateFederatedLoginUrlQuery {
  provider: FederatedProviderId;
  tenantId: string;
  clientId?: string;
  redirectUri: string;
  prompt?: string;
  loginHint?: string;
}
