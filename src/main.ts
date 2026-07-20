import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { SuccessResponseInterceptor } from './core/interceptors/success-response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Inyección obligatoria de ConfigService
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 3001;

  // Validación estricta global de entrada (DTOs)
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  // Interceptor global para normalizar respuestas exitosas { success: true, data: T }
  app.useGlobalInterceptors(new SuccessResponseInterceptor());

  // Configuración CORS restringida y parametrizada
  const rawOrigins = configService.get<string>('CORS_ORIGINS');
  const allowedOrigins = rawOrigins ? rawOrigins.split(',') : ['http://localhost:3000'];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  await app.listen(port);
  console.log(`Server running on: http://localhost:${port}`);
}
bootstrap();
