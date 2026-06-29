# Spike: full-screen 3D scene + Spline

Question: can this project use Spline for a nicer editable 3D game scene?

## Research

- `@splinetool/react-spline` loads an exported Spline scene with `<Spline scene="https://.../scene.splinecode" />`.
- It exposes `onLoad`, `findObjectByName/findObjectById`, `emitEvent`, and Spline mouse/key event callbacks.
- If CORS bites, Spline recommends downloading the `.splinecode` file and self-hosting it.
- Current package latest checked: `@splinetool/react-spline@4.1.0`; it needs `@splinetool/runtime` as a peer dependency.

Source: https://github.com/splinetool/react-spline

## Verdict

Yes, we can use Spline, but not as the game-state layer.

Best split:

1. **React Three Fiber owns gameplay**: board positions, player tokens, dice, clickable actions, reveal/event UI.
2. **Spline owns art/backdrop later**: table, room, decorative props, lights, branded objects edited visually in Spline.
3. Keep board layout editable in `shared/content.json -> board[].layout`; this already drives server-safe gameplay and the 3D board.

Why not add Spline dependency now: there is no exported `.splinecode` scene yet, so the dependency would add bundle weight without visible value.

## Implementation started

- Added a full-viewport `GameScene3D` path for `turn`, `moving`, `event`, `reveal`, and `finished` phases.
- Scoreboard, room status, turn/dice control, event card, reveal card, and victory card now render as textured 3D planes inside the same WebGL scene.
- `?sceneEdit=1` shows an in-scene editing hint pointing to the board layout file.

## Next only when needed

When there is a Spline scene URL/file:

```bash
npm install -w client @splinetool/react-spline @splinetool/runtime
```

Then lazy-load it as a decorative backdrop, or read named Spline anchors if we decide to place art around the existing data-driven board.
