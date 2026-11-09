import { AsymmetricKeyProviderPort, JwksResponseDto } from '../../../domain/ports/crypto/asymmetric_key_provider_port';
import { GetJwksQuery } from './query';

/**
 * Caso de Uso (Read Slice): Obtención del conjunto de claves públicas en formato JWKS (RFC 7517).
 */
export class GetJwksQueryHandler {
  constructor(private readonly asymmetricKeyProvider: AsymmetricKeyProviderPort) {}

  public execute(_query?: GetJwksQuery): JwksResponseDto {
    return this.asymmetricKeyProvider.getPublicKeyJwks();
  }
}
