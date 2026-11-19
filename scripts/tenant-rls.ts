import { Client } from 'pg';
import crypto from 'crypto';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

interface ParsedArgs {
  action?: string;
  flags: Record<string, string | boolean>;
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { flags: {} };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=', 2);
        result.flags[k] = v;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        result.flags[key] = argv[i + 1];
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (!result.action) {
      result.action = arg;
    }
    i++;
  }
  return result;
}

async function connectAsIdentityApp(): Promise<Client> {
  const connectionString =
    process.env.RLS_DATABASE_URL ||
    'postgresql://identity_app:identity_app_pass_2026@localhost:5432/identity_db';

  let client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (connectionString.includes('@db:') || errorMsg.includes('ENOTFOUND')) {
      const fallbackUrl = connectionString.replace('@db:', '@localhost:');
      client = new Client({ connectionString: fallbackUrl });
      await client.connect();
      return client;
    }
    throw err;
  }
}

function renderTable(rows: Array<{ id: string; email: string; tenant_id: string }>): void {
  const idHeader = 'id';
  const emailHeader = 'email';
  const tenantHeader = 'tenant_id';

  const idWidth = Math.max(idHeader.length, ...rows.map((r) => r.id.length));
  const emailWidth = Math.max(emailHeader.length, ...rows.map((r) => r.email.length));
  const tenantWidth = Math.max(tenantHeader.length, ...rows.map((r) => r.tenant_id.length));

  const pad = (val: string, len: number) => val.padEnd(len, ' ');

  console.log(
    `${colors.bold} ${pad(idHeader, idWidth)} | ${pad(emailHeader, emailWidth)} | ${pad(tenantHeader, tenantWidth)}${colors.reset}`
  );
  console.log(
    `${colors.gray}-${'-'.repeat(idWidth)}-+-${'-'.repeat(emailWidth)}-+-${'-'.repeat(tenantWidth)}-${colors.reset}`
  );

  for (const row of rows) {
    console.log(
      ` ${pad(row.id, idWidth)} | ${pad(row.email, emailWidth)} | ${colors.cyan}${pad(row.tenant_id, tenantWidth)}${colors.reset}`
    );
  }

  console.log(`${colors.gray}(${rows.length} ${rows.length === 1 ? 'row' : 'rows'})${colors.reset}`);
}

async function handleListUsers(flags: Record<string, string | boolean>, rawJson: boolean): Promise<void> {
  const tenantId = typeof flags.tenant === 'string' ? flags.tenant.trim() : undefined;
  const limitRaw = typeof flags.limit === 'string' ? Number(flags.limit) : 10;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 10;

  const client = await connectAsIdentityApp();
  const start = performance.now();

  try {
    await client.query('BEGIN');
    if (tenantId) {
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    }

    const res = await client.query<{
      id: string;
      email: string;
      tenant_id: string;
      roles?: string[];
    }>(
      'SELECT id, email, tenant_id, roles FROM users ORDER BY created_at DESC LIMIT $1',
      [limit]
    );

    await client.query('COMMIT');
    const latencyMs = Math.round(performance.now() - start);

    if (rawJson) {
      console.log(
        JSON.stringify(
          {
            role: 'identity_app',
            sessionTenant: tenantId ?? null,
            rowCount: res.rows.length,
            latencyMs,
            rows: res.rows,
          },
          null,
          2
        )
      );
      return;
    }

    const ctxLabel = tenantId
      ? `${colors.green}app.current_tenant_id = '${tenantId}'${colors.reset}`
      : `${colors.yellow}<unset> (Fail-Closed RLS)${colors.reset}`;

    console.log(
      `${colors.bold}PostgreSQL RLS Query${colors.reset} ${colors.gray}[role: identity_app | ${latencyMs}ms]${colors.reset}`
    );
    console.log(`${colors.gray}Session Context:${colors.reset} ${ctxLabel}\n`);
    renderTable(res.rows);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function handleInsertUser(flags: Record<string, string | boolean>, rawJson: boolean): Promise<void> {
  const sessionTenant =
    typeof flags['session-tenant'] === 'string' ? flags['session-tenant'].trim() : undefined;
  const targetTenant = typeof flags.tenant === 'string' ? flags.tenant.trim() : undefined;
  const email = typeof flags.email === 'string' ? flags.email.trim() : undefined;
  const userId =
    typeof flags.id === 'string' && flags.id.trim().length > 0
      ? flags.id.trim()
      : crypto.randomUUID();

  if (!sessionTenant) {
    console.error(`${colors.red}Error:${colors.reset} La bandera --session-tenant es obligatoria.`);
    process.exit(1);
  }
  if (!targetTenant) {
    console.error(`${colors.red}Error:${colors.reset} La bandera --tenant es obligatoria.`);
    process.exit(1);
  }
  if (!email) {
    console.error(`${colors.red}Error:${colors.reset} La bandera --email es obligatoria.`);
    process.exit(1);
  }

  const client = await connectAsIdentityApp();
  const start = performance.now();

  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [sessionTenant]);

    const res = await client.query<{ id: string; email: string; tenant_id: string }>(
      `INSERT INTO users (id, tenant_id, email, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, email, tenant_id`,
      [userId, targetTenant, email, 'rls_probe_dummy_hash']
    );

    await client.query('COMMIT');
    const latencyMs = Math.round(performance.now() - start);

    if (rawJson) {
      console.log(
        JSON.stringify(
          {
            success: true,
            role: 'identity_app',
            sessionTenant,
            targetTenant,
            latencyMs,
            user: res.rows[0],
          },
          null,
          2
        )
      );
      return;
    }

    console.log(
      `${colors.green}✓ INSERT permitido por política RLS${colors.reset} ${colors.gray}[role: identity_app | ${latencyMs}ms]${colors.reset}`
    );
    console.log(`${colors.gray}Session Context:${colors.reset} app.current_tenant_id = '${sessionTenant}'`);
    console.log(JSON.stringify(res.rows[0], null, 2));
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const latencyMs = Math.round(performance.now() - start);
    const pgErr = err as { code?: string; message?: string; detail?: string };
    const pgCode = pgErr?.code || 'UNKNOWN';
    const pgMessage = pgErr?.message || String(err);

    if (rawJson) {
      console.log(
        JSON.stringify(
          {
            success: false,
            role: 'identity_app',
            sessionTenant,
            targetTenant,
            latencyMs,
            pgCode,
            error: pgMessage,
          },
          null,
          2
        )
      );
    } else {
      console.error(
        `${colors.red}✖ PostgreSQL Kernel Rejection [${pgCode}]${colors.reset} ${colors.gray}[role: identity_app | ${latencyMs}ms]${colors.reset}`
      );
      console.error(`${colors.gray}Session Context:${colors.reset} app.current_tenant_id = '${sessionTenant}'`);
      console.error(`${colors.gray}Target Row Tenant:${colors.reset} '${targetTenant}'`);
      console.error(`${colors.red}ERROR:${colors.reset} ${pgMessage}`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const { action, flags } = parseCliArgs(process.argv.slice(2));
  const rawJson = Boolean(flags['raw-json']);

  if (action === 'list-users') {
    await handleListUsers(flags, rawJson);
    return;
  }

  if (action === 'insert-user') {
    await handleInsertUser(flags, rawJson);
    return;
  }

  console.error(`${colors.red}Error:${colors.reset} Acción desconocida "${action || ''}" en tenant-rls.ts.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`${colors.red}Error fatal RLS:${colors.reset}`, err instanceof Error ? err.message : err);
  process.exit(1);
});
