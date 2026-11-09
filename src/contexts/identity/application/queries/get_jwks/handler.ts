import { AsymmetricKeyProviderPort, JwksResponseDto } from '../../../domain/ports/crypto/asymmetric_key_provider_port';
import { GetJwksQuery } from './query';

/**
 * Caso de Uso (Read Slice): Obtención del conjunto de claves públicas en formato JWKS (RFC 7517).
 */
export class GetJwksQueryHandler {
  constructor(private readonly asymmetricKeyProvider: AsymmetricKeyProviderPort) {
    if (!asymmetricKeyProvider) {
      throw new Error('AsymmetricKeyProviderPort must be provided to GetJwksQueryHandler');
    }
  }

  public execute(_query?: GetJwksQuery): JwksResponseDto {
    const jwks = this.asymmetricKeyProvider.getPublicKeyJwks();
    if (!jwks || !Array.isArray(jwks.keys)) {
      return Object.freeze({ keys: Object.freeze([]) });
    }
    return jwks;
  }
}
