# Home Design Studio

A browser-based home design app for phones, tablets and desktops. Lay out floor plans, design kitchens, furnish rooms (including furniture imported from your own photos), check spacing, and walk through the result in 3D.

Runs entirely in the browser — no server or account. Designs auto-save locally (IndexedDB) and can be exported/imported as a single `.home.json` file (photos and 3D models are bundled inside). It is an installable PWA, so on a phone you can "Add to Home Screen" and use it like an app, including offline.

## Features

| Area | What you can do |
| --- | --- |
| **Rooms & floor plans** | Draw rectangular rooms or any polygon shape; add rooms by exact size; drag corners/walls to resize; drag whole rooms — corners snap to neighbouring rooms so multi-room plans join cleanly. Split walls, hide walls for open plans, set floor elevation (steps, sunken rooms). |
| **Trace a floor plan** | Upload a photo or image of an existing plan, set its scale from a dimension written on it, verify with a second dimension (fixes photos taken at an angle), then draw rooms over it – corners snap to the plan's wall lines so adjacent rooms share walls. |
| **Walls & ceilings** | Wall height and thickness, wall color (plus per-wall accent colors), baseboards. Ceilings: flat, **sloped (shed)**, **vaulted (gable)** or **tray**, with peak height, direction and pitch readout; ceiling color. |
| **Flooring** | Hardwood, laminate, vinyl, herringbone, tile, stone, checkerboard, carpet, concrete — with color, grout/accent, plank/tile size and rotation. **Import your own pattern or photo** as flooring. |
| **Doors, windows, openings** | Doors, double/French doors, sliding doors, windows, open passages and garage doors. Width/height/sill, position, hinge side & swing direction, trim color. Drag along any wall; openings cut through shared walls between rooms automatically. |
| **Lighting & fixtures** | Recessed, flush, pendant, chandelier, ceiling fan, sconce, floor/table lamp, under-cabinet LED — real light sources with brightness, reach and color temperature. Time-of-day sun & ambient controls (try evening to see your lighting plan). |
| **Kitchen designer** | Generates single-wall, L, U, galley and island layouts (with corner cabinets, appliances, upper cabinets, range hood; avoids doors and windows). Finish palettes for cabinets, countertops, appliances, hardware. **Design check**: work triangle legs & total, landing areas for sink/cooktop/fridge, dishwasher distance, aisle width, backsplash height, countertop frontage. Standard cabinet widths, wall snapping and run alignment. |
| **Furniture & imports** | 60+ catalog pieces. **Import from a photo** (or take one with the phone camera): remove the background (auto or tap-to-erase), set real dimensions, choose a shape — box with photo front, standing cut-out, cylinder, L-shape or a **custom footprint you draw**. **Import 3D models** (`.glb`, `.gltf`, `.obj`) for exact fixtures and appliances, scaled to the size you enter. Saved pieces go to *My items* for reuse. |
| **Spacing & dimensions** | Selected items show live clearance lines to the nearest wall/item in all four directions (plan and 3D), plus height above the floor and below the ceiling. Wall lengths, opening widths, room areas, a measuring tool and a scale bar. |
| **Views** | 2D plan (rotatable, pinch-zoom), 3D orbit, **isometric, top, front and side** orthographic views — all rotatable — and a clean **line-drawing** style. Walls facing the camera are cut away automatically. |
| **Walk-through** | First-person walk mode with collision (you pass through doors, not walls). Desktop: WASD/arrows + mouse. Phone: on-screen joystick + drag to look. Double-click a floor in 3D to start walking there. |

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173 (also reachable from your phone on the same network)
npm test         # unit tests (130: data safety, geometry, kitchen generator sweep, offline, a11y…)
npm run test:e2e # Playwright smoke tests on desktop + phone (builds and serves the app itself)
npm run build    # production build in dist/ (static files – host anywhere)
```

## Publishing (GitHub Pages)

Every push to `main` runs `.github/workflows/deploy.yml`: type-check, unit tests, build and the Playwright
smoke tests must all pass before the app is published to
`https://<user>.github.io/home-designer/`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
On a phone, open the URL and choose *Add to Home Screen* / *Install app*.

## Project layout

```
src/
  model.ts        Data model (rooms, openings, items, settings) – meters/radians
  geometry.ts     Polygon math, walls, ceiling heights, clearances, wall snapping
  units.ts        Feet-inches / metric formatting & parsing (10' 6", 34 1/2", 3.2m…)
  catalog.ts      Furniture / cabinet / appliance / lighting catalog
  kitchen.ts      Kitchen layout generator + design checks
  placement.ts    Snapping and placement rules
  state.ts        Store with undo/redo and auto-save
  storage.ts      IndexedDB persistence for projects and assets
  plan2d.ts       2D canvas floor-plan editor
  three/          3D scene building, procedural models, textures, viewer & walk mode
  ui/             Panels, importers and app shell
```

## Shortcuts

`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Del` delete · `R` rotate 90° (`Shift+R` 15°) · `Ctrl+D` duplicate · arrows nudge (`Shift` = 1 ft) · hold `Alt` while dragging to disable snapping · `Esc` deselect / exit walk mode.
