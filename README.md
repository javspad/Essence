# 🎲🍻 Despedida de Javi

Juego de mesa web multijugador para 7 amigos, cada uno en su compu, estilo Mario Party / The Game of Life. Tablero online sincronizado + minijuegos que corren local en cada pantalla. Hecho para una noche.

## Arquitectura

- **El tablero es online**: el estado vive en el server (autoritativo) y se espeja en las 7 pantallas vía Socket.io.
- **Los minijuegos son locales**: cada uno corre en su compu sin sincronizar gameplay. Solo viaja el resultado `{ score, payload }`.
- **Reveal**: cuando todos terminan, el server resuelve (con *rig*), reparte monedas y manda una pantalla de resultados a las 7 compus.

```
shared/   tipos + content.json (el "alma" del juego) + lógica de rig
server/   Express + Socket.io, GameState en memoria, resolve() + rig, juez IA
client/   Vite + React + TS + Tailwind: lobby, tablero, motores de minijuego
```

## Correr en local

```bash
npm install
npm run dev        # server :3001 + cliente :5173 + herramientas de desarrollo habilitadas
```

Abrí http://localhost:5173 en cada compu/pestaña. Uno crea la sala (código de 4 letras), el resto entra con ese código. El que crea es el **host**.

> 💡 En la misma red (Plan B LAN): los demás entran a `http://IP-DEL-HOST:5173`.
> El juego sigue disponible desde la LAN, pero el endpoint que guarda `shared/content.json` acepta escrituras solo desde la máquina host.

### Juez IA (opcional)

```bash
cp server/.env.example server/.env
# pegá tu ANTHROPIC_API_KEY
```

Sin key, el juez (Luján, roast, padrino) usa un fallback determinístico y el juego funciona igual.

### Smoke test

```bash
PORT=3055 npm run start -w server   # en una terminal
npm run smoke                       # en otra: simula 3 jugadores una partida entera
```

## Contenido (lo llenan Javi y los amigos)

Todo el "alma" vive en [`shared/content.json`](shared/content.json): mapas, eventos, actividades y jugadores. No hace falta tocar código.

- `players`: 7 jugadores con `id`, `name`, `color`, `groom`. **El `id` ata el rig a la persona** (al entrar, si tu nombre coincide con un slot, tomás ese id).
- `events`: cada evento define su story y, cuando tiene gameplay, una `activity` que elige un **motor** (`type`) y le pasa `content` + `rigged`.
- `board[].eventId` (o `maps[].board[].eventId`): es la única asignación de contenido de un casillero; referencia una entrada de `events`.
- `rigged: { losers: [...], winners: [...] }`: se aplica **en el server** después de los scores reales. El cliente nunca se entera.

### Map builder

Abrí `http://localhost:5173/map-builder` para editar mapas visualmente. El builder permite crear/duplicar mapas, mover casilleros, conectar rutas tipo grafo, cambiar terreno, asignar un evento a cada casillero, colocar map props decorativos y exportar/importar el JSON completo. El modo **Test map** mueve una ficha de prueba por cualquier casillero, ya sea desde el selector, clickeando el mapa o siguiendo rutas salientes. **3D playtest** abre la escena en pantalla completa, como una vista real de partida; también se puede abrir directo con `http://localhost:5173/map-builder?playtest3d=1`. En desarrollo, **Save** guarda un backup local de recuperación y escribe el JSON completo validado en `shared/content.json`; al abrir un builder siempre manda `shared/content.json`, y **Recover browser draft** solo recupera un borrador local si lo pedís explícitamente.

### Event builder

Abrí `http://localhost:5173/event-builder` para editar eventos, actividades, stories, consecuencias y playtests. En desarrollo, **Save** escribe el JSON completo validado en `shared/content.json` y deja una copia local recuperable que no se carga automáticamente.

### Tools hub

Abrí `http://localhost:5173/tools` para encontrar los builders disponibles. El Content JSON exportado usa `mapProps` como campo canónico para objetos decorativos del mapa y conserva `artifacts` como compatibilidad de importación/runtime.

## Motores de minijuego disponibles

`prompt`, `hostPick`, `selfTap`, `vote`, `judge`, `timing`, `reaction`, `buzzer`, `estimate`, `whack`, `maze`, `flappy`, `snake`, `horserace` y `redlight`.

Agregar un minijuego = un Event con `activity` en `content.json` sobre un motor existente. Agregar un motor nuevo = un componente en `client/src/minigames/` + registrarlo en `index.ts` (y si recalcula score en server, un caso en `server/src/activities/index.ts`).

## Deploy (Railway)

1. Subí el repo a GitHub.
2. En Railway: **New Project → Deploy from GitHub repo**.
3. Variables: `ANTHROPIC_API_KEY` (opcional). `PORT` lo setea Railway.
4. Build command: `npm install && npm run build` · Start command: `npm start`.

El server sirve el `client/dist` ya buildeado en el mismo puerto, así que con un solo servicio alcanza.
El build y el server normales dejan builders, playtest y comandos de debug deshabilitados. Solo en un deployment de QA confiable se puede definir `ENABLE_DEV_TOOLS=1`; la variable debe estar presente tanto durante el build como al iniciar el server.
