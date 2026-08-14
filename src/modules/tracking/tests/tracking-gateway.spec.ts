import { Test, TestingModule } from '@nestjs/testing';
import { TrackingGateway } from '../tracking.gateway';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackingService } from '../tracking.service';
import { ROLES } from '../../users/users.constants';

describe('TrackingGateway Connection Handling', () => {
  let gateway: TrackingGateway;
  let jwtService: any;
  let configService: any;
  let prismaService: any;

  beforeEach(async () => {
    jwtService = {
      verifyAsync: jest.fn(),
    };

    configService = {
      get: jest.fn().mockImplementation((key, defaultVal) => {
        if (key === 'JWT_SECRET') return 'secret';
        return defaultVal;
      }),
    };

    prismaService = {
      driverProfile: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prismaService },
        { provide: TrackingService, useValue: {} },
      ],
    }).compile();

    gateway = module.get<TrackingGateway>(TrackingGateway);
  });

  it('should correctly resolve driverId from userId via driverProfile.findUnique on handleConnection', async () => {
    const mockSocket: any = {
      handshake: {
        auth: {
          token: 'driver-jwt-token',
        },
      },
      data: {},
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };

    // Payload simulado decodificado del JWT
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-driver-123',
      rol: ROLES.SYS_DRIVER,
      name: 'Chofer de Prueba',
    });

    // Perfil del chofer resuelto en DB
    prismaService.driverProfile.findUnique.mockResolvedValue({
      id: 'driver-789',
      userId: 'user-driver-123',
      unit: 'Unidad 05',
    });

    await gateway.handleConnection(mockSocket);

    // Verificaciones:
    // 1. Debe haber consultado a la base de datos por el userId (sub) del JWT decodificado
    expect(prismaService.driverProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-driver-123' },
    });

    // 2. Debe haber guardado el driverId real de la base de datos en los datos de la sesión del socket
    expect(mockSocket.data.driverId).toBe('driver-789');

    // 3. Debe haber unido al socket a la sala del conductor
    expect(mockSocket.join).toHaveBeenCalledWith('driver:driver-789');

    // 4. No debe haberse desconectado
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
  });
});
