/**
 * Puerto Secundario (SPI): Cifrado simétrico autenticado de secretos en reposo (US-33)
 */
export interface SecretCipherPort {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}
