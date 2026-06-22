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
npm run dev        # server :3001  +  cliente :5173 (con proxy de socket)
```

Abrí http://localhost:5173 en cada compu/pestaña. Uno crea la sala (código de 4 letras), el resto entra con ese código. El que crea es el **host**.

> 💡 En la misma red (Plan B LAN): los demás entran a `http://IP-DEL-HOST:5173`.

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

Todo el "alma" vive en [`shared/content.json`](shared/content.json): tablero, minijuegos, dares, fates y players. No hace falta tocar código.

- `players`: 7 jugadores con `id`, `name`, `color`, `groom`. **El `id` ata el rig a la persona** (al entrar, si tu nombre coincide con un slot, tomás ese id).
- `minigames`: cada entrada elige un **motor** (`type`) y le pasa `content` + `rigged`.
- `rigged: { losers: [...], winners: [...] }`: se aplica **en el server** después de los scores reales. El cliente nunca se entera.

## Motores de minijuego disponibles

`vote`, `buzzer`, `timing` (skin *bostezo*), `judge` (skin *lujan*, usa Anthropic), `reaction`, `estimate`, `whack`.

Agregar un minijuego = una entrada nueva en `content.json` sobre un motor existente. Agregar un motor nuevo = un componente en `client/src/minigames/` + registrarlo en `index.ts` (y si recalcula score en server, un caso en `server/src/minigames/index.ts`).

## Deploy (Railway)

1. Subí el repo a GitHub.
2. En Railway: **New Project → Deploy from GitHub repo**.
3. Variables: `ANTHROPIC_API_KEY` (opcional). `PORT` lo setea Railway.
4. Build command: `npm install && npm run build` · Start command: `npm start`.

El server sirve el `client/dist` ya buildeado en el mismo puerto, así que con un solo servicio alcanza.
