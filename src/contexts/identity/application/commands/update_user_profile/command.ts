export interface UpdateUserProfileCommand {
  readonly userId: string;
  readonly tenantId: string;
  readonly email?: string;
}
