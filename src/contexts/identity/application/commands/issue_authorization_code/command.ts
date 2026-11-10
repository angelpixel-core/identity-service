/**
 * Command DTO: IssueAuthorizationCodeCommand
 * Parámetros para la emisión de un código de autorización OAuth2 (RFC 6749 Sección 4.1.1 & RFC 7636).
 */
export interface IssueAuthorizationCodeCommand {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly responseType: string;
  readonly scope?: string;
  readonly state?: string;
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly nonce?: string;
}
