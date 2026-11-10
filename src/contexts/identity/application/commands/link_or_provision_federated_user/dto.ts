import { FederatedProviderId } from '../../../domain/ports/external_identity_provider_port';

export interface FederatedUserSessionResultDTO {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
  idToken?: string;
  user: {
    id: string;
    email: string;
    tenantId: string;
  };
  isNewUser: boolean;
  linked: boolean;
  provider: FederatedProviderId;
}
