import { OAuth2M2MClient } from '../interfaces/http/client/oauth2_m2m_client';

async function main(): Promise<void> {
  const baseUrl = process.env.IDP_BASE_URL || 'http://localhost:4000';
  console.log(`Conectando con Identity Provider en ${baseUrl}...`);

  const client = new OAuth2M2MClient({ baseUrl });
  const credentials = {
    clientId: 'm2m-service-app',
    clientSecret: 'ValidSecret123!_SuperSecureSecretForTesting_2026',
    scope: 'identity:read',
  };

  console.log('\n1. Primera solicitud (Petición HTTP real hacia /api/v1/oauth2/token)...');
  const token1 = await client.getValidToken(credentials);
  console.log(`✓ Token obtenido exitosamente (expira en: ${token1.expires_in}s)`);
  console.log(`  Token: ${token1.access_token.slice(0, 30)}...`);

  console.log('\n2. Segunda solicitud consecutiva inmediata (Smart Cache Hit en memoria)...');
  const token2 = await client.getValidToken(credentials);
  const isCacheHit = token1.access_token === token2.access_token;
  console.log(`✓ ¿Mismo token reutilizado desde caché?: ${isCacheHit ? 'SÍ (Cache Hit)' : 'NO'}`);

  if (!isCacheHit) {
    throw new Error('Fallo de caché: se esperaba reutilizar el token anterior.');
  }

  console.log('\n¡Demostración de OAuth2M2MClient completada con éxito!');
}

main().catch((err: unknown) => {
  console.error('\nError ejecutando demo M2M:', err);
  process.exit(1);
});
