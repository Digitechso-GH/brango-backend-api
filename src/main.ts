import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { SuccessResponseInterceptor } from './core/interceptors/success-response.interceptor';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Aumentar el límite del body-parser para permitir la subida de evidencias base64
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));

  // Inyección obligatoria de ConfigService
  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT');
  if (!port) {
    throw new Error('❌ Falta la variable de entorno PORT. Revisa tu .env');
  }

  // Validación estricta global de entrada (DTOs)
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  // Interceptor global para normalizar respuestas exitosas { success: true, data: T }
  app.useGlobalInterceptors(new SuccessResponseInterceptor());

  // Configuración CORS parametrizada desde variables de entorno sin fallbacks hardcodeados
  const rawOrigins = configService.get<string>('CORS_ORIGINS');
  if (!rawOrigins) {
    throw new Error('La variable de entorno CORS_ORIGINS no está configurada.');
  }

  const allowedOrigins = rawOrigins.split(',').map((o) => o.trim());

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Permitir solicitudes sin origen (apps nativas Android/iOS) o en la lista permitida de .env
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error(`Origen ${origin} no permitido por CORS`));
      }
    },
    credentials: true,
  });

  await app.listen(port, "0.0.0.0");
  console.log(`Server running on: http://0.0.0.0:${port}`);
}
void bootstrap();
