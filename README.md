# Blue FEV001

Aplicacion web de chatbot para orientacion vocacional con enfoque conversacional. El asistente empieza como un amigo cercano, conoce al usuario con naturalidad y despues conecta la charla con intereses, habilidades, estudios y posibles caminos academicos o profesionales.

## Stack

- Frontend: React + Vite + React Router
- Backend: Node.js + Express
- Base de datos: SQLite + Prisma
- Auth: JWT + bcrypt
- IA: Google Gemini con rotacion automatica de multiples API keys

## Estructura

```text
blue_fev001/
  backend/
  frontend/
```

## Variables de entorno

1. Copia `backend/.env.example` a `backend/.env`
2. Copia `frontend/.env.example` a `frontend/.env`
3. Completa al menos `JWT_SECRET` y `GEMINI_API_KEYS`

## Comandos exactos

### 1. Instalar dependencias

```powershell
npm install
```

### 2. Configurar Prisma

```powershell
npm run prisma:generate
npm run db:init
```

La migracion de Prisma tambien queda incluida en `backend/prisma/migrations/...` por si quieres usar `npm run prisma:migrate` en un entorno donde el engine de migraciones de Prisma este disponible sin restricciones.

### 3. Seed opcional

```powershell
npm run prisma:seed
```

### 4. Levantar frontend y backend

```powershell
npm run dev
```

El frontend queda por defecto en `http://localhost:5173` y el backend en `http://localhost:4000`.

## Flujo principal

- Registro y login con JWT
- Chats separados por usuario autenticado
- Historial persistente en SQLite
- Memoria por conversacion usando mensajes guardados
- Respuestas de Gemini con failover entre multiples API keys

## Notas de configuracion

- Coloca una imagen del personaje en `frontend/public/character.png` si buscan reemplazar el ya puesto.
- `GEMINI_API_KEYS` acepta varias keys separadas por comas.
- El frontend nunca recibe las API keys; toda la integracion vive en el backend.

## Scripts utiles

### Raiz

- `npm run dev`: levanta frontend y backend al mismo tiempo
- `npm run build`: compila el frontend
- `npm run start`: inicia solo el backend en modo produccion
- `npm run prisma:generate`: genera cliente Prisma
- `npm run prisma:migrate`: aplica migracion de desarrollo
- `npm run prisma:seed`: crea un usuario demo opcional
- `npm run db:init`: crea las tablas SQLite localmente con un script idempotente

### Backend

- `npm run dev -w backend`
- `npm run start -w backend`
- `npm run prisma:generate -w backend`
- `npm run prisma:migrate -w backend`
- `npm run prisma:seed -w backend`
- `npm run db:init -w backend`

### Frontend

- `npm run dev -w frontend`
- `npm run build -w frontend`
- `npm run preview -w frontend`

## Credenciales demo del seed

Si ejecutas el seed con la configuracion por defecto:

- Email: `demo@bluefev.dev`
- Password: `Demo12345`

## Endpoints principales

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/chats`
- `POST /api/chats`
- `GET /api/chats/:chatId/messages`
- `POST /api/chats/:chatId/messages`
- `DELETE /api/chats/:chatId`

