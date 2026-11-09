import { Request, Response } from 'express';
import { GetOpenIdConfigurationQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_openid_configuration/handler';
import { GetJwksQueryHandler } from '../../../../../src/contexts/identity/application/queries/get_jwks/handler';

/**
 * Driver Adapter (HTTP REST Controller): DiscoveryController
 * Expone los endpoints de descubrimiento OIDC (RFC 8414) y JWKS (RFC 7517).
 * Optimizado con cabeceras de caché HTTP y seguridad defensiva.
 */
export class DiscoveryController {
  private static readonly CACHE_HEADER_VALUE =
    'public, max-age=3600, stale-while-revalidate=86400';

  constructor(
    private readonly getOpenIdConfigHandler: GetOpenIdConfigurationQueryHandler,
    private readonly getJwksHandler: GetJwksQueryHandler
  ) {
    this.getOpenIdConfiguration = this.getOpenIdConfiguration.bind(this);
    this.getJwks = this.getJwks.bind(this);
  }

  /**
   * GET /.well-known/openid-configuration
   */
  public getOpenIdConfiguration(req: Request, res: Response): void {
    try {
      const forwardedProto = req.headers['x-forwarded-proto'];
      const protocol =
        (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ||
        req.protocol ||
        'http';
      const host = req.get('host');
      const issuerBaseUrl =
        process.env.PUBLIC_ISSUER_URL || (host ? `${protocol}://${host}` : undefined);

      const config = this.getOpenIdConfigHandler.execute({ issuerBaseUrl });

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', DiscoveryController.CACHE_HEADER_VALUE);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).json(config);
    } catch (_err) {
      res.status(500).json({ error: 'Failed to generate OpenID configuration' });
    }
  }

  /**
   * GET /.well-known/jwks.json
   */
  public getJwks(_req: Request, res: Response): void {
    try {
      const jwks = this.getJwksHandler.execute();

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', DiscoveryController.CACHE_HEADER_VALUE);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).json(jwks);
    } catch (_err) {
      res.status(500).json({ error: 'Failed to retrieve JWKS' });
    }
  }
}
