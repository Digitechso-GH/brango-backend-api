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
    origin: '*', // En producción se restringe a las variables de entorno allowed origins
    credentials: true,
  },
})
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
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
      // 1. Extraer token JWT del handshake
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];

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
        await client.join(TRACKING_ROOMS.OPERATORS);
        console.log(`Socket conectado (MOCK OPERATOR): ${client.id}`);
        return;
      }

      // 2. Verificar token JWT
      const secret = this.configService.get<string>(
        'JWT_SECRET',
        'super_secret_key_change_me_in_production',
      );
      const payload = await this.jwtService.verifyAsync(token, { secret });

      // 3. Vincular datos del chofer o del operador a la conexión
      client.data.userId = payload.sub;
      client.data.role = payload.rol;

      if (payload.rol === ROLES.SYS_DRIVER) {
        const driver = await this.prisma.driverProfile.findUnique({
          where: { usuarioId: payload.sub },
        });

        if (!driver) {
          client.disconnect();
          return;
        }

        client.data.driverId = driver.id;
        await client.join(TRACKING_ROOMS.DRIVERS);
      } else {
        // Operadores se unen al cuarto para escuchar actualizaciones en tiempo real
        await client.join(TRACKING_ROOMS.OPERATORS);
      }

      console.log(
        `Socket conectado: ${client.id} - Usuario: ${payload.nombre} (Rol: ${payload.rol})`,
      );
    } catch (err) {
      console.log(
        'Error de conexión en Socket.io, desconectando:',
        err.message,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Socket desconectado: ${client.id}`);
  }

  @SubscribeMessage(TRACKING_EVENTS.LOCATION_UPDATE)
  async handleLocationUpdate(
    client: Socket,
    payload: {
      latitud: number;
      longitud: number;
      evento?: string;
      pedidoId?: string;
    },
  ) {
    // Solo los choferes pueden reportar ubicación
    if (client.data.role !== ROLES.SYS_DRIVER || !client.data.driverId) {
      return;
    }

    const { latitud, longitud, evento, pedidoId } = payload;

    // Retransmitir en tiempo real a los operadores
    this.server
      .to(TRACKING_ROOMS.OPERATORS)
      .emit(TRACKING_EVENTS.DRIVER_LOCATION, {
        driverId: client.data.driverId,
        latitud,
        longitud,
        evento: evento || LOCATION_EVENTS.INTERVAL_30_SEC,
        pedidoId,
        updatedAt: new Date(),
      });

    // Registrar en base de datos aplicando la lógica de persistencia controlada (throttling)
    await this.trackingService.recordSnapshot(
      client.data.driverId,
      latitud,
      longitud,
      evento || LOCATION_EVENTS.INTERVAL_30_SEC,
      pedidoId,
    );
  }
}
