import {
  RouteNormalizer,
  DEFAULT_LATENCY_BUCKETS,
  HttpRequestMetricLabels,
  HttpErrorMetricLabels,
} from '../../../../../src/contexts/shared/domain/telemetry/metric_types';

describe('Telemetry Domain: Metric Types & Route Normalizer (US-21)', () => {
  describe('DEFAULT_LATENCY_BUCKETS', () => {
    it('should define SRE-calibrated logarithmic buckets in seconds', () => {
      expect(DEFAULT_LATENCY_BUCKETS).toBeInstanceOf(Array);
      expect(DEFAULT_LATENCY_BUCKETS.length).toBeGreaterThanOrEqual(8);
      expect(DEFAULT_LATENCY_BUCKETS[0]).toBe(0.005); // 5ms
      expect(DEFAULT_LATENCY_BUCKETS).toEqual([
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ]);
    });
  });

  describe('RouteNormalizer', () => {
    it('should preserve root and clean static routes', () => {
      expect(RouteNormalizer.normalize('/')).toBe('/');
      expect(RouteNormalizer.normalize('/health/live')).toBe('/health/live');
      expect(RouteNormalizer.normalize('/health/ready')).toBe('/health/ready');
      expect(RouteNormalizer.normalize('/metrics')).toBe('/metrics');
      expect(RouteNormalizer.normalize('/api/v1/auth/register')).toBe('/api/v1/auth/register');
      expect(RouteNormalizer.normalize('/oauth2/token')).toBe('/oauth2/token');
    });

    it('should strip query parameters and hash fragments', () => {
      expect(RouteNormalizer.normalize('/api/v1/users?page=1&limit=20')).toBe('/api/v1/users');
      expect(RouteNormalizer.normalize('/oauth2/authorize?client_id=foo#token')).toBe('/oauth2/authorize');
    });

    it('should collapse UUIDs into :id parameter', () => {
      const uuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
      expect(RouteNormalizer.normalize(`/api/v1/users/${uuid}`)).toBe('/api/v1/users/:id');
      expect(RouteNormalizer.normalize(`/api/v1/tenants/${uuid}/profile`)).toBe('/api/v1/tenants/:id/profile');
    });

    it('should collapse numeric IDs into :id parameter', () => {
      expect(RouteNormalizer.normalize('/api/v1/orders/12345')).toBe('/api/v1/orders/:id');
      expect(RouteNormalizer.normalize('/api/v1/items/42/details')).toBe('/api/v1/items/:id/details');
    });

    it('should collapse hex hashes or long tokens into :token parameter', () => {
      const sha256Hex = '4bf92f3577b34da6a3ce929d0e0e47365c8a412e109dfb33a1b2c3d4e5f60718';
      expect(RouteNormalizer.normalize(`/oauth2/verify/${sha256Hex}`)).toBe('/oauth2/verify/:token');
    });

    it('should handle trailing slashes consistently', () => {
      expect(RouteNormalizer.normalize('/health/live/')).toBe('/health/live');
      expect(RouteNormalizer.normalize('/api/v1/auth/me/')).toBe('/api/v1/auth/me');
    });

    it('should handle empty or nullish inputs with fallback', () => {
      expect(RouteNormalizer.normalize('')).toBe('/');
      expect(RouteNormalizer.normalize(null as unknown as string)).toBe('/');
      expect(RouteNormalizer.normalize(undefined as unknown as string)).toBe('/');
    });
  });

  describe('Metric Labels Validation', () => {
    it('should sanitize and trim label values', () => {
      const labels: HttpRequestMetricLabels = {
        method: ' get ',
        route: ' /api/v1/auth/me ',
        statusCode: 200,
        tenantId: ' tenant-alpha ',
      };

      const sanitized = RouteNormalizer.sanitizeHttpLabels(labels);
      expect(sanitized.method).toBe('GET');
      expect(sanitized.route).toBe('/api/v1/auth/me');
      expect(sanitized.statusCode).toBe(200);
      expect(sanitized.tenantId).toBe('tenant-alpha');
    });

    it('should provide default tenantId "none" if omitted', () => {
      const labels: HttpRequestMetricLabels = {
        method: 'POST',
        route: '/oauth2/token',
        statusCode: 200,
      };

      const sanitized = RouteNormalizer.sanitizeHttpLabels(labels);
      expect(sanitized.tenantId).toBe('none');
    });

    it('should sanitize error metric labels', () => {
      const errorLabels: HttpErrorMetricLabels = {
        method: 'POST',
        route: '/api/v1/auth/register',
        statusCode: 400,
        errorType: ' VALIDATION_ERROR ',
        tenantId: 'tenant-test',
      };

      const sanitized = RouteNormalizer.sanitizeErrorLabels(errorLabels);
      expect(sanitized.errorType).toBe('VALIDATION_ERROR');
      expect(sanitized.statusCode).toBe(400);
      expect(sanitized.method).toBe('POST');
    });
  });
});
