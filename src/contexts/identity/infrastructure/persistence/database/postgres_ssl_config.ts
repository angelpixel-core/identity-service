import fs from 'fs';
import path from 'path';
import { PoolConfig } from 'pg';

export class SecurityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityConfigurationError';
    Object.setPrototypeOf(this, SecurityConfigurationError.prototype);
  }
}

export interface PostgresSslOptions {
  readonly enabled?: boolean;
  readonly ca?: string | Buffer | Array<string | Buffer>;
  readonly caPath?: string;
  readonly rejectUnauthorized?: boolean;
  readonly minVersion?: 'TLSv1.2' | 'TLSv1.3';
  readonly checkServerIdentity?: (host: string, cert: any) => Error | undefined;
}

/**
 * Secondary Infrastructure Helper: PostgresSslConfigFactory
 * Construye configuraciones de conexión PostgreSQL (node-pg) criptográficamente blindadas,
 * forzando validación estricta de certificados CA y TLS 1.2+ conforme a PCI-DSS v4.0 (Req 4.1)
 * y SOC 2 Type II (CC6.7).
 *
 * Incluye un "Anti-Downgrade Security Guard" que bloquea cualquier intento de deshabilitar
 * la verificación de certificados (`rejectUnauthorized: false`).
 */
export function createSecurePostgresConfig(
  rawConfig: string | PoolConfig,
  options?: PostgresSslOptions
): PoolConfig {
  let baseConfig: PoolConfig;

  // 1. Normalizar entrada a PoolConfig
  if (typeof rawConfig === 'string') {
    baseConfig = parseConnectionStringToPoolConfig(rawConfig);
  } else {
    baseConfig = { ...rawConfig };
  }

  // 2. Anti-Downgrade Guard: Verificar si se intentó desactivar rejectUnauthorized
  if (options?.rejectUnauthorized === false) {
    throw new SecurityConfigurationError(
      'Disabling certificate validation (rejectUnauthorized: false) is strictly forbidden under PCI-DSS v4.0 Req 4.1 and SOC 2 CC6.7'
    );
  }

  if (baseConfig.ssl && typeof baseConfig.ssl === 'object' && baseConfig.ssl.rejectUnauthorized === false) {
    throw new SecurityConfigurationError(
      'Disabling certificate validation (rejectUnauthorized: false) is strictly forbidden under PCI-DSS v4.0 Req 4.1 and SOC 2 CC6.7'
    );
  }

  // 3. Determinar si SSL debe habilitarse
  const isSslRequested =
    options?.enabled !== false &&
    (options?.enabled === true ||
      options?.ca !== undefined ||
      options?.caPath !== undefined ||
      Boolean(process.env.DATABASE_SSL_CA) ||
      Boolean(process.env.DATABASE_SSL_CA_PATH) ||
      baseConfig.ssl !== undefined ||
      process.env.DATABASE_SSL_MODE === 'verify-full' ||
      process.env.DATABASE_SSL_MODE === 'require');

  // Si SSL está explícitamente deshabilitado (e.g. en tests en memoria o dev local)
  if (!isSslRequested) {
    if (baseConfig.ssl === false || options?.enabled === false) {
      delete baseConfig.ssl;
    }
    return baseConfig;
  }

  // 4. Resolver certificado CA raíz confiable
  let resolvedCa: string | Buffer | Array<string | Buffer> | undefined = options?.ca;

  if (!resolvedCa) {
    const caPath = options?.caPath || process.env.DATABASE_SSL_CA_PATH;
    if (caPath && fs.existsSync(caPath)) {
      resolvedCa = fs.readFileSync(path.resolve(caPath), 'utf8');
    } else if (process.env.DATABASE_SSL_CA) {
      resolvedCa = process.env.DATABASE_SSL_CA;
    }
  }

  // 5. Configurar objeto SSL estricto
  const existingSslObj = typeof baseConfig.ssl === 'object' ? baseConfig.ssl : {};

  const secureSsl = {
    ...existingSslObj,
    rejectUnauthorized: true,
    minVersion: options?.minVersion ?? (existingSslObj as any).minVersion ?? 'TLSv1.2',
    ...(resolvedCa ? { ca: resolvedCa } : {}),
    ...(options?.checkServerIdentity ? { checkServerIdentity: options.checkServerIdentity } : {}),
  };

  baseConfig.ssl = secureSsl;

  return baseConfig;
}

/**
 * Parsea y normaliza una URL de conexión de PostgreSQL a PoolConfig,
 * detectando parámetros de consulta relacionados con SSL y aplicando salvaguardas.
 */
function parseConnectionStringToPoolConfig(connectionString: string): PoolConfig {
  try {
    const parsedUrl = new URL(connectionString);

    const sslMode = parsedUrl.searchParams.get('sslmode')?.toLowerCase();

    // Detección anti-downgrade en la query string
    if (sslMode === 'no-verify' || sslMode === 'allow' || sslMode === 'prefer') {
      throw new SecurityConfigurationError(
        `Insecure sslmode '${sslMode}' is forbidden. Encrypted transport must enforce full certificate verification.`
      );
    }

    const config: PoolConfig = {
      connectionString,
    };

    if (sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
      config.ssl = {
        rejectUnauthorized: true,
      };
    }

    return config;
  } catch (err: unknown) {
    if (err instanceof SecurityConfigurationError) {
      throw err;
    }
    // Si la cadena no es una URL parseable estándar (e.g. key-value pairs o dummy test string)
    return { connectionString };
  }
}
