// Faithful JavaScript port of Cubyz's terrain-generation primitives.
//
// Ported from the game source (src/random.zig, src/server/terrain/noise/*.zig,
// src/server/terrain/mapgen/MapGenV1.zig) so the Addon Creator's chunk preview
// can reproduce the same terrain shape the game generates for a given seed.
//
// Deterministic: uses the game's 48-bit Java-style LCG and exact seed mixing.
// BigInt is used for seed arithmetic (seeds are u64 in Zig); the hot math that
// does not touch seeds stays in Number.

(function () {
  "use strict";

  const U64 = (1n << 64n) - 1n;
  const M48 = (1n << 48n) - 1n;
  const MULT = 0x5deece66dn;
  const ADD = 0xbn;
  const TWO24 = 1 << 24;
  const TWO23 = 1 << 23;

  // ---- random.zig -------------------------------------------------------
  function scrambleSeed(seed) {
    return (seed ^ MULT) & M48;
  }

  function lcgNext(seed) {
    return (seed * MULT + ADD) & M48;
  }

  function nextWithBitSize(seed, bits) {
    const s = lcgNext(seed);
    const v = Number((s >> BigInt(48 - bits)) & ((1n << BigInt(bits)) - 1n));
    return [s, v];
  }

  function nextFloat(seed) {
    const [s, v] = nextWithBitSize(seed, 24);
    return [s, v / TWO24];
  }

  function nextFloatSigned(seed) {
    const [s, v] = nextWithBitSize(seed, 24);
    const signed = (v << 8) >> 8; // sign-extend 24-bit
    return [s, signed / TWO23];
  }

  function nextU32(seed) {
    return nextWithBitSize(seed, 32);
  }

  function nextU64(seed) {
    let s, a, b;
    [s, a] = nextWithBitSize(seed, 32);
    [s, b] = nextWithBitSize(s, 32);
    return [s, (BigInt(a) << 32n) | BigInt(b)];
  }

  function nextIntBounded(seed, bound) {
    if (bound <= 0) return [seed, 0];
    const bitSize = Math.ceil(Math.log2(bound));
    let s = seed, v;
    do {
      [s, v] = nextWithBitSize(s, bitSize);
    } while (v >= bound);
    return [s, v];
  }

  function initSeed2D(worldSeed, x, y) {
    const sx = Math.imul(11248723, x | 0);
    const sy = Math.imul(105436839, y | 0);
    const seed = (sx ^ sy) >>> 0;
    return BigInt(seed) ^ worldSeed;
  }

  function toU64(value) {
    const b = BigInt(value);
    return b & U64;
  }

  // ---- ValueNoise.zig ---------------------------------------------------
  function getSeedX(x, worldSeed) {
    return worldSeed ^ ((54275629861n * BigInt((Math.trunc(x) | 0) >>> 0)) & U64);
  }

  function getSeedY(x, worldSeed) {
    return worldSeed ^ ((5478938690717n * BigInt((Math.trunc(x) | 0) >>> 0)) & U64);
  }

  function getGridValue1D(x, worldSeed) {
    const [_, v] = nextFloat(getSeedX(x, worldSeed));
    return v;
  }

  function samplePoint1D(_x, lineSeed) {
    let seed = lineSeed;
    let r;
    [seed, r] = nextFloat(seed);
    const x = _x + 0.0001 * r;
    const start = Math.floor(x);
    const interp = x - start;
    return (1 - interp) * getGridValue1D(start, lineSeed) + interp * getGridValue1D(start + 1, lineSeed);
  }

  function sampleValueNoise2D(x, _y, worldSeed) {
    let seed = worldSeed;
    let r;
    [seed, r] = nextFloat(seed);
    const y = _y + r;
    let lineSeed;
    [seed, lineSeed] = nextU64(seed);
    const start = Math.floor(y);
    const interp = y - start;
    const lower = samplePoint1D(x, getSeedY(start, lineSeed));
    const upper = samplePoint1D(x, getSeedY(start + 1, lineSeed));
    return (1 - interp) * lower + interp * upper;
  }

  // ---- FractalNoise.zig / RandomlyWeightedFractalNoise.zig --------------
  function fractalSetSeed(x, y, offsetX, offsetY, worldSeed, scale, maxResolution) {
    const wsMul = toU64(worldSeed * BigInt((scale * maxResolution) | 1));
    return initSeed2D(wsMul, Math.imul(offsetX + x, maxResolution) | 0, Math.imul(offsetY + y, maxResolution) | 0);
  }

  function maskedWx(wx, mask) {
    return wx & ~mask;
  }

  function generateFractalTerrain(wx, wy, x0, y0, width, height, scale, worldSeed, map, maxResolution, weighted) {
    const max = scale + 1;
    const mask = scale - 1;
    const bigMap = new Float32Array(max * max);
    const offsetX = maskedWx(wx, mask);
    const offsetY = maskedWx(wy, mask);
    const setBig = (x, y, v) => { bigMap[x * max + y] = v; };

    setBig(0, 0, nextFloat(fractalSetSeed(0, 0, offsetX, offsetY, worldSeed, scale, maxResolution))[1]);
    setBig(0, scale, nextFloat(fractalSetSeed(0, scale, offsetX, offsetY, worldSeed, scale, maxResolution))[1]);
    setBig(scale, 0, nextFloat(fractalSetSeed(scale, 0, offsetX, offsetY, worldSeed, scale, maxResolution))[1]);
    setBig(scale, scale, nextFloat(fractalSetSeed(scale, scale, offsetX, offsetY, worldSeed, scale, maxResolution))[1]);

    generateInitializedFractalTerrain(offsetX, offsetY, scale, scale, worldSeed, bigMap, max, weighted, maxResolution);

    for (let px = 0; px < width; px++) {
      const sx = (wx & mask) + px;
      for (let py = 0; py < height; py++) {
        const sy = (wy & mask) + py;
        map.set(x0 + px, y0 + py, bigMap[sx * max + sy]);
      }
    }
  }

  function generateInitializedFractalTerrain(offsetX, offsetY, scale, startingScale, worldSeed, bigMap, max, weighted, maxResolution) {
    const get = (x, y) => bigMap[x * max + y];
    const set = (x, y, v) => { bigMap[x * max + y] = v; };
    let res = startingScale / 2;
    while (res >= 1) {
      const randomnessScale = res / scale / 2;
      for (let x = 0; x < max; x += 2 * res) {
        for (let y = res; y + res < max; y += 2 * res) {
          let seed = fractalSetSeed(x, y, offsetX, offsetY, worldSeed, res, maxResolution);
          let w, r;
          [seed, w] = nextFloat(seed);
          [seed, r] = nextFloatSigned(seed);
          const v = weighted
            ? get(x, y - res) * (1 - w) + get(x, y + res) * w + r * randomnessScale
            : (get(x, y - res) + get(x, y + res)) / 2 + r * randomnessScale;
          set(x, y, weighted ? v : clamp(v, 0, 0.9999));
        }
      }
      for (let x = res; x + res < max; x += 2 * res) {
        for (let y = 0; y < max; y += 2 * res) {
          let seed = fractalSetSeed(x, y, offsetX, offsetY, worldSeed, res, maxResolution);
          let w, r;
          [seed, w] = nextFloat(seed);
          [seed, r] = nextFloatSigned(seed);
          const v = weighted
            ? get(x - res, y) * (1 - w) + get(x + res, y) * w + r * randomnessScale
            : (get(x - res, y) + get(x + res, y)) / 2 + r * randomnessScale;
          set(x, y, weighted ? v : clamp(v, 0, 0.9999));
        }
      }
      for (let x = res; x + res < max; x += 2 * res) {
        for (let y = res; y + res < max; y += 2 * res) {
          let seed = fractalSetSeed(x, y, offsetX, offsetY, worldSeed, res, maxResolution);
          let w1, w2, r;
          [seed, w1] = nextFloat(seed);
          [seed, w2] = nextFloat(seed);
          [seed, r] = nextFloatSigned(seed);
          const v = weighted
            ? (get(x - res, y - res) * (1 - w1) + get(x - res, y + res) * w1) * (1 - w2) +
              (get(x + res, y - res) * (1 - w1) + get(x + res, y + res) * w1) * w2 + r * randomnessScale
            : (get(x - res, y - res) + get(x - res, y + res) + get(x + res, y - res) + get(x + res, y + res)) / 4 + r * randomnessScale;
          set(x, y, weighted ? v : clamp(v, 0, 0.9999));
        }
      }
      res = Math.floor(res / 2);
    }
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // A dense Array2D-style buffer for the noise maps.
  function makeMap(width, height) {
    const data = new Float32Array(width * height);
    return {
      width, height, data,
      get: (x, y) => data[x * height + y],
      set: (x, y, v) => { data[x * height + y] = v; },
    };
  }

  // generateSparseFractalTerrain(wx, wy, scale, worldSeed, map, maxResolution)
  function generateSparseFractalTerrain(wx, wy, scale, worldSeed, map, maxResolution, weighted) {
    const scaledWx = Math.floor(wx / maxResolution);
    const scaledWy = Math.floor(wy / maxResolution);
    const scaledScale = Math.floor(scale / maxResolution);
    for (let x0 = 0; x0 < map.width; x0 += scaledScale) {
      for (let y0 = 0; y0 < map.height; y0 += scaledScale) {
        generateFractalTerrain(
          Math.imul(scaledWx, 1) + x0 | 0,
          Math.imul(scaledWy, 1) + y0 | 0,
          x0, y0,
          Math.min(map.width - x0, scaledScale),
          Math.min(map.height - y0, scaledScale),
          scaledScale, worldSeed, map, maxResolution, weighted
        );
      }
    }
  }

  // ---- PerlinNoise.zig --------------------------------------------------
  function sCurve(x) {
    return 3 * x * x - 2 * x * x * x;
  }

  function generateSmoothNoise(x, y, width, height, maxScale, minScale, worldSeed, voxelSize, reductionFactor) {
    const map = makeMap(Math.floor(width / voxelSize), Math.floor(height / voxelSize));
    let seed = worldSeed;
    seed = scrambleSeed(seed);
    let l1, l2, l3;
    [seed, l1] = nextU64(seed);
    [seed, l2] = nextU64(seed);
    [seed, l3] = nextU64(seed);
    l1 = BigInt(l1); l2 = BigInt(l2); l3 = BigInt(l3);

    const octaves = Math.log2(maxScale / minScale) + 1;
    let fac = 1 / ((1 - Math.pow(reductionFactor, octaves)) / (1 - reductionFactor));

    let scale = maxScale;
    while (scale >= minScale) {
      const resolutionMask = scale - 1;
      const resShift = Math.log2(scale) | 0;
      // Precompute gradients lazily per grid point (cache).
      const gradCacheX = new Map();
      const gradCacheY = new Map();
      const gradient = (gx, gy, i) => {
        const key = gx * 1000003 + gy;
        const cache = i === 0 ? gradCacheX : gradCacheY;
        if (cache.has(key)) return cache.get(key);
        let s = toU64(l1 * BigInt(Math.imul(gx, 1) >>> 0) + l2 * BigInt(Math.imul(gy, 1) >>> 0) + l3 * BigInt(i) + BigInt(resShift));
        s = scrambleSeed(s);
        const v = 2 * nextFloat(s)[1] - 1;
        cache.set(key, v);
        return v;
      };
      const dotGrid = (ix, iy, px, py) => {
        const dx = px / scale - ix;
        const dy = py / scale - iy;
        let gx = gradient(ix, iy, 0);
        let gy = gradient(ix, iy, 1);
        const gr = Math.sqrt(gx * gx + gy * gy) || 1;
        gx /= gr; gy /= gr;
        return dx * gx + dy * gy;
      };
      const perlin = (px, py) => {
        const x0 = Math.floor(px / scale);
        const y0 = Math.floor(py / scale);
        const sx = sCurve((px & resolutionMask) / scale);
        const sy = sCurve((py & resolutionMask) / scale);
        const n00 = dotGrid(x0, y0, px, py);
        const n01 = dotGrid(x0, y0 + 1, px, py);
        const n10 = dotGrid(x0 + 1, y0, px, py);
        const n11 = dotGrid(x0 + 1, y0 + 1, px, py);
        const n0 = n00 + sy * (n01 - n00);
        const n1 = n10 + sy * (n11 - n10);
        return n0 + sx * (n1 - n0);
      };

      const x0 = x & ~resolutionMask;
      const y0 = y & ~resolutionMask;
      for (let x1 = x; x1 - width - x < 0; x1 += voxelSize) {
        for (let y1 = y; y1 - y - height < 0; y1 += voxelSize) {
          map.data[((x1 - x) / voxelSize) * map.height + (y1 - y) / voxelSize] += Math.abs(perlin(x1 - x0, y1 - y0)) * fac;
        }
      }
      fac *= reductionFactor;
      scale >>= 1;
    }
    return map;
  }

  // ---- MapGenV1.zig (single-biome) --------------------------------------
  // Produces the same height field the game computes inside one biome:
  //   height = biomeHeight + (rough-0.5)*2*roughness
  //                       + (hill -0.5)*2*hills
  //                       + (mount-0.5)*2*mountains
  // biomeHeight is constant for a single biome; the game picks it per Voronoi
  // blob as random(minHeight..maxHeight).
  function generateBiomeHeightField(biome, worldSeed, size, wx, wy) {
    const voxelSize = 1;
    const rough = makeMap(size, size);
    generateSparseFractalTerrain(wx, wy, 64, worldSeed ^ 954936678493n, rough, voxelSize, false);
    const mountain = makeMap(size, size);
    generateSparseFractalTerrain(wx, wy, 256, worldSeed ^ 6758947592930535n, mountain, voxelSize, true);
    const hill = generateSmoothNoise(wx, wy, size, size, 128, 32, worldSeed ^ 157839765839495820n, voxelSize, 0.5);

    const minH = Number.isFinite(biome.minHeight) ? biome.minHeight : 0;
    const maxH = Number.isFinite(biome.maxHeight) ? biome.maxHeight : minH;
    const base = minH + nextFloat(initSeed2D(worldSeed, wx, wy))[1] * (maxH - minH);
    const roughness = Number.isFinite(biome.roughness) ? biome.roughness : 0;
    const hills = Number.isFinite(biome.hills) ? biome.hills : 0;
    const mountains = Number.isFinite(biome.mountains) ? biome.mountains : 0;
    const floor = biome.minHeightLimit;
    const ceil = biome.maxHeightLimit;

    const heights = new Float32Array(size * size);
    let mn = Infinity, mx = -Infinity;
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        let h = base
          + (rough.get(x, y) - 0.5) * 2 * roughness
          + (hill.get(x, y) - 0.5) * 2 * hills
          + (mountain.get(x, y) - 0.5) * 2 * mountains;
        if (Number.isFinite(floor)) h = Math.max(h, floor);
        if (Number.isFinite(ceil)) h = Math.min(h, ceil);
        heights[x * size + y] = h;
        if (h < mn) mn = h;
        if (h > mx) mx = h;
      }
    }
    return { heights, size, min: mn, max: mx, mean: (mn + mx) / 2, base };
  }

  // ---- ValueNoise.percentile -------------------------------------------
  const PERCENTILE_TABLE = [0,0.09205693,0.118748918,0.1381177,0.153936773,0.167584523,0.179740771,0.190797567,0.201004371,0.210530936,0.219498828,0.227998286,0.236098647,0.243854254,0.251308768,0.258497864,0.265450924,0.272192806,0.278744399,0.285123795,0.29134646,0.297426044,0.303374379,0.309202045,0.314918369,0.320531696,0.326049506,0.331478625,0.336825191,0.342094779,0.347292482,0.352423042,0.357490718,0.362499535,0.367453157,0.372355014,0.377208292,0.382015973,0.386780887,0.391505628,0.396192669,0.400844365,0.40546292,0.410050421,0.414608865,0.41914016,0.423646122,0.42812851,0.432588934,0.437029063,0.441450417,0.445854485,0.450242727,0.454616576,0.458977371,0.463326483,0.467665165,0.471994757,0.476316481,0.480631619,0.484941333,0.489246904,0.493549466,0.497850269,0.502150475,0.506451249,0.51075381,0.515059411,0.519369125,0.523684263,0.528005957,0.532335579,0.536674261,0.541023373,0.545384168,0.549758017,0.55414623,0.558550298,0.562971651,0.56741178,0.571872234,0.576354622,0.580860555,0.585391879,0.589950323,0.594537794,0.599156379,0.603808045,0.608495116,0.613219857,0.617984771,0.622792422,0.62764573,0.632547557,0.63750118,0.642509996,0.647577702,0.652708232,0.657905936,0.663175523,0.668522059,0.673951208,0.679469048,0.685082376,0.69079864,0.696626305,0.70257467,0.708654224,0.714876949,0.721256315,0.727807879,0.73454976,0.741502821,0.748691916,0.75614643,0.763902068,0.772002398,0.780501842,0.789469778,0.798996329,0.809203147,0.820259928,0.832416176,0.846063911,0.861882984,0.881251752,0.907943725,1];

  function percentile(ratio) {
    if (ratio < 0) ratio = 0;
    const scaled = ratio * PERCENTILE_TABLE.length;
    const index = Math.trunc(scaled);
    if (index >= PERCENTILE_TABLE.length - 1) return 1;
    const offset = scaled - index;
    return (1 - offset) * PERCENTILE_TABLE[index] + offset * PERCENTILE_TABLE[index + 1];
  }

  // ---- biomes.zig ClimateProperties ------------------------------------
  const CLIMATE_FIELDS = ["hot", "temperate", "cold", "inland", "land", "ocean", "wet", "neitherWetNorDry", "dry", "barren", "balanced", "overgrown", "mountain", "lowTerrain", "antiMountain"];

  function climateBits(flags, initMidValues) {
    let bits = 0;
    const set = new Set(flags || []);
    for (let i = 0; i < CLIMATE_FIELDS.length; i++) if (set.has(CLIMATE_FIELDS[i])) bits |= (1 << i);
    if (initMidValues) {
      for (let g = 0; g < 5; g++) {
        const base = g * 3;
        if (((bits >> base) & 7) === 0) bits |= (1 << (base + 1));
      }
    }
    return bits & 0x7fff;
  }

  // ---- utils.AliasTable ------------------------------------------------
  function buildAlias(items) {
    const n = items.length;
    const chance = new Array(n).fill(0);
    const alias = new Array(n).fill(0);
    if (!n) return { items, chance, alias };
    const total = items.reduce((s, it) => s + (it.chance || 0), 0) || 1;
    const desired = total / n;
    const current = items.map((it) => it.chance || 0);
    const small = [], large = [];
    for (let i = 0; i < n; i++) (current[i] < desired ? small : large).push(i);
    while (small.length && large.length) {
      const s = small.pop(), l = large.pop();
      const delta = desired - current[s];
      chance[s] = Math.floor((delta / desired) * 65535);
      alias[s] = l;
      current[l] -= delta;
      (current[l] < desired ? small : large).push(l);
    }
    while (large.length) chance[large.pop()] = 0;
    while (small.length) chance[small.pop()] = 0;
    return { items, chance, alias };
  }

  function aliasSample(table, seed) {
    const [s1, idx] = nextIntBounded(seed, table.items.length);
    const [s2, r] = nextWithBitSize(s1, 16);
    if (r < table.chance[idx]) return { item: table.items[table.alias[idx]], seed: s2 };
    return { item: table.items[idx], seed: s2 };
  }

  // ---- biomes.TreeNode -------------------------------------------------
  function buildClimateTree(biomesData) {
    const list = Object.entries(biomesData)
      .filter(([, b]) => !b.isCave)
      .map(([id, b]) => ({ id, chance: b.chance || 0, bits: climateBits(b.climate, true) }));
    return buildTreeNode(list, 0);
  }

  function buildTreeNode(list, shift) {
    if (list.length <= 1 || shift >= 15) return { leaf: true, table: buildAlias(list) };
    const valueMap = [1, 0, 1, 1, 2, 1, 1, 1];
    let cL = 0, cM = 0, cU = 0;
    for (const b of list) {
      const c = (b.bits >> shift) & 7;
      if (c === 1) cL += b.chance; else if (c === 4) cU += b.chance; else cM += b.chance;
    }
    const total = cL + cM + cU || 1;
    const lowerBorder = percentile(cL / total);
    const upperBorder = percentile((cL + cM) / total);
    const lists = [[], [], []];
    for (const b of list) lists[valueMap[(b.bits >> shift) & 7]].push(b);
    return {
      leaf: false, lowerBorder, upperBorder,
      children: [buildTreeNode(lists[0], shift + 3), buildTreeNode(lists[1], shift + 3), buildTreeNode(lists[2], shift + 3)],
    };
  }

  function sampleClimateBiome(node, seedObj, x, y, wavelengths, depth) {
    if (node.leaf) {
      const bs = initSeed2D(seedObj.v, x, y);
      const res = aliasSample(node.table, bs);
      return res.item ? res.item.id : null;
    }
    const wavelength = wavelengths[depth] || 2400;
    const [ns, r] = nextWithBitSize(seedObj.v, 32);
    seedObj.v = ns;
    const value = sampleValueNoise2D(x / wavelength, y / wavelength, BigInt(r));
    let idx = 0;
    if (value >= node.lowerBorder) idx = value >= node.upperBorder ? 2 : 1;
    return sampleClimateBiome(node.children[idx], seedObj, x, y, wavelengths, depth + 1);
  }

  // ---- Voronoi biome blobs (approximate placement, real params) --------
  function buildBiomeCandidates(biomesData, tree, worldSeed, minX, minY, maxX, maxY, wavelengths) {
    const CHUNK = 2048;
    const accepted = [];
    const cx0 = Math.floor(minX / CHUNK) - 1, cx1 = Math.ceil(maxX / CHUNK) + 1;
    const cy0 = Math.floor(minY / CHUNK) - 1, cy1 = Math.ceil(maxY / CHUNK) + 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let seed = initSeed2D(worldSeed, cx * CHUNK, cy * CHUNK);
        let rejections = 0;
        while (rejections < 100) {
          const [s1, rx] = nextIntBounded(seed, CHUNK);
          const [s2, ry] = nextIntBounded(s1, CHUNK);
          seed = s2;
          const x = cx * CHUNK + rx, y = cy * CHUNK + ry;
          const seedObj = { v: seed };
          const biomeId = sampleClimateBiome(tree, seedObj, x, y, wavelengths, 0);
          seed = seedObj.v;
          const b = biomesData[biomeId];
          if (!b) { rejections++; continue; }
          const [s3, sf] = nextFloatSigned(seed);
          seed = s3;
          const radius = (b.minRadius + b.maxRadius) / 2 + ((b.maxRadius - b.minRadius) / 2) * sf;
          let ok = true;
          for (const c of accepted) {
            const md = (radius + c.radius) * 0.85;
            const dx = c.x - x, dy = c.y - y;
            if (dx * dx + dy * dy < md * md) { ok = false; break; }
          }
          if (!ok) { rejections++; continue; }
          rejections = 0;
          const [s4, f] = nextFloat(seed);
          seed = s4;
          const height = b.minHeight + f * (b.maxHeight - b.minHeight);
          accepted.push({ x, y, biomeId, radius, height, weight: 1 / Math.sqrt(Math.PI * radius * radius) });
          if (accepted.length > 6000) return accepted;
        }
      }
    }
    return accepted;
  }

  // Blends the candidate biomes into a per-voxel height field + biome id.
  // `forced` (optional) pins the authored biome at the centre of the window so
  // the biome being edited always appears, surrounded by its real neighbours.
  function generateMultiBiomeField(biomesData, worldSeed, size, wx, wy, wavelengths, forced) {
    const tree = buildClimateTree(biomesData);
    // Candidates that can influence the window sit within ~(radius+radius)*0.85,
    // so a ~1000-block margin is plenty (the game's own chunk search radius).
    const R = 1000;
    const candidates = buildBiomeCandidates(biomesData, tree, worldSeed, wx - R, wy - R, wx + size + R, wy + size + R, wavelengths);
    if (forced && forced.biomeId && biomesData[forced.biomeId]) {
      candidates.unshift({
        x: wx + size / 2, y: wy + size / 2, biomeId: forced.biomeId,
        radius: forced.radius || 400, height: forced.height || 0,
        weight: 1 / Math.sqrt(Math.PI * (forced.radius || 400) * (forced.radius || 400)),
      });
    }

    const rough = makeMap(size, size);
    generateSparseFractalTerrain(wx, wy, 64, worldSeed ^ 954936678493n, rough, 1, false);
    const mountain = makeMap(size, size);
    generateSparseFractalTerrain(wx, wy, 256, worldSeed ^ 6758947592930535n, mountain, 1, true);
    const hill = generateSmoothNoise(wx, wy, size, size, 128, 32, worldSeed ^ 157839765839495820n, 1, 0.5);

    const spacing = 32;
    const cols = Math.ceil(size / spacing) + 2;
    const sample = (gx, gy) => {
      const x = wx + gx * spacing, y = wy + gy * spacing;
      let wsum = 0, h = 0, r = 0, hi = 0, mo = 0, best = Infinity, bestId = null;
      for (const c of candidates) {
        const dx = c.x - x, dy = c.y - y;
        const d2 = Math.max(1, dx * dx + dy * dy);
        const w = 1 / d2;
        const b = biomesData[c.biomeId];
        h += c.height * w; r += (b.roughness || 0) * w; hi += (b.hills || 0) * w; mo += (b.mountains || 0) * w;
        wsum += w;
        const dist = Math.sqrt(d2) * c.weight;
        if (dist < best) { best = dist; bestId = c.biomeId; }
      }
      if (!wsum) { bestId = "grassland"; h = r = hi = mo = 0; wsum = 1; }
      return { biomeId: bestId, height: h / wsum, roughness: r / wsum, hills: hi / wsum, mountains: mo / wsum };
    };

    const grid = [];
    for (let gx = 0; gx < cols; gx++) {
      grid.push([]);
      for (let gy = 0; gy < cols; gy++) grid[gx].push(sample(gx, gy));
    }

    const heights = new Float32Array(size * size);
    const biomeIds = new Array(size * size);
    const lerp = (a, b, t) => a + (b - a) * t;
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const fx = Math.min(cols - 2, x / spacing), fz = Math.min(cols - 2, z / spacing);
        const gx = Math.floor(fx), gz = Math.floor(fz), tx = fx - gx, tz = fz - gz;
        const s00 = grid[gx][gz], s10 = grid[gx + 1][gz], s01 = grid[gx][gz + 1], s11 = grid[gx + 1][gz + 1];
        const bHeight = lerp(lerp(s00.height, s10.height, tx), lerp(s01.height, s11.height, tx), tz);
        const bRough = lerp(lerp(s00.roughness, s10.roughness, tx), lerp(s01.roughness, s11.roughness, tx), tz);
        const bHills = lerp(lerp(s00.hills, s10.hills, tx), lerp(s01.hills, s11.hills, tx), tz);
        const bMount = lerp(lerp(s00.mountains, s10.mountains, tx), lerp(s01.mountains, s11.mountains, tx), tz);
        const biomeId = s00.biomeId;
        let h = bHeight
          + (rough.get(x, z) - 0.5) * 2 * bRough
          + (hill.get(x, z) - 0.5) * 2 * bHills
          + (mountain.get(x, z) - 0.5) * 2 * bMount;
        const b = biomesData[biomeId];
        if (b && Number.isFinite(b.minHeightLimit)) h = Math.max(h, b.minHeightLimit);
        if (b && Number.isFinite(b.maxHeightLimit)) h = Math.min(h, b.maxHeightLimit);
        heights[x * size + z] = h;
        biomeIds[x * size + z] = biomeId;
      }
    }
    return { heights, biomeIds, size, candidates: candidates.length };
  }

  const root = (typeof globalThis !== "undefined") ? globalThis : (typeof self !== "undefined" ? self : this);
  root.CubyzWorldgen = {
    scrambleSeed, nextFloat, nextFloatSigned, nextU32, nextU64, nextIntBounded, initSeed2D,
    sampleValueNoise2D,
    makeMap, generateSparseFractalTerrain, generateSmoothNoise,
    generateBiomeHeightField,
    percentile, climateBits, buildClimateTree, sampleClimateBiome, generateMultiBiomeField,
  };
})();
