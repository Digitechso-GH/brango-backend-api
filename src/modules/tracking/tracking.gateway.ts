import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { ROLES } from '../users/users.constants';
import {
  TRACKING_ROOMS,
  TRACKING_EVENTS,
  LOCATION_EVENTS,
} from './tracking.constants';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TrackingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly trackingService: TrackingService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;

      if (!token) {
        client.disconnect();
        return;
      }

      const mockToken = this.configService.get<string>(
        'DEV_MOCK_OPERATOR_TOKEN',
        'operator-mock-token',
      );
      if (token === mockToken) {
        client.data.role = ROLES.SYS_OPERATOR;
        await client.join(TRACKING_ROOMS.OPERATOR_LIVE);
        this.logger.log(`Socket conectado (MOCK OPERATOR): ${client.id}`);
        return;
      }

      const secret = this.configService.get<string>(
        'JWT_SECRET',
        'super_secret_key_change_me_in_production',
      );
      const payload = await this.jwtService.verifyAsync(token, { secret });

      client.data.userId = payload.sub;
      client.data.role = payload.rol;

      if (payload.rol === ROLES.SYS_DRIVER) {
        const driver = await this.prisma.driverProfile.findUnique({
          where: { userId: payload.sub },
        });

        if (driver) {
          client.data.driverId = driver.id;
          await client.join(`driver:${driver.id}`);
          this.logger.log(`Driver socket conectado y asignado a driver:${driver.id}`);
        } else {
          this.logger.warn(`Conexión con rol SYS_DRIVER pero sin perfil de conductor para userId ${payload.sub}`);
          client.disconnect();
          return;
        }
      } else if (payload.rol === ROLES.SYS_ADMIN || payload.rol === ROLES.SYS_OPERATOR) {
        await client.join(TRACKING_ROOMS.OPERATOR_LIVE);
      }

      if (payload.rol === ROLES.SYS_DRIVER) {
        this.logger.log(
          `Socket conectado (DRIVER): ${client.id} - Usuario: ${payload.name} (DriverID: ${client.data.driverId})`,
        );
      } else {
        this.logger.log(
          `Socket conectado (STAFF): ${client.id} - Usuario: ${payload.name} (Rol: ${payload.rol})`,
        );
      }
    } catch (err: any) {
      this.logger.log('Error de conexión en Socket.io, desconectando:', err.message);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket desconectado: ${client.id}`);
  }

  @SubscribeMessage(TRACKING_EVENTS.LOCATION_UPDATE)
  @SubscribeMessage('chofer:ubicacion:actualizar')
  async handleLocationUpdate(
    client: Socket,
    payload: {
      latitude: number;
      longitude: number;
      event?: string;
      routeAssignmentId?: string;
      // Compatibilidad con payload antiguo:
      latitud?: number;
      longitud?: number;
      evento?: string;
      pedidoId?: string;
    },
  ) {
    // Si se recibe el evento legacy de compatibilidad, loggear warning de deprecación (14 días de gracia)
    const isLegacyEvent = !payload.latitude && payload.latitud;
    if (isLegacyEvent) {
      this.logger.warn(
        `Legacy event/properties received from socket ${client.id}. Notice: support for these legacy events and properties will be deprecated after 14 consecutive days of inactivity.`,
      );
    }

    const driverId = client.data.driverId;
    if (!driverId) {
      this.logger.warn(`Intento de enviar ubicación sin driverId válido para socket: ${client.id}`);
      return;
    }

    const latitude = payload.latitude;
    const longitude = payload.longitude;
    const event = payload.event;
    const routeAssignmentId = payload.routeAssignmentId;

    if (!latitude || !longitude) {
      this.logger.warn(`Coordenadas inválidas recibidas en actualización de ubicación de socket: ${client.id}`);
      return;
    }

    let orderId: string | null = null;
    if (routeAssignmentId) {
      const assignment = await this.prisma.routeAssignment.findUnique({
        where: { id: routeAssignmentId },
        select: { orderId: true },
      });
      if (assignment) {
        orderId = assignment.orderId;
      }
    }

    const locationData = {
      driverId,
      latitude,
      longitude,
      event: event || LOCATION_EVENTS.INTERVAL_30_SEC,
      routeAssignmentId: routeAssignmentId || null,
      updatedAt: new Date(),
    };

    // Retransmitir a salas de operadores y ordenes
    this.server.to(TRACKING_ROOMS.OPERATOR_LIVE).emit(TRACKING_EVENTS.DRIVER_LOCATION, locationData);
    if (orderId) {
      this.server.to(`order:${orderId}`).emit(TRACKING_EVENTS.DRIVER_LOCATION, locationData);
    }

    // Persistir el snapshot
    await this.trackingService.recordSnapshot(
      driverId,
      latitude,
      longitude,
      event || LOCATION_EVENTS.INTERVAL_30_SEC,
      routeAssignmentId,
    );
  }

  notifyOrderAssigned(driverId: string, orderId: string) {
    if (this.server) {
      this.server.to(`driver:${driverId}`).emit('order_assigned', {
        driverId,
        orderId,
        timestamp: new Date(),
      });
    }
  }
}
