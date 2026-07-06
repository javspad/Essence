# Scripts de QA visual y de mapa

Herramientas usadas para verificar el diorama 3D y el map builder. Requieren el server en 3001 y el client (vite) en 5173. Los paths de salida (`OUT`) apuntan a un scratchpad de sesión: ajustalos a una carpeta local antes de correr.

- **validate-map.mjs** — valida `shared/content.json`: ids secuenciales, rutas, refs de catálogo, bounds, unicidad, terrazas. `node scripts/qa/validate-map.mjs`
- **qa_shots.py** — screenshots del map-builder + playtest 3D (START, celda media, META) con Playwright headless. `python3 scripts/qa/qa_shots.py http://localhost:5173`
- **cam_bots.mjs + cam_view.py** — partida real: dos bots por socket (crean sala, tiran, fuerzan minijuegos) y un viewer Playwright que entra a la sala y filma frames de la cámara cinematográfica. Correr `node scripts/qa/cam_bots.mjs` y a los ~2s `python3 scripts/qa/cam_view.py`.

Reglas de geometría que estos scripts ayudan a chequear (ver memoria del proyecto):
- **Regla del faldón**: cada celda debe estar SOBRE una terraza o a distancia Chebyshev ≥ 0.85 del rect de cualquier terraza más alta.
- **Oclusión de cámara**: props altos (edificios, montañas, palmeras) nunca al sur (y mayor) de celdas cercanas — la cámara mira desde el sur, baja (3.9 + elev·0.85, z+6.6).
