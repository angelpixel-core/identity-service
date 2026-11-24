import { DomainValidationError } from '../../exceptions/user/error';

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Value Object: PhoneNumber (US-32)
 * Valida y normaliza números telefónicos al estándar internacional E.164 (^\+[1-9]\d{6,14}$).
 */
export class PhoneNumber {
  private readonly value: string;

  private constructor(normalized: string) {
    this.value = normalized;
  }

  public static create(raw: string): PhoneNumber {
    if (!raw || typeof raw !== 'string') {
      throw new DomainValidationError('Phone number must be a non-empty string in E.164 format');
    }

    const normalized = raw.trim().replace(/[\s\-().]/g, '');
    if (!E164_REGEX.test(normalized)) {
      throw new DomainValidationError(
        `Invalid phone number "${raw}". Expected international E.164 format (e.g. +5491112345678)`
      );
    }

    return new PhoneNumber(normalized);
  }

  public getValue(): string {
    return this.value;
  }

  public equals(other: PhoneNumber): boolean {
    if (!other) return false;
    return this.value === other.getValue();
  }
}
