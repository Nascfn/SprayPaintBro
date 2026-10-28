# Spray Paint Bro

A first-person 3D browser game where you play a graffiti artist and spray paint the walls of a city block. Built with [Three.js](https://threejs.org/), TypeScript and Vite.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and click to play. `npm run build` outputs a static site in `dist/` that can be hosted anywhere (GitHub Pages, Netlify, …).

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump (you can climb onto the dumpster) |
| Left mouse | Spray |
| Mouse wheel | Switch nozzle cap (skinny, medium, fat) |
| 1–9 | Select a color from the hotbar |
| Tab | Open the color picker for the selected slot |
| R | Shake the can |
| C | Clear the wall you're aiming at |
| Ctrl+Z | Undo the last stroke |
| Esc | Pause |

## How the paint works

- Every vertical wall face has an invisible paint layer just in front of it. Its texture is a GPU render target that's only created the first time you hit that wall.
- Spraying raycasts from the crosshair and stamps a soft, speckled brush into that render target. Stamps are spaced along the stroke so fast movements don't leave gaps.
- Distance matters, like a real can:
  - Up close you get a tight, solid line.
  - From further back you get a wide, faint haze of droplets.
  - Past about 3 m the paint doesn't reach the wall.
- Holding still makes paint pool, and past a threshold it runs down the wall as a drip.
- The paint layer reuses the wall's normal map, so paint follows brick mortar lines and concrete texture.
- All textures and sounds are generated procedurally at startup; the game has no image or audio assets.

## Project layout

```
src/
  main.ts                 entry point
  game/Game.ts            game loop, input, states, debug API
  world/World.ts          city block: buildings, alley, vacant lot, props, colliders
  world/textures.ts       procedural brick/concrete/asphalt/metal textures + normal maps
  world/lighting.ts       sky, sun, shadows, fog, environment lighting
  player/PlayerController.ts   pointer-lock FPS movement and collision
  player/SprayCanViewmodel.ts  hand + spray can in view
  paint/PaintSurface.ts   paintable wall face (lazy render target, drip build-up)
  paint/PaintRenderer.ts  instanced GPU brush stamping, undo snapshots
  paint/PaintSystem.ts    aiming, strokes, undo/clear
  paint/Drips.ts          paint runs
  paint/SprayParticles.ts mist particles
  paint/sprayMath.ts      spray falloff math (unit tested)
  audio/SprayAudio.ts     synthesized hiss, can rattle, footsteps
  ui/Hud.ts, ui/hud.css   HUD, menus, color picker
```

## Testing

- `npm test` runs the unit tests.
- Add `?debug` to the URL to expose `window.__game` for scripted checks:
  - `teleport`, `spray`, `color` and `nozzle` drive the game.
  - `advance(seconds)` steps the simulation at a fixed rate.
  - `stats()` reports the current state.
- In debug mode the game also runs without pointer lock.
