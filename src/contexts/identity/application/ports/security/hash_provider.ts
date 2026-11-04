/**
 * Secondary Port (SPI): HashProviderPort
 * Contrato abstracto de seguridad para el hashing y verificación criptográfica de contraseñas.
 */
export interface HashProviderPort {
  hash(plainText: string): Promise<string>;
  compare(plainText: string, hashedText: string): Promise<boolean>;
}
