# Blue FEV001

Aplicacion web de chatbot para orientacion vocacional con enfoque conversacional. El asistente empieza como un amigo cercano, conoce al usuario con naturalidad y despues conecta la charla con intereses, habilidades, estudios y posibles caminos academicos o profesionales.

## Stack

- Frontend: React + Vite + React Router
- Backend: Node.js + Express
- Base de datos: MariaDB/MySQL con Prisma
- Entorno local: Laragon
- Auth: JWT + bcrypt
- IA: Google Gemini con rotacion automatica de multiples API keys

## Estructura

```text
blue_fev001/
  backend/
  frontend/
```

## Base de datos en Laragon

1. Abre Laragon e inicia Apache/Nginx y MySQL/MariaDB.
2. Entra a phpMyAdmin desde Laragon.
3. Crea o selecciona la base de datos:

```text
db_forum_2025
```

4. Importa el archivo `.sql` de la base desde la pestana Importar de phpMyAdmin.
5. Verifica que existan las tablas de la oferta educativa, usuarios, chats y mensajes.

Si la base ya existe en Laragon, no necesitas crearla otra vez; solo revisa que el nombre coincida con el `DATABASE_URL`.

## Variables de entorno

Backend:

1. Copia `backend/.env.example` a `backend/.env`.
2. Ajusta las variables segun tu Laragon local.

Ejemplo para desarrollo local:

```env
PORT=4000
NODE_ENV=development

DATABASE_URL="mysql://blue_fev:BlueFev123@127.0.0.1:3306/db_forum_2025"

JWT_SECRET=replace-with-a-strong-secret
JWT_EXPIRES_IN=7d

FRONTEND_URL=http://localhost:5173

GEMINI_API_KEYS=tu_api_key_1,tu_api_key_2
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_CHAT_MODEL=gemini-2.5-flash-lite
GEMINI_MEMORY_MODEL=gemini-2.5-flash-lite
GEMINI_CHAT_MAX_OUTPUT_TOKENS=300
GEMINI_MEMORY_MAX_OUTPUT_TOKENS=600
GEMINI_CHAT_TEMPERATURE=0.6
GEMINI_MEMORY_TEMPERATURE=0.1
GEMINI_MEMORY_EVERY_USER_MESSAGES=4
GEMINI_MEMORY_CONTEXT_MESSAGE_LIMIT=8
GEMINI_MEMORY_CONTEXT_MAX_CHARS=3600
GEMINI_MEMORY_USER_MESSAGE_MAX_CHARS=600
GEMINI_MEMORY_ASSISTANT_MESSAGE_MAX_CHARS=350
GEMINI_MEMORY_CURRENT_CHAT_SUMMARY_MAX_CHARS=500
GEMINI_MEMORY_USER_MEMORY_MAX_CHARS=700
GEMINI_MEMORY_TARGET_CHAT_SUMMARY_CHARS=450
GEMINI_MEMORY_TARGET_USER_MEMORY_CHARS=650
GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY=6
GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY=8
GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY=3200
GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY=4800

SEED_USER_NAME=Demo User
SEED_USER_EMAIL=demo@bluefev.dev
SEED_USER_PASSWORD=Demo12345
```

Importante: `FRONTEND_URL` y `GEMINI_MODEL` deben ir en lineas separadas.

Frontend:

1. Copia `frontend/.env.example` a `frontend/.env`.
2. Usa:

```env
VITE_API_URL=http://localhost:4000/api
```

## Prisma

Despues de importar la base en Laragon, genera el cliente de Prisma:

```powershell
npm run prisma:generate -w backend
```

Si cambiaste la estructura directamente en la base y quieres sincronizar `schema.prisma` con la base:

```powershell
npx prisma db pull --schema backend/prisma/schema.prisma
npm run prisma:generate -w backend
```

Si agregas cambios desde Prisma hacia la base, usa migraciones o revisa primero el SQL generado antes de aplicarlo en la base compartida.

## Comandos exactos

### 1. Instalar dependencias

```powershell
npm install
```

### 2. Generar Prisma Client

```powershell
npm run prisma:generate -w backend
```

### 3. Seed opcional

El seed crea un usuario demo si la configuracion de base y variables esta lista:

```powershell
npm run prisma:seed -w backend
```

Credenciales demo por defecto:

- Email: `demo@bluefev.dev`
- Password: `Demo12345`

Tambien puedes crear usuarios desde el registro normal de la app.

### 4. Levantar frontend y backend

```powershell
npm run dev
```

El frontend queda por defecto en `http://localhost:5173` y el backend en `http://localhost:4000`.

Tambien puedes correrlos por separado:

```powershell
npm run dev -w backend
npm run dev -w frontend
```

## Flujo principal

- Registro y login con JWT
- Chats separados por usuario autenticado
- Historial persistente en MariaDB/MySQL
- Memoria resumida entre chats para ahorrar tokens
- Busqueda de oferta educativa desde tablas de base de datos
- Respuestas de Gemini con failover entre multiples API keys

## Notas de configuracion

- Coloca una imagen del personaje en `frontend/public/character.png` si buscas reemplazar el personaje actual.
- `GEMINI_API_KEYS` acepta varias keys separadas por comas.
- `GEMINI_MODEL` se mantiene por compatibilidad y funciona como fallback para ambos usos.
- `GEMINI_CHAT_MODEL` y `GEMINI_MEMORY_MODEL` tienen prioridad y permiten configurar por separado conversacion y memoria.
- Los limites de salida y temperaturas de cada uso se configuran con las variables `GEMINI_*_MAX_OUTPUT_TOKENS` y `GEMINI_*_TEMPERATURE`.
- `GEMINI_MEMORY_EVERY_USER_MESSAGES` limita cada cuantas respuestas conversacionales elegibles se regeneran los resumenes de memoria; no cambia la cantidad de mensajes recientes enviada a la conversacion principal.
- Las ocho variables nuevas de memoria son opcionales; si se omiten o no contienen enteros positivos, se usan los valores predeterminados definidos en `backend/src/config/env.js`.
- `GEMINI_MEMORY_CONTEXT_MESSAGE_LIMIT` (8) limita los mensajes seleccionados para memoria.
- `GEMINI_MEMORY_CONTEXT_MAX_CHARS` (3600) limita el transcript completo, incluidas etiquetas y separadores.
- `GEMINI_MEMORY_USER_MESSAGE_MAX_CHARS` (600) limita la copia de cada mensaje del usuario.
- `GEMINI_MEMORY_ASSISTANT_MESSAGE_MAX_CHARS` (350) limita la copia de cada respuesta normal de Blue.
- `GEMINI_MEMORY_CURRENT_CHAT_SUMMARY_MAX_CHARS` (500) limita la copia del resumen previo del chat.
- `GEMINI_MEMORY_USER_MEMORY_MAX_CHARS` (700) limita la copia de la memoria global previa.
- `GEMINI_MEMORY_TARGET_CHAT_SUMMARY_CHARS` (450) define el objetivo del nuevo resumen del chat.
- `GEMINI_MEMORY_TARGET_USER_MEMORY_CHARS` (650) define el objetivo de la memoria estable; el parser conserva limites de seguridad 700/1000.
- Con resumen actual, la llamada conversacional usa un historial mas pequeno mediante `GEMINI_CHAT_HISTORY_LIMIT_WITH_SUMMARY` y `GEMINI_CHAT_HISTORY_MAX_CHARS_WITH_SUMMARY`.
- Sin resumen actual, conserva un poco mas de historial mediante `GEMINI_CHAT_HISTORY_LIMIT_WITHOUT_SUMMARY` y `GEMINI_CHAT_HISTORY_MAX_CHARS_WITHOUT_SUMMARY`.
- Los limites conversacionales solo afectan la copia enviada a la conversacion principal de Gemini. La generacion de memoria usa su configuracion independiente y preserva el mensaje de usuario mas reciente.
- El frontend nunca recibe las API keys; toda la integracion vive en el backend.
- No subas archivos `.env`, dumps locales ni bases `.db` al repositorio.

## Scripts utiles

### Raiz

- `npm run dev`: levanta frontend y backend al mismo tiempo
- `npm run build`: compila el frontend
- `npm run start`: inicia solo el backend en modo produccion
- `npm run prisma:generate`: genera cliente Prisma
- `npm run prisma:migrate`: aplica migraciones Prisma configuradas
- `npm run prisma:seed`: crea un usuario demo opcional

### Backend

- `npm run dev -w backend`
- `npm run start -w backend`
- `npm run prisma:generate -w backend`
- `npm run prisma:migrate -w backend`
- `npm run prisma:seed -w backend`

### Frontend

- `npm run dev -w frontend`
- `npm run build -w frontend`
- `npm run preview -w frontend`

## Endpoints principales

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/chats`
- `POST /api/chats`
- `GET /api/chats/:chatId/messages`
- `POST /api/chats/:chatId/messages`
- `DELETE /api/chats/:chatId`
