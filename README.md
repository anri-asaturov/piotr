# piotr · Tessera

A real-time ray-marching app that turns any image into a field of 3D shapes, one
shape per pixel. Everything is drawn by a single WebGL 2 fragment shader. Shapes
are placed with **domain repetition**, and neighbouring domains never conflict.

**Live:** https://anri-asaturov.github.io/piotr/

- One fullscreen triangle, one fragment shader, one draw call per frame. No
  libraries, no build step, no WebGL extensions required.
- Six shapes: sphere, cube, pin, bar, diamond and ring. Pixel brightness drives
  height and, optionally, size.
- Motion: wave, float, spin, scatter, camera sway, tap ripples, and a poke mode
  that pushes the pins like a pin-art toy.
- Lighting: soft shadows, ambient occlusion, a back plate and three backdrops.
- Sources: six procedural presets (including editable text), any image you open,
  drop or paste, or the live camera.
- Touch-first: drag to orbit, pinch to zoom, two fingers to pan, tap for
  ripples, double-tap to reset the view.
- Hand-built UI: sliders, switches and segmented controls with pointer, touch and
  keyboard support. It is a side panel on desktop and a bottom sheet on phones.
- Adaptive resolution keeps the frame rate up on weak GPUs. Nothing is drawn
  while the scene is still.

## Controls

| Action        | Mouse / keyboard                    | Touch                     |
| ------------- | ----------------------------------- | ------------------------- |
| Orbit         | drag, arrow keys                    | one-finger drag           |
| Zoom          | wheel / trackpad pinch, `+` `-`     | pinch                     |
| Pan           | right-drag, shift-drag, middle-drag | two-finger drag           |
| Ripple        | click                               | tap                       |
| Reset view    | double-click, `R`                   | double-tap                |
| Poke mode     | `P` or the hand button              | hand button               |
| Play / pause  | `Space`                             | pause button              |
| Shapes        | `1` … `6`                           | Shape tab                 |
| Hide the UI   | `H`                                 | eye button                |
| Screenshot    | `S`                                 | camera-frame button       |
| Open image    | `O`, drag and drop, paste           | Image tab → Open image    |
| Naive / aware | `N` (compare domain repetition)     | Engine tab                |

## How it works

### The field

The image is box-filtered down to a `W×H` grid (Image → Resolution sets the
long side). Each pixel becomes one cell, and cell centres sit one unit apart in
the image plane. On the CPU, `js/field.js` computes for every cell:

- `z`: shape height towards the viewer, from brightness through the depth
  curve, terraces and invert settings, plus the wave, float, scatter, ripple
  and poke offsets
- `r`: shape size (0 means an empty cell, for example a transparent pixel)
- the highest shape top and the lowest shape bottom over a `(2R+1)²` window
  around the cell

This data goes to the GPU as one `RGBA32F` texture. Colours go in a second
`RGBA8` texture. Both are read with `texelFetch`, so no float filtering or other
extension is needed. The CPU only recomputes the data while something moves.
The window extrema use a separable van Herk / Gil–Werman filter, which costs
O(1) per cell whatever the window size.

### Domain repetition without conflicts

Naive domain repetition folds space into one cell with `q = p - round(p)` and
evaluates a single shape. That works when every cell holds the same symmetric
shape. Here every cell differs in height, size and spin, so the distance
returned is only the distance to *this cell's* shape. A taller neighbour can be
much closer. The ray then steps straight into it, and shapes come out bitten,
missing or smeared. Switch *Engine → Domain repetition → Naive* (or press `N`)
to see it.

The shader's `map()` fixes this in two parts:

1. **Evaluate the 2×2 closest cells.** These are the cell containing `p` and its
   three neighbours on the side `p` leans towards. The minimum over them is an
   exact distance to that geometry.
2. **Bound everything else.** Every other cell's column is at least
   `a1 = 0.5 + min(|q.x|, |q.y|)` away in the image plane. Within the window,
   every shape lies between the stored min-bottom and max-top, so its distance
   is at least `sqrt(a1² + dz²)`. Cells outside the window are at least
   `R + 0.5 - max(|q.x|, |q.y|)` away and lie inside the global z range.

The ray advances by the smaller of the exact distance and those bounds, so it
never tunnels into a domain it did not evaluate. It still takes long strides
above the relief. The bound holds because every shape stays inside its own cell
column: spinning cubes are shrunk by 1/√2 so their corners never cross into a
neighbour. *Engine → View → Step cost* shows the per-pixel step count, and
*Domains* colours every cell separately and draws the cell borders on the plate.

### Minimal WebGL

- The fullscreen triangle comes from `gl_VertexID`. There are no vertex buffers.
- One program and two textures, with a single `drawArrays(TRIANGLES, 0, 3)` per
  frame.
- No framebuffers and no required extensions. `KHR_parallel_shader_compile` is
  used when present so the page stays responsive while the shader compiles.
- GLSL ES 3.00 with `highp` and integer hashes, which behaves the same on every
  WebGL 2 GPU.
- The app handles context loss and restore. The render resolution adapts to
  the measured refresh rate, capped at 60 fps.

## Run locally

ES modules need an HTTP server; `file://` will not work.

```sh
python3 -m http.server 8080   # or: npx serve .
# open http://localhost:8080
```

`npm run check` syntax-checks the modules. There is nothing to install.

## Deploy

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to
`master`, `main` or the development branch, and can also be started by hand from
the Actions tab.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. Then re-run the workflow, or push again.

## Layout

```
index.html          page shell
css/style.css       hand-written UI styles (desktop panel + phone bottom sheet)
js/main.js          app wiring, render loop, panel definition
js/shaders.js       the GLSL: fullscreen triangle + ray-marching fragment shader
js/renderer.js      the whole WebGL layer (program, 2 textures, 1 draw call)
js/field.js         per-cell heights / sizes / window bounds, ripples, poke
js/camera.js        orbit camera
js/input.js         pointer, touch and wheel gestures
js/perf.js          adaptive render resolution
js/images.js        presets, file and camera input, downsampling
js/ui.js            UI components (slider, switch, segmented, tabs…)
js/settings.js      defaults and persistence
```
