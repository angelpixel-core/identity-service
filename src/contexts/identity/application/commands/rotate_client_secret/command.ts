export interface RotateClientSecretCommand {
  readonly tenantId: string;
  readonly clientId: string;
  readonly gracePeriodSeconds?: number;
  readonly isRootOperator?: boolean;
  readonly actorUserId?: string;
}
