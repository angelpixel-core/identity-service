import { WebAuthnDeviceType } from '../../../domain/entities/webauthn_credential/entity';

export interface WebAuthnRegistrationOptionsInput {
  readonly rpName: string;
  readonly rpID: string;
  readonly userId: string;
  readonly userName: string;
  readonly excludeCredentialIds: readonly string[];
}

export interface WebAuthnRegistrationVerifyInput {
  readonly response: unknown;
  readonly expectedChallenge: string;
  readonly expectedOrigin: string | string[];
  readonly expectedRPID: string;
}

export interface WebAuthnVerifiedRegistration {
  readonly verified: boolean;
  readonly credentialId?: string;
  readonly publicKeyCose?: Buffer;
  readonly counter?: number;
  readonly transports?: string[];
  readonly deviceType?: WebAuthnDeviceType;
  readonly backedUp?: boolean;
}

export interface WebAuthnAuthenticationOptionsInput {
  readonly rpID: string;
  readonly allowCredentialIds: readonly string[];
}

export interface WebAuthnAuthenticationVerifyInput {
  readonly response: unknown;
  readonly expectedChallenge: string;
  readonly expectedOrigin: string | string[];
  readonly expectedRPID: string;
  readonly credential: {
    readonly id: string;
    readonly publicKeyCose: Buffer;
    readonly counter: number;
    readonly transports?: readonly string[];
  };
}

export interface WebAuthnVerifiedAuthentication {
  readonly verified: boolean;
  readonly newCounter: number;
}

/**
 * Secondary Port (SPI): WebAuthnVerifierPort (US-35 / US-36)
 * Desacopla el caso de uso de la librería WebAuthn/FIDO2 subyacente (@simplewebauthn/server).
 */
export interface WebAuthnVerifierPort {
  generateRegistrationOptions(
    input: WebAuthnRegistrationOptionsInput
  ): Promise<Record<string, unknown> & { challenge: string }>;

  verifyRegistrationResponse(
    input: WebAuthnRegistrationVerifyInput
  ): Promise<WebAuthnVerifiedRegistration>;

  generateAuthenticationOptions?(
    input: WebAuthnAuthenticationOptionsInput
  ): Promise<Record<string, unknown> & { challenge: string }>;

  verifyAuthenticationResponse?(
    input: WebAuthnAuthenticationVerifyInput
  ): Promise<WebAuthnVerifiedAuthentication>;
}
