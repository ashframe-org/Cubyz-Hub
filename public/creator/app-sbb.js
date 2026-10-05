// Faithful port of Cubyz's SBB (Structure Building Blocks) system, used by
// trees and other composite structures.
//
// Ported from src/blueprint.zig (binary .blp format), src/server/terrain/sbb.zig
// (structure/child/rotation model) and simple_structures/SbbGen.zig (placement).

(function () {
  "use strict";

  let fetchBytesImpl = null; // overridable for tests

  function setFetchBytes(fn) { fetchBytesImpl = fn; }

  async function defaultFetchBytes(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function getBytes(url) {
    return (fetchBytesImpl || defaultFetchBytes)(url);
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function parseName(str) {
    const first = str.indexOf(":");
    if (first === -1) return { id: str, data: 0 };
    const second = str.indexOf(":", first + 1);
    if (second === -1) return { id: str, data: 0 };
    const data = parseInt(str.slice(second + 1), 0);
    return { id: str.slice(0, second), data: Number.isFinite(data) ? data : 0 };
  }

  // Binary .blp: big-endian header, raw-deflate body (palette strings + voxels).
  async function loadBlueprint(baseUrl, id) {
    const path = id.replace(/^[a-z0-9_]+:/, "");
    const bytes = await getBytes(`${baseUrl}/sbb/${path}.blp`);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 0;
    const version = dv.getUint16(off, false); off += 2;
    const compression = dv.getUint16(off, false); off += 2;
    const paletteBytes = dv.getUint32(off, false); off += 4;
    const paletteCount = version === 0 ? dv.getUint16(off, false) : dv.getUint32(off, false); off += version === 0 ? 2 : 4;
    const width = dv.getUint16(off, false); off += 2;
    const depth = dv.getUint16(off, false); off += 2;
    const height = dv.getUint16(off, false); off += 2;
    const raw = await inflateRaw(bytes.subarray(off));
    const rdv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let ro = 0;
    const palette = [];
    for (let i = 0; i < paletteCount; i++) {
      const len = rdv.getUint32(ro, false); ro += 4;
      palette.push(new TextDecoder().decode(raw.subarray(ro, ro + len)));
      ro += len;
    }
    const count = width * depth * height;
    const blocks = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      const raw = rdv.getUint32(ro, false); ro += 4;
      // v0 stores the packed Block (typ | data<<16); the palette index is `typ`.
      blocks[i] = version === 0 ? (raw & 0xffff) : raw;
    }
    return { id, width, depth, height, palette, blocks };
  }

  // Neighbor: 0 up, 1 down, 2 +x, 3 -x, 4 +y, 5 -y
  const NEIGHBOR_ROTATE_Z = [0, 1, 4, 5, 3, 2];
  const NEIGHBOR_REL = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  function rotateNeighbor(dir, times) {
    let d = dir;
    for (let i = 0; i < ((times % 4) + 4) % 4; i++) d = NEIGHBOR_ROTATE_Z[d];
    return d;
  }

  function buildVariant(bp, angle) {
    const swap = angle === 1 || angle === 3;
    const w = swap ? bp.depth : bp.width;
    const d = swap ? bp.width : bp.depth;
    const h = bp.height;
    const blocks = new Uint32Array(w * d * h);
    const set = (x, y, z, v) => { blocks[(x * d + y) * h + z] = v; };
    for (let x = 0; x < bp.width; x++) {
      for (let y = 0; y < bp.depth; y++) {
        for (let z = 0; z < bp.height; z++) {
          const v = bp.blocks[(x * bp.depth + y) * bp.height + z];
          let nx, ny;
          if (angle === 0) { nx = x; ny = y; }
          else if (angle === 1) { nx = w - y - 1; ny = x; }
          else if (angle === 2) { nx = w - x - 1; ny = d - y - 1; }
          else { nx = y; ny = d - x - 1; }
          set(nx, ny, z, v);
        }
      }
    }
    return { id: bp.id, width: w, depth: d, height: h, palette: bp.palette, blocks, angle };
  }

  // Finds origin + child markers (palette names) in a variant.
  function analyzeVariant(variant) {
    const originIds = new Set();
    const childIdx = new Map(); // palette index -> color name
    variant.palette.forEach((name, i) => {
      const bare = parseName(name).id;
      if (bare === "cubyz:sbb/origin") originIds.add(i);
      else if (bare.startsWith("cubyz:sbb/child/")) childIdx.set(i, bare.split("/").pop());
    });
    let origin = null;
    const childBlocks = [];
    const w = variant.width, d = variant.depth, h = variant.height;
    for (let x = 0; x < w; x++)
      for (let y = 0; y < d; y++)
        for (let z = 0; z < h; z++) {
          const v = variant.blocks[(x * d + y) * h + z];
          if (originIds.has(v)) origin = { x, y, z, direction: parseName(variant.palette[v]).data };
          else if (childIdx.has(v)) childBlocks.push({ x, y, z, color: childIdx.get(v), direction: parseName(variant.palette[v]).data });
        }
    return { variant, origin, childBlocks };
  }

  function buildBlueprintEntry(bp) {
    const variants = [];
    for (let a = 0; a < 4; a++) variants.push(analyzeVariant(buildVariant(bp, a)));
    return variants; // index by rotation 0..3
  }

  // Minimal ZON reader for the structure definition files.
  function parseStructureZon(text) {
    const blueprints = [];
    const bpMatch = text.match(/\.blueprints\s*=\s*\.\{([\s\S]*?)\n\t\}/);
    if (bpMatch) {
      const body = bpMatch[1];
      let depth = 0, start = -1;
      const entries = [];
      for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === "{") { if (depth === 0) start = i; depth++; }
        else if (c === "}") { depth--; if (depth === 0 && start >= 0) entries.push(body.slice(start + 1, i)); }
      }
      for (const e of entries) {
        const idm = e.match(/\.id\s*=\s*"([^"]+)"/);
        const cm = e.match(/\.chance\s*=\s*(-?[\d.]+)/);
        blueprints.push({ id: idm ? idm[1] : null, chance: cm ? parseFloat(cm[1]) : 1 });
      }
    }
    const children = {};
    const chMatch = text.match(/\.children\s*=\s*\.\{([\s\S]*?)\n\t\}/);
    if (chMatch) {
      for (const m of chMatch[1].matchAll(/\.([A-Za-z_0-9]+)\s*=\s*"([^"]+)"/g)) children[m[1]] = m[2];
    }
    const rotMatch = text.match(/\.rotation\s*=\s*("([^"]+)"|(-?[\d.]+))/);
    let rotation = { type: "random" };
    if (rotMatch) {
      if (rotMatch[2]) {
        const s = rotMatch[2];
        if (["0", "90", "180", "270"].includes(s)) rotation = { type: "fixed", fixed: (parseInt(s, 10) / 90) % 4 };
        else if (s === "fixed") rotation = { type: "fixed", fixed: 0 };
        else rotation = { type: s };
      } else if (rotMatch[3]) {
        rotation = { type: "fixed", fixed: (Math.abs(Math.trunc(parseFloat(rotMatch[3]) / 90)) % 4) };
      }
    }
    return { blueprints, children, rotation };
  }

  const structureCache = new Map();
  const blueprintCache = new Map();

  async function loadBlueprintEntry(baseUrl, id) {
    if (blueprintCache.has(id)) return blueprintCache.get(id);
    const p = (async () => {
      const bp = await loadBlueprint(baseUrl, id);
      return buildBlueprintEntry(bp);
    })();
    blueprintCache.set(id, p);
    return p;
  }

  async function loadStructure(baseUrl, id, seen) {
    if (structureCache.has(id)) return structureCache.get(id);
    seen = seen || new Set();
    if (seen.has(id)) return null;
    seen.add(id);
    const p = (async () => {
      const path = id.replace(/^[a-z0-9_]+:/, "");
      const bytes = await getBytes(`${baseUrl}/sbb/${path}.zig.zon`);
      const def = parseStructureZon(new TextDecoder().decode(bytes));
      const variants = await Promise.all(def.blueprints.map((b) => (b.id ? loadBlueprintEntry(baseUrl, b.id) : Promise.resolve(null))));
      const children = {};
      await Promise.all(Object.entries(def.children).map(async ([name, cid]) => {
        children[name] = await loadStructure(baseUrl, cid, seen);
      }));
      return {
        id,
        variants,
        blueprints: def.blueprints,
        children,
        rotation: def.rotation,
      };
    })();
    structureCache.set(id, p);
    return p;
  }

  // ---- alias sampling with the game PRNG wrapper ----
  function buildAlias(items) {
    const n = items.length;
    const chance = new Array(n).fill(0);
    const alias = new Array(n).fill(0);
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
    return { chance, alias };
  }

  function sampleBlueprints(structure, rng) {
    const items = structure.variants.map((v, i) => ({ items: v, chance: structure.blueprints[i].chance }));
    const table = buildAlias(items);
    const idx = rng.nextIntBounded(items.length);
    const useAlias = rng.nextInt16() < table.chance[idx];
    const chosen = items[useAlias ? table.alias[idx] : idx];
    return chosen.items || null;
  }

  // ---- placement ----
  function alignDirections(input, desired) {
    let current = input;
    for (let i = 0; i < 4; i++) {
      if (current === desired) return i;
      current = NEIGHBOR_ROTATE_Z[current];
    }
    return 0;
  }

  function applyRotation(rotation, align) {
    if (rotation.type === "fixed") return { type: "fixed", fixed: (rotation.fixed + align) % 4 };
    return { type: "fixed", fixed: align };
  }

  function initialRotation(rotation, rng) {
    if (rotation.type === "fixed") return rotation;
    if (rotation.type === "inherit") return { type: "fixed", fixed: 0 };
    return { type: "fixed", fixed: rng.nextIntBounded(4) };
  }

  function childRotation(self, childRotationType, direction, rng) {
    if (direction === 0 || direction === 1) { // up / down
      if (childRotationType.type === "random") return { type: "fixed", fixed: rng.nextIntBounded(4) };
      if (childRotationType.type === "inherit") return self;
      return childRotationType;
    }
    return { type: "fixed", fixed: 0 };
  }

  function pasteVariant(variant, paste, place) {
    const { width, depth, height, palette, blocks } = variant;
    for (let x = 0; x < width; x++)
      for (let y = 0; y < depth; y++)
        for (let z = 0; z < height; z++) {
          const v = blocks[(x * depth + y) * height + z];
          const parsed = parseName(palette[v]);
          if (parsed.id === "cubyz:void" || parsed.id === "cubyz:sbb/origin" || parsed.id.startsWith("cubyz:sbb/child/")) continue;
          place(paste.x + x, paste.y + y, paste.z + z, parsed.id, parsed.data);
        }
  }

  function place(structure, placementPosition, placementDirection, rotation, rng, place3, depth) {
    if (!structure || depth > 12) return;
    const variants = sampleBlueprints(structure, rng);
    if (!variants) return;
    const origin = variants[0].origin;
    if (!origin) return;
    const desired = placementDirection === null || placementDirection === undefined ? origin.direction : placementDirection;
    const align = alignDirections(origin.direction, desired);
    const bpRot = applyRotation(rotation, align);
    const rotated = variants[bpRot.fixed];
    const ro = rotated.origin;
    if (!ro) return;
    const rel = NEIGHBOR_REL[desired] || [0, 0, 0];
    const paste = {
      x: placementPosition.x - ro.x - rel[0],
      y: placementPosition.y - ro.y - rel[1],
      z: placementPosition.z - ro.z - rel[2],
    };
    pasteVariant(rotated.variant, paste, place3);
    for (const childBlock of rotated.childBlocks) {
      const child = structure.children[childBlock.color];
      if (!child) continue;
      const childRot = childRotation(bpRot, child.rotation, childBlock.direction, rng);
      place(child, { x: paste.x + childBlock.x, y: paste.y + childBlock.y, z: paste.z + childBlock.z }, childBlock.direction, childRot, rng, place3, depth + 1);
    }
  }

  window.CubyzSbb = {
    setFetchBytes,
    loadStructure,
    // Game-PRNG-backed rng for blueprint choice + random rotations.
    makeRng(seedBig) {
      let s = seedBig;
      const W = window.CubyzWorldgen;
      return {
        nextIntBounded(bound) { const r = W.nextIntBounded(s, bound); s = r[0]; return r[1]; },
        nextInt16() { const r = W.nextIntBounded(s, 65536); s = r[0]; return r[1]; },
        nextFloat() { const r = W.nextFloat(s); s = r[0]; return r[1]; },
      };
    },
    // Place an already-loaded structure at `base` (raw SBB/game coords).
    composeResolved(structure, rng, base, place3) {
      place(structure, base, null, initialRotation(structure.rotation, rng), rng, place3, 0);
    },
    // Async convenience wrapper.
    async compose(baseUrl, structureId, rng, base, place3) {
      const structure = await loadStructure(baseUrl, structureId);
      if (!structure) return false;
      place(structure, base, null, initialRotation(structure.rotation, rng), rng, place3, 0);
      return true;
    },
    parseName,
  };
})();
