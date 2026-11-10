import {
  FederatedUserProfile,
  FederationStatePayload,
} from '../../../domain/ports/external_identity_provider_port';

export interface ProcessFederatedCallbackResult {
  userProfile: FederatedUserProfile;
  statePayload: FederationStatePayload;
}
