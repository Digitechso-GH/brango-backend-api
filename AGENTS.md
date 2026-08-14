# ⚙️ Reglas de Agente para Backend (Bran Go Backend)

> **REGLA OBLIGATORIA DE RAÍZ**: Antes de cualquier cambio, consulta el archivo principal [`AGENTS.md`](file:///c:/Users/Juan/Desktop/Front/BranGo/AGENTS.md) en la raíz del proyecto y el documento de arquitectura backend [`docs/05-backend.md`](file:///c:/Users/Juan/Desktop/Front/BranGo/docs/05-backend.md).

## Reglas Estrictas para Backend:
1. **Idioma del Código**: Todo el código (variables, funciones, servicios, controladores, DTOs, entidades de Prisma) DEBE estar escrito en **Inglés**.
   - Queda prohibido el uso de términos en español como `chofer`, `usuarioId`, `origenLat`, `origenLng`, `latitud`, `longitud`, `posicionCola`.
   - Utilizar `@map` en Prisma para mapear columnas heredadas a propiedades puramente en inglés.
2. **CERO PARCHES en Serialización**: Ningún controlador o pasarela de WebSockets devolverá objetos Prisma crudos. Todo dato de salida debe estar serializado estrictamente con DTOs de respuesta (`OrderResponseDto`, `DriverResponseDto`, `DriverLocationDto`).
3. **Autorización y Roles**:
   - Autenticación estricta con JWT y Guards.
   - Todo endpoint administrativo y operativo debe usar `@UseGuards(JwtAuthGuard, RolesGuard)` y `@Roles(...)`.
   - El JWT es la única fuente de verdad de identidad y rol. Nunca extraer `driverId` o el rol del cuerpo de peticiones o payloads de sockets.
4. **WebSocket Rooms**:
   - `operator:live`: Room para operadores/admins.
   - `driver:{driverId}`: Room por chofer.
   - `order:{orderId}`: Room para el pedido activo.
   - Tras desconexión, la reconexión debe re-unir automáticamente al cliente a su room correspondiente en `handleConnection`.
5. **Endpoint de Reordenamiento**:
   - `PATCH /orders/reorder` debe validar que todos los pedidos pertenezcan al chofer autenticado (según JWT) y ejecutarse de manera atómica con `$transaction` en Prisma.

