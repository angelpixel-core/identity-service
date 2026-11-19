import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import net from 'net';
import bcrypt from 'bcrypt';

export interface ResetOptions {
  noSeeds?: boolean;
  quiet?: boolean;
}

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

async function flushRedis(redisUrlOrPort?: string): Promise<boolean> {
  return new Promise((resolve) => {
    let host = 'localhost';
    let port = 6379;

    if (redisUrlOrPort) {
      try {
        const parsed = new URL(redisUrlOrPort);
        host = parsed.hostname || 'localhost';
        port = Number(parsed.port) || 6379;
      } catch {
        // Fallback to default
      }
    }

    const socket = net.createConnection({ host, port }, () => {
      socket.write('FLUSHDB\r\n');
    });

    socket.setTimeout(2000);

    socket.on('data', (data) => {
      const response = data.toString();
      socket.end();
      resolve(response.includes('+OK'));
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function extractDbSql(rawContent: string, noSeeds = false): string {
  // Discard tests db part if present
  const dbPart = rawContent.split(/\\c\s+identity_test_db;/i)[0];
  // Remove \c identity_db; directives
  let cleanSql = dbPart.replace(/\\c\s+identity_db;/gi, '').trim();

  if (noSeeds && cleanSql.includes('INSERT INTO registered_clients')) {
    cleanSql = cleanSql.split(/INSERT INTO registered_clients/i)[0].trim();
  }

  return cleanSql;
}

export async function resetDatabase(options: ResetOptions = {}): Promise<void> {
  const startTotal = performance.now();

  // 1. Production safety barrier
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Cannot reset database in production environment (NODE_ENV=production).');
  }

  const log = (msg: string) => {
    if (!options.quiet) console.log(msg);
  };

  log(`\n${colors.bold}${colors.cyan}=== AngelPixel Identity DB Reset Pipeline ===${colors.reset}`);
  log(`${colors.gray}Environment: ${process.env.NODE_ENV || 'development'} | Seeds: ${options.noSeeds ? 'Disabled' : 'Enabled'}${colors.reset}\n`);

  // 2. Connect to PostgreSQL (Host vs Docker fallback)
  let connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/identity_db';
  let client = new Client({ connectionString });

  try {
    await client.connect();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // If failed because @db:5432 was unreachable from outside container, fallback to localhost
    if (connectionString.includes('@db:') || errorMsg.includes('ENOTFOUND')) {
      const fallbackUrl = connectionString.replace('@db:', '@localhost:');
      log(`${colors.yellow}⚠️ Connection to Docker host 'db' failed. Retrying with '${fallbackUrl}'...${colors.reset}`);
      client = new Client({ connectionString: fallbackUrl });
      await client.connect();
    } else {
      throw err;
    }
  }

  log(`${colors.green}✓ Connected to PostgreSQL database: identity_db${colors.reset}`);

  try {
    // 3. Drop & Recreate Schema public
    const startSchema = performance.now();
    log(`${colors.gray}Executing DROP SCHEMA public CASCADE and recreating schema...${colors.reset}`);
    await client.query(`
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO postgres;
      GRANT ALL ON SCHEMA public TO public;
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);
    const schemaLatency = Math.round(performance.now() - startSchema);
    log(`${colors.green}✓ Schema 'public' purged and recreated (${schemaLatency}ms)${colors.reset}`);

    // 4. Execute DDL Migrations from infrastructure/local/initdb.d/
    const initDir = path.resolve(__dirname, '../infrastructure/local/initdb.d');
    const ddlFiles = [
      '005-create-identity-schema.sql',
      '006-create-registered-clients.sql',
      '007-enable-postgresql-rls.sql',
      '008-create-federated-identities.sql',
    ];

    for (const file of ddlFiles) {
      const startFile = performance.now();
      const filePath = path.join(initDir, file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Migration file not found: ${filePath}`);
      }

      const rawSql = fs.readFileSync(filePath, 'utf-8');
      const cleanSql = extractDbSql(rawSql, options.noSeeds);

      await client.query(cleanSql);
      const fileLatency = Math.round(performance.now() - startFile);
      log(`${colors.green}✓ Executed migration: ${file} (${fileLatency}ms)${colors.reset}`);
    }

    // 5. Seed Platform Root Superadmin (if seeds enabled)
    if (!options.noSeeds) {
      const startSeeds = performance.now();
      const rootUserId = 'usr_root_superadmin_000000000001';
      const rootEmail = 'admin@angelpixel.io';
      const rootTenantId = 'system';
      const rootPassword = 'Admin_Root_2026!';
      const salt = await bcrypt.genSalt(10);
      const rootPasswordHash = await bcrypt.hash(rootPassword, salt);
      const now = new Date();

      await client.query(`
        INSERT INTO users (id, email, password_hash, tenant_id, roles, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          tenant_id = EXCLUDED.tenant_id,
          roles = EXCLUDED.roles,
          updated_at = EXCLUDED.updated_at;
      `, [rootUserId, rootEmail, rootPasswordHash, rootTenantId, ['superadmin', 'member'], now, now]);

      const seedLatency = Math.round(performance.now() - startSeeds);
      log(`${colors.green}✓ Seeded Platform Root Superadmin '${rootEmail}' in tenant '${rootTenantId}' (${seedLatency}ms)${colors.reset}`);
    }

    // 6. Verify Row Counts
    const usersCount = (await client.query('SELECT COUNT(*)::int as count FROM users')).rows[0].count;
    const clientsCount = (await client.query('SELECT COUNT(*)::int as count FROM registered_clients')).rows[0].count;
    const fedCount = (await client.query('SELECT COUNT(*)::int as count FROM federated_identities')).rows[0].count;

    log(`${colors.cyan}📊 Database Status:${colors.reset} users: ${usersCount}, registered_clients: ${clientsCount}, federated_identities: ${fedCount}`);

    // 7. Redis Flush
    const redisOk = await flushRedis(process.env.REDIS_URL || 'redis://localhost:6379');
    if (redisOk) {
      log(`${colors.green}✓ Redis cache flushed successfully (FLUSHDB)${colors.reset}`);
    } else {
      log(`${colors.yellow}⚠️ Redis cache unreachable or skipped (no cache keys to purge)${colors.reset}`);
    }

    const totalLatency = Math.round(performance.now() - startTotal);
    log(`\n${colors.bold}${colors.green}🚀 Database Reset Completed Successfully in ${totalLatency}ms!${colors.reset}\n`);
  } finally {
    await client.end();
  }
}

// CLI Execution entrypoint
if (require.main === module || process.argv[1]?.endsWith('db-reset.ts')) {
  const noSeeds = process.argv.includes('--no-seeds');
  const quiet = process.argv.includes('--quiet') || process.argv.includes('-q');

  resetDatabase({ noSeeds, quiet }).catch((err) => {
    console.error(`\n${colors.bold}${colors.red}❌ Database Reset Failed:${colors.reset}`, err.message);
    process.exit(1);
  });
}
