# CineForge — Cinematic 3D Trailer Studio

A browser-based cinematic trailer editor for game vehicles, military hardware and other 3D models — a simplified "Unreal Sequencer" that runs entirely in the browser (Three.js + Vite, no server, no paid APIs).

Import your own **GLB / GLTF**, press **Generate Cinematic Trailer**, tweak shots and effects on the timeline, and **export a 1920×1080 / 30 fps MP4 or WebM**.

▶ **Run online (StackBlitz):** https://stackblitz.com/github/shohanbek77777-creator/3d-cinematic-trailer

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the build
```

Requirements: a desktop browser with WebGL 2. For frame-accurate MP4 export use a current **Chrome / Edge** (WebCodecs + H.264). Firefox and Safari also work (codec availability varies — see *Export* below).

## How to make a trailer from your model

1. **Import** — drag & drop a `.glb` (or a `.gltf` together with its `.bin` and textures, or a whole folder) anywhere on the window, use **Import Model**, or paste a direct URL into *Import 3D Model → Load URL* (Google Drive, Dropbox and GitHub links are converted automatically).
2. The app parses the real file (materials and textures are preserved; Draco, Meshopt and KTX2 compression supported), measures the model with outlier-robust bounds, fixes implausible units (mm/cm), detects the forward axis and the **wheels** (by node/material names or geometry), centres it and puts the tyres on the ground.
3. The first imported model **replaces the demo car** and a **45-second trailer is generated for it automatically**: speeds, camera distances, road width, dust and smoke are scaled to its size (cars vs. heavy vehicles; static objects get a showcase trailer).
4. Use **Generate Cinematic Trailer** to choose another environment, style (Action / Elegant), duration, title, tagline and end subtitle.
5. Edit anything on the timeline / in the properties panel, then **Export Video**.

### Generated structure (45 s)

| Time | Section | Content |
|---|---|---|
| 0–5 s | Intro | fade-in, wide establishing shot, tagline title |
| 5–12 s | Reveal | vehicle rolls in and stops; close-ups of the front and wheel, low-angle orbit, light smoke |
| 12–22 s | Action | launch with tyre smoke, rear/side/front tracking, orbit, dust, lower-third title |
| 22–35 s | Intense Action | faster speed, quick cuts, drive-bys, aerial, shaky low cameras, flash, heavy dust, braking sparks + smoke |
| 35–45 s | Final Hero Shot | braking to a stop, slow push-in hero shot, big title + subtitle, fade-out |

A "cinematographer pass" picks each shot's side so the camera does not stare straight into a low sun.

## Features

**Interface** — dark production-tool UI: top bar (New / Open / Save / Undo / Redo / Import / Generate / Export / Fullscreen / Shortcuts), left panel (Project Assets + Scene Outliner, Import, Scenes, Environment, Effects), 16:9 viewport with Shot/Editor camera, gizmo and quality switch, right panel (Object Properties, Transform, Model Setup, Motion Path, Lighting, Materials) and a resizable timeline.

**Import** — GLB/GLTF from disk, drag & drop (files and folders), URL; multiple models per scene; models stored in IndexedDB and embedded (base64) in saved project files; glTF animations can be played on the timeline.

**Environments** (procedural, seeded "Variation"): Desert Highway, Abandoned City, Mountain Road, Night City, Military Base — each with its own road, terrain, props, physical or night sky, sun, fog, ambient particles, IBL reflections and colour-grading preset. Switching environment keeps your edit and moves animated vehicles onto the new road.

**Cameras** — Wide Cinematic, Low Angle, Front / Side / Rear Tracking, Close-up (front / wheel / rear / side / top), Orbit, Hero, Drive-By, Aerial, Custom keyframes (capture the editor view). Per-shot distance, height, side, FOV start→end, dolly, orbit speed, drift, slide, shake, dutch angle; cut or smooth-blend transitions.

**Animation** — keyframed motion paths (Catmull-Rom path + monotone-cubic distance profile → natural acceleration and braking; duplicate a position to stop), auto heading and turns, wheel spin from travelled distance, front-wheel steering from path curvature, suspension pitch/roll, "Drive along road" helper, auto-key when moving an animated model with the gizmo, adjustable duration.

**Effects** (all with real parameters) — Bloom, Fog, Depth of Field (bokeh, auto-focus on the target), Colour Grading (exposure, contrast, saturation, temperature, tint, split toning, vignette, grain, chromatic aberration), true temporal Motion Blur (sub-frame accumulation, shutter angle), Lens Flare (occlusion-tested, anamorphic streak, ghosts), Dust, Smoke, Sparks, ambient particles, Letterbox (2.39 / 2.00 / 1.85). Timeline FX clips: Dust storm, Tyre smoke, Sparks, Flash, Fade in/out, Titles (cinematic / hero / lower-third).

**Export** — offline, frame-by-frame rendering at the chosen resolution (720p–4K), 24/25/30/60 fps, 16:9, selectable range/duration presets, quality, motion-blur samples, progress + ETA, cancel, in-dialog preview and download.
- **WebCodecs (Mediabunny)** → MP4 (H.264 / HEVC / AV1) or WebM (VP9 / VP8). Frame-accurate regardless of PC speed.
- **Fallback** without WebCodecs → real-time MediaRecorder capture (WebM, or MP4 where supported).
- **FFmpeg.wasm** → optional "Convert to MP4" for WebM results (downloads the ~31 MB core from unpkg on first use).

**Project** — Save/Load `.ctrailer.json` (with embedded models), autosave to the browser, undo/redo (120 steps), Reset scene, fullscreen preview, keyboard shortcuts.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| Enter / Home, End | Stop (go to start), go to end |
| ← / → (Shift) | Previous / next frame (1 s) |
| C | Toggle Shot / Editor camera |
| W / E / R | Move / rotate / scale gizmo |
| F, Shift+F / F11 | Focus selection, fullscreen preview |
| K | Keyframe at playhead |
| S | Split selected clip |
| Del | Delete selection |
| Ctrl+D | Duplicate |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | Undo, redo |
| Ctrl+S / Ctrl+O / Ctrl+I / Ctrl+E | Save / open / import / export |
| G | Generate trailer |
| + / − | Zoom timeline |

## Known limitations

- **Google Drive links**: Drive only serves files shared as "Anyone with the link"; very large files may show a confirmation page and some browsers block the cross-origin download. If URL import fails, download the file and drag it into the app.
- **MP4** needs an H.264/HEVC/AV1 WebCodecs encoder (Chrome/Edge have it; some Firefox/Linux builds only offer VP9 → WebM, then use *Convert to MP4*).
- MediaRecorder fallback records in real time — on slow machines lower the resolution or motion-blur samples.
- Wheel detection is automatic; for unusual models set *Model Setup → Forward axis / Real length* manually. Tracked vehicles (tanks) move along the path but tracks are not animated.
- Very heavy models (hundreds of MB, many 8K textures) can exceed browser memory / IndexedDB quota — save the project file to keep them.

## Project structure

```
index.html, vite.config.js, package.json, .stackblitzrc
src/
  main.js                     boot
  app/        App.js (controller), Project.js (data model), History.js (undo), Storage.js (IndexedDB / autosave / files)
  engine/     Engine.js (renderer, scene, cameras, gizmo), Pipeline.js (post FX), shaders.js, Overlay.js (titles)
  assets/     ModelLoader.js (GLB/GLTF/URL/drag&drop), ModelAnalyzer.js (bounds, wheels, axes), DemoVehicle.js
  scene/      Actor.js (model runtime: wheels, suspension, headlights, materials), Particles.js, environments/*
  anim/       Path.js, CameraShots.js, Sequencer.js (FX clips), TrailerGenerator.js, math.js
  export/     Exporter.js (WebCodecs / MediaRecorder / FFmpeg.wasm)
  ui/         Layout.js, LeftPanel.js, Inspector.js, Timeline.js, Dialogs.js, dom.js, icons.js
  styles/     main.css
```
