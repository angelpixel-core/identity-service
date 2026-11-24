import { ClientProfile, ClientType } from '../../../domain/entities/client_application/aggregate';

export interface RegisterClientCommand {
  readonly tenantId: string;
  readonly clientId?: string;
  readonly clientName: string;
  readonly clientType?: ClientType | ClientProfile;
  readonly clientProfile?: ClientProfile;
  readonly allowedOrigins: string[];
  readonly redirectUris?: string[];
  readonly allowedGrantTypes?: string[];
  readonly scopes?: string[];
  readonly actorUserId?: string;
}
