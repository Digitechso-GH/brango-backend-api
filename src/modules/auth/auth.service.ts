import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
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
      nombre: user.nombre,
      rol: user.rol.code,
    };

    let driverId = undefined;
    let unidad = undefined;

    if (user.rol.code === 'SYS_DRIVER') {
      const fullUser = await this.usersService.findById(user.id);
      if (fullUser?.chofer) {
        driverId = fullUser.chofer.id;
        unidad = fullUser.chofer.unidad;
      }
    }

    return {
      token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol.code,
        driverId,
        unidad,
      },
    };
  }
}
