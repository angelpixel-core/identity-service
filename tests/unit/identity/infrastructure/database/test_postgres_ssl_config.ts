import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createSecurePostgresConfig,
  SecurityConfigurationError,
} from '../../../../../src/contexts/identity/infrastructure/persistence/database/postgres_ssl_config';

describe('Unit: PostgresSslConfigFactory (PCI-DSS v4.0 Req 4.1 & SOC 2 CC6.7 Hardening)', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pg-ssl-test-'));
    delete process.env.DATABASE_SSL_CA;
    delete process.env.DATABASE_SSL_CA_PATH;
    delete process.env.DATABASE_SSL_MODE;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  describe('SSL/TLS Enforcement and Defaults', () => {
    it('should configure rejectUnauthorized: true and minVersion: TLSv1.2 by default when SSL is enabled', () => {
      const config = createSecurePostgresConfig(
        { host: 'postgres-flexible.internal', port: 5432, database: 'identity_db' },
        { enabled: true }
      );

      expect(config.ssl).toBeDefined();
      expect(typeof config.ssl).toBe('object');
      const ssl = config.ssl as any;
      expect(ssl.rejectUnauthorized).toBe(true);
      expect(ssl.minVersion).toBe('TLSv1.2');
    });

    it('should support TLSv1.3 when explicitly requested in options', () => {
      const config = createSecurePostgresConfig(
        'postgresql://app:secret@db.internal:5432/identity_db',
        { enabled: true, minVersion: 'TLSv1.3' }
      );

      const ssl = config.ssl as any;
      expect(ssl.rejectUnauthorized).toBe(true);
      expect(ssl.minVersion).toBe('TLSv1.3');
    });

    it('should remove ssl configuration when explicitly disabled for non-SSL environments', () => {
      const config = createSecurePostgresConfig(
        { host: 'localhost', port: 5432, ssl: false },
        { enabled: false }
      );

      expect(config.ssl).toBeUndefined();
    });
  });

  describe('CA Certificate Resolution', () => {
    it('should embed CA certificate string directly into ssl.ca', () => {
      const mockCaPem = '-----BEGIN CERTIFICATE-----\nMOCK_ROOT_CA_CERTIFICATE_DATA\n-----END CERTIFICATE-----';

      const config = createSecurePostgresConfig('postgresql://app:secret@db.internal:5432/identity_db', {
        enabled: true,
        ca: mockCaPem,
      });

      const ssl = config.ssl as any;
      expect(ssl.ca).toBe(mockCaPem);
      expect(ssl.rejectUnauthorized).toBe(true);
      expect(ssl.minVersion).toBe('TLSv1.2');
    });

    it('should load CA certificate from file path when caPath is supplied', async () => {
      const caFilePath = path.join(tempDir, 'azure-root-ca.crt');
      const caContent = '-----BEGIN CERTIFICATE-----\nFILE_BASED_AZURE_ROOT_CA\n-----END CERTIFICATE-----';
      await fs.promises.writeFile(caFilePath, caContent, 'utf8');

      const config = createSecurePostgresConfig('postgresql://app:secret@db.internal:5432/identity_db', {
        enabled: true,
        caPath: caFilePath,
      });

      const ssl = config.ssl as any;
      expect(ssl.ca).toBe(caContent);
      expect(ssl.rejectUnauthorized).toBe(true);
    });

    it('should resolve CA certificate from DATABASE_SSL_CA environment variable', () => {
      const envCa = '-----BEGIN CERTIFICATE-----\nENV_VAR_ROOT_CA\n-----END CERTIFICATE-----';
      process.env.DATABASE_SSL_CA = envCa;

      const config = createSecurePostgresConfig('postgresql://app:secret@db.internal:5432/identity_db');

      const ssl = config.ssl as any;
      expect(ssl.ca).toBe(envCa);
      expect(ssl.rejectUnauthorized).toBe(true);
    });

    it('should resolve CA certificate from DATABASE_SSL_CA_PATH environment variable', async () => {
      const caFilePath = path.join(tempDir, 'env-path-ca.crt');
      const caContent = '-----BEGIN CERTIFICATE-----\nENV_PATH_ROOT_CA\n-----END CERTIFICATE-----';
      await fs.promises.writeFile(caFilePath, caContent, 'utf8');
      process.env.DATABASE_SSL_CA_PATH = caFilePath;

      const config = createSecurePostgresConfig('postgresql://app:secret@db.internal:5432/identity_db');

      const ssl = config.ssl as any;
      expect(ssl.ca).toBe(caContent);
      expect(ssl.rejectUnauthorized).toBe(true);
    });
  });

  describe('Anti-Downgrade Security Guard (PCI-DSS & SOC 2 Compliance)', () => {
    it('should throw SecurityConfigurationError if rejectUnauthorized: false is passed in options', () => {
      expect(() =>
        createSecurePostgresConfig('postgresql://app:secret@db.internal:5432/identity_db', {
          rejectUnauthorized: false,
        })
      ).toThrow(SecurityConfigurationError);

      expect(() =>
        createSecurePostgresConfig('postgresql://app:secret@db.internal:5432/identity_db', {
          rejectUnauthorized: false,
        })
      ).toThrow(/Disabling certificate validation \(rejectUnauthorized: false\) is strictly forbidden/);
    });

    it('should throw SecurityConfigurationError if raw PoolConfig has ssl.rejectUnauthorized: false', () => {
      expect(() =>
        createSecurePostgresConfig({
          connectionString: 'postgresql://app:secret@db.internal:5432/identity_db',
          ssl: { rejectUnauthorized: false },
        })
      ).toThrow(SecurityConfigurationError);
    });

    it('should throw SecurityConfigurationError if connection string contains insecure sslmode=no-verify', () => {
      expect(() =>
        createSecurePostgresConfig('postgresql://app:secret@db.internal:5432/identity_db?sslmode=no-verify')
      ).toThrow(SecurityConfigurationError);

      expect(() =>
        createSecurePostgresConfig('postgresql://app:secret@db.internal:5432/identity_db?sslmode=no-verify')
      ).toThrow(/Insecure sslmode 'no-verify' is forbidden/);
    });

    it('should automatically harden connection strings with sslmode=verify-full', () => {
      const config = createSecurePostgresConfig(
        'postgresql://app:secret@db.internal:5432/identity_db?sslmode=verify-full'
      );

      const ssl = config.ssl as any;
      expect(ssl.rejectUnauthorized).toBe(true);
      expect(ssl.minVersion).toBe('TLSv1.2');
    });

    it('should automatically harden connection strings with sslmode=require', () => {
      const config = createSecurePostgresConfig(
        'postgresql://app:secret@db.internal:5432/identity_db?sslmode=require'
      );

      const ssl = config.ssl as any;
      expect(ssl.rejectUnauthorized).toBe(true);
      expect(ssl.minVersion).toBe('TLSv1.2');
    });

    it('should throw SecurityConfigurationError if sslmode=disable is passed when SSL is enforced', () => {
      expect(() =>
        createSecurePostgresConfig(
          'postgresql://app:secret@db.internal:5432/identity_db?sslmode=disable',
          { enabled: true }
        )
      ).toThrow(SecurityConfigurationError);
    });
  });
});
