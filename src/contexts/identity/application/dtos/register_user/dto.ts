/**
 * Response DTO: RegisterUserResponseDTO
 * Contrato limpio de salida desacoplado de HTTP y de esquemas de persistencia.
 */
export interface RegisterUserResponseDTO {
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
  readonly roles?: string[];
  readonly accessToken: string;
}

