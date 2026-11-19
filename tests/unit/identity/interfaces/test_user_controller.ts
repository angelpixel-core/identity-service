// 1. Librerías Externas
import type { Request, Response, NextFunction } from 'express';

// 2. Capa de Interfaces
import { UserController } from '@interfaces/http/rest/v1/identity/user_controller';

// 4. Capa de Aplicación
import type { GetUserProfileQueryHandler } from '@identity/application/queries/get_user_profile/handler';
import type { UpdateUserProfileCommandHandler } from '@identity/application/commands/update_user_profile/handler';
import type { DeleteUserCommandHandler } from '@identity/application/commands/delete_user/handler';

// 5. Capa de Dominio
import { DomainValidationError } from '@identity/domain/exceptions/user/error';

describe('REST Driver Controller: UserController (US-06 / GDPR Teardown)', () => {
  let getProfileHandler: jest.Mocked<GetUserProfileQueryHandler>;
  let updateProfileHandler: jest.Mocked<UpdateUserProfileCommandHandler>;
  let deleteUserHandler: jest.Mocked<DeleteUserCommandHandler>;
  let controller: UserController;

  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    getProfileHandler = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetUserProfileQueryHandler>;

    updateProfileHandler = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<UpdateUserProfileCommandHandler>;

    deleteUserHandler = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<DeleteUserCommandHandler>;

    controller = new UserController(
      getProfileHandler,
      updateProfileHandler,
      deleteUserHandler
    );

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe('deleteUser (DELETE /api/v1/users/:userId)', () => {
    it('should return 204 No Content when user is successfully deleted', async () => {
      mockReq = {
        params: { userId: 'usr-123' },
        tenantId: 'acme-corp',
      };
      deleteUserHandler.execute.mockResolvedValueOnce(undefined);

      await controller.deleteUser(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(deleteUserHandler.execute).toHaveBeenCalledWith({
        userId: 'usr-123',
        tenantId: 'acme-corp',
      });
      expect(mockRes.status).toHaveBeenCalledWith(204);
      expect(mockRes.send).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when userId is missing', async () => {
      mockReq = {
        params: {},
        tenantId: 'acme-corp',
      };

      await controller.deleteUser(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing userId or tenant context',
      });
      expect(deleteUserHandler.execute).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when tenantId context is missing', async () => {
      mockReq = {
        params: { userId: 'usr-123' },
        tenantId: undefined,
      };

      await controller.deleteUser(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing userId or tenant context',
      });
      expect(deleteUserHandler.execute).not.toHaveBeenCalled();
    });

    it('should return 404 Not Found when user is not found in the given tenant (Anti-Enumeration)', async () => {
      mockReq = {
        params: { userId: 'foreign-usr-999' },
        tenantId: 'acme-corp',
      };
      deleteUserHandler.execute.mockRejectedValueOnce(
        new Error('User not found in tenant acme-corp')
      );

      await controller.deleteUser(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'User not found' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 400 Bad Request when DomainValidationError is thrown', async () => {
      mockReq = {
        params: { userId: 'usr-123' },
        tenantId: 'acme-corp',
      };
      deleteUserHandler.execute.mockRejectedValueOnce(
        new DomainValidationError('Invalid tenant format')
      );

      await controller.deleteUser(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid tenant format',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next(error) when an unhandled server error occurs', async () => {
      mockReq = {
        params: { userId: 'usr-123' },
        tenantId: 'acme-corp',
      };
      const unexpectedError = new Error('Database connection timeout');
      deleteUserHandler.execute.mockRejectedValueOnce(unexpectedError);

      await controller.deleteUser(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(unexpectedError);
    });

    it('should return 501 Not Implemented if deleteUserHandler was not configured', async () => {
      const controllerWithoutDelete = new UserController(
        getProfileHandler,
        updateProfileHandler
      );
      mockReq = {
        params: { userId: 'usr-123' },
        tenantId: 'acme-corp',
      };

      await controllerWithoutDelete.deleteUser(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(501);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Delete user handler not configured',
      });
    });
  });

  describe('getUserById (GET /api/v1/users/:userId)', () => {
    it('should return 200 OK with profile when user exists', async () => {
      mockReq = {
        params: { userId: 'usr-123' },
        tenantId: 'acme-corp',
      };
      const mockProfile = {
        id: 'usr-123',
        email: 'alice@acme.com',
        tenantId: 'acme-corp',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      getProfileHandler.execute.mockResolvedValueOnce(mockProfile);

      await controller.getUserById(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(mockProfile);
    });

    it('should return 404 Not Found when profile handler throws not found', async () => {
      mockReq = {
        params: { userId: 'usr-123' },
        tenantId: 'acme-corp',
      };
      getProfileHandler.execute.mockRejectedValueOnce(
        new Error('User not found in database')
      );

      await controller.getUserById(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'User not found' });
    });
  });

  describe('updateUser (PATCH /api/v1/users/:userId)', () => {
    it('should return 200 OK with updated profile', async () => {
      mockReq = {
        params: { userId: 'usr-123' },
        tenantId: 'acme-corp',
        body: { email: 'alice.updated@acme.com' },
      };
      const updatedProfile = {
        id: 'usr-123',
        email: 'alice.updated@acme.com',
        tenantId: 'acme-corp',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      updateProfileHandler.execute.mockResolvedValueOnce(updatedProfile);

      await controller.updateUser(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(updatedProfile);
    });
  });
});
