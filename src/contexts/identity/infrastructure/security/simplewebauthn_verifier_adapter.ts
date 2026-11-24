import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  WebAuthnAuthenticationOptionsInput,
  WebAuthnAuthenticationVerifyInput,
  WebAuthnRegistrationOptionsInput,
  WebAuthnRegistrationVerifyInput,
  WebAuthnVerifiedAuthentication,
  WebAuthnVerifiedRegistration,
  WebAuthnVerifierPort,
} from '../../application/ports/security/webauthn_verifier_port';

/**
 * Secondary Adapter: SimpleWebAuthnVerifierAdapter (US-35)
 * Implementa WebAuthnVerifierPort sobre @simplewebauthn/server.
 */
export class SimpleWebAuthnVerifierAdapter implements WebAuthnVerifierPort {
  public async generateRegistrationOptions(
    input: WebAuthnRegistrationOptionsInput
  ): Promise<Record<string, unknown> & { challenge: string }> {
    const options = await generateRegistrationOptions({
      rpName: input.rpName,
      rpID: input.rpID,
      userID: new TextEncoder().encode(input.userId),
      userName: input.userName,
      attestationType: 'none',
      excludeCredentials: input.excludeCredentialIds.map((id) => ({ id })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    return options as unknown as Record<string, unknown> & { challenge: string };
  }

  public async verifyRegistrationResponse(
    input: WebAuthnRegistrationVerifyInput
  ): Promise<WebAuthnVerifiedRegistration> {
    const verification = await verifyRegistrationResponse({
      response: input.response as RegistrationResponseJSON,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRPID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false };
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    return {
      verified: true,
      credentialId: credential.id,
      publicKeyCose: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ? [...credential.transports] : [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    };
  }

  public async generateAuthenticationOptions(
    input: WebAuthnAuthenticationOptionsInput
  ): Promise<Record<string, unknown> & { challenge: string }> {
    const options = await generateAuthenticationOptions({
      rpID: input.rpID,
      allowCredentials: input.allowCredentialIds.map((id) => ({ id })),
      userVerification: 'preferred',
    });

    return options as unknown as Record<string, unknown> & { challenge: string };
  }

  public async verifyAuthenticationResponse(
    input: WebAuthnAuthenticationVerifyInput
  ): Promise<WebAuthnVerifiedAuthentication> {
    const verification = await verifyAuthenticationResponse({
      response: input.response as AuthenticationResponseJSON,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRPID,
      requireUserVerification: false,
      credential: {
        id: input.credential.id,
        publicKey: new Uint8Array(input.credential.publicKeyCose),
        counter: input.credential.counter,
        transports: input.credential.transports
          ? ([...input.credential.transports] as AuthenticatorTransport[])
          : undefined,
      },
    });

    if (!verification.verified) {
      return { verified: false, newCounter: input.credential.counter };
    }

    return {
      verified: true,
      newCounter: verification.authenticationInfo.newCounter,
    };
  }
}
