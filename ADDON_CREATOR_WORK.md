# Addon Creator — Remaining Work

Ideas and known approximations for the Addon Creator's **Chunk Preview** (and
related tooling), saved for later. The preview aims to reproduce the real game
world generation; the items below are what still differs.

## Worldgen parity — still approximate

1. **Voronoi sub-biomes + transition biomes**
   - `NoiseBasedVoronoi.addSubBiomesOf` (`parentBiomes`) and `addTransitionBiomes`
     (`transitionBiomes`) are not mixed into the preview's blob map.
   - Also the exact Voronoi **candidate placement** (the 4-pass interleaved chunk
     generation with neighbour rejection) is approximated by a simpler pass.

2. **`StructureMap` placement + `generationMode`**
   - Structures are placed per-column by `chance`; the game uses a seeded
     structure map.
   - `generationMode` (`floor` / `ceiling` / `floor_and_ceiling` / `air` /
     `underground` / `water_surface`) is ignored.

3. **Procedural structure models** (SBB is already exact)
   - `simple_tree` (`SimpleTreeModel.zig`), `simple_vegetation`,
     `flower_patch`, `ground_patch`, `boulder`, `fallen_tree`, `stalagmite`
     are approximated rather than ported from `simple_structures/*.zig`.

4. **`OreGenerator`** — ore veins are not generated at all.

5. **`SurfaceMap` details**
   - `BlockStack` ground-layer counts use the max instead of
     `min + random(max - min)`.
   - `smoothBeaches`, `keepOriginalTerrain`, rivers, and the min/max height
     limit handling are simplified.

6. **Block data / rotation**
   - Stairs, directional logs, fences, walls etc. render as unrotated cubes
     (the block `data`/rotation isn't applied).

## Preview / UX ideas

- **Solid interior toggle**: render interior voxels (not just exposed faces) so
  flying inside looks solid; cap to small sizes (32³/64³) for performance.
- **Camera**: optional camera-facing billboards for `plane` flowers so they're
  visible from every angle (currently a single flat quad, invisible edge-on).
- **Larger previews**: 256³ works but generation is heavy; consider a
  lower-resolution mesh for big areas.
- **Real per-biome structures for neighbour biomes**: currently the authored
  biome's structures come from the form and only the authored biome gets real
  structures; other biomes use their manifest structures (which is real, but
  `simple_*` ones are approximated per item 3).
- **SBB `placeMode` (`.degradable`)**: placement currently ignores the
  degradable-vs-all distinction.

## Notes / gotchas

- Bump the `?v=` token in `public/creator/index.html` for **any** frontend
  change; bump the panel fetch token in `app-studio.js` `loadStudioPanel` when
  panel HTML changes.
- Game assets live in `runtime/creator-data/<version>/` (mirrored) and are
  generated with `node scripts/build-creator-data.js <cubyz-checkout> <out>`.
- Relevant ported modules: `public/creator/app-worldgen.js` (noise, climate
  tree, Voronoi, MapGenV1), `app-sbb.js` (SBB blueprints), `app-sdf.js` (SDF
  cave models), `app-preview.js` (the renderer/glue).
