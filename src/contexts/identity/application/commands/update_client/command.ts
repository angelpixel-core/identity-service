import { ClientStatus } from '../../../domain/entities/client_application/aggregate';

export interface UpdateClientCommand {
  readonly tenantId: string;
  readonly clientId: string;
  readonly isRootOperator?: boolean;
  readonly clientName?: string;
  readonly allowedOrigins?: string[];
  readonly redirectUris?: string[];
  readonly allowedGrantTypes?: string[];
  readonly scopes?: string[];
  readonly status?: ClientStatus;
  readonly actorUserId?: string;
}
