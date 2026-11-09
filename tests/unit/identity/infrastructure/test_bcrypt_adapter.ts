import { HashProviderPort } from '../../../../src/contexts/identity/application/ports/security/hash_provider';
import { BcryptAdapter } from '../../../../src/contexts/identity/infrastructure/security/bcrypt_adapter';

describe('Infrastructure Adapter: BcryptAdapter', () => {
  let adapter: HashProviderPort;

  beforeEach(() => {
    adapter = new BcryptAdapter(6);
  });

  describe('Password Hashing', () => {
    it('should generate a valid bcrypt hash starting with $2b$ or $2a$', async () => {
      const plainPassword = 'SecurePass123!';
      const hash = await adapter.hash(plainPassword);

      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);
    }, 15000);

    it('should produce different hashes for the same password due to dynamic salting', async () => {
      const plainPassword = 'SamePassword456!';
      const hash1 = await adapter.hash(plainPassword);
      const hash2 = await adapter.hash(plainPassword);

      expect(hash1).not.toBe(hash2);
    }, 15000);

    it('should throw an error when attempting to hash an empty string or whitespace', async () => {
      await expect(adapter.hash('')).rejects.toThrow();
      await expect(adapter.hash('   ')).rejects.toThrow();
    }, 15000);
  });

  describe('Password Verification (compare)', () => {
    it('should return true when plain password matches the bcrypt hash', async () => {
      const plainPassword = 'CorrectPassword789!';
      const hash = await adapter.hash(plainPassword);

      const isValid = await adapter.compare(plainPassword, hash);
      expect(isValid).toBe(true);
    }, 15000);

    it('should return false when plain password does not match the bcrypt hash', async () => {
      const plainPassword = 'OriginalPassword!';
      const hash = await adapter.hash(plainPassword);

      const isValid = await adapter.compare('WrongPassword!', hash);
      expect(isValid).toBe(false);
    }, 15000);

    it('should return false when comparing against empty or invalid hash format', async () => {
      const isValid = await adapter.compare('AnyPassword', '');
      expect(isValid).toBe(false);
    });
  });
});

