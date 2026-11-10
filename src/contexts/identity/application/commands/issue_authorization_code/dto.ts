export interface IssueAuthorizationCodeResultDto {
  readonly code: string;
  readonly redirectUri: string;
  readonly state?: string;
  readonly callbackUrl: string;
}

