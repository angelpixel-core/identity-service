export interface RotateRefreshTokenResultDto {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly id_token?: string;
  readonly new_refresh_token: string;
  readonly family_id: string;
  readonly user_id: string;
  readonly tenant_id: string;
}

