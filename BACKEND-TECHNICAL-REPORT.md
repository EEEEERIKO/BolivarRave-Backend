# Informe técnico del backend — UNAC Bolívar

## 1. Resumen ejecutivo

El backend es una API HTTP para la gestión académica y operativa del edificio Bolívar Rave de la UNAC. Atiende autenticación, horarios, aulas, reservas, auditorio, personal, inventario, tareas, registro de asistencia, operaciones y objetos perdidos.

La aplicación está construida con:

- Node.js y TypeScript 5 en modo estricto.
- Express 5 para la API HTTP.
- PostgreSQL, normalmente administrado mediante Supabase.
- Prisma 7 con el adaptador `@prisma/adapter-pg`.
- SQL directo para una parte importante del dominio y de las migraciones.
- JWT para tokens de acceso y refresh tokens persistidos para renovar sesiones.
- Socket.IO para eventos de actualización de horarios.
- Resend para correos transaccionales.
- Helmet, CORS y `express-rate-limit` como controles HTTP básicos.
- Render como despliegue principal del backend; existe además configuración alternativa para Railway.

El backend se despliega separado del frontend. En desarrollo suele ejecutarse en `http://localhost:4000`; el frontend local lo consume mediante proxies de Next.js. En producción, el frontend de Vercel consume el backend desplegado y sus logs deben revisarse en el proveedor correspondiente.

## 2. Estructura del proyecto

```text
backend/
├── src/
│   ├── server.ts                 Servidor HTTP, middleware y montaje de rutas
│   ├── lib/
│   │   ├── auth.ts               JWT, refresh tokens y autorización por rol
│   │   ├── prisma.ts             Cliente Prisma con adaptador PostgreSQL
│   │   ├── resend.ts             Cliente singleton de Resend
│   │   └── websocket.ts          Socket.IO y eventos de horarios
│   └── modules/
│       ├── schedules/            Horarios, importaciones y aulas
│       ├── auditorio/            Solicitudes y reservas del auditorio
│       ├── reservas/             Reservas de salas, equipos y televisores
│       ├── staff/                Personal, usuarios, jornadas y pausas
│       ├── inventory/            Grupos y elementos de inventario
│       ├── tasks/                Catálogo, asignaciones y seguimiento
│       ├── registro/             Asistencia, entradas y salidas
│       ├── operations/           Tablero operativo
│       └── lost-found/           Objetos perdidos
├── prisma/
│   ├── schema.prisma             Modelos Prisma declarados
│   ├── migrations/               Migraciones Prisma
│   ├── sql/                      Migraciones SQL y esquema complementario
│   └── scripts/                  Utilidades de base de datos
├── render.yaml                   Configuración de despliegue en Render
├── railway.json                  Configuración alternativa de Railway
└── package.json                  Scripts y dependencias
```

La aplicación sigue una separación por dominio: cada módulo normalmente contiene `routes.ts` para HTTP y `service.ts` para la lógica de negocio. Los correos tienen archivos separados en los módulos que los utilizan.

## 3. Arranque y ciclo de una petición

El punto de entrada es `src/server.ts`.

```text
Cliente / frontend
        ↓
HTTP o WebSocket
        ↓
Helmet + CORS + rate limit + JSON parser
        ↓
Puerta de autenticación global para /api
        ↓
Middleware de rol o clave administrativa
        ↓
Router del módulo
        ↓
Service y acceso a PostgreSQL
        ↓
Respuesta JSON / evento Socket.IO / correo
```

El servidor crea un `http.Server`, monta Express y comparte ese servidor con Socket.IO. El puerto se toma de `PORT` y por defecto es `4000`.

Endpoints técnicos principales:

- `GET /api/health`: comprueba que el proceso HTTP está activo.
- `GET /api/ws-status`: estado del WebSocket en entornos de desarrollo.
- `GET /api/...`: endpoints de consulta.
- `POST`, `PUT`, `PATCH`, `DELETE /api/...`: operaciones de creación, edición y ciclo de vida.

El endpoint de salud actual no comprueba la conexión a la base de datos, Resend ni el estado de los módulos. Por tanto, una respuesta 200 significa que el proceso está levantado, no necesariamente que todo el sistema esté operativo.

## 4. Middleware, CORS y errores

Antes de las rutas se configuran:

- `helmet()` para cabeceras de seguridad.
- CORS con credenciales y una lista explícita de orígenes locales y de producción.
- `express-rate-limit` para limitar peticiones por ventana de tiempo.
- `express.json({ limit: "10mb" })` para solicitudes JSON grandes, necesarias para algunos procesos de importación.
- Manejador centralizado de errores.

La política CORS permite los frontends locales y el frontend publicado en Vercel, además de los valores de `CORS_ORIGINS`. En producción conviene mantener esta lista cerrada y revisar cualquier origen agregado por variables de entorno.

El manejador global distingue, entre otros casos, errores de CORS y payloads demasiado grandes. En desarrollo puede devolver detalles técnicos; en producción devuelve mensajes generales para no filtrar información interna.

Actualmente no existe un middleware de logging estructurado por petición. La mayoría de los mensajes se escriben con `console.log` o `console.error` desde los módulos. Esto explica por qué una petición que llega a otro despliegue, o que falla antes de llegar a una ruta concreta, puede no aparecer en la terminal local.

## 5. Autenticación y autorización

`src/lib/auth.ts` gestiona la autenticación.

### Token de acceso

El login del personal genera un JWT firmado con:

- Identificador del personal.
- Cédula.
- Rol normalizado.
- Etiqueta del rol.
- Nombre.
- Emisor y audiencia configurados.
- Tiempo de expiración configurable, normalmente corto.

El cliente debe enviarlo así:

```http
Authorization: Bearer <accessToken>
```

`requireAuthToken` valida firma, emisor, audiencia, expiración y payload. Los roles reconocidos son:

```text
admin
monitor
colaborador
registro
```

También existe una consideración especial para monitores con permisos de registro.

### Refresh tokens

Los refresh tokens se almacenan en el sistema para permitir rotación, revocación y cierre de sesiones. Las operaciones principales incluyen crear, renovar, revocar uno y revocar todos. Las credenciales se validan con hash de contraseña basado en `scrypt` y comparación resistente a temporización.

### Middleware de permisos

El servidor usa middlewares como:

- `requireAdminRole`.
- `requireAdminOrMonitorRole`.
- `requireAdminOrRegistroRole`.
- `requireAdminOrMonitorOrRegistroRole`.

La restricción de permisos no depende únicamente del frontend. Aunque el frontend oculte opciones de menú, el backend vuelve a validar el rol antes de ejecutar cada operación sensible.

### Excepciones públicas

La puerta global permite sin JWT algunos endpoints necesarios para el funcionamiento público:

- salud y estado técnico;
- login, refresh y logout;
- horarios públicos definidos por el sistema;
- `GET /api/reservas/:id/confirm` para enlaces de correo;
- `POST /api/auditorio/public/reservas` para solicitudes de personas sin cuenta.

La lista de rutas públicas debe revisarse con cuidado cada vez que se agregue un endpoint nuevo.

## 6. Base de datos y persistencia

La base de datos es PostgreSQL. La conexión se obtiene de `DIRECT_URL` o `DATABASE_URL`, dependiendo del componente que la utilice. En el despliegue habitual se conecta a Supabase.

### Prisma

Prisma se inicializa con `PrismaPg` y un pool PostgreSQL. El proceso de build ejecuta `prisma generate` y el cliente se importa desde `@prisma/client`.

El archivo `prisma/schema.prisma` declara modelos como facultades, salones, tipos de reserva, eventos, horarios e inventario. No todo el dominio está expresado allí: varias tablas de personal, solicitudes, tareas y reservas se consultan mediante SQL directo.

### SQL directo

Los servicios usan SQL parametrizado y funciones auxiliares para consultar o modificar partes del esquema que no están completamente representadas en Prisma. Las migraciones SQL cubren, entre otros componentes:

- auditorio;
- personal y roles;
- jornadas y pausas;
- tareas y asignaciones;
- solicitudes de horarios;
- solicitudes de auditorio;
- reservas y tokens de confirmación;
- historial de acciones sobre salones;
- refresh tokens;
- políticas RLS e índices.

El proyecto incluye PostgreSQL avanzado, como `btree_gist`, índices y triggers. La documentación de `prisma/sql/README.md` describe una secuencia de migraciones SQL consolidada.

### Riesgo de gobernanza

El uso combinado de Prisma y SQL directo es válido, pero exige una única política de migraciones. Si se modifica una tabla solo en SQL y no se actualiza el esquema Prisma, o al contrario, pueden aparecer diferencias entre entornos. TI debería mantener un inventario de tablas, propietario de cada migración y procedimiento de rollback.

## 7. Módulos funcionales

### Horarios — `/api/schedules`

Gestiona eventos académicos, franjas horarias, solicitudes de cambio, salones, estados de aula e importaciones.

Funciones principales:

- crear, actualizar y eliminar eventos;
- importar horarios parseados o archivos;
- consultar historial de importaciones;
- revisar y resolver solicitudes de horario;
- consultar disponibilidad de salones;
- registrar acciones sobre aulas, daños, limpieza y asignaciones visuales;
- publicar cambios mediante Socket.IO.

Las importaciones pueden recibir archivos y procesar información de Excel. Las operaciones administrativas requieren permisos elevados.

### Auditorio — `/api/auditorio`

Gestiona el flujo de reservas del auditorio:

- listado administrativo;
- calendario y notificaciones de próximas actividades;
- solicitudes públicas sin cuenta;
- creación y edición de reservas;
- aprobación, rechazo y eliminación;
- asignación de encargados;
- exportación a Excel.

El flujo público crea una solicitud pendiente y una reserva pendiente. Después de registrarla, el servicio intenta enviar un correo de solicitud creada mediante Resend. Los cambios posteriores de estado generan correos de confirmación o rechazo al solicitante.

El envío de correo ocurre después de completar la operación de base de datos. Esto permite conservar la solicitud aunque el proveedor de correo falle; por ello debe existir monitoreo o reintento para detectar entregas pendientes.

### Reservas — `/api/reservas`

Gestiona reservas de salones, equipos y televisores, además del proceso de confirmación por correo.

Incluye:

- creación de reservas;
- consulta de reservas propias y administrativas;
- candidatos de televisores/equipos;
- confirmación pública mediante token;
- devolución y cierre;
- cancelación;
- reporte de daños o incidencias;
- gestión de elementos desplazados.

El endpoint de confirmación se expone para que el enlace del correo funcione sin sesión. La lógica de autorización del resto de operaciones se mantiene en el backend.

### Personal — `/api/staff`

Concentra autenticación y administración de colaboradores:

- login, refresh, logout y cambio de contraseña;
- alta, edición y consulta de personal;
- roles y permisos operativos;
- jornadas semanales;
- bloques de horario y pausas;
- balances y actividades;
- datos contractuales y estados de operación.

Las jornadas se almacenan por día y sus pausas se relacionan con el bloque correspondiente. El backend debe recibir siempre el día explícito para evitar aplicar accidentalmente un cambio a todos los días.

### Inventario — `/api/inventory`

Administra grupos y elementos de inventario, disponibilidad, ubicación y estados defectuosos. Este módulo es utilizado por el flujo de reservas de equipos y televisores.

### Tareas — `/api/tasks`

Gestiona catálogo de tareas, espacios, habilidades, instancias, asignaciones, revisión y estados del flujo de trabajo. Además del rol, algunas operaciones de catálogo requieren la cabecera de clave administrativa configurada en `ADMIN_API_KEY`.

### Registro — `/api/registro`

Gestiona previsualización, entrada, salida, tablero de asistencia y reportes. Sus permisos se limitan a administración y perfiles de registro según la operación.

### Operaciones — `/api/operaciones`

Construye el tablero operativo combinando personal, aulas, préstamos y tareas. El acceso está protegido para perfiles administrativos y de monitor.

### Objetos perdidos — `/api/objetos-perdidos`

Ofrece operaciones para registrar objetos, consultar el listado, actualizar su estado y obtener estadísticas.

## 8. Correos transaccionales

`src/lib/resend.ts` crea un cliente singleton de Resend cuando existe `RESEND_API_KEY`. Los módulos de auditorio y reservas preparan plantillas HTML y llaman al proveedor desde sus servicios o archivos `email.ts`.

Flujos principales:

```text
Solicitud pública de auditorio
        ↓
Guardar solicitud y reserva pendiente
        ↓
Enviar correo de solicitud registrada
        ↓
Administración aprueba o rechaza
        ↓
Enviar correo de confirmación o rechazo
```

```text
Reserva de recurso
        ↓
Guardar reserva y token
        ↓
Enviar enlace de términos/confirmación
        ↓
Usuario confirma mediante endpoint público
```

El resultado HTTP de una petición y la entrega final de un correo son eventos distintos. Un `201` confirma que la solicitud fue almacenada; no garantiza que el mensaje haya llegado a la bandeja del destinatario. Para operación real se recomienda guardar el `messageId` de Resend, estado del envío, fecha del último intento y error del proveedor.

## 9. WebSocket y tiempo real

`src/lib/websocket.ts` inicializa Socket.IO sobre el mismo servidor HTTP.

El cliente se suscribe al canal lógico `schedules`. El servidor puede emitir:

- `schedule:refresh` para solicitar una recarga;
- `schedule:changed` para informar cambios concretos.

Los cambios se producen después de operaciones de horarios y permiten que varias pantallas se actualicen sin esperar a una recarga manual. El WebSocket no reemplaza las consultas HTTP iniciales.

La configuración acepta polling y WebSocket, con validación de origen. La suscripción visible en el código no muestra un handshake JWT equivalente al de la API; si se requiriera confidencialidad por usuario o datos sensibles en nuevos canales, debería agregarse autenticación del socket y autorización por sala.

## 10. Variables de entorno

Las variables se documentan en `.env.example`. Las más importantes son:

```env
PORT=4000
NODE_ENV=development
DATABASE_URL=...
DIRECT_URL=...
AUTH_JWT_SECRET=...
ACCESS_TOKEN_EXPIRES_IN=...
REFRESH_TOKEN_EXPIRES_IN=...
CORS_ORIGINS=...
RESEND_API_KEY=...
RESEND_FROM=...
ADMIN_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Los valores reales, especialmente contraseñas, claves JWT, claves de Resend y claves de Supabase, nunca deben documentarse en el repositorio ni enviarse al frontend. No se incluyen aquí los valores del `.env` local.

En producción es obligatorio configurar como mínimo una clave JWT segura y la clave administrativa. Si falta la configuración crítica, el proceso debe fallar al arrancar en lugar de usar valores de desarrollo.

## 11. Despliegue y ambientes

### Desarrollo local

```bash
cd backend
npm install
npm run dev
```

El servidor escucha normalmente en `http://localhost:4000`.

Comprobación básica:

```bash
curl -i http://localhost:4000/api/health
```

Para probar el flujo completo también debe estar activo el frontend en `http://localhost:3000` y su variable de API debe apuntar al backend local.

### Build y ejecución de producción

```bash
npm run build
npm run start
```

El build genera JavaScript compilado en `dist/`. El script de build ejecuta previamente `prisma generate`.

### Render

`render.yaml` define un servicio web Node que instala dependencias, ejecuta el build y arranca `node dist/server.js`. Tiene despliegue automático habilitado y utiliza Node 22.

El frontend de Vercel y el backend de Render son despliegues independientes. Modificar un archivo local no modifica ninguno de los dos hasta que se haga commit, push y despliegue. Los logs de una petición que sale desde `https://administracion-bolivar-rave.vercel.app` deben buscarse en Vercel y Render, no en el proceso local de `localhost:4000`.

## 12. Scripts disponibles

```bash
npm run dev          # servidor con recarga mediante tsx watch
npm run build        # genera Prisma y compila TypeScript
npm run start        # ejecuta dist/server.js
npm run prisma:generate
npm run db:migrate   # migraciones Prisma
npm run db:push      # sincronización directa del esquema Prisma
```

Las migraciones SQL adicionales deben ejecutarse según la secuencia descrita en `prisma/sql/README.md`. `db:push` no debe utilizarse como sustituto de una estrategia de migraciones controlada en producción.

## 13. Calidad, seguridad y deuda técnica

Fortalezas actuales:

- TypeScript estricto con comprobaciones adicionales de acceso a índices y propiedades opcionales.
- Validación de JWT, roles, expiración, emisor y audiencia.
- Hash de contraseñas con `scrypt`.
- Refresh tokens revocables.
- Helmet, CORS y rate limiting.
- Separación de lógica por módulos.
- Uso de RLS, índices y constraints en las migraciones SQL.
- Errores internos ocultos en producción.

Riesgos y áreas de mejora:

- No hay logging estructurado ni identificador de correlación para seguir una petición entre frontend, backend, base de datos y correo.
- No existe un health check que valide base de datos, Resend y dependencias críticas.
- La coexistencia de Prisma y SQL directo puede generar drift de esquema.
- El estado de los correos no parece tener una cola durable ni una tabla de entregas/reintentos centralizada.
- La respuesta de errores puede perder contexto operativo al mostrar solo un mensaje genérico en producción.
- El estado de WebSocket debe revisarse si se publican datos privados o se agregan nuevos canales.
- Algunos servicios usan SQL dinámico; debe conservarse una lista cerrada de identificadores permitidos y mantener los valores siempre parametrizados.
- Las rutas públicas deben auditarse periódicamente porque la autorización global depende de coincidencias de path.
- La lógica de dominios grandes puede beneficiarse de validadores Zod compartidos, DTOs y pruebas de servicio.

## 14. Recomendaciones para TI

1. Añadir un logger estructurado con fecha, método, ruta, status, duración, usuario, `requestId` y nombre de servicio.
2. Propagar `requestId` desde el frontend o generarlo en el primer proxy; incluirlo en todos los logs y en los envíos de correo.
3. Implementar `/api/health/live` y `/api/health/ready`, donde readiness compruebe PostgreSQL y dependencias críticas.
4. Registrar cada intento de correo con destinatario anonimizado, tipo de mensaje, proveedor, `messageId`, estado y error.
5. Implementar reintentos controlados o una cola/outbox para correos importantes, especialmente solicitud creada, aprobación y rechazo.
6. Definir una única autoridad de migraciones: Prisma, SQL versionado o una política híbrida documentada y automatizada.
7. Ejecutar migraciones en CI/CD y evitar `db:push` en producción.
8. Añadir pruebas de integración para login, refresh, permisos, solicitud pública, aprobación/rechazo y confirmación de reservas.
9. Añadir pruebas de concurrencia para evitar doble reserva, solapamientos y asignación simultánea de inventario.
10. Auditar las rutas públicas y usar una matriz de permisos por módulo y rol.
11. Configurar alertas para errores 5xx, latencia, caída del backend, desconexiones de Socket.IO y fallos de Resend.
12. Mantener secretos únicamente en el gestor de variables del entorno de despliegue y rotarlos periódicamente.
13. Documentar para cada ambiente la URL del frontend, URL del backend, base de datos, remitente de correo y versión desplegada.

## 15. Diagnóstico operativo rápido

### Petición no aparece en los logs locales

Comprobar primero la URL visible en el navegador. Si comienza por `https://administracion-bolivar-rave.vercel.app`, la petición pasa por Vercel y normalmente llega a Render. El proceso local no participa.

```bash
curl -i http://localhost:4000/api/health
```

Después comprobar:

- logs de funciones/proxy en Vercel;
- logs del servicio backend en Render;
- variables de entorno del despliegue;
- origen CORS;
- estado y URL de PostgreSQL;
- configuración de Resend y dominio remitente.

### La solicitud se guarda, pero no llega el correo

Separar el diagnóstico en tres pasos:

```text
1. ¿La ruta recibió la petición?
2. ¿La transacción creó la solicitud?
3. ¿Resend aceptó y entregó el mensaje?
```

Un registro en la base de datos demuestra únicamente el paso 2. Para comprobar el paso 3 hacen falta logs del proveedor, `messageId`, dominio remitente verificado y revisión de spam/bounces.

### El backend no arranca

Revisar `NODE_ENV`, `AUTH_JWT_SECRET`, `DATABASE_URL`/`DIRECT_URL`, el puerto asignado por la plataforma y la ejecución de `npm run build`. En producción no deben activarse secretos de desarrollo ni valores por defecto.

## 16. Resumen para transferencia a TI

El backend es una API modular Express/TypeScript desplegada de forma independiente al frontend. Su fuente de verdad es PostgreSQL/Supabase; Prisma cubre parte del modelo y varios módulos utilizan SQL directo versionado. La autenticación utiliza JWT y refresh tokens, con autorización por roles en el servidor. Los correos son enviados por Resend desde los módulos de auditorio y reservas, y los cambios de horarios se notifican por Socket.IO.

Para operar el sistema con trazabilidad, las prioridades son logging estructurado con correlación, health checks reales, observabilidad de correos, pruebas de integración y una gobernanza única de migraciones. Estos puntos son especialmente importantes porque una solicitud puede registrarse correctamente aunque su correo falle, y porque producción (Vercel/Render) no comparte la consola local.
