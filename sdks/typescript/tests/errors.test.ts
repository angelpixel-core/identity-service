import {
  IdentitySDKError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
  ConflictError,
  OAuth2ProtocolError,
  parseHttpError,
} from '../src/errors';

describe('SDK Errors: Typed Hierarchy & RFC 6749 Protocol Mapping', () => {
  it('should instantiate base IdentitySDKError correctly', () => {
    const err = new IdentitySDKError(500, 'server_error', 'Internal server error occurred');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(IdentitySDKError);
    expect(err.name).toBe('IdentitySDKError');
    expect(err.status).toBe(500);
    expect(err.error).toBe('server_error');
    expect(err.error_description).toBe('Internal server error occurred');
    expect(err.message).toBe('server_error: Internal server error occurred');
  });

  it('should instantiate AuthenticationError with 401 status', () => {
    const err = new AuthenticationError('invalid_client', 'Client credentials incorrect');
    expect(err.status).toBe(401);
    expect(err.error).toBe('invalid_client');
    expect(err.name).toBe('AuthenticationError');
  });

  it('should instantiate AuthorizationError with 403 status', () => {
    const err = new AuthorizationError('forbidden_origin', 'Origin is not permitted');
    expect(err.status).toBe(403);
    expect(err.error).toBe('forbidden_origin');
    expect(err.name).toBe('AuthorizationError');
  });

  it('should instantiate ValidationError with 400 status', () => {
    const err = new ValidationError('invalid_request', 'Missing required parameter');
    expect(err.status).toBe(400);
    expect(err.error).toBe('invalid_request');
    expect(err.name).toBe('ValidationError');
  });

  it('should instantiate NotFoundError with 404 status', () => {
    const err = new NotFoundError('client_not_found', 'Client ID not registered');
    expect(err.status).toBe(404);
    expect(err.error).toBe('client_not_found');
    expect(err.name).toBe('NotFoundError');
  });

  it('should instantiate ConflictError with 409 status', () => {
    const err = new ConflictError('email_already_registered', 'User email already exists');
    expect(err.status).toBe(409);
    expect(err.error).toBe('email_already_registered');
    expect(err.name).toBe('ConflictError');
  });

  it('should instantiate OAuth2ProtocolError with custom status and error code', () => {
    const err = new OAuth2ProtocolError(400, 'unauthorized_client', 'Client cannot use grant_type');
    expect(err.status).toBe(400);
    expect(err.error).toBe('unauthorized_client');
    expect(err.name).toBe('OAuth2ProtocolError');
  });

  describe('parseHttpError factory function', () => {
    it('should map 400 status to ValidationError', () => {
      const err = parseHttpError(400, { error: 'invalid_request', error_description: 'Param missing' });
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.status).toBe(400);
      expect(err.error).toBe('invalid_request');
    });

    it('should map 401 status to AuthenticationError', () => {
      const err = parseHttpError(401, { error: 'invalid_token' });
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.status).toBe(401);
    });

    it('should map 403 status to AuthorizationError', () => {
      const err = parseHttpError(403, { error: 'access_denied' });
      expect(err).toBeInstanceOf(AuthorizationError);
      expect(err.status).toBe(403);
    });

    it('should map 404 status to NotFoundError', () => {
      const err = parseHttpError(404, { error: 'not_found' });
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.status).toBe(404);
    });

    it('should map 409 status to ConflictError', () => {
      const err = parseHttpError(409, { error: 'conflict' });
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.status).toBe(409);
    });

    it('should fallback to IdentitySDKError for other HTTP statuses', () => {
      const err = parseHttpError(503, { error: 'service_unavailable' });
      expect(err).toBeInstanceOf(IdentitySDKError);
      expect(err.status).toBe(503);
    });
  });
});

