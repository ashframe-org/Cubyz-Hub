// Faithful port of Cubyz's SDF cave models (src/server/terrain/sdf.zig +
// sdf_models/*.zig) used by cave biomes via `.caveModels`.

(function () {
  "use strict";

  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const rnd = (rng) => rng.nextFloat() * 2 - 1;
  const pick = (rng, a, b) => {
    a = num(a, 0);
    b = num(b, a);
    return a + (b - a) * rng.nextFloat();
  };

  function instantiate(model, rng) {
    if (!model) return null;
    switch (model.id) {
      case "cubyz:sphere": {
        const r = pick(rng, model.minRadius, model.maxRadius);
        return { kind: "sphere", radius: r, bounds: [r, r, r] };
      }
      case "cubyz:partial_sphere": {
        const r = pick(rng, model.minRadius, model.maxRadius);
        const d = model.cutDirection || [0, 0, -1];
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        const rndr = num(model.cutDirectionRandomness, 0);
        const cutDir = [
          d[0] / len + rnd(rng) * rndr,
          d[1] / len + rnd(rng) * rndr,
          d[2] / len + rnd(rng) * rndr,
        ];
        return { kind: "partial_sphere", radius: r, cutPercentage: num(model.cutPercentage, 0.5), cutDir, bounds: [r, r, r] };
      }
      case "cubyz:cylinder": {
        const r = pick(rng, model.minRadius, model.maxRadius);
        const minH = num(model.minHeight, 32);
        const maxH = num(model.maxfHeight, minH * 2);
        const hh = pick(rng, minH / 2, maxH / 2);
        return { kind: "cylinder", radius: r, halfHeight: hh, bounds: [r, r, hh] };
      }
      case "cubyz:torus": {
        const r = pick(rng, model.minRadius, model.maxRadius);
        const t = pick(rng, model.minThickness, num(model.maxThickness, model.minThickness));
        return { kind: "torus", radius: r, thickness: t, bounds: [r + t, r + t, t] };
      }
      case "cubyz:rectangular_cuboid": {
        const mins = model.minSideLengths || [32, 32, 32];
        const maxs = model.maxSideLengths || mins.map((v) => v * 2);
        const radii = [0, 1, 2].map((i) => pick(rng, mins[i] / 2, maxs[i] / 2));
        return { kind: "rectangular_cuboid", radii, bounds: radii };
      }
      case "cubyz:rotated": {
        const child = instantiate(model.child, rng);
        if (!child) return null;
        const a = (num(model.minAngle, 0) + (num(model.maxAngle, 360) - num(model.minAngle, 0)) * rng.nextFloat()) * Math.PI / 180;
        return { kind: "rotated", child, axis: model.axis || "z", sin: Math.sin(a), cos: Math.cos(a), bounds: child.bounds };
      }
      case "cubyz:cluster": {
        const children = [];
        for (const c of model.children || []) {
          const min = num(c.minAmount, 1);
          const max = num(c.maxAmount, min);
          const amount = Math.floor(min + rng.nextFloat() * (max - min) + rng.nextFloat());
          for (let i = 0; i < amount; i++) {
            const inst = instantiate(c, rng);
            if (!inst) continue;
            const po = c.positionOffset || [0, 0, 0];
            const ro = c.randomOffset || [0, 0, 0];
            children.push({ inst, offset: [po[0] + rnd(rng) * ro[0], po[1] + rnd(rng) * ro[1], po[2] + rnd(rng) * ro[2]] });
          }
        }
        let bx = 0, by = 0, bz = 0;
        for (const c of children) {
          bx = Math.max(bx, Math.abs(c.offset[0]) + (c.inst.bounds[0] || 0));
          by = Math.max(by, Math.abs(c.offset[1]) + (c.inst.bounds[1] || 0));
          bz = Math.max(bz, Math.abs(c.offset[2]) + (c.inst.bounds[2] || 0));
        }
        return { kind: "cluster", children, smoothness: num(model.smothness, 4), bounds: [bx, by, bz] };
      }
      default:
        return null;
    }
  }

  function rotatePoint(axis, s, c, p) {
    switch (axis) {
      case "x": return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]];
      case "y": return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
      default: return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]];
    }
  }

  function evalInstance(inst, p) {
    switch (inst.kind) {
      case "sphere":
        return Math.hypot(p[0], p[1], p[2]) - inst.radius;
      case "partial_sphere": {
        const sphere = Math.hypot(p[0], p[1], p[2]) - inst.radius;
        const d = inst.cutDir;
        const plane = d[0] * p[0] + d[1] * p[1] + d[2] * p[2] - inst.radius + inst.cutPercentage * inst.radius * 2;
        return Math.max(sphere, plane);
      }
      case "cylinder": {
        const circle = Math.hypot(p[0], p[1]) - inst.radius;
        const height = Math.abs(p[2]) - inst.halfHeight;
        return Math.hypot(Math.max(height, 0), Math.max(circle, 0)) + Math.min(0, Math.max(circle, height));
      }
      case "torus": {
        const radial = Math.hypot(p[0], p[1]);
        return Math.hypot(radial - inst.radius, p[2]) - inst.thickness;
      }
      case "rectangular_cuboid": {
        const d = [Math.abs(p[0]) - inst.radii[0], Math.abs(p[1]) - inst.radii[1], Math.abs(p[2]) - inst.radii[2]];
        return Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0)) + Math.min(0, Math.max(d[0], Math.max(d[1], d[2])));
      }
      case "rotated":
        return evalInstance(inst.child, rotatePoint(inst.axis, inst.sin, inst.cos, p));
      case "cluster": {
        let sdf = 1e9;
        for (const c of inst.children) {
          const cp = [p[0] - c.offset[0], p[1] - c.offset[1], p[2] - c.offset[2]];
          sdf = smoothUnion(evalInstance(c.inst, cp), sdf, inst.smoothness);
        }
        return sdf;
      }
      default:
        return 1e9;
    }
  }

  function smoothUnion(a, b, smoothness) {
    const k = 4 * smoothness || 1e-6;
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * smoothness;
  }

  // Carves `models` out of a solid volume. `isSolid(x,y,z)` / `setAir(x,y,z)`.
  function carve(models, size, rng, smoothness, isSolid, setAir) {
    for (const model of models) {
      const min = num(model.minAmount, 1);
      const max = num(model.maxAmount, min);
      const amount = Math.floor(min + rng.nextFloat() * (max - min) + rng.nextFloat());
      for (let i = 0; i < amount; i++) {
        const inst = instantiate(model, rng);
        if (!inst) continue;
        const b = inst.bounds;
        const pad = Math.max(b[0], b[1], b[2]) + 2;
        const cx = size / 2 + rnd(rng) * size * 0.3;
        const cy = size / 2 + rnd(rng) * size * 0.3;
        const cz = size / 2 + rnd(rng) * size * 0.3;
        const x0 = Math.max(0, Math.floor(cx - pad)), x1 = Math.min(size - 1, Math.ceil(cx + pad));
        const y0 = Math.max(0, Math.floor(cy - pad)), y1 = Math.min(size - 1, Math.ceil(cy + pad));
        const z0 = Math.max(0, Math.floor(cz - pad)), z1 = Math.min(size - 1, Math.ceil(cz + pad));
        for (let z = z0; z <= z1; z++)
          for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
              if (!isSolid(x, y, z)) continue;
              if (evalInstance(inst, [x - cx, y - cy, z - cz]) < 0) setAir(x, y, z);
            }
      }
    }
  }

  window.CubyzSdf = { instantiate, evalInstance, carve, smoothUnion };
})();
