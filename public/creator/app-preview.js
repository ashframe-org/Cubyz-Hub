// Live, simplified biome chunk preview for the Addon Creator.
//
// This is NOT the game's real generator - it is a fast, seeded approximation
// built from the biome form values (ground layers, height range, roughness/
// hills/mountains, structures, sky/fog) so authors get instant visual feedback
// while editing. It regenerates automatically on every form change (debounced).
//
// three.js is loaded lazily from /vendor/three-r128.min.js. Block face textures
// come from gamedata/<version>/block_textures.json + the mirrored game assets.

(function () {
  const THREE_URL = "/vendor/three-r128.min.js";

  // Block ids that are used as convenience defaults but have no block def of
  // their own - map them to the real textured block.
  const TEXTURE_ALIASES = {
    grass: "grass/temperate",
    grass_block: "grass/temperate",
    dirt: "soil",
    stone: "slate/smooth",
    cobblestone: "cobblestone",
  };

  // Non-cube block models: plants render as crossed quads, carpets as a thin slab.
  const PLANT_MODELS = new Set(["cross", "plane", "fern", "monstera", "cactus", "cube_hanging_planes"]);
  const PLANT_PREFIXES = ["flower/", "glimmergill/", "toadstool/", "bolete/"];

  const WORLDGEN_WAVELENGTHS = [2400, 3200, 1800, 1600, 512];

  const state = {
    THREE: null,
    threePromise: null,
    renderer: null,
    scene: null,
    camera: null,
    canvas: null,
    container: null,
    meshes: new Map(), // paletteIndex -> {mesh, capacity, materials, id}
    colorCache: new Map(),
    textureCache: new Map(),
    blockTextures: null,
    biomesData: null,
    biomeSummary: "",
    sbb: new Map(),
    _crossGeo: null,
    _planeGeo: null,
    _carpetGeo: null,
    _cubeGeo: null,
    _stoneMats: null,
    gridHelper: null,
    axesHelper: null,
    showGrid: false,
    showAxes: false,
    showFps: false,
    flyMode: false,
    yaw: 0,
    pitch: 0,
    flyPos: null,
    keys: {},
    fps: 0,
    _frames: 0,
    _fpsTime: 0,
    _last: 0,
    statusBase: "",
    seed: 12345,
    size: 64,
    theta: 0.85,
    phi: 1.02,
    radius: 150,
    target: { x: 0, y: 0, z: 0 },
    dirty: false,
    scheduled: 0,
    rafId: 0,
    gridSize: 0,
    statusError: false,
    initialized: false,
    disposed: false,
    listeners: [],
    dragging: false,
    lastX: 0,
    lastY: 0,
  };

  function schedule(delay) {
    if (state.disposed) return;
    clearTimeout(state.scheduled);
    state.scheduled = setTimeout(rebuild, delay);
  }

  function status(msg, isError) {
    state.statusBase = msg || "";
    state.statusError = !!isError;
    updateStats();
  }

  function updateStats() {
    const el = document.getElementById("chunkPreviewStatus");
    if (!el) return;
    const fps = state.showFps && state.fps ? ` · ${state.fps} fps` : "";
    el.textContent = (state.statusBase || "") + fps;
    el.style.color = state.statusError ? "var(--danger, #ff6b6b)" : "var(--text-muted, #999)";
  }

  // ---------- seeded noise ----------
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(seed, x, y) {
    let h = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function valueNoise(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const tl = hash2(seed, xi, yi), tr = hash2(seed, xi + 1, yi);
    const bl = hash2(seed, xi, yi + 1), br = hash2(seed, xi + 1, yi + 1);
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
  }

  function fbm(seed, x, y, octaves) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * valueNoise((seed + i * 1013) | 0, x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  function hash3(seed, x, y, z) {
    let h = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function valueNoise3(seed, x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const c = (dx, dy, dz) => hash3(seed, xi + dx, yi + dy, zi + dz);
    const x00 = c(0, 0, 0) + u * (c(1, 0, 0) - c(0, 0, 0));
    const x10 = c(0, 1, 0) + u * (c(1, 1, 0) - c(0, 1, 0));
    const x01 = c(0, 0, 1) + u * (c(1, 0, 1) - c(0, 0, 1));
    const x11 = c(0, 1, 1) + u * (c(1, 1, 1) - c(0, 1, 1));
    const y0 = x00 + v * (x10 - x00);
    const y1 = x01 + v * (x11 - x01);
    return y0 + w * (y1 - y0);
  }

  function fbm3(seed, x, y, z, octaves) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * valueNoise3((seed + i * 1013) | 0, x * freq, y * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  // ---------- form reading ----------
  function readNum(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
  }

  function readColor(id, fallback) {
    const el = document.getElementById(id);
    return el && /^#[0-9a-f]{6}$/i.test(el.value) ? el.value : fallback;
  }

  function nsBlock(value) {
    const v = String(value || "").trim();
    if (!v) return null;
    return v.includes(":") ? v : `cubyz:${v}`;
  }

  function parseGroundEntries(entries) {
    const layers = [];
    for (const e of entries || []) {
      const range = e.match(/^(\d+)\s+to\s+(\d+)\s+(.+)$/);
      if (range) { layers.push({ block: nsBlock(range[3]), count: parseInt(range[2]) }); continue; }
      const count = e.match(/^(\d+)\s+(.+)$/);
      if (count) { layers.push({ block: nsBlock(count[2]), count: parseInt(count[1]) }); continue; }
      layers.push({ block: nsBlock(e), count: 1 });
    }
    return layers.filter((l) => l.block);
  }

  function readGroundLayers() {
    const layers = [];
    const surface = nsBlock((document.getElementById("bioSurfaceBlock") || {}).value) || "cubyz:grass/temperate";
    layers.push({ block: surface, count: 1 });
    const sub = nsBlock((document.getElementById("bioSubBlock") || {}).value);
    if (sub) {
      const max = readNum("bioSubMax", 3);
      layers.push({ block: sub, count: Math.max(1, Math.round(max || 3)) });
    }
    document.querySelectorAll("#bioGroundLayers .ground-layer-row").forEach((row) => {
      const block = nsBlock(row.querySelector(".ground-layer-block")?.value);
      if (!block) return;
      const mn = parseFloat(row.querySelector(".ground-layer-min")?.value);
      const mx = parseFloat(row.querySelector(".ground-layer-max")?.value);
      const count = Number.isFinite(mx) ? Math.max(1, Math.round(mx))
        : Number.isFinite(mn) ? Math.max(1, Math.round(mn)) : 1;
      layers.push({ block, count });
    });
    return layers;
  }

  function readStructures() {
    return Array.from(document.querySelectorAll(".structure-row-entry")).map((row) => {
      const id = row.querySelector(".struct-type-selector").value;
      if (!id) return null;
      const chance = parseFloat(row.querySelector(".struct-chance").value) || 0.02;
      const s = { id, chance };
      const val = (sel) => row.querySelector(sel)?.value;
      if (id === "cubyz:simple_tree") {
        s.log = nsBlock(val(".field-log")) || "cubyz:log/oak";
        s.leaves = nsBlock(val(".field-leaves")) || "cubyz:leaves/oak";
        s.height = parseInt(val(".field-height")) || 6;
        s.variation = parseInt(val(".field-height-var")) || 3;
        s.leafRadius = parseFloat(val(".field-leaf-radius")) || 2;
      } else if (id === "cubyz:simple_vegetation") {
        s.block = nsBlock(val(".field-block")) || "cubyz:grass/vegetation/temperate";
        s.height = parseInt(val(".field-height")) || 1;
      } else if (id === "cubyz:flower_patch") {
        s.block = nsBlock(val(".field-block")) || "cubyz:dandelions";
        s.width = parseInt(val(".field-width")) || 10;
        s.density = Math.min(1, parseFloat(val(".field-density")) || 0.3);
      } else if (id === "cubyz:boulder") {
        s.block = nsBlock(val(".field-block")) || "cubyz:slate/rough";
        s.size = parseFloat(val(".field-size")) || 5;
      } else if (id === "cubyz:ground_patch") {
        s.block = nsBlock(val(".field-block")) || "cubyz:gravel";
        s.width = parseFloat(val(".field-width")) || 5;
      } else if (id === "cubyz:fallen_tree") {
        s.log = nsBlock(val(".field-log")) || "cubyz:log/oak";
        s.height = parseInt(val(".field-height")) || 6;
      } else if (id === "cubyz:stalagmite") {
        s.block = nsBlock(val(".field-block")) || "cubyz:slate/smooth";
        s.size = parseFloat(val(".field-size")) || 12;
      }
      return s;
    }).filter((s) => s && s.id);
  }

  // ---------- worldgen (simplified) ----------
  function generate(size) {
    const H = size;
    const seed = state.seed >>> 0 || 1;
    const vox = new Uint16Array(size * size * H);
    const palette = [""];
    const indexById = new Map();
    const idIndex = (id) => {
      if (!indexById.has(id)) {
        indexById.set(id, palette.length);
        palette.push(id);
      }
      return indexById.get(id);
    };
    const idx = (x, y, z) => (y * size + z) * size + x;
    const inBounds = (x, y, z) => x >= 0 && x < size && y >= 0 && y < H && z >= 0 && z < size;
    const set = (x, y, z, id) => {
      if (!inBounds(x, y, z) || !id) return;
      vox[idx(x, y, z)] = idIndex(id);
    };

    // Game-accurate generation via CubyzWorldgen. Prefer multi-biome (climate
    // tree + Voronoi) with the authored biome pinned at the centre; fall back
    // to the single-biome MapGenV1 port, then to the old simplified fBm.
    const biomeParams = {
      minHeight: readNum("bioMinHeight", 20),
      maxHeight: readNum("bioMaxHeight", 40),
      roughness: readNum("bioRoughness", 1),
      hills: readNum("bioHills", 5),
      mountains: readNum("bioMountains", 0),
      minHeightLimit: readNum("bioMinHeightLimit", NaN),
      maxHeightLimit: readNum("bioMaxHeightLimit", NaN),
    };
    const worldgen = window.CubyzWorldgen;
    const authoredId = ((document.getElementById("biomeId") || {}).value || "").trim();
    const layers = readGroundLayers();
    const stone = nsBlock((document.getElementById("bioStoneBlock") || {}).value) || "cubyz:slate/smooth";
    const surfaceY = new Int16Array(size * size);
    const fillDepth = size >= 128 ? 96 : H;
    // Keep the anchor within the fill depth so columns always reach the bottom
    // (no floating slab / hollow underside).
    const surfaceAnchor = Math.min(Math.round(H * 0.42), Math.max(6, fillDepth - 2));
    let biomeSummary = "single biome";
    let filled = false;
    let biomeOf = null;

    // Cave biomes: fill a solid volume then carve tunnels with 3D noise (a
    // simplified stand-in for CaveMap + SDF caveModels).
    const isCaveMode = !!(document.getElementById("bioIsCave") || {}).checked;
    if (isCaveMode) {
      const top = H - 5;
      for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
          surfaceY[z * size + x] = top;
          let y = top;
          for (const layer of layers) {
            let count = Math.max(1, Math.round(layer.count || 1));
            while (count-- > 0 && y > 0) { set(x, y, z, layer.block); y--; }
          }
          while (y > 0 && top - y < fillDepth) { set(x, y, z, stone); y--; }
        }
      }
      const authoredBiome = state.biomesData && state.biomesData[authoredId];
      const caveModels = authoredBiome && authoredBiome.caveModels;
      if (caveModels && caveModels.length && window.CubyzSdf && window.CubyzSbb) {
        // Real SDF cave models for the authored cave biome.
        const rng = window.CubyzSbb.makeRng(BigInt(state.seed));
        const smooth = readNum("bioCaveSmoothness", 4);
        window.CubyzSdf.carve(caveModels, size, rng, smooth,
          (x, y, z) => vox[idx(x, y, z)] !== 0,
          (x, y, z) => { vox[idx(x, y, z)] = 0; });
        biomeSummary = `cave · ${caveModels.length} SDF model${caveModels.length > 1 ? "s" : ""}`;
      } else {
        const caves = readNum("bioCaves", 1);
        const radiusFactor = readNum("bioCaveRadiusFactor", 1);
        const threshold = 1 - Math.max(0.02, Math.min(0.45, caves * 0.12 * Math.max(0.3, radiusFactor)));
        for (let y = 1; y < top; y++) {
          for (let z = 0; z < size; z++) {
            for (let x = 0; x < size; x++) {
              if (fbm3(seed, x * 0.055, y * 0.07, z * 0.055, 3) > threshold) vox[idx(x, y, z)] = 0;
            }
          }
        }
        biomeSummary = `cave · density ${caves}`;
      }
      filled = true;
    }

    if (worldgen && state.biomesData && authoredId && worldgen.generateMultiBiomeField) {
      try {
        const data = Object.assign({}, state.biomesData);
        const prev = data[authoredId] || {};
        data[authoredId] = Object.assign({}, prev, {
          climate: prev.climate || [], chance: prev.chance || 1,
          minRadius: prev.minRadius || 320, maxRadius: prev.maxRadius || 360,
          minHeight: biomeParams.minHeight, maxHeight: biomeParams.maxHeight,
          minHeightLimit: biomeParams.minHeightLimit, maxHeightLimit: biomeParams.maxHeightLimit,
          roughness: biomeParams.roughness, hills: biomeParams.hills, mountains: biomeParams.mountains,
          isCave: false,
          groundStructure: layers.map((l) => (l.count > 1 ? `${l.count} ${l.block}` : l.block)),
          stoneBlock: stone,
        });
        const forced = {
          biomeId: authoredId,
          radius: Math.max(360, size * 4),
          height: (biomeParams.minHeight + biomeParams.maxHeight) / 2,
        };
        const field = worldgen.generateMultiBiomeField(data, BigInt(seed), size, 0, 0, WORLDGEN_WAVELENGTHS, forced);
        biomeOf = field.biomeIds;
        let mean = 0;
        for (const h of field.heights) mean += h;
        mean /= field.heights.length || 1;

        const counts = {};
        for (let z = 0; z < size; z++) {
          for (let x = 0; x < size; x++) {
            const hWorld = field.heights[x * size + z];
            let h = Math.round(surfaceAnchor + (hWorld - mean));
            h = Math.max(3, Math.min(H - 6, h));
            surfaceY[z * size + x] = h;
            const biomeId = field.biomeIds[x * size + z] || authoredId;
            counts[biomeId] = (counts[biomeId] || 0) + 1;
            const b = data[biomeId];
            const cellLayers = biomeId === authoredId ? layers : parseGroundEntries(b && b.groundStructure);
            const cellStone = b && b.stoneBlock ? b.stoneBlock : stone;
            let y = h;
            for (const layer of cellLayers) {
              let count = Math.max(1, Math.round(layer.count || 1));
              while (count-- > 0 && y > 0) { set(x, y, z, layer.block); y--; }
            }
            while (y > 0 && h - y < fillDepth) { set(x, y, z, cellStone); y--; }
          }
        }
        biomeSummary = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(", ");
        filled = true;
      } catch (_) {
        filled = false;
      }
    }

    if (!filled) {
      let heightField = null;
      if (worldgen && typeof worldgen.generateBiomeHeightField === "function") {
        try { heightField = worldgen.generateBiomeHeightField(biomeParams, BigInt(seed), size, 0, 0); } catch (_) { heightField = null; }
      }
      if (!heightField) {
        const amp = 2.5 + Math.max(0, biomeParams.roughness) * 1.4 + Math.max(0, biomeParams.hills) * 0.6 + Math.max(0, biomeParams.mountains) * 1.0;
        const sim = new Float32Array(size * size);
        let mn = Infinity, mx = -Infinity;
        for (let z = 0; z < size; z++)
          for (let x = 0; x < size; x++) {
            const broad = (fbm(seed ^ 0x9e3779b9, x * 0.02, z * 0.02, 2) - 0.5) * amp * 0.7;
            const detail = (fbm(seed, x * 0.07, z * 0.07, 4) - 0.5) * 2 * amp;
            sim[x * size + z] = broad + detail;
            if (sim[x * size + z] < mn) mn = sim[x * size + z];
            if (sim[x * size + z] > mx) mx = sim[x * size + z];
          }
        heightField = { heights: sim, size, min: mn, max: mx, mean: (mn + mx) / 2 };
      }
      for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
          const hWorld = heightField.heights[x * size + z];
          let h = Math.round(surfaceAnchor + (hWorld - heightField.mean));
          h = Math.max(3, Math.min(H - 6, h));
          surfaceY[z * size + x] = h;
          let y = h;
          for (const layer of layers) {
            let count = Math.max(1, Math.round(layer.count || 1));
            while (count-- > 0 && y > 0) { set(x, y, z, layer.block); y--; }
          }
          while (y > 0 && h - y < fillDepth) { set(x, y, z, stone); y--; }
        }
      }
    }

    state.biomeSummary = biomeSummary;

    // Structures: place each biome's real structures for the cells that belong
    // to it; the authored biome uses the form's structures so edits show up.
    const rng = mulberry32(seed);
    const authoredStructures = readStructures();
    const structuresFor = (biomeId) => {
      if (biomeId === authoredId) return authoredStructures;
      const b = state.biomesData && state.biomesData[biomeId];
      return (b && b.structures) || [];
    };
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const h = surfaceY[z * size + x];
        const biomeId = biomeOf ? biomeOf[x * size + z] || authoredId : authoredId;
        for (const s of structuresFor(biomeId)) {
          if (!s) continue;
          if (rng() < Math.min(0.9, s.chance || 0)) placeStructure(s, x, h, z, { set, rng, surfaceY, size });
        }
      }
    }

    return { vox, palette, size, H };
  }

  function placeStructure(s, x, h, z, ctx) {
    const { set, rng, surfaceY, size } = ctx;
    // Patch-like structures must sit on the *local* column's surface, not the
    // centre column's (otherwise they float on slopes / stack on each other).
    const localSurface = (nx, nz) => {
      if (nx < 0 || nx >= size || nz < 0 || nz >= size) return null;
      const sy = surfaceY[nz * size + nx];
      return Number.isFinite(sy) ? sy : null;
    };
    const B = (v) => nsBlock(v);
    if (s.id === "cubyz:simple_tree") {
      const log = B(s.log) || "cubyz:log/oak";
      const leaves = B(s.leaves) || "cubyz:leaves/oak";
      const variation = s.variation ?? s.height_variation ?? 3;
      const th = Math.max(2, Math.round((s.height || 6) + (rng() * 2 - 1) * variation));
      for (let k = 0; k < th; k++) set(x, h + 1 + k, z, log);
      const r = Math.max(1, Math.round(s.leafRadius || 2));
      const cy = h + th;
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++)
            if (dx * dx + dy * dy + dz * dz <= r * r + 0.5) set(x + dx, cy + dy, z + dz, leaves);
    } else if (s.id === "cubyz:simple_vegetation") {
      const block = B(s.block) || "cubyz:grass/vegetation/temperate";
      for (let k = 0; k < Math.max(1, s.height || 1); k++) set(x, h + 1 + k, z, block);
    } else if (s.id === "cubyz:flower_patch" || s.id === "cubyz:bush") {
      // Plants sit ON TOP of the surface block (never replace it), using each
      // column's own surface so they don't float on slopes.
      const block = B((s.blocks && s.blocks[0]) || s.block) || "cubyz:dandelions";
      const r = Math.max(1, Math.round((s.width || 5) / 2));
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz > r * r) continue;
          if (rng() > (s.density || 0.3)) continue;
          const sy = localSurface(x + dx, z + dz);
          if (sy === null) continue;
          set(x + dx, sy + 1, z + dz, block);
        }
    } else if (s.id === "cubyz:ground_patch") {
      // Ground patches DO replace the surface block.
      const block = B(s.block) || "cubyz:gravel";
      const r = Math.max(1, Math.round((s.width || 5) / 2));
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz > r * r) continue;
          const sy = localSurface(x + dx, z + dz);
          if (sy === null) continue;
          set(x + dx, sy, z + dz, block);
        }
    } else if (s.id === "cubyz:boulder") {
      const block = B(s.block) || "cubyz:slate/rough";
      const r = Math.max(1, Math.round((s.size || 5) / 2));
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++)
            if (dx * dx + dy * dy + dz * dz <= r * r) set(x + dx, h + dy, z + dz, block);
    } else if (s.id === "cubyz:fallen_tree") {
      const log = B(s.log) || "cubyz:log/oak";
      const len = Math.max(2, s.height || 6);
      const dz = rng() < 0.5 ? 1 : 0;
      const dx = dz ? 0 : 1;
      for (let k = 0; k < len; k++) set(x + dx * k, h + 1, z + dz * k, log);
    } else if (s.id === "cubyz:stalagmite") {
      const block = B(s.block) || "cubyz:slate/smooth";
      const th = Math.max(2, Math.round((s.size || 12) / 3));
      for (let k = 0; k < th; k++) {
        const rad = Math.max(0, Math.round((th - k) / 4));
        for (let dx = -rad; dx <= rad; dx++)
          for (let dz = -rad; dz <= rad; dz++) set(x + dx, h + 1 + k, z + dz, block);
      }
    } else if (s.id === "cubyz:sbb") {
      // Real SBB structures (trees etc.), composed from the game's .blp files.
      const structureId = String(s.structure || "");
      if (!structureId || !window.CubyzSbb) return;
      const st = state.sbb.get(structureId);
      if (!st) { ensureSbb(structureId); return; }
      const rng = window.CubyzSbb.makeRng(
        BigInt(state.seed) ^ BigInt((Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0)
      );
      window.CubyzSbb.composeResolved(st, rng, { x: 0, y: 0, z: 0 }, (sx, sy, sz, blockId) => {
        const block = nsBlock(blockId);
        if (!block || block === "cubyz:void") return;
        // SBB is X/Y horizontal + Z up; the preview is X/Z horizontal + Y up.
        set(x + sx, h + 1 + sz, z + sy, block);
      });
    }
  }

  function ensureSbb(structureId) {
    if (state.sbb.has(structureId)) return;
    state.sbb.set(structureId, null);
    if (!window.CubyzSbb) return;
    const baseUrl = `gamedata/${window.VERSION_PATH}`;
    window.CubyzSbb.loadStructure(baseUrl, structureId)
      .then((st) => {
        state.sbb.set(structureId, st || null);
        if (st) schedule(0);
      })
      .catch((err) => {
        status(`SBB load failed: ${structureId} (${err.message})`, true);
      });
  }

  // ---------- three.js ----------
  function loadThree() {
    if (state.THREE) return Promise.resolve(state.THREE);
    if (state.threePromise) return state.threePromise;
    state.threePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = THREE_URL;
      script.onload = () => {
        state.THREE = window.THREE;
        resolve(window.THREE);
      };
      script.onerror = () => reject(new Error("three.js failed to load"));
      document.head.appendChild(script);
    });
    return state.threePromise;
  }

  async function loadBlockTextures() {
    if (state.blockTextures) return state.blockTextures;
    try {
      const res = await fetch(window.gameDataUrl ? window.gameDataUrl("block_textures.json") : "block_textures.json");
      state.blockTextures = res.ok ? await res.json() : {};
    } catch (_) {
      state.blockTextures = {};
    }
    return state.blockTextures;
  }

  async function loadBiomesData() {
    if (state.biomesData) return state.biomesData;
    try {
      const res = await fetch(window.gameDataUrl ? window.gameDataUrl("biomes_data.json") : "biomes_data.json");
      state.biomesData = res.ok ? await res.json() : {};
    } catch (_) {
      state.biomesData = {};
    }
    return state.biomesData;
  }

  function stripNs(id) {
    return String(id || "").replace(/^[a-z0-9_]+:/, "");
  }

  function textureFor(texPath) {
    if (!texPath) return null;
    if (state.textureCache.has(texPath)) return state.textureCache.get(texPath);
    const THREE = state.THREE;
    const url = window.gameDataUrl ? window.gameDataUrl(`blocks/textures/${texPath}.png`) : `blocks/textures/${texPath}.png`;
    const tex = new THREE.TextureLoader().load(url, undefined, undefined, () => {
      state.textureCache.set(texPath, null);
    });
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    // Textures are authored in sRGB; without this three r128 treats the sampled
    // values as linear and the renderer re-encodes them, washing colours out.
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    state.textureCache.set(texPath, tex);
    return tex;
  }

  function colorFor(id) {
    if (state.colorCache.has(id)) return state.colorCache.get(id);
    const hue = (hashString(id) % 360) / 360;
    const color = new state.THREE.Color().setHSL(hue, 0.42, 0.5);
    state.colorCache.set(id, color);
    return color;
  }

  function blockInfo(id) {
    const bare = stripNs(id);
    let info = state.blockTextures ? state.blockTextures[bare] : null;
    if (!info && TEXTURE_ALIASES[bare]) info = state.blockTextures ? state.blockTextures[TEXTURE_ALIASES[bare]] : null;
    return info || null;
  }

  function geometryTypeFor(id) {
    const info = blockInfo(id);
    const model = (info && info.model) || "cube";
    if (model === "carpet") return "carpet";
    if (model === "plane") return "plane"; // single flat quad (flowers)
    if (PLANT_MODELS.has(model) || PLANT_PREFIXES.some((p) => model.startsWith(p))) return "cross";
    return "cube";
  }

  function buildGeometry(type) {
    const THREE = state.THREE;
    if (type === "cross" || type === "plane") {
      const cacheKey = type === "cross" ? "_crossGeo" : "_planeGeo";
      if (!state[cacheKey]) {
        const g = new THREE.BufferGeometry();
        let v, uv, n;
        if (type === "plane") {
          // Horizontal quad facing up, sitting just above the block below
          // (nudged up slightly so it doesn't z-fight with that block's top face).
          v = [-0.5, -0.47, -0.5, 0.5, -0.47, -0.5, 0.5, -0.47, 0.5, -0.5, -0.47, 0.5];
          uv = [0, 0, 1, 0, 1, 1, 0, 1];
          n = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
        } else {
          // Two intersecting diagonal planes (X).
          v = [-0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5];
          uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
          n = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
        }
        g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
        g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
        // Plane: wind so the up face is the front face (otherwise DoubleSide
        // lighting flips the normal and the quad renders dark).
        if (type === "plane") g.setIndex([0, 2, 1, 0, 3, 2]);
        state[cacheKey] = g;
      }
      return state[cacheKey];
    }
    if (type === "carpet") {
      if (!state._carpetGeo) {
        const g = new THREE.BoxGeometry(1, 0.125, 1);
        g.translate(0, -0.4375, 0);
        state._carpetGeo = g;
      }
      return state._carpetGeo;
    }
    if (!state._cubeGeo) state._cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    return state._cubeGeo;
  }

  function stoneMaterials() {
    if (state._stoneMats) return state._stoneMats;
    const THREE = state.THREE;
    const info = state.blockTextures ? state.blockTextures["slate/smooth"] : null;
    const tex = info ? textureFor(info.texture) : null;
    const mk = () => tex ? new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 }) : new THREE.MeshLambertMaterial({ color: 0x777777 });
    state._stoneMats = [mk(), mk(), mk(), mk(), mk(), mk()];
    return state._stoneMats;
  }

  function materialsFor(id, type, info) {
    const THREE = state.THREE;
    if (type === "cross" || type === "plane") {
      const tex = info ? textureFor(info.texture) : null;
      return tex
        ? new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5 })
        : new THREE.MeshLambertMaterial({ color: colorFor(id), side: THREE.DoubleSide, alphaTest: 0.5 });
    }
    if (type === "carpet") {
      const tex = info ? textureFor(info.top || info.texture) : null;
      return tex ? new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 }) : new THREE.MeshLambertMaterial({ color: colorFor(id) });
    }
    const sideTex = info ? textureFor(info.texture) : null;
    const topTex = info ? textureFor(info.top || info.texture) : null;
    const bottomTex = info ? textureFor(info.bottom || info.texture) : null;
    const translucent = !!(info && info.transparent && !info.viewThrough);
    const viewThrough = !!(info && info.viewThrough);
    const isOre = !!(info && info.rotation === "ore");
    const mk = (tex) => {
      if (!tex) return new THREE.MeshLambertMaterial({ color: colorFor(id) });
      const params = { map: tex };
      if (translucent) {
        params.transparent = true;
        params.alphaTest = 0.02;
        params.depthWrite = false;
      } else {
        params.alphaTest = 0.5;
      }
      if (viewThrough) params.side = THREE.DoubleSide;
      if (isOre) {
        // Draw the ore spots just in front of the base stone to avoid z-fighting.
        params.polygonOffset = true;
        params.polygonOffsetFactor = -1;
        params.polygonOffsetUnits = -1;
      }
      return new THREE.MeshLambertMaterial(params);
    };
    return [mk(sideTex), mk(sideTex), mk(topTex), mk(bottomTex), mk(sideTex), mk(sideTex)];
  }

  function makeInstanced(geometry, materials, capacity) {
    const THREE = state.THREE;
    const mesh = new THREE.InstancedMesh(geometry, materials, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    state.scene.add(mesh);
    return mesh;
  }

  function ensureMesh(index, id, capacity) {
    const info = blockInfo(id);
    const type = geometryTypeFor(id);
    let entry = state.meshes.get(index);
    if (entry && entry.id === id && entry.type === type && entry.capacity >= capacity) {
      entry.mesh.count = capacity;
      if (entry.baseMesh) entry.baseMesh.count = capacity;
      return entry;
    }
    if (entry) {
      state.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.dispose();
      if (entry.baseMesh) {
        state.scene.remove(entry.baseMesh);
        entry.baseMesh.geometry.dispose();
        entry.baseMesh.dispose();
      }
    }
    const geometry = buildGeometry(type);
    const materials = materialsFor(id, type, info);
    const mesh = makeInstanced(geometry, materials, capacity);
    // Ore blocks are an overlay on a host stone block; draw the stone behind.
    const isOre = !!(info && info.rotation === "ore" && type === "cube");
    const baseMesh = isOre ? makeInstanced(buildGeometry("cube"), stoneMaterials(), capacity) : null;
    entry = { mesh, baseMesh, capacity, materials, id, type };
    state.meshes.set(index, entry);
    return entry;
  }

  function updateMeshes(gen) {
    const { vox, palette, size, H } = gen;
    const index = (x, y, z) => (y * size + z) * size + x;
    const counts = new Array(palette.length).fill(0);
    const at = (x, y, z) => (x < 0 || x >= size || z < 0 || z >= size || y < 0 || y >= H) ? 0 : vox[index(x, y, z)];
    // Plants/carpets don't occlude neighbouring faces, and are never hidden by
    // them (otherwise a flower would cull the top face of the block below it).
    const nonOccluding = palette.map((id) => geometryTypeFor(id) !== "cube");
    const solid = (x, y, z) => {
      const v = at(x, y, z);
      return !!v && !nonOccluding[v];
    };
    const visible = (x, y, z) => {
      const v = at(x, y, z);
      if (!v) return false;
      if (nonOccluding[v]) return true;
      return !(solid(x + 1, y, z) && solid(x - 1, y, z) && solid(x, y + 1, z) && solid(x, y - 1, z) && solid(x, y, z + 1) && solid(x, y, z - 1));
    };

    for (let y = 0; y < H; y++)
      for (let z = 0; z < size; z++)
        for (let x = 0; x < size; x++) {
          const v = vox[index(x, y, z)];
          if (v && visible(x, y, z)) counts[v]++;
        }

    const arrays = counts.map((c) => (c ? new Float32Array(c * 3) : null));
    const cursors = new Array(palette.length).fill(0);
    for (let y = 0; y < H; y++)
      for (let z = 0; z < size; z++)
        for (let x = 0; x < size; x++) {
          const v = vox[index(x, y, z)];
          if (!v || !visible(x, y, z)) continue;
          const a = arrays[v], c = cursors[v]++;
          a[c * 3] = x - size / 2 + 0.5;
          a[c * 3 + 1] = y - H / 2 + 0.5;
          a[c * 3 + 2] = z - size / 2 + 0.5;
        }

    const m = new state.THREE.Matrix4();
    let total = 0;
    const updated = new Set();
    for (let i = 1; i < palette.length; i++) {
      const count = counts[i];
      if (!count) {
        const existing = state.meshes.get(i);
        if (existing) {
          existing.mesh.count = 0;
          if (existing.baseMesh) existing.baseMesh.count = 0;
        }
        continue;
      }
      const entry = ensureMesh(i, palette[i], count);
      const arr = arrays[i];
      for (let k = 0; k < count; k++) {
        m.makeTranslation(arr[k * 3], arr[k * 3 + 1], arr[k * 3 + 2]);
        entry.mesh.setMatrixAt(k, m);
        if (entry.baseMesh) entry.baseMesh.setMatrixAt(k, m);
      }
      entry.mesh.instanceMatrix.needsUpdate = true;
      entry.mesh.count = count;
      if (entry.baseMesh) {
        entry.baseMesh.instanceMatrix.needsUpdate = true;
        entry.baseMesh.count = count;
      }
      updated.add(i);
      total += count;
    }
    // Hide any mesh whose palette index no longer exists (e.g. after removing
    // the structure that was the only source of that block).
    for (const [idx, entry] of state.meshes) {
      if (updated.has(idx)) continue;
      entry.mesh.count = 0;
      if (entry.baseMesh) entry.baseMesh.count = 0;
    }
    return total;
  }

  function updateCamera() {
    if (!state.camera) return;
    const { theta, phi, radius, target } = state;
    const sp = Math.sin(phi);
    state.camera.position.set(
      target.x + radius * sp * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * sp * Math.cos(theta)
    );
    state.camera.lookAt(target.x, target.y, target.z);
  }

  function fitCamera() {
    state.radius = state.size * 2.3;
    state.target = { x: 0, y: 0, z: 0 };
    state.theta = 0.85;
    state.phi = 1.02;
    updateCamera();
  }

  function render() {
    if (state.renderer && state.scene && state.camera) state.renderer.render(state.scene, state.camera);
  }

  function resize() {
    if (!state.renderer || !state.container) return;
    const w = state.container.clientWidth || 640;
    const h = state.container.clientHeight || 420;
    state.renderer.setSize(w, h, false);
    state.camera.aspect = w / Math.max(1, h);
    state.camera.updateProjectionMatrix();
    render();
  }

  function applyEnvironment() {
    const THREE = state.THREE;
    const sky = readColor("bioSkyColor", "#75b2ff");
    const fog = readColor("bioFogColor", "#e2f2ff");
    const density = readNum("bioFogDensity", 1.5);
    state.scene.background = new THREE.Color(sky);
    // Keep fog well behind the chunk so it adds atmosphere without tinting the
    // terrain a pale colour (the default density put the chunk inside the fog).
    const far = state.size * (7 + 6 / Math.max(0.2, density));
    state.scene.fog = new THREE.Fog(fog, state.size * 3.5, far);
  }

  function activeSize() {
    const btn = document.querySelector("#chunkPreviewSizes button.active");
    return parseInt(btn?.dataset.size) || 64;
  }

  function rebuild() {
    if (state.disposed || !state.initialized) return;
    try {
      const nextSize = activeSize();
      if (nextSize !== state.size) {
        state.size = nextSize;
        fitCamera();
        updateHelpers();
      }
      applyEnvironment();
      const total = updateMeshes(generate(state.size));
      render();
      status(`${total.toLocaleString()} blocks · ${state.size}³ · ${state.biomeSummary || "single biome"} · seed ${state.seed}`);
    } catch (err) {
      status(`Preview error: ${err.message}`, true);
    }
  }

  // ---------- controls ----------
  function attachControlListeners() {
    const canvas = state.canvas;
    if (!canvas) return;
    const down = (e) => { state.dragging = true; state.lastX = e.clientX; state.lastY = e.clientY; canvas.setPointerCapture?.(e.pointerId); };
    const move = (e) => {
      if (!state.dragging) return;
      const dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
      state.lastX = e.clientX; state.lastY = e.clientY;
      if (state.flyMode) {
        state.yaw -= dx * 0.005;
        state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - dy * 0.005));
      } else {
        state.theta -= dx * 0.008;
        state.phi = Math.max(0.12, Math.min(Math.PI - 0.12, state.phi - dy * 0.008));
        updateCamera();
      }
    };
    const up = (e) => { state.dragging = false; canvas.releasePointerCapture?.(e.pointerId); };
    const wheel = (e) => {
      e.preventDefault();
      if (state.flyMode && state.flyPos) {
        state.flyPos.addScaledVector(forwardVector(), -Math.sign(e.deltaY) * state.size * 0.08);
      } else {
        const min = Math.max(1.5, state.size * 0.12);
        state.radius = Math.max(min, Math.min(state.size * 8, state.radius * (1 + Math.sign(e.deltaY) * 0.12)));
        updateCamera();
      }
    };
    canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    state.listeners.push(() => {
      canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      canvas.removeEventListener("wheel", wheel);
    });
  }

  function lookEuler() {
    return new state.THREE.Euler(state.pitch, state.yaw, 0, "YXZ");
  }

  function forwardVector() {
    return new state.THREE.Vector3(0, 0, -1).applyEuler(lookEuler());
  }

  function attachKeyListeners() {
    const down = (e) => {
      if (!state.flyMode) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      state.keys[e.key.toLowerCase()] = true;
    };
    const up = (e) => { state.keys[e.key.toLowerCase()] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    state.listeners.push(() => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    });
  }

  function updateFly(dt) {
    if (!state.flyMode || !state.camera || !state.flyPos) return;
    const THREE = state.THREE;
    const euler = lookEuler();
    const speed = (state.keys["shift"] ? 4 : 1.6) * state.size * 0.35 * dt;
    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(euler);
    const right = new THREE.Vector3(1, 0, 0).applyEuler(euler);
    const move = new THREE.Vector3();
    if (state.keys["w"]) move.add(fwd);
    if (state.keys["s"]) move.sub(fwd);
    if (state.keys["d"]) move.add(right);
    if (state.keys["a"]) move.sub(right);
    if (state.keys["e"]) move.y += 1;
    if (state.keys["q"]) move.y -= 1;
    if (move.lengthSq() > 0) state.flyPos.addScaledVector(move.normalize(), speed);
    state.camera.position.copy(state.flyPos);
    state.camera.quaternion.setFromEuler(euler);
  }

  function animate() {
    if (state.disposed || !state.initialized) return;
    state.rafId = requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min(0.1, (now - (state._last || now)) / 1000);
    state._last = now;
    if (state.flyMode) updateFly(dt);
    if (state.renderer && state.scene && state.camera) state.renderer.render(state.scene, state.camera);
    state._frames++;
    if (!state._fpsTime) state._fpsTime = now;
    if (now - state._fpsTime >= 500) {
      state.fps = Math.round((state._frames * 1000) / (now - state._fpsTime));
      state._frames = 0;
      state._fpsTime = now;
      if (state.showFps) updateStats();
    }
  }

  function updateHelpers() {
    if (!state.scene) return;
    const THREE = state.THREE;
    if (state.gridSize !== state.size || !state.gridHelper) {
      state.gridSize = state.size;
      if (state.gridHelper) { state.scene.remove(state.gridHelper); state.gridHelper.geometry.dispose(); state.gridHelper.material.dispose(); }
      state.gridHelper = new THREE.GridHelper(state.size * 2, Math.max(4, Math.round(state.size / 4)), 0x888888, 0x444444);
      state.gridHelper.position.y = -state.size / 2;
      state.scene.add(state.gridHelper);
      if (state.axesHelper) { state.scene.remove(state.axesHelper); if (state.axesHelper.dispose) state.axesHelper.dispose(); }
      state.axesHelper = new THREE.AxesHelper(state.size * 0.6);
      state.scene.add(state.axesHelper);
    }
    if (state.gridHelper) state.gridHelper.visible = state.showGrid;
    if (state.axesHelper) state.axesHelper.visible = state.showAxes;
  }

  function toggleFly() {
    state.flyMode = !state.flyMode;
    if (state.flyMode) {
      state.flyPos = state.camera.position.clone();
      const dir = new state.THREE.Vector3(state.target.x, state.target.y, state.target.z).sub(state.camera.position).normalize();
      state.yaw = Math.atan2(-dir.x, -dir.z);
      state.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
      state.keys = {};
    } else {
      fitCamera();
    }
  }

  function attachToggles() {
    const toggles = document.getElementById("chunkPreviewToggles");
    if (!toggles) return;
    const onClick = (e) => {
      const btn = e.target.closest("button[data-toggle]");
      if (!btn) return;
      const key = btn.dataset.toggle;
      if (key === "grid") state.showGrid = !state.showGrid;
      else if (key === "axes") state.showAxes = !state.showAxes;
      else if (key === "fps") state.showFps = !state.showFps;
      else if (key === "fly") toggleFly();
      const active = key === "grid" ? state.showGrid : key === "axes" ? state.showAxes : key === "fps" ? state.showFps : state.flyMode;
      btn.classList.toggle("active", active);
      updateHelpers();
      updateStats();
      const hint = document.getElementById("chunkPreviewHint");
      if (hint) hint.textContent = state.flyMode ? "WASD move · Q/E down/up · Shift fast · drag to look" : "Drag to orbit · scroll to zoom";
    };
    toggles.addEventListener("click", onClick);
    state.listeners.push(() => toggles.removeEventListener("click", onClick));
  }

  function attachFormListeners() {
    const workspace = document.getElementById("dynamicWorkspace");
    if (workspace) {
      const onChange = (e) => {
        if (e.target && e.target.id && e.target.id.startsWith("chunkPreview")) return;
        // Texture search inputs: wait until a value is committed (blur/select),
        // not on every keystroke.
        const t = e.target;
        const isTextureSearch = t && t.tagName === "INPUT" && t.type === "text" &&
          typeof t.getAttribute === "function" && (t.getAttribute("oninput") || "").includes("filterDropdown");
        if (e.type === "input" && isTextureSearch) return;
        // Numbers/text: debounce so typing doesn't rebuild on every keystroke.
        schedule(e.type === "change" ? 0 : 280);
      };
      workspace.addEventListener("input", onChange, true);
      workspace.addEventListener("change", onChange, true);
      state.listeners.push(() => {
        workspace.removeEventListener("input", onChange, true);
        workspace.removeEventListener("change", onChange, true);
      });
    }
    const sizes = document.getElementById("chunkPreviewSizes");
    if (sizes) {
      const onClick = (e) => {
        const btn = e.target.closest("button[data-size]");
        if (!btn) return;
        sizes.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
        schedule(0);
      };
      sizes.addEventListener("click", onClick);
      state.listeners.push(() => sizes.removeEventListener("click", onClick));
    }
    const seedInput = document.getElementById("chunkPreviewSeed");
    if (seedInput) {
      const onSeed = () => {
        const n = parseInt(seedInput.value);
        state.seed = Number.isFinite(n) ? n : hashString(seedInput.value || "0");
        schedule(0);
      };
      seedInput.addEventListener("change", onSeed);
      state.listeners.push(() => seedInput.removeEventListener("change", onSeed));
    }
    // Adding/removing a structure or ground layer must refresh the preview now.
    const observer = new MutationObserver(() => schedule(0));
    ["biomeStructuresContainer", "bioGroundLayers"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { childList: true });
    });
    state.listeners.push(() => observer.disconnect());
  }

  function dispose() {
    state.disposed = true;
    clearTimeout(state.scheduled);
    cancelAnimationFrame(state.rafId);
    state.listeners.forEach((fn) => { try { fn(); } catch (_) {} });
    state.listeners = [];
    if (state.renderer) {
      try { state.renderer.dispose(); } catch (_) {}
      try { if (state.renderer.forceContextLoss) state.renderer.forceContextLoss(); } catch (_) {}
    }
    state.renderer = null;
    state.scene = null;
    state.camera = null;
    state.canvas = null;
    state.container = null;
    state.meshes = new Map();
    state._crossGeo = null;
    state._planeGeo = null;
    state._carpetGeo = null;
    state._cubeGeo = null;
    state._stoneMats = null;
    state.gridHelper = null;
    state.axesHelper = null;
    state.gridSize = 0;
    state.initialized = false;
  }

  async function initBiomePreview() {
    if (state.initialized) dispose();
    state.disposed = false;
    state.size = activeSize();
    const seedEl = document.getElementById("chunkPreviewSeed");
    if (seedEl && seedEl.value) {
      const n = parseInt(seedEl.value);
      state.seed = Number.isFinite(n) ? n : hashString(seedEl.value);
    } else if (seedEl) {
      seedEl.value = String(state.seed);
    }

    const canvas = document.getElementById("chunkPreviewCanvas");
    const container = document.getElementById("chunkPreviewContainer");
    if (!canvas || !container) return;
    state.canvas = canvas;
    state.container = container;

    try {
      status("Loading preview…");
      const THREE = await loadThree();
      await loadBlockTextures();
      await loadBiomesData();
      if (state.disposed) return;

      state.scene = new THREE.Scene();
      state.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 6000);
      state.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      state.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      if (THREE.sRGBEncoding) state.renderer.outputEncoding = THREE.sRGBEncoding;

      state.scene.add(new THREE.HemisphereLight(0xffffff, 0x3c4149, 0.55));
      const sun = new THREE.DirectionalLight(0xffffff, 0.5);
      sun.position.set(1, 1.6, 0.8);
      state.scene.add(sun);

      fitCamera();
      resize();
      updateHelpers();
      attachControlListeners();
      attachKeyListeners();
      attachToggles();
      attachFormListeners();
      state.initialized = true;
      rebuild();
      animate();
      window.addEventListener("resize", resize);
      state.listeners.push(() => window.removeEventListener("resize", resize));
    } catch (err) {
      status(`Could not start preview: ${err.message}`, true);
    }
  }

  window.initBiomePreview = initBiomePreview;
  window.disposeBiomePreview = dispose;
  window.scheduleBiomePreview = () => schedule(0);
  window.refreshChunkPreview = () => (state.initialized ? rebuild() : initBiomePreview());
  window.randomizeChunkSeed = () => {
    const seedEl = document.getElementById("chunkPreviewSeed");
    state.seed = Math.floor(Math.random() * 2147483647);
    if (seedEl) seedEl.value = String(state.seed);
    schedule(0);
  };
})();
