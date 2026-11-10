import { FederatedUserProfile } from '../../../domain/ports/external_identity_provider_port';

export interface LinkOrProvisionFederatedUserCommand {
  userProfile: FederatedUserProfile;
  tenantId: string;
  clientId?: string;
  ip?: string;
}
