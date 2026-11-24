import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import {
  AuthTokenClaims,
  TokenProviderPort,
} from '../../application/ports/security/token_provider';

/**
 * Secondary Adapter: JwtTokenAdapter
 * Implementación de TokenProviderPort basada en la especificación RFC 7519 (JSON Web Tokens).
 */
export class JwtTokenAdapter implements TokenProviderPort {
  private readonly secretKey: string;
  private readonly expiresIn: string | number;

  constructor(secretKey: string, expiresIn: string | number = '1h') {
    if (!secretKey || secretKey.trim().length === 0) {
      throw new Error('Secret key must be a non-empty string');
    }
    this.secretKey = secretKey;
    this.expiresIn = expiresIn;
  }

  /**
   * Genera un token JWT firmado criptográficamente con los claims del usuario y tenant.
   */
  public async generateToken(claims: AuthTokenClaims): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: SignOptions = {
        expiresIn: this.expiresIn as any,
      };

      jwt.sign(
        {
          userId: claims.userId,
          ...(claims.email ? { email: claims.email } : {}),
          ...(claims.tenantId ? { tenantId: claims.tenantId } : {}),
          ...(claims.roles ? { roles: claims.roles } : {}),
          ...(claims.actorType ? { actorType: claims.actorType } : {}),
          ...(claims.claims || {}),
        },
        this.secretKey,
        options,
        (err, token) => {
          if (err || !token) {
            return reject(err ?? new Error('Failed to generate token'));
          }
          resolve(token);
        }
      );
    });
  }

  /**
   * Verifica la autenticidad y vigencia temporal de un token JWT, retornando sus claims.
   */
  public async verifyToken(token: string): Promise<AuthTokenClaims> {
    return new Promise((resolve, reject) => {
      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        return reject(new Error('Token must be a non-empty string'));
      }

      jwt.verify(token, this.secretKey, (err, decoded) => {
        if (err || !decoded) {
          return reject(err ?? new Error('Invalid token'));
        }

        const payload = decoded as JwtPayload & Partial<AuthTokenClaims>;

        if (!payload.userId || !payload.email || !payload.tenantId) {
          return reject(new Error('Token payload missing required claims'));
        }

        const extraClaims: Record<string, unknown> = {};
        if (Array.isArray((payload as Record<string, unknown>).amr)) {
          extraClaims.amr = (payload as Record<string, unknown>).amr;
        }
        if (typeof (payload as Record<string, unknown>).client_id === 'string') {
          extraClaims.client_id = (payload as Record<string, unknown>).client_id;
        }
        if (typeof (payload as Record<string, unknown>).kyc_verified === 'boolean') {
          extraClaims.kyc_verified = (payload as Record<string, unknown>).kyc_verified;
        }
        if (typeof (payload as Record<string, unknown>).kyc_status === 'string') {
          extraClaims.kyc_status = (payload as Record<string, unknown>).kyc_status;
        }

        const result: AuthTokenClaims = {
          userId: payload.userId,
          email: payload.email,
          tenantId: payload.tenantId,
          ...(payload.roles && Array.isArray(payload.roles) ? { roles: payload.roles } : {}),
          ...(payload.actorType ? { actorType: payload.actorType } : {}),
          ...(Object.keys(extraClaims).length > 0 ? { claims: extraClaims } : {}),
        };

        resolve(result);
      });
    });
  }
}

