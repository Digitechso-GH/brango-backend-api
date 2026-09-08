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

      // Garantizar que req.user siempre contenga driverId para choferes
      if (payload.role === 'SYS_DRIVER' && !payload.driverId) {
        const profile = await this.prisma.driverProfile.findUnique({
          where: { userId: payload.sub },
          select: { id: true },
        });
        if (profile) {
          payload.driverId = profile.id;
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
