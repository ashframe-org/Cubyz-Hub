const INVALID_FIELD_CLASS = "creator-field-invalid";

function markFieldValidity(id, isValid) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle(INVALID_FIELD_CLASS, !isValid);
}

function showDropdown(id) {
    document.querySelectorAll('.dropdown-options').forEach(d => d.style.display = 'none');
    if (!window.dropdownsGenerated) rebuildDropdowns();
    const el = document.getElementById(id);
    if (el) {
        el.style.display = 'block';
        filterDropdown(id === 'dropDropdown' ? 'dropSearch' : id.replace('Dropdown', 'Search'), id);
    }
}

function checkBlockRules({ blockId, baseTexture, rotationMode, updateTypeVal, tickTypeVal, hasItemIconRef, tagCount }) {
    rotationMode = rotationMode || "cubyz:stairs";
    const oreNeedsIcon = rotationMode === "cubyz:ore" && !hasItemIconRef;

    const usesDecay = updateTypeVal === 'decay' || tickTypeVal === 'decay';
    const usesVineDecay = updateTypeVal === 'vine_decay' || tickTypeVal === 'vine_decay';
    const usesSupportCheck = updateTypeVal === 'check_support_blocks' || tickTypeVal === 'check_support_blocks';
    const SUPPORT_CHECK_ROTATIONS = ['cubyz:carpet', 'cubyz:planar', 'cubyz:no_rotation', 'cubyz:torch', 'cubyz:texture_pile', 'cubyz:direction'];

    const decayAndVineDecayConflict = usesDecay && usesVineDecay;
    const rotationIncompatibleWithDecay = !decayAndVineDecayConflict && usesDecay && !['cubyz:decayable', 'cubyz:branch'].includes(rotationMode);
    const rotationIncompatibleWithVineDecay = !decayAndVineDecayConflict && usesVineDecay && rotationMode !== 'cubyz:hanging';
    const rotationIncompatibleWithSupportCheck = usesSupportCheck && !SUPPORT_CHECK_ROTATIONS.includes(rotationMode);
    const rotationCallbackConflict = decayAndVineDecayConflict || rotationIncompatibleWithDecay || rotationIncompatibleWithVineDecay || rotationIncompatibleWithSupportCheck;

    const missingTags = !tagCount;

    let rotationMsg = "";
    if (decayAndVineDecayConflict) rotationMsg = "A block can't use both 'decay' and 'vine_decay' together - they require different, incompatible rotation modes. Pick one.";
    else if (rotationIncompatibleWithDecay) rotationMsg = "A 'decay' update or tick callback requires the rotation to be 'Decayable / Leaf (cubyz:decayable)' or 'Connecting Branch (cubyz:branch)'.";
    else if (rotationIncompatibleWithVineDecay) rotationMsg = "A 'vine_decay' update or tick callback requires the rotation to be 'Hanging / Vine (cubyz:hanging)'.";
    else if (rotationIncompatibleWithSupportCheck) rotationMsg = "A 'check_support_blocks' update or tick callback requires the rotation to be one of: Flat Layer/Carpet, Faces Player on Placement, Fixed/No Rotation, Wall/Floor Torch, Random Texture Variant, or Directional Log.";

    return {
        blockId: !!blockId,
        baseTexture: !!baseTexture,
        oreNeedsIcon,
        rotationCallbackConflict,
        rotationMsg,
        missingTags,
        valid: !!blockId && !!baseTexture && !oreNeedsIcon && !rotationCallbackConflict && !missingTags,
    };
}
window.checkBlockRules = checkBlockRules;

function saveBlockToProject(silent) {
    const blockId = document.getElementById('blockId').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const tSearch = document.getElementById('topSearch').value.trim();

    const rotationMode = document.getElementById('blockRotation').value || "cubyz:stairs";
    const itemIconSearch = document.getElementById('itemIconSearch').value.trim();

    const updateTypeVal = document.getElementById('logicUpdateType')?.value;
    const tickTypeVal = document.getElementById('logicTickType')?.value;
    const blockTags = Array.from(document.querySelectorAll('#blockTagsContainer .tag-pill'));

    const check = checkBlockRules({
        blockId, baseTexture: tSearch, rotationMode,
        updateTypeVal, tickTypeVal,
        hasItemIconRef: !!itemIconSearch, tagCount: blockTags.length,
    });

    markFieldValidity('blockId', check.blockId);
    markFieldValidity('topSearch', check.baseTexture);
    markFieldValidity('itemIconSearch', !check.oreNeedsIcon);
    markFieldValidity('blockRotationSearch', !check.rotationCallbackConflict);
    markFieldValidity('blockTagsContainer', !check.missingTags);

    if (!check.valid) {
        if (!silent) alert(!check.blockId ? "Please specify a Block ID first!" : !check.baseTexture ? "Please select at least a Base Texture!" : check.oreNeedsIcon ? "Procedural world ores require a '2D Inventory Icon Texture' fallback sprite!" : check.rotationMsg || "This block needs at least one tag (e.g. mineable, diggable, choppable) - the game logs an error (and shows an error prompt in the client) for a block with no tags, and tags decide which tools can mine it.");
        return false;
    }

    const sidesData = {
        front: document.getElementById('frontSearch').value.trim(),
        left: document.getElementById('leftSearch').value.trim(),
        right: document.getElementById('rightSearch').value.trim(),
        up: document.getElementById('upSearch').value.trim(),
        bottom: document.getElementById('bottomSearch').value.trim(),
        back: document.getElementById('backSearch')?.value.trim() || ""
    };
    for (let i = 6; i <= 15; i++) sidesData[`tex${i}`] = document.getElementById(`tex${i}`)?.value.trim() || "";

    const interactMode = document.getElementById('logicInteractType')?.value || "none";

    const blockData = {
        id: blockId,
        subFolder: window.projectData.blocks.find(b => b.id === blockId)?.subFolder || "",
        health: document.getElementById('blockHealth').value || "1",
        resistance: document.getElementById('blockResistance').value || "0",
        rotation: rotationMode,
        collide: document.getElementById('blockCollide').checked,
        transparent: document.getElementById('blockTransparent').checked,
        replaceable: document.getElementById('blockReplaceable')?.checked || false,
        degradable: document.getElementById('blockDegradable')?.checked || false,
        viewThrough: document.getElementById('blockViewThrough')?.checked || false,
        alwaysViewThrough: document.getElementById('blockAlwaysViewThrough')?.checked || false,
        hasBackFace: document.getElementById('blockHasBackFace')?.checked || false,
        allowOres: document.getElementById('blockAllowOres')?.checked || false,
        friction: parseFloat(document.getElementById('blockFriction')?.value) || 20,
        bounciness: parseFloat(document.getElementById('blockBounciness')?.value) || 0.0,
        density: parseFloat(document.getElementById('blockDensity')?.value) || 1.2,
        terminalVelocity: parseFloat(document.getElementById('blockTerminalVelocity')?.value) || 90,
        mobility: parseFloat(document.getElementById('blockMobility')?.value) || 1.0,
        emittedLightColor: document.getElementById('emittedLightColor')?.value || "#000000",
        absorbedLightColor: document.getElementById('absorbedLightColor')?.value || "#ffffff",
        emittedLight: parseInt((document.getElementById('emittedLightColor')?.value || "#000000").replace('#', ''), 16),
        absorbedLight: parseInt((document.getElementById('absorbedLightColor')?.value || "#ffffff").replace('#', ''), 16),
        tags: Array.from(document.querySelectorAll('#blockTagsContainer .tag-pill')).map(el => `.${el.dataset.tag}`),
        dropAuto: document.getElementById('dropAuto').checked,
        dropSearch: document.getElementById('dropSearch').value.trim().toLowerCase(),
        hasItemIcon: document.getElementById('hasItemIcon').checked,
        itemIconSearch,
        baseTexture: tSearch,

        ...(interactMode === 'open_chest' ? { blockEntity: "cubyz:chest" } : {}),

        callbacks: {
            touchType: document.getElementById('logicTouchType').value,
            touchMode: document.getElementById('logicTouchMode').value,
            touchDps: parseFloat(document.getElementById('logicTouchDps').value) || 0.6,
            touchVariant: document.getElementById('logicTouchTypeVariant').value,
            updateType: document.getElementById('logicUpdateType').value,
            decayReplacement: document.getElementById('decayReplacement').value.trim(),
            decayPrevention: document.getElementById('decayPrevention').value.trim(),
            updateReplaceBlock: document.getElementById('updateReplaceBlockSearch')?.value?.trim() || "",
            tickType: document.getElementById('logicTickType').value,
            decayTickReplacement: document.getElementById('decayTickReplacement').value.trim(),
            decayTickPrevention: document.getElementById('decayTickPrevention').value.trim(),
            tickReplaceBlock: document.getElementById('tickReplaceBlockSearch').value.trim(),
            breakType: document.getElementById('logicBreakType').value,
            breakReplaceBlock: document.getElementById('breakReplaceBlockSearch').value.trim(),
            interactType: interactMode,
            interactWindowName: document.getElementById('interactWindowName').value.trim()
        },
        sides: sidesData
    };

    if (!blockData.blockEntity) {
        const existing = window.projectData.blocks.find(b => b.id === blockId);
        if (existing?.blockEntity) blockData.blockEntity = existing.blockEntity;
    }

    window.projectData.blocks = window.projectData.blocks.filter(b => b.id !== window.editingId && b.id !== blockId);
    window.projectData.blocks.push(blockData);
    Object.assign(window, { hasUnsavedChanges: false, editingId: null });
    window.updateSearchableItems();
    window.updateSidebarProjectTree();
    if (!silent) alert(`Saved block "${blockId}" successfully into memory!`);
    return true;
}
window.saveBlockToProject = saveBlockToProject;

function saveItemToProject(silent) {
    const itemId = document.getElementById('itemId').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const itemTexture = document.getElementById('itemTextureSearch').value.trim();

    markFieldValidity('itemId', !!itemId);
    markFieldValidity('itemTextureSearch', !!itemTexture);

    if (!itemId || !itemTexture) {
        if (!silent) alert(itemId ? "Please select a texture for your item!" : "Please specify an Item ID first!");
        return false;
    }

    let baseHex = document.getElementById('matColorBase').value;
    let r = parseInt(baseHex.slice(1, 3), 16) / 255, g = parseInt(baseHex.slice(3, 5), 16) / 255, b = parseInt(baseHex.slice(5, 7), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h /= 6;
    }

    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        return t < 1/6 ? p + (q - p) * 6 * t : t < 1/2 ? q : t < 2/3 ? p + (q - p) * (2/3 - t) * 6 : p;
    };
    const hslToHex = (h, s, l) => {
        let r = l, g = l, b = l;
        if (s !== 0) {
            let q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
        }
        return [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    };

    const colorsList = [0.22, 0.38, 0.52, 0.72, 0.88].map(step => `0xff${hslToHex(h, s, step)}`);

    window.projectData.items = window.projectData.items.filter(i => i.id !== window.editingId && i.id !== itemId);
    window.projectData.items.push({
        id: itemId,
        subFolder: window.projectData.items.find(i => i.id === itemId)?.subFolder || "",
        stackSize: document.getElementById('itemStackSize').value || "120",
        foodValue: parseFloat(document.getElementById('itemFoodValue')?.value) || 0.0,
        blockPlacement: document.getElementById('itemBlockPlacementSearch')?.value?.trim() || "",
        texture: itemTexture,
        colors: colorsList,
        baseColor: baseHex,
        material: {
        durability: document.getElementById('matDurability').value || "250",
        swingSpeed: document.getElementById('matSwingSpeed').value || "1.0",
        textureRoughness: document.getElementById('matTexRoughness').value || "0.0",
        massDamage: document.getElementById('matMassDamage').value || "2.0",
        hardnessDamage: document.getElementById('matHardnessDamage').value || "2.0",
        modifierType: document.getElementById('matModifierType').value,
        modifierStrength: document.getElementById('matModifierStrength').value || "1.0"
        },
        tags: Array.from(document.querySelectorAll('#itemTagsContainer .tag-pill')).map(el => `.${el.dataset.tag}`)
    });

    Object.assign(window, { hasUnsavedChanges: false, editingId: null });
    window.updateSearchableItems();
    window.updateSidebarProjectTree();
    if (!silent) alert(`Saved item "${itemId}" successfully into memory!`);
    return true;
}
window.saveItemToProject = saveItemToProject;

function saveRecipeToProject(silent) {
    const filename = document.getElementById('recipeFilename').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const outputItem = document.getElementById('recipeOutputSearch').value.trim();

    const inputsList = [];
    for (let i = 1; i <= 4; i++) {
        const val = document.getElementById(`recipeInputSearch${i}`).value.trim();
        const count = parseInt(document.getElementById(`recipeInputCount${i}`).value) || 1;
        if (val) inputsList.push(count > 1 ? `${count} ${val}` : val);
    }

    markFieldValidity('recipeFilename', !!filename);
    markFieldValidity('recipeOutputSearch', !!outputItem);
    markFieldValidity('recipeInputSearch1', inputsList.length > 0);

    if (!filename || !outputItem || !inputsList.length) {
        if (!silent) alert(!filename ? "Please specify a Recipe File Name first!" : !outputItem ? "Please select an Output item!" : "Please add at least one ingredient input item!");
        return false;
    }

    if (!window.projectData.recipes) window.projectData.recipes = {};
    if (window.editingId) delete window.projectData.recipes[window.editingId];

    window.projectData.recipes[filename] = [{
        inputs: inputsList,
        output: (parseInt(document.getElementById('recipeOutputCount').value) || 1) > 1 ? `${parseInt(document.getElementById('recipeOutputCount').value)} ${outputItem}` : outputItem
    }];

    Object.assign(window, { hasUnsavedChanges: false, editingId: null });
    window.updateSidebarProjectTree();
    if (!silent) alert(`Added recipe to project "${filename}_recipes.zig.zon"!`);
    return true;
}
window.saveRecipeToProject = saveRecipeToProject;

function checkBiomeRules({ biomeId, isCave, caveLayerTag }) {
    const missingCaveLayer = !!isCave && !caveLayerTag;
    return {
        biomeId: !!biomeId,
        missingCaveLayer,
        valid: !!biomeId && !missingCaveLayer,
    };
}
window.checkBiomeRules = checkBiomeRules;

function saveBiomeToProject(silent) {
    const bId = document.getElementById('biomeId').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    markFieldValidity('biomeId', !!bId);

    const isCave = document.getElementById('bioIsCave').checked;
    const caveLayerSelect = document.getElementById('bioCaveLayer')?.value || "";
    const caveLayerCustom = document.getElementById('bioCaveLayerCustom')?.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || "";
    const caveLayerTag = caveLayerSelect === '__custom__' ? caveLayerCustom : caveLayerSelect;
    const biomeCheck = checkBiomeRules({ biomeId: bId, isCave, caveLayerTag });
    markFieldValidity('bioCaveLayer', !biomeCheck.missingCaveLayer);
    if (caveLayerSelect === '__custom__') markFieldValidity('bioCaveLayerCustom', !!caveLayerCustom);

    if (!biomeCheck.valid) {
        if (!silent) alert(!bId ? "Please specify a Biome ID first!" : "This is a cave biome, so it needs a cave layer selected - otherwise it will silently never spawn in-game.");
        return false;
    }

    const getHexColorAsRGBVector = (hex) => {
        if (!hex || hex.length < 7) return `.{ 1.0, 1.0, 1.0 }`;
        const parts = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(c => (parseInt(c, 16) / 255).toFixed(2));
        return `.{ ${parts.join(', ')} }`;
    };

    const autoNamespaceBlock = (val) => {
        let clean = val.trim();
        if (!clean || clean.includes(":") || clean.includes("{")) return clean;
        const addonName = document.getElementById('addonName').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || 'custom_addon';
        return window.projectData.blocks.some(b => b.id === clean) ? `${addonName}:${clean}` : `cubyz:${clean}`;
    };

    const propertiesList = ['bioTemp', 'bioWet', 'bioZone', 'bioGrowth', 'bioHeightProp']
    .map(n => document.querySelector(`input[name="${n}"]:checked`)?.value).filter(Boolean).map(v => `.${v}`);

    const structuralLayers = Array.from(document.querySelectorAll('.structure-row-entry')).map(row => {
        const type = row.querySelector('.struct-type-selector').value;
        if (!type) return null;
        let s = { id: type, chance: parseFloat(row.querySelector('.struct-chance').value) || 0.05 };
        const modeSel = row.querySelector('.struct-generation-mode');
        if (modeSel && modeSel.value) s.generationMode = modeSel.value;
        const prioInp = row.querySelector('.struct-priority');
        if (prioInp && prioInp.value.trim() !== '') s.priority = parseFloat(prioInp.value);
        if (type === 'cubyz:simple_tree') {
            s.log = row.querySelector('.field-log').value.trim() || 'cubyz:oak_log';
            s.leaves = row.querySelector('.field-leaves').value.trim() || 'cubyz:leaves/oak';
            s.top = s.log.replace('_log', '_top'); s.type = '.round';
            s.height = parseInt(row.querySelector('.field-height').value) || 6;
            s.height_variation = parseInt(row.querySelector('.field-height-var').value) || 3;
            s.leafRadius = parseFloat(row.querySelector('.field-leaf-radius').value) || 2;
        } else if (type === 'cubyz:simple_vegetation' || type === 'cubyz:flower_patch' || type === 'cubyz:boulder' || type === 'cubyz:ground_patch') {
            s.block = row.querySelector('.field-block').value.trim() || (type === 'cubyz:simple_vegetation' ? 'cubyz:fern' : type === 'cubyz:boulder' ? 'cubyz:slate/rough' : type === 'cubyz:ground_patch' ? 'cubyz:gravel' : 'cubyz:daffodil');
            if (type === 'cubyz:simple_vegetation') { s.height = parseInt(row.querySelector('.field-height').value) || 1; s.height_variation = parseInt(row.querySelector('.field-height-var')?.value) || 0; }
            if (type === 'cubyz:flower_patch') { s.width = parseInt(row.querySelector('.field-width').value) || 10; s.variation = parseInt(row.querySelector('.field-variation').value) || 6; s.density = parseFloat(row.querySelector('.field-density').value) || 0.3; if (s.priority === undefined) s.priority = 0.1; }
            if (type === 'cubyz:boulder') { s.size = parseInt(row.querySelector('.field-size').value) || 5; s.size_variance = parseInt(row.querySelector('.field-size-var').value) || 4; }
            if (type === 'cubyz:ground_patch') { s.width = parseInt(row.querySelector('.field-width').value) || 5; s.depth = parseInt(row.querySelector('.field-depth').value) || 2; s.smoothness = parseFloat(row.querySelector('.field-smoothness').value) || 0.2; }
        } else if (type === 'cubyz:fallen_tree') {
            s.log = row.querySelector('.field-log').value.trim() || 'cubyz:oak_log'; s.top = s.log;
            s.height = parseInt(row.querySelector('.field-height').value) || 6; s.height_variation = parseInt(row.querySelector('.field-height-var').value) || 3;
        } else if (type === 'cubyz:sbb') {
            s.structure = row.querySelector('.field-structure').value.trim() || 'cubyz:tree/coniferous/pine/loblolly';
            s.placeMode = row.querySelector('.field-placemode').value.trim() || '.degradable';
        } else if (type === 'cubyz:stalagmite') {
            s.block = row.querySelector('.field-block').value.trim() || 'cubyz:stalagmite';
            s.size = parseFloat(row.querySelector('.field-size').value) || 12;
            s.size_variation = parseFloat(row.querySelector('.field-size-var').value) || 8;
            s.baseSlope = parseFloat(row.querySelector('.field-base-slope').value) || 4;
            const topSlopeVal = row.querySelector('.field-top-slope')?.value.trim();
            s.topSlope = topSlopeVal ? parseFloat(topSlopeVal) : s.baseSlope;
        }
        return s;
    }).filter(Boolean);

    const groundLayers = Array.from(document.querySelectorAll('#bioGroundLayers .ground-layer-row')).map(row => ({
        block: autoNamespaceBlock(row.querySelector('.ground-layer-block').value),
        min: row.querySelector('.ground-layer-min').value.trim(),
        max: row.querySelector('.ground-layer-max').value.trim(),
    })).filter(l => l.block);

    const parentBiomes = Array.from(document.querySelectorAll('#bioParentBiomes .parent-biome-row')).map(row => ({
        id: row.querySelector('.parent-biome-id').value.trim(),
        chance: row.querySelector('.parent-biome-chance').value.trim(),
        parentEdgeDistance: row.querySelector('.parent-biome-distance').value.trim(),
    })).filter(p => p.id);

    const biomeTags = Array.from(document.querySelectorAll('#biomeTagsContainer .tag-pill')).map(el => el.dataset.tag);

    const skyHex = document.getElementById('bioSkyColor')?.value || "#75b2ff", fogHex = document.getElementById('bioFogColor')?.value || "#e2f2ff";

    window.projectData.biomes = window.projectData.biomes.filter(b => b.id !== window.editingId && b.id !== bId);
    window.projectData.biomes.push({
        id: bId,
        subFolder: window.projectData.biomes.find(b => b.id === bId)?.subFolder || "",
        chance: document.getElementById('biomeChance').value || "1.0",
        interpolation: document.getElementById('bioInterpolation').value,
        interpolationWeight: document.getElementById('bioInterpolationWeight').value || "1.0",
        minRadius: document.getElementById('bioMinRadius').value || "256",
        maxRadius: document.getElementById('bioMaxRadius').value || "320",
        smoothBeaches: document.getElementById('bioSmoothBeaches').checked,
        minHeight: document.getElementById('bioMinHeight').value || "20",
        maxHeight: document.getElementById('bioMaxHeight').value || "40",
        minHeightLimit: document.getElementById('bioMinHeightLimit').value || "7",
        maxHeightLimit: document.getElementById('bioMaxHeightLimit').value || "50",
        roughness: document.getElementById('bioRoughness').value || "1.0",
        hills: document.getElementById('bioHills').value || "5.0",
        mountains: document.getElementById('bioMountains').value || "0.0",
        soilCreep: document.getElementById('bioSoilCreep').value || "1.0",
        keepOriginalTerrain: document.getElementById('bioKeepOriginalTerrain').value || "1.0",
        rivers: document.getElementById('bioRivers').checked,
        maxSubBiomeCount: document.getElementById('bioMaxSubBiomeCount').value.trim(),
        surfaceBlock: autoNamespaceBlock(document.getElementById('bioSurfaceBlock').value),
        subBlock: autoNamespaceBlock(document.getElementById('bioSubBlock').value),
        subMin: document.getElementById('bioSubMin').value.trim(),
        subMax: document.getElementById('bioSubMax').value.trim(),
        stoneBlock: autoNamespaceBlock(document.getElementById('bioStoneBlock').value),
        groundLayers,
        isCave: document.getElementById('bioIsCave').checked,
        caveLayerTag,
        caves: document.getElementById('bioCaves').value || "1.0",
        caveRadiusFactor: document.getElementById('bioCaveRadiusFactor').value || "1.0",
        caveSmoothness: document.getElementById('bioCaveSmoothness').value || "4.0",
        caveNoiseStrength: document.getElementById('bioCaveNoiseStrength').value || "8.0",
        crystals: document.getElementById('bioCrystals').value || "0",
        music: document.getElementById('bioMusic').value.trim() || 'cubyz:sunrise',
        fogDensity: document.getElementById('bioFogDensity').value || "1.5",
        fogLower: document.getElementById('bioFogLower').value || "100",
        fogHigher: document.getElementById('bioFogHigher').value || "1000",
        isValidPlayerSpawn: document.getElementById('bioSpawn').checked,
        skyColorHex: skyHex, fogColorHex: fogHex,
        skyColorVector: getHexColorAsRGBVector(skyHex), fogColorVector: getHexColorAsRGBVector(fogHex),
        properties: propertiesList, structures: structuralLayers,
        tags: biomeTags, parentBiomes,
        climate: document.querySelector('input[name="bioTemp"]:checked')?.value,
        humidity: document.querySelector('input[name="bioWet"]:checked')?.value,
        zone: document.querySelector('input[name="bioZone"]:checked')?.value,
        growth: document.querySelector('input[name="bioGrowth"]:checked')?.value,
        elevationType: document.querySelector('input[name="bioHeightProp"]:checked')?.value
    });

    Object.assign(window, { hasUnsavedChanges: false, editingId: null });
    window.updateSidebarProjectTree();
    if (!silent) alert(`Saved biome "${bId}" successfully into project memory!`);
    return true;
}
window.saveBiomeToProject = saveBiomeToProject;

function saveEntityToProject(silent) {
    const entId = document.getElementById('entityId').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    markFieldValidity('entityId', !!entId);
    if (!entId) {
        if (!silent) alert("Please specify an Entity ID first!");
        return false;
    }

    if (!window.projectData.entities) window.projectData.entities = [];
    window.projectData.entities = window.projectData.entities.filter(e => e.id !== entId);
    window.projectData.entities.push({
        id: entId,
        height: document.getElementById('entityHeight').value || "2.0",
                                     coordinateSystem: document.getElementById('entityCoordSystem').value,
                                     model: document.getElementById('entityModelSearch').value.trim(),
                                     defaultTexture: document.getElementById('entityTextureSearch').value.trim(),
                                         tags: Array.from(document.querySelectorAll('#entityTagsContainer .tag-pill')).map(el => `.${el.dataset.tag}`)
    });

    Object.assign(window, { hasUnsavedChanges: false, editingId: null });
    window.updateSidebarProjectTree();
    if (!silent) alert(`Saved entity "${entId}" successfully into memory!`);
    return true;
}
window.saveEntityToProject = saveEntityToProject;

function saveParticleToProject(silent) {
    const pId = document.getElementById('particleId').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    markFieldValidity('particleId', !!pId);
    if (!pId) {
        if (!silent) alert("Please specify a Particle ID first!");
        return false;
    }

    const shape = document.getElementById('particleSpawnShape').value;
    const mode = document.getElementById('particleDirectionMode').value;

    if (!window.projectData.particles) window.projectData.particles = [];
    window.projectData.particles = window.projectData.particles.filter(p => p.id !== pId);
    window.projectData.particles.push({
        id: pId,
        texture: document.getElementById('particleTextureSearch').value.trim(),
        hasEmission: document.getElementById('particleHasEmission').checked,
        speedMin: parseFloat(document.getElementById('particleSpeedMin').value) || 1.0,
        speedMax: parseFloat(document.getElementById('particleSpeedMax').value) || 1.5,
        lifeMin: parseFloat(document.getElementById('particleLifeMin').value) || 0.75,
        lifeMax: parseFloat(document.getElementById('particleLifeMax').value) || 1.0,
        densityMin: parseFloat(document.getElementById('particleDensityMin').value) || 2.0,
        densityMax: parseFloat(document.getElementById('particleDensityMax').value) || 3.0,
        rotVelMin: parseFloat(document.getElementById('particleRotVelMin').value) || 20.0,
        rotVelMax: parseFloat(document.getElementById('particleRotVelMax').value) || 60.0,
        dragMin: parseFloat(document.getElementById('particleDragMin').value) || 0.5,
        dragMax: parseFloat(document.getElementById('particleDragMax').value) || 0.6,
        randomRotate: document.getElementById('particleRandomRotate').checked,
        collides: document.getElementById('particleCollides').checked,
        shape,
        shapeRadius: (shape === 'sphere') ? (document.getElementById('particleShapeRadius')?.value || "1.0") : "",
        shapeSize: (shape === 'cube') ? (document.getElementById('particleShapeSize')?.value || "1.0") : "",
        mode,
        dirX: (mode === 'direction') ? (document.getElementById('particleDirX')?.value || "0.0") : "",
        dirY: (mode === 'direction') ? (document.getElementById('particleDirY')?.value || "0.0") : "",
        dirZ: (mode === 'direction') ? (document.getElementById('particleDirZ')?.value || "1.0") : ""
    });

    Object.assign(window, { hasUnsavedChanges: false, editingId: null });
    window.updateSidebarProjectTree();
    if (!silent) alert(`Saved particle "${pId}" successfully into memory!`);
    return true;
}
window.saveParticleToProject = saveParticleToProject;

async function exportFullAddon() {
    const keys = ["blocks", "items", "biomes", "entities", "particles"];
    if (keys.every(k => !window.projectData[k]?.length) && (!window.projectData.recipes || !Object.keys(window.projectData.recipes).length)) {
        return alert("Your project is empty! Save at least one object before exporting.");
    }

    const zip = new JSZip();
    const addonName = document.getElementById('addonName').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || 'custom_addon';
    const addonFolder = zip.folder(addonName);

    const folders = {};
    const entityFolder = (typeof window.entityFolderForVersion === "function"
        ? window.entityFolderForVersion(window.VERSION_PATH || "unreleased") : "entity_models");
    ["blocks", "items", "biomes", entityFolder, "particles", "blocks/textures", "items/textures", `${entityFolder}/textures`, "particles/textures", `${entityFolder}/models`, "world_presets", "tools", "structure_tables", "sbb", "recipes"].forEach(f => {
        const key = f === `${entityFolder}/models` ? "models" : f;
        folders[key] = addonFolder.folder(f);
    });

    const packs = { block: [], item: [], entity: [], particle: [] };

    window.projectData.blocks.forEach(b => {
        if (window.deletedAddonElements?.blocks.includes(b.id)) return;
        let dropDec = "    .drops = .{\n        .{.items = .{.auto}},\n    },\n";
        if (!b.dropAuto && b.dropSearch.length > 0) {
            let item = b.dropSearch;
            if (!item.includes(":")) {
                item = (window.projectData.blocks.some(bl => bl.id === item) || window.projectData.items.some(it => it.id === item)) ? `${addonName}:${item}` : `cubyz:${item}`;
            }
            dropDec = `    .drops = .{\n        .{.items = .{"${item}"}},\n    },\n`;
        }

        const baseMatch = window.serverTextures.find(t => t.name === b.baseTexture);
        if (baseMatch) packs.block.push(baseMatch);

        const tagsLine = b.tags?.length ? `    .tags = .{${b.tags.join(', ')}},\n` : "";
        let bZon = ".{\n" +
        tagsLine +
        `    .blockHealth = ${parseFloat(b.health || 1).toFixed(1)},\n` +
        `    .blockResistance = ${parseFloat(b.resistance || 0).toFixed(1)},\n` +
        `    .replaceable = ${b.replaceable},\n` +
        `    .degradable = ${b.degradable},\n` +
        `    .viewThrough = ${b.viewThrough},\n` +
        `    .alwaysViewThrough = ${b.alwaysViewThrough},\n` +
        `    .hasBackFace = ${b.hasBackFace},\n` +
        `    .allowOres = ${b.allowOres},\n` +
        `    .friction = ${parseFloat(b.friction || 20).toFixed(1)},\n` +
        `    .bounciness = ${parseFloat(b.bounciness || 0).toFixed(2)},\n` +
        `    .density = ${parseFloat(b.density || 1.2).toFixed(2)},\n` +
        `    .terminalVelocity = ${parseFloat(b.terminalVelocity || 90).toFixed(1)},\n` +
        `    .mobility = ${parseFloat(b.mobility || 1.0).toFixed(2)},\n`;

        if (b.rotation !== "cubyz:ore") bZon += `    .collide = ${b.collide},\n    .transparent = ${b.transparent},\n`;
        if (b.emittedLight > 0) bZon += `    .emittedLight = ${b.emittedLight},\n`;
        if (b.absorbedLight !== undefined) bZon += `    .absorbedLight = ${b.absorbedLight},\n`;

        if (b.blockEntity) {
            bZon += `    .blockEntity = ${blockEntityRefForVersion(b.blockEntity, window.VERSION_PATH)},\n`;
        }

        if (b.rotation === "cubyz:ore") bZon += "    .ore = .{\n        .veins = 4.5,\n        .size = 20,\n        .maxHeight = -600,\n        .density = 0.25,\n    },\n";

        if (b.callbacks) {
            if (b.callbacks.touchType === 'hurt') {
                let dps = parseFloat(b.callbacks.touchDps || 0.6);
                bZon += `    .onTouch = .{\n        .type = .hurt,\n        .dps = ${(b.callbacks.touchMode === 'heal' && dps > 0 ? -dps : dps).toFixed(1)},\n        .damageType = .${b.callbacks.touchVariant},\n    },\n`;
            }
            const compHook = (hk, ty, rv, dr, dp) => {
                if (!ty || ty === 'none') return "";
                let s = `    .${hk} = .{\n        .type = .${ty},\n`;
                if (ty === 'replace_block' && rv) s += `        .block = "${rv.includes(':') ? rv : addonName + ':' + rv}",\n`;
                else if (ty === 'decay') {
                    let prev = dp || ".log";
                    s += `        .replacement = "${dr || 'cubyz:air'}",\n        .prevention = ${prev.includes('.') ? `.{${prev.split(',').map(t => t.trim()).join(', ')}}` : `.{"${prev}"}`},\n`;
                }
                return s + "    },\n";
                };
                bZon += compHook('onUpdate', b.callbacks.updateType, b.callbacks.updateReplaceBlock, b.callbacks.decayReplacement, b.callbacks.decayPrevention);
                bZon += compHook('onTick', b.callbacks.tickType, b.callbacks.tickReplaceBlock, b.callbacks.decayTickReplacement, b.callbacks.decayTickPrevention);
                bZon += compHook('onBreak', b.callbacks.breakType, b.callbacks.breakReplaceBlock);
                if (b.callbacks.interactType && b.callbacks.interactType !== 'none') {
                    bZon += `    .onInteract = .{\n        .type = .${b.callbacks.interactType},\n${b.callbacks.interactType === 'open_window' ? `        .name = "${b.callbacks.interactWindowName || 'crafting_table'}",\n` : ""}${"    },\n"}`;
                    }
                }
                bZon += dropDec;

                if (b.hasItemIcon && b.itemIconSearch?.length) {
                    const im = window.serverTextures.find(t => t.name === b.itemIconSearch);
                    if (im) packs.item.push(im);
                    bZon += `    .item = {\n        .texture = "${b.itemIconSearch.split('/').pop()}.png",\n    },\n`;
                } else {
                    (b.subFolder ? folders["items"].folder(b.subFolder) : folders["items"]).file(`${b.id}.zig.zon`, `.{\n    .block = "${addonName}:${b.id}",\n}`);
                }

                const texRef = (texName) => {
                    const match = window.serverTextures.find(t => t.name === texName);
                    return match?.isCustom ? `${addonName}:${texName}` : `cubyz:${texName}`;
                };

                bZon += `    .model = "cubyz:cube",\n    .rotation = "${b.rotation}",\n`;
                if (b.rotation === "cubyz:ore") { bZon += `    .texture = "${texRef(b.baseTexture)}",\n`; }
                else {
                    ['up', 'bottom', 'front', 'back', 'right', 'left'].forEach((f, idx) => {
                        if (b.sides?.[f]) {
                            bZon += `    .texture${idx} = "${texRef(b.sides[f])}",\n`;
                            const m = window.serverTextures.find(t => t.name === b.sides[f]); if (m) packs.block.push(m);
                        }
                    });
                    for (let i = 6; i <= 15; i++) {
                        if (b.sides?.[`tex${i}`]) {
                            bZon += `    .texture${i} = "${texRef(b.sides[`tex${i}`])}",\n`;
                            const m = window.serverTextures.find(t => t.name === b.sides[`tex${i}`]); if (m) packs.block.push(m);
                        }
                    }
                    if (b.baseTexture && b.sides && !b.sides.up && !b.sides.front) bZon += `    .texture = "${texRef(b.baseTexture)}",\n`;
                }

                (b.subFolder ? folders["blocks"].folder(b.subFolder) : folders["blocks"]).file(`${b.id}.zig.zon`, bZon + "}");
            });

    window.projectData.items.forEach(item => {
        if (window.deletedAddonElements?.items.includes(item.id) || window.projectData.blocks.some(b => b.id === item.id)) return;
        const baseMatch = window.serverTextures.find(t => t.name === item.texture);
        if (baseMatch) packs.item.push(baseMatch);

        let iZon = ".{\n" + `    .texture = "${item.texture.split('/').pop()}.png",\n`;
        if (item.stackSize != 120) iZon += `    .stackSize = ${item.stackSize},\n`;
        if (item.foodValue > 0) iZon += `    .food = ${parseFloat(item.foodValue).toFixed(1)},\n`;
        if (item.blockPlacement) iZon += `    .block = "${item.blockPlacement.includes(':') ? item.blockPlacement : addonName + ':' + item.blockPlacement}",\n`;
        if (item.tags?.length) iZon += `    .tags = .{${item.tags.join(', ')}},\n`;

        if (item.tags?.includes('.material')) {
            iZon += "    .material = .{\n" +
            `        .durability = ${item.material.durability},\n` +
            `        .massDamage = ${parseFloat(item.material.massDamage).toFixed(1)},\n` +
            `        .hardnessDamage = ${parseFloat(item.material.hardnessDamage).toFixed(1)},\n` +
            `        .swingSpeed = ${parseFloat(item.material.swingSpeed).toFixed(1)},\n` +
            `        .textureRoughness = ${parseFloat(item.material.textureRoughness).toFixed(1)},\n` +
            `        .colors = .{\n            ${item.colors.join(', ')}\n        },\n`;
            if (item.material.modifierType !== "none") {
                iZon += `        .modifiers = .{\n            .{\n                .id = .${item.material.modifierType},\n                .strength = ${parseFloat(item.material.modifierStrength).toFixed(1)},\n            },\n        },\n`;
            }
            iZon += "    },\n";
        }
        (item.subFolder ? folders["items"].folder(item.subFolder) : folders["items"]).file(`${item.id}.zig.zon`, iZon + "}");
    });

    window.projectData.biomes.forEach(bio => {
        if (window.deletedAddonElements?.biomes.includes(bio.id)) return;
        const fmtB = id => {
            let c = (id || "").trim();
            return (!c || c.includes(":") || c.includes("{")) ? c : window.projectData.blocks.some(b => b.id === c) ? `${addonName}:${c}` : `cubyz:${c}`;
        };

        const numericOr = (v, fb) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; };

        let bioZon = ".{\n" +
        `    .${biomeClimateFieldForVersion(window.VERSION_PATH)} = .{ ${(bio.properties || bio.climate || []).join(', ')} },\n` +
        `    .chance = ${parseFloat(bio.chance || 1).toFixed(2)},\n` +
        `    .interpolation = ${bio.interpolation || '.square'},\n`;
        if (String(bio.interpolationWeight ?? "").trim() !== "" && numericOr(bio.interpolationWeight, 1) !== 1) {
            bioZon += `    .interpolationWeight = ${numericOr(bio.interpolationWeight, 1)},\n`;
        }
        if (String(bio.minRadius) === String(bio.maxRadius)) {
            bioZon += `    .radius = ${bio.minRadius},\n`;
        } else {
            bioZon += `    .minRadius = ${bio.minRadius},\n    .maxRadius = ${bio.maxRadius},\n`;
        }
        bioZon +=
        `    .smoothBeaches = ${bio.smoothBeaches},\n` +
        `    .minHeight = ${bio.minHeight},\n` +
        `    .maxHeight = ${bio.maxHeight},\n` +
        `    .minHeightLimit = ${bio.minHeightLimit},\n` +
        `    .maxHeightLimit = ${bio.maxHeightLimit},\n` +
        `    .roughness = ${parseFloat(bio.roughness || 1).toFixed(2)},\n` +
        `    .hills = ${parseFloat(bio.hills || 0).toFixed(2)},\n` +
        `    .mountains = ${parseFloat(bio.mountains || 0).toFixed(2)},\n` +
        `    .soilCreep = ${parseFloat(bio.soilCreep || 1).toFixed(2)},\n` +
        `    .keepOriginalTerrain = ${parseFloat(bio.keepOriginalTerrain || 1).toFixed(2)},\n` +
        `    .stoneBlock = "${fmtB(bio.stoneBlock)}",\n    .isCave = ${bio.isCave},\n`;

        if (bio.rivers) bioZon += `    .rivers = true,\n`;
        if (String(bio.maxSubBiomeCount ?? "").trim() !== "") bioZon += `    .maxSubBiomeCount = ${numericOr(bio.maxSubBiomeCount, 0)},\n`;

        const tagSet = [];
        (bio.tags || []).forEach(t => { const c = String(t).replace(/^\.+/, "").trim(); if (c && !tagSet.includes(c)) tagSet.push(c); });
        if (bio.isCave && bio.caveLayerTag) { const c = bio.caveLayerTag.replace(/^\.+/, ""); if (!tagSet.includes(c)) tagSet.push(c); }
        if (tagSet.length) bioZon += `    .tags = .{ ${tagSet.map(t => `.${t}`).join(', ')} },\n`;

        if (bio.isCave) {
            bioZon += `    .caves = ${parseFloat(bio.caves || 1).toFixed(2)},\n    .caveRadiusFactor = ${parseFloat(bio.caveRadiusFactor || 1).toFixed(2)},\n`;
            if (String(bio.caveSmoothness ?? "").trim() !== "" && numericOr(bio.caveSmoothness, 4) !== 4) {
                bioZon += `    .caveSmoothness = ${numericOr(bio.caveSmoothness, 4)},\n`;
            }
            if (String(bio.caveNoiseStrength ?? "").trim() !== "" && numericOr(bio.caveNoiseStrength, 8) !== 8) {
                bioZon += `    .caveNoiseStrength = ${numericOr(bio.caveNoiseStrength, 8)},\n`;
            }
            bioZon += `    .crystals = ${bio.crystals},\n`;
        }
        bioZon += `    .music = "${bio.music}",\n    .fogDensity = ${parseFloat(bio.fogDensity || 1.5).toFixed(2)},\n`;
        if (String(bio.fogLower ?? "").trim() !== "" && numericOr(bio.fogLower, 100) !== 100) {
            bioZon += `    .fogLower = ${numericOr(bio.fogLower, 100)},\n`;
        }
        if (String(bio.fogHigher ?? "").trim() !== "" && numericOr(bio.fogHigher, 1000) !== 1000) {
            bioZon += `    .fogHigher = ${numericOr(bio.fogHigher, 1000)},\n`;
        }
        bioZon += `    .fogColor = ${bio.fogColorVector},\n    .skyColor = ${bio.skyColorVector},\n    .validPlayerSpawn = ${!!bio.isValidPlayerSpawn},\n`;

        if (bio.parentBiomes?.length) {
            bioZon += "    .parentBiomes = .{\n";
            bio.parentBiomes.forEach(p => {
                bioZon += `        .{\n            .id = "${p.id}",\n            .chance = ${parseFloat(p.chance || 1).toFixed(2)},\n`;
                if (String(p.parentEdgeDistance ?? "").trim() !== "") {
                    bioZon += `            .parentEdgeDistance = ${numericOr(p.parentEdgeDistance, 512)},\n`;
                }
                bioZon += `        },\n`;
            });
            bioZon += "    },\n";
        }

        if (bio.structures?.length) {
            bioZon += "    .structures = .{\n";
            bio.structures.forEach(s => {
                bioZon += `        .{\n            .id = "${s.id}",\n            .chance = ${parseFloat(s.chance).toFixed(3)},\n`;
                if (s.generationMode) bioZon += `            .generationMode = .${String(s.generationMode).replace(/^\.+/, '')},\n`;
                if (String(s.priority ?? "").trim() !== "") bioZon += `            .priority = ${numericOr(s.priority, 1)},\n`;
                if (s.id === 'cubyz:simple_tree') bioZon += `            .log = "${s.log}",\n            .leaves = "${s.leaves}",\n            .top = "${s.top}",\n            .type = ${s.type || '.round'},\n            .height = ${s.height},\n            .height_variation = ${s.height_variation},\n            .leafRadius = ${parseFloat(s.leafRadius || 2).toFixed(1)},\n`;
                else if (s.id === 'cubyz:simple_vegetation') bioZon += `            .block = "${s.block}",\n            .height = ${s.height},\n            .height_variation = ${s.height_variation || 0},\n`;
                else if (s.id === 'cubyz:flower_patch') bioZon += `            .blocks = .{"${s.block}"},\n            .width = ${s.width},\n            .variation = ${s.variation},\n            .density = ${parseFloat(s.density || 0.3).toFixed(2)},\n`;
                else if (s.id === 'cubyz:boulder') bioZon += `            .block = "${s.block}",\n            .size = ${s.size},\n            .size_variance = ${s.size_variance || 3},\n`;
                else if (s.id === 'cubyz:ground_patch') bioZon += `            .block = "${s.block}",\n            .width = ${s.width},\n            .depth = ${s.depth},\n            .smoothness = ${parseFloat(s.smoothness || 0.2).toFixed(2)},\n`;
                else if (s.id === 'cubyz:fallen_tree') bioZon += `            .log = "${s.log}",\n            .top = "${s.top}",\n            .height = ${s.height},\n            .height_variation = ${s.height_variation},\n`;
                else if (s.id === 'cubyz:sbb') bioZon += `            .structure = "${s.structure}",\n            .placeMode = ${s.placeMode},\n`;
                else if (s.id === 'cubyz:stalagmite') bioZon += `            .block = "${s.block}",\n            .size = ${s.size},\n            .size_variation = ${s.size_variation},\n            .baseSlope = ${s.baseSlope},\n            .topSlope = ${s.topSlope},\n`;
                bioZon += "        },\n";
                });
            bioZon += "    },\n";
            }

            const groundEntries = [`"${fmtB(bio.surfaceBlock)}"`];
            if (bio.subBlock) {
                const subB = fmtB(bio.subBlock);
                const mn = String(bio.subMin ?? "").trim(), mx = String(bio.subMax ?? "").trim();
                if (mn !== "" && mx !== "" && parseFloat(mx) !== parseFloat(mn)) groundEntries.push(`"${mn} to ${mx} ${subB}"`);
                else if (mn !== "") groundEntries.push(`"${mn} ${subB}"`);
                else if (mx !== "") groundEntries.push(`"${mx} ${subB}"`);
                else groundEntries.push(`"0 to 3 ${subB}"`);
            }
            (bio.groundLayers || []).forEach(l => {
                const b = fmtB(l.block);
                const mn = String(l.min ?? "").trim(), mx = String(l.max ?? "").trim();
                if (mn !== "" && mx !== "" && parseFloat(mx) > parseFloat(mn)) groundEntries.push(`"${mn} to ${mx} ${b}"`);
                else if (mn !== "") groundEntries.push(`"${mn} ${b}"`);
                else if (mx !== "") groundEntries.push(`"${mx} ${b}"`);
                else groundEntries.push(`"${b}"`);
            });
            bioZon += `    .ground_structure = .{\n        ${groundEntries.join(",\n        ")},\n    },\n`;

            // Re-emit any top-level field the UI does not manage (caveModels,
            // stripes, transitionBiomes, type, future fields) exactly as it was
            // imported, so a round-trip never strips game data.
            const managedBiomeKeys = new Set(["climate", "properties", "chance", "interpolation", "interpolationWeight", "minRadius", "maxRadius", "radius", "smoothBeaches", "minHeight", "maxHeight", "minHeightLimit", "maxHeightLimit", "roughness", "hills", "mountains", "soilCreep", "keepOriginalTerrain", "rivers", "maxSubBiomeCount", "stoneBlock", "isCave", "caves", "caveRadiusFactor", "caveSmoothness", "caveNoiseStrength", "crystals", "tags", "music", "fogDensity", "fogLower", "fogHigher", "fogColor", "skyColor", "validPlayerSpawn", "isValidPlayerSpawn", "structures", "ground_structure", "parentBiomes"]);
            if (bio.rawBlocks) {
                for (const [rawKey, rawText] of Object.entries(bio.rawBlocks)) {
                    if (managedBiomeKeys.has(rawKey)) continue;
                    bioZon += rawText.replace(/\s+$/, "") + "\n";
                }
            }
            bioZon += "}";
            (bio.subFolder ? folders["biomes"].folder(bio.subFolder) : folders["biomes"]).file(`${bio.id}.zig.zon`, bioZon);
    });

    if (window.projectData.recipes) {
        Object.keys(window.projectData.recipes).forEach(fn => {
            if (window.deletedAddonElements?.recipes.includes(fn)) return;
            let rZon = ".{\n";
            window.projectData.recipes[fn].forEach(r => {
                rZon += "    .{\n        .inputs = .{";
                rZon += r.inputs.map(input => {
                    let c = input.trim(), pfx = "", m = c.match(/^(\d+)\s+(.+)$/);
                    if (m) { pfx = m[1] + " "; c = m[2]; }
                    if (c.includes(":") || c.includes("{")) return `"${pfx}${c}"`;
                    return (window.projectData.blocks.some(b => b.id === c) || window.projectData.items.some(i => i.id === c)) ? `"${pfx}${addonName}:${c}"` : `"${pfx}cubyz:${c}"`;
                }).join(", ") + "},\n";

                let outC = r.output.trim(), outPfx = "", outM = outC.match(/^(\d+)\s+(.+)$/);
                if (outM) { outPfx = outM[1] + " "; outC = outM[2]; }
                rZon += `        .output = "${outPfx}${outC.includes(":") || outC.includes("{") ? outC : (window.projectData.blocks.some(b => b.id === outC) || window.projectData.items.some(i => i.id === outC) ? addonName + ':' + outC : 'cubyz:' + outC)}",\n    },\n`;
        });
            const mb = window.projectData.blocks.find(b => b.id === fn);
            (mb?.subFolder ? folders["recipes"].folder(mb.subFolder) : folders["recipes"]).file(`${fn}_recipes.zig.zon`, rZon + "}");
    });
        }

        if (window.projectData.entities) {
            window.projectData.entities.forEach(ent => {
                if (window.deletedAddonElements?.entities?.includes(ent.id)) return;

                let tagStr = ent.tags.map(t => `\n        ${t},`).join('');

                const cleanModel = ent.model.includes(':') ? ent.model.split(':').pop() : ent.model;
                const cleanTex = ent.defaultTexture.includes(':') ? ent.defaultTexture.split(':').pop() : ent.defaultTexture;

                const modelIsCustom = !!window.customEntityModels?.[`${addonName}:${cleanModel}`];
                const texIsCustom = window.serverTextures.some(t => t.isCustom && t.isEntityType && entityTextureMatches(t.name, cleanTex));
                const modelRef = modelIsCustom ? `${addonName}:${cleanModel}` : `cubyz:${cleanModel}`;
                const texRef = texIsCustom ? `${addonName}:${cleanTex}` : `cubyz:${cleanTex}`;

                folders[entityFolder].file(`${ent.id.split(':').pop()}.zig.zon`, `.{\n${ent.tags.length ? `    .tags = .{${tagStr}\n    },\n` : ""}` +
                `    .model = "${modelRef}",\n` +
                `    .defaultTexture = "${texRef}",\n` +
                `    .height = ${parseFloat(ent.height || 2.0).toFixed(1)},\n` +
                `    .coordinateSystem = ${ent.coordinateSystem || '.right_handed_z_up'},\n}`);

                if (ent.defaultTexture) {
                    const m = window.serverTextures.find(t => entityTextureMatches(t.name, cleanTex) || t.name === ent.defaultTexture);
                    if (m) packs.entity.push(m);
                }
            });
        }

        if (window.projectData.particles) {
            window.projectData.particles.forEach(p => {
                if (window.deletedAddonElements?.particles?.includes(p.id)) return;
                let pZon = ".{\n" +
                `    .texture = "${p.texture.includes(':') ? p.texture : addonName + ':' + p.texture}",\n` +
                `    .rotationVelocity = .{ .min = ${parseFloat(p.rotVelMin || 20).toFixed(1)}, .max = ${parseFloat(p.rotVelMax || 60).toFixed(1)} },\n` +
                `    .density = .{ .min = ${parseFloat(p.densityMin || 2).toFixed(1)}, .max = ${parseFloat(p.densityMax || 3).toFixed(1)} },\n` +
                `    .dragCoefficient = .{ .min = ${parseFloat(p.dragMin || 0.5).toFixed(2)}, .max = ${parseFloat(p.dragMax || 0.6).toFixed(2)} },\n` +
                `    .speed = .{ .min = ${parseFloat(p.speedMin || 1).toFixed(1)}, .max = ${parseFloat(p.speedMax || 1.5).toFixed(1)} },\n` +
                `    .lifeTime = .{ .min = ${parseFloat(p.lifeMin || 0.75).toFixed(2)}, .max = ${parseFloat(p.lifeMax || 1).toFixed(2)} },\n` +
                `    .randomRotate = ${p.randomRotate},\n    .collides = ${p.collides},\n    .shape = .${p.shape},\n`;

                if (p.shape === 'sphere') pZon += `    .radius = ${parseFloat(p.shapeRadius || 1.0).toFixed(1)},\n`;
                else if (p.shape === 'cube') pZon += `    .size = ${String(p.shapeSize).includes('.') ? p.shapeSize : parseFloat(p.shapeSize || 1.0).toFixed(1)},\n`;
                pZon += `    .mode = .${p.mode},\n`;
                if (p.mode === 'direction') pZon += `    .direction = .{ ${parseFloat(p.dirX || 0).toFixed(1)}, ${parseFloat(p.dirY || 0).toFixed(1)}, ${parseFloat(p.dirZ || 1).toFixed(1)} },\n`;

                folders["particles"].file(`${p.id}.zig.zon`, pZon + "}");
                const m = window.serverTextures.find(t => t.name === p.texture); if (m) packs.particle.push(m);
                if (p.hasEmission) { const em = window.serverTextures.find(t => t.name === `${p.texture}_emission`); if (em) packs.particle.push(em); }
            });
        }

        const unq = type => Array.from(new Map(packs[type].map(t => [t.name, t])).values());
        const writeTex = async (list, folder, clean) => {
            for (const tex of list) {
                const fn = clean ? (tex.name.includes('/') ? tex.name.split('/').pop() : tex.name) : tex.name;
                if (tex.isCustom && tex.rawFile) folder.file(`${fn}.png`, tex.rawFile);
                else {
                    try {
                        const res = await fetch(tex.dataUrl);
                        if (res.ok) folder.file(`${fn}.png`, await res.blob());
                    } catch (e) {}
                }
            }
        };
        if (window.customEntityModels) {
            for (const [fullKey, fileObject] of Object.entries(window.customEntityModels)) {
                const cleanFileName = fullKey.includes(':') ? fullKey.split(':').pop() : fullKey;
                const fileExt = fileObject.name.includes('.') ? '.' + fileObject.name.split('.').pop() : '.obj';

                folders["models"].file(`${cleanFileName}${fileExt}`, fileObject);
            }
        }
        await writeTex(unq('block'), folders["blocks/textures"], false);
        await writeTex(unq('item'), folders["items/textures"], true);
        await writeTex(unq('entity'), folders[`${entityFolder}/textures`], true);
        await writeTex(unq('particle'), folders["particles/textures"], true);

        zip.generateAsync({type:"blob"}).then(c => {
            const a = document.createElement('a'); a.href = URL.createObjectURL(c); a.download = `${addonName}.zip`; a.click();
        });
    }
    window.exportFullAddon = exportFullAddon;
