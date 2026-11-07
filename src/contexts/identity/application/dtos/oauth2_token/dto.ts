/**
 * DTO que representa la respuesta exitosa de emisión de token según RFC 6749 Sección 5.1.
 */
export interface OAuth2TokenResponseDTO {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly scope?: string;
}

