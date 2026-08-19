<div align="center">
  <h1>⚙️ Bran Go - Backend Core API</h1>
  <p><strong>Motor de Reglas de Negocio, APIs REST y Gateway WebSocket</strong></p>
</div>

## 📌 Descripción

El Backend de **Bran Go** es el cerebro de la operación. Construido sobre una arquitectura escalable, maneja la persistencia de datos relacionales, la autenticación, la asignación de pedidos y coordina en tiempo real el rastreo GPS (telemetría) enviada por los dispositivos móviles hacia la Torre de Control.

## 🛠 Stack Tecnológico

- **Framework**: [NestJS](https://nestjs.com/)
- **Lenguaje**: TypeScript
- **ORM**: [Prisma](https://www.prisma.io/)
- **Base de Datos**: PostgreSQL
- **WebSockets**: [Socket.io](https://socket.io/) (Gateways de NestJS)
- **Autenticación**: JWT (JSON Web Tokens)
- **Validación**: Class-Validator y Class-Transformer

## 🚀 Requisitos Previos

- Node.js (v20 o superior)
- PostgreSQL (Instalado localmente o vía Docker)
- Prisma CLI

## ⚙️ Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Cadena de conexión a PostgreSQL
DATABASE_URL="postgresql://usuario:password@localhost:5432/brango_db?schema=public"

# Configuración del servidor
PORT=3001

# Secreto para firmar tokens JWT
JWT_SECRET=tu_jwt_secret_super_seguro
```

## 💻 Instalación y Uso Local

1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Generar el cliente de Prisma e instanciar la base de datos:
   ```bash
   npx prisma generate
   npx prisma db push
   # Si existen seeders: npx prisma db seed
   ```
3. Iniciar el servidor de desarrollo:
   ```bash
   npm run start:dev
   ```
El backend estará disponible por defecto en http://localhost:3001.

## 📡 WebSockets (Rastreo GPS)

El backend expone un Gateway de Socket.io para la telemetría en tiempo real:
- **Evento Input**: `driver:location` (El móvil envía ping GPS con LAT/LNG cada pocos segundos).
- **Evento Output**: `operator:location-update` (La torre de control escucha y actualiza los marcadores en el mapa).
- **Rooms**: La sala de operadores se maneja mediante autenticación JWT conectada al Socket.

## 🚢 Despliegue (CI/CD)

El backend también cuenta con un pipeline de GitHub Actions que:
1. Construye la imagen Docker.
2. Aplica migraciones de Prisma en el proceso de build.
3. Pushea la imagen a GHCR usando el SHA del commit.
4. Despliega en el VPS por SSH recargando el `docker-compose.yml`.
