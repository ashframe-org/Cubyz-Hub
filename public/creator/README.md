# Cubyz Addon Creator

A web-based tool for creating and managing addons for the game Cubyz.

## File Structure

* **Main Page**: `index.html`
* **Panels**: `blocks.html`, `items.html`, `recipes.html`, `biomes.html`, `entities.html`, `particles.html` 

## Core Logic

* **app-core.js**: Setup & Initialization
* **app-io.js**: Import Handling
* **app-save.js**: Export Handling
* **app-studio.js**: Interface Control
* **app-versionflow.js**: Onboarding / version selection & migration

## Game-data snapshots

The creator loads each supported game version from `gamedata/<version>/`
(mounted from `runtime/creator-data/` in `compose.yaml`). `window.VERSION_PATH`
selects the version and defaults to `unreleased` (shown as `0.4.0 (unreleased)`).

Every version folder contains the **real game files** for its categories
(`blocks/`, `items/`, `biomes/`, `cave_layers/`, `structure_tables/`,
`recipes/`, `sbb/`, `models/`, `particles/`, `world_presets/`,
`entity_models/` — definitions, textures and blueprints) plus index manifests
(`blocks.json`, `items.json`, `textures.json`, `cave_layers.json`, …) that the
creator fetches. Audio is not included (Cubyz ships it separately).

Regenerate a snapshot from a Cubyz checkout with:

```sh
node scripts/build-creator-data.js <cubyz-checkout> runtime/creator-data/<version>
```

Options:
* `--lean` — write only the manifests + referenced texture PNGs instead of
  mirroring the whole category tree.
* `--music-json <file>` — reuse an existing `music.json` for track names
  (`assets/cubyz/music` is gitignored in Cubyz).
* `--include-reserved` — keep `_`-prefixed loader-internal files in the id
  manifests (they are excluded by default).


