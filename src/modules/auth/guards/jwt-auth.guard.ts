import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<any>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Token de autenticación ausente');
    }

    try {
      const secret = this.configService.get<string>(
        'JWT_SECRET',
        'super_secret_key_change_me_in_production',
      );
      const payload: any = await this.jwtService.verifyAsync(token, { secret });

      // Garantizar que req.user siempre contenga driverId y tenantId
      if (payload.role === 'SYS_DRIVER' && !payload.driverId) {
        const profile = await this.prisma.driverProfile.findUnique({
          where: { userId: payload.sub },
          select: { id: true, tenantId: true },
        });
        if (profile) {
          payload.driverId = profile.id;
          if (!payload.tenantId && profile.tenantId) {
            payload.tenantId = profile.tenantId;
          }
        }
      }

      // Verificar en tiempo real que el usuario esté activo y su empresa no esté suspendida
      if (payload.role !== 'SYS_SUPERADMIN') {
        const dbUser = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: {
            active: true,
            tenantId: true,
            tenant: { select: { status: true } },
          },
        });
        if (!dbUser || !dbUser.active) {
          throw new UnauthorizedException('Cuenta desactivada');
        }
        if (dbUser.tenant?.status === 'SUSPENDED') {
          throw new UnauthorizedException('Empresa suspendida');
        }
        if (payload.tenantId === undefined) {
          payload.tenantId = dbUser.tenantId;
        }
      }

      // Adjuntamos el usuario decodificado a la request
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException(
        'Token de autenticación inválido o expirado',
      );
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
