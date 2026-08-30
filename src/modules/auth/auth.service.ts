import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { ROLES } from '../users/users.constants';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async validateUser(loginDto: LoginDto) {
    const cleanEmail = (loginDto.email || '').toLowerCase().trim();
    const cleanPassword = (loginDto.password || '').trim();

    const user = await this.usersService.findByEmail(cleanEmail);
    if (!user) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const isPasswordValid = await bcrypt.compare(
      cleanPassword,
      user.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    return user;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      rol: user.role.code,
    };

    const secret = this.configService.get<string>('JWT_SECRET', 'super_secret_key_change_me_in_production');
    // Generar access token de 7 días y refresh token de 30 días
    const token = this.jwtService.sign(payload, { secret, expiresIn: '7d' });
    const refreshToken = this.jwtService.sign({ sub: user.id }, { secret, expiresIn: '30d' });

    let driverId = undefined;
    let unit = undefined;

    if (user.role.code === ROLES.SYS_DRIVER) {
      const fullUser = await this.usersService.findById(user.id);
      if (fullUser?.driver) {
        driverId = fullUser.driver.id;
        unit = fullUser.driver.unit;
      }
    }

    return {
      token,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        rol: user.role.code,
        driverId,
        unit,
      },
    };
  }

  async refresh(refreshToken: string) {
    try {
      const secret = this.configService.get<string>('JWT_SECRET', 'super_secret_key_change_me_in_production');
      const payload = await this.jwtService.verifyAsync(refreshToken, { secret });

      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('Usuario no encontrado');
      }

      return this.login(user);
    } catch {
      throw new UnauthorizedException('Token de refresco inválido o expirado');
    }
  }
}
