import { FederatedProviderId } from '../../../domain/ports/external_identity_provider_port';

export interface ProcessFederatedCallbackCommand {
  code: string;
  state: string;
  provider?: FederatedProviderId;
}
