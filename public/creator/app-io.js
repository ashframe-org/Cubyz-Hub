
function isZonFile(path) {
    return path.endsWith('.zig.zon') || path.endsWith('.zon');
}

function pathHasCategory(path, category) {
    return path.split('/').includes(category);
}

function pathHasCategorySubfolder(path, category, subfolder) {
    const parts = path.split('/');
    const idx = parts.indexOf(category);
    return idx !== -1 && parts[idx + 1] === subfolder;
}

function stripZonExtension(filename) {
    if (filename.endsWith('.zig.zon')) return filename.slice(0, -'.zig.zon'.length);
    const lastDot = filename.lastIndexOf('.');
    return lastDot === -1 ? filename : filename.slice(0, lastDot);
}

function detectSourceVersion(filePaths) {
    const has = (category) => filePaths.some((p) => pathHasCategory(p, category));

    if (has('entity_models')) return "unreleased";
    if (filePaths.some((p) => /(^|\/)blocks\/.*log\/(oak|birch|pine|willow|baobab|mahogany)\.zig\.zon$/.test(p))) return "0.3.0";
    if (filePaths.some((p) => /(^|\/)blocks\/.*planks\/oak\.zig\.zon$/.test(p))) return "0.2.0";
    if (has('entityModels')) return null;
    if (has('entity')) return "0.1.1";

    if (filePaths.some((p) => /(^|\/)blocks\/.*oak_planks\.zig\.zon$/.test(p))) return "0.1.1";

    return null;
}

const CONTENT_SCAN_FILE_LIMIT = 40;

async function detectVersionFromContent(zip, filePaths) {
    const biomeFiles = filePaths.filter((p) => pathHasCategory(p, 'biomes') && (p.endsWith('.zig.zon') || p.endsWith('.zon'))).slice(0, CONTENT_SCAN_FILE_LIMIT);
    const blockFiles = filePaths.filter((p) => pathHasCategory(p, 'blocks') && (p.endsWith('.zig.zon') || p.endsWith('.zon'))).slice(0, CONTENT_SCAN_FILE_LIMIT);

    for (const path of biomeFiles) {
        const content = await zip.files[path].async("string");
        if (/\.climate\s*=/.test(content)) return "unreleased";
    }

    let sawBiomeTagsField = false;
    for (const path of biomeFiles) {
        const content = await zip.files[path].async("string");
        if (/\.tags\s*=\s*\.\{/.test(content)) sawBiomeTagsField = true;
    }

    let sawLegacyOnUpdateDrops = false;
    const legacyOnUpdateDropsPattern = /\.onUpdate(?:\.drops\s*=|\s*=\s*\.\{[\s\S]{0,300}?\.drops\s*=)/;

    let sawSelectionCapabilities = false;
    let sawOldReplacableSpelling = false;
    let sawAllowedToolTags = false;

    for (const path of blockFiles) {
        const content = await zip.files[path].async("string");
        if (legacyOnUpdateDropsPattern.test(content)) sawLegacyOnUpdateDrops = true;
        if (/\.selectionCapabilities\s*=/.test(content)) sawSelectionCapabilities = true;
        if (/\.replacable\s*=/.test(content)) sawOldReplacableSpelling = true;
        if (/\.allowedToolTags\s*=/.test(content)) sawAllowedToolTags = true;

        if (/\.voidstone\b/.test(content) && !/\.voidStone\b/.test(content)) return "unreleased";
    }

    if (sawSelectionCapabilities || sawBiomeTagsField || sawAllowedToolTags) return "0.3.0";

    if (sawOldReplacableSpelling) return "0.2.0";
    if (sawLegacyOnUpdateDrops) return "0.2.0";

    return null;
}

async function importExistingAddon(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];

    try {
        const zip = await JSZip.loadAsync(file);
        const zipPaths = Object.keys(zip.files);
        const filePaths = zipPaths.filter((p) => !zip.files[p].dir);
        let namespaceName = file.name.replace('.zip', '').toLowerCase().replace(/[^a-z0-9_]/g, "");

        const KNOWN_CATEGORY_FOLDERS = ['blocks', 'items', 'biomes', 'recipes', 'particles', 'entity', 'entityModels', 'entity_models', 'models', 'textures', 'tools', 'world_presets', 'structure_tables', 'sbb', 'cave_layers'];
        for (const path of zipPaths) {
            const parts = path.split('/');
            if (parts.length > 1 && parts[0] !== "__MACOSX" && !KNOWN_CATEGORY_FOLDERS.includes(parts[0])) {
                namespaceName = parts[0];
                break;
            }
        }

        let detectedVersion = detectSourceVersion(filePaths);

        if (detectedVersion === null) {
            detectedVersion = await detectVersionFromContent(zip, filePaths);
        }

        const rules = await loadMigrationRulesForImport();
        const latest = rules.versions.some((v) => v.version === "unreleased")
            ? "unreleased"
            : (rules.versions.filter((v) => v.released).pop()?.version || "unreleased");
        const versionChoices = rules.versions.filter((v) => v.released || v.version === "unreleased");

        const sourceVersion = await confirmImportVersions(detectedVersion, latest, versionChoices);
        if (!sourceVersion) return;
        const targetVersion = sourceVersion;

        document.getElementById('addonName').value = namespaceName;

        const namespaceCounts = {};
        for (const path of filePaths.slice(0, 200)) {
            if (!isZonFile(path)) continue;
            const content = await zip.files[path].async("string");
            const matches = content.matchAll(/"([a-z][a-z0-9_]*):[a-z0-9_/]+/g);
            for (const m of matches) {
                if (m[1] === 'cubyz') continue;
                namespaceCounts[m[1]] = (namespaceCounts[m[1]] || 0) + 1;
            }
        }
        const originalNamespace = Object.entries(namespaceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

        window.projectData.blocks = [];
        window.projectData.items = [];
        window.projectData.recipes = {};
        window.projectData.biomes = [];
        window.projectData.entities = [];
        window.projectData.particles = [];

        const entityFolder = entityFolderForVersion(sourceVersion);

        for (const [path, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir || !path.endsWith('.png')) continue;

            const isBlockType = pathHasCategory(path, 'blocks');
            const isEntityType = pathHasCategory(path, entityFolder);
            const isParticleType = pathHasCategory(path, 'particles');

            const categoryPrefixPattern = isEntityType
                ? new RegExp(`^.*?${entityFolder}/(?:textures/)?`)
                : isParticleType
                ? /^.*?particles\/(?:textures\/)?/
                : isBlockType
                ? /^.*?blocks\/(?:textures\/)?/
                : /^.*?items\/(?:textures\/)?/;
            const filename = path.replace(categoryPrefixPattern, '').replace('.png', '');

            const base64Data = await zipEntry.async("base64");
            const dataUrl = `data:image/png;base64,${base64Data}`;
            const rawFileBlob = await zipEntry.async("blob");

            if (!window.serverTextures.some(t => t.name === filename)) {
                window.serverTextures.unshift({
                    name: filename,
                    dataUrl: dataUrl,
                    isCustom: true,
                    isBlockType: isBlockType,
                    isEntityType: isEntityType,
                    isParticleType: isParticleType,
                    rawFile: new File([rawFileBlob], `${filename}.png`, { type: "image/png" })
                });
            }
        }

        if (typeof window.rebuildDropdowns === 'function') window.rebuildDropdowns();

        const parseIntegerToHexColor = (numStr, defaultHex) => {
            if (!numStr) return defaultHex;
            let val = parseInt(numStr.trim(), 0);
            if (isNaN(val)) return defaultHex;
            return "#" + (val & 0xFFFFFF).toString(16).padStart(6, '0');
        };

        const extractVal = (contentStr, key, fallback) => {
            const match = contentStr.match(new RegExp(`\\.${key}\\s*=\\s*([^,\\r\\n]+)`));
            return match ? match[1].trim().replace(/^["']|["']$/g, '') : fallback;
        };

        const splitTopLevelBlocks = (contentStr) => {
            const blocks = [];
            let depth = 0, start = -1;
            for (let i = 0; i < contentStr.length; i++) {
                const ch = contentStr[i];
                if (ch === '{') {
                    if (depth === 1) start = i;
                    depth++;
                } else if (ch === '}') {
                    depth--;
                    if (depth === 1 && start !== -1) {
                        blocks.push(contentStr.slice(start, i + 1));
                        start = -1;
                    }
                }
            }
            return blocks;
        };

        const extractMinMax = (contentStr, key) => {
            const regex = new RegExp(`\\.${key}\\s*=\\s*\\.\\{\\s*\\.min\\s*=\\s*([^,\\s}]+)\\s*,\\s*\\.max\\s*=\\s*([^,\\s}]+)`);
            const match = contentStr.match(regex);
            return match ? { min: parseFloat(match[1]), max: parseFloat(match[2]) } : { min: 0, max: 0 };
        };

        const defaultsCache = {};
        for (const [path, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            const base = path.split('/').pop();
            if (base === '_defaults.zig.zon' || base === '_defaults.zon') {
                const dirPath = path.slice(0, path.length - base.length);
                defaultsCache[dirPath] = await zipEntry.async("string");
            }
        }
        const withDefaultsMerged = (path, ownContent) => {
            const dirPath = path.slice(0, path.length - path.split('/').pop().length);
            const defaults = defaultsCache[dirPath];
            return defaults ? `${ownContent}\n${defaults}` : ownContent;
        };

        for (const [path, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            const nameToken = stripZonExtension(path.split('/').pop());

            if (nameToken === '_defaults') continue;

            const parts = path.split('/');
            let extractedSubFolder = "";
            const catIndex = parts.findIndex(p => p === 'blocks' || p === 'items' || p === 'recipes' || p === 'biomes' || p === entityFolder || p === 'particles');
            if (catIndex !== -1 && parts.length > catIndex + 2) {
                extractedSubFolder = parts.slice(catIndex + 1, parts.length - 1).join('/');
            }

            const categoryFolders = ['blocks', 'items', 'recipes', 'biomes', entityFolder, 'particles'];
            const startsWithTextures = categoryFolders.some((cat) => {
                const i = parts.indexOf(cat);
                return i !== -1 && parts.slice(i + 1).join('/').toLowerCase().startsWith('textures');
            });
            if (startsWithTextures) continue;

            if (pathHasCategory(path, 'blocks') && isZonFile(path)) {
                const content = withDefaultsMerged(path, await zipEntry.async("string"));
                const loadedRotation = extractVal(content, 'rotation', 'cubyz:stairs');
                const loadedBaseTexture = content.match(/\.texture\s*=\s*"[^:]+:([^"]+)"/)?.[1] || "stone";

                const getSideTex = (sideKey) => {
                    const sideMatch = content.match(new RegExp(`\\.${sideKey}\\s*=\\s*"[^:]+:([^"]+)"`));
                    return sideMatch ? sideMatch[1] : "";
                };

                let parsedTags = [];
                const tagsMatch = content.match(/\.tags\s*=\s*\.\{\s*([\s\S]*?)\}/);
                if (tagsMatch) {
                    parsedTags = tagsMatch[1].split(',')
                        .map(t => t.trim().replace(/^\./, ''))
                        .filter(t => t.length > 0)
                        .map(t => `.${t}`);
                }

                window.projectData.blocks.push({
                    id: nameToken,
                    subFolder: extractedSubFolder,
                    health: extractVal(content, 'blockHealth', '1'),
                    resistance: extractVal(content, 'blockResistance', '0'),
                    rotation: loadedRotation,
                    collide: !content.includes(".collide = false"),
                    transparent: content.includes(".transparent = true"),
                    replaceable: content.includes(".replaceable = true"),
                    degradable: content.includes(".degradable = true"),
                    viewThrough: content.includes(".viewThrough = true"),
                    alwaysViewThrough: content.includes(".alwaysViewThrough = true"),
                    hasBackFace: content.includes(".hasBackFace = true"),
                    allowOres: content.includes(".allowOres = true"),
                    friction: extractVal(content, 'friction', '20'),
                    bounciness: extractVal(content, 'bounciness', '0.0'),
                    density: extractVal(content, 'density', '1.2'),
                    terminalVelocity: extractVal(content, 'terminalVelocity', '90'),
                    mobility: extractVal(content, 'mobility', '1.0'),
                    emittedLightColor: parseIntegerToHexColor(extractVal(content, 'emittedLight', '0'), '#000000'),
                    absorbedLightColor: parseIntegerToHexColor(extractVal(content, 'absorbedLight', '16777215'), '#ffffff'),
                    dropAuto: !content.includes(".drops ="),
                    dropSearch: content.match(/\.items\s*=\s*\.\{\s*\.\{\s*items\s*=\s*\.\{\s*"([^"]+)"/)?.[1] || "",
                    hasItemIcon: content.includes(".item ="),
                    blockEntity: (content.match(/\.blockEntity\s*=\s*\.?("[^"]+"|[A-Za-z_][\w:]*)/)?.[1] || "")
                        .replace(/^"|"$/g, "").replace(/^\./, ""),
                    itemIconSearch: content.match(/\.item\s*=\s*\.?\{\s*\.texture\s*=\s*"([^"]+)\.png"/)?.[1] || "",
                    baseTexture: loadedBaseTexture,
                    callbacks: {
                        touchType: content.includes(".onTouch") ? "hurt" : "none",
                        touchMode: content.includes(".damageType = .heal") ? "heal" : "damage",
                        touchDps: parseFloat(content.match(/\.dps\s*=\s*([^,\r\n]+)/)?.[1]) || 0.6,
                        touchVariant: content.match(/\.damageType\s*=\s*\.([^,\r\n]+)/)?.[1] || "heat",
                        updateType: content.match(/\.onUpdate\s*=\s*\{\s*\.type\s*=\s*\.([^,\r\n]+)/)?.[1] || "none",
                        tickType: content.match(/\.onTick\s*=\s*\{\s*\.type\s*=\s*\.([^,\r\n]+)/)?.[1] || "none",
                        breakType: content.match(/\.onBreak\s*=\s*\{\s*\.type\s*=\s*\.([^,\r\n]+)/)?.[1] || "none",
                        interactType: content.match(/\.onInteract\s*=\s*\{\s*\.type\s*=\s*\.([^,\r\n]+)/)?.[1] || "none",
                        interactWindowName: content.match(/\.onInteract\s*=\s*\{\s*[\s\S]*?\.name\s*=\s*"([^"]+)"/)?.[1] || "crafting_table"
                    },
                    sides: {
                        front: getSideTex('texture2'),
                        left: getSideTex('texture5'),
                        right: getSideTex('texture4'),
                        up: getSideTex('texture0'),
                        bottom: getSideTex('texture1')
                    },
                    tags: parsedTags
                });

            } else if (pathHasCategory(path, 'items') && isZonFile(path)) {
                const content = withDefaultsMerged(path, await zipEntry.async("string"));
                let parsedTags = [];
                const tagsMatch = content.match(/\.tags\s*=\s*\.\{\s*([\s\S]*?)\}/);
                if (tagsMatch) {
                    parsedTags = tagsMatch[1].split(',')
                        .map(t => t.trim().replace(/^\./, ''))
                        .filter(t => t.length > 0)
                        .map(t => `.${t}`);
                }

                window.projectData.items.push({
                    id: nameToken,
                    subFolder: extractedSubFolder,
                    stackSize: extractVal(content, 'stackSize', '120'),
                    foodValue: parseFloat(extractVal(content, 'food', '0.0')),
                    blockPlacement: extractVal(content, 'block', ''),
                    tags: parsedTags,
                    texture: extractVal(content, 'texture', 'stone').replace('.png', ''),
                    colors: ["0xffffffff"],
                    baseColor: "#9c9c9c",
                    material: {
                        durability: content.match(/\.durability\s*=\s*([^,\r\n]+)/)?.[1] || "250",
                        swingSpeed: content.match(/\.swingSpeed\s*=\s*([^,\r\n]+)/)?.[1] || "1.0",
                        textureRoughness: content.match(/\.textureRoughness\s*=\s*([^,\r\n]+)/)?.[1] || "0.0",
                        massDamage: content.match(/\.massDamage\s*=\s*([^,\r\n]+)/)?.[1] || "2.0",
                        hardnessDamage: content.match(/\.hardnessDamage\s*=\s*([^,\r\n]+)/)?.[1] || "2.0",
                        modifierType: content.match(/\.id\s*=\s*\.([^,\r\n]+)/)?.[1] || "none",
                        modifierStrength: content.match(/\.strength\s*=\s*([^,\r\n]+)/)?.[1] || "1.0"
                    }
                });

            } else if (pathHasCategory(path, entityFolder) && !pathHasCategorySubfolder(path, entityFolder, 'models') && !pathHasCategorySubfolder(path, entityFolder, 'textures') && isZonFile(path)) {
                const content = withDefaultsMerged(path, await zipEntry.async("string"));
                const nameToken = stripZonExtension(path.split('/').pop());

                const addonName = document.getElementById('addonName').value;

                let entityTags = [];
                const entityTagsMatch = content.match(/\.tags\s*=\s*\.\{\s*([\s\S]*?)\}/);
                if (entityTagsMatch) {
                    entityTags = entityTagsMatch[1].split(',')
                        .map(t => t.trim().replace(/^\./, ''))
                        .filter(t => t.length > 0)
                        .map(t => `.${t}`);
                }

                window.projectData.entities.push({
                    id: `${addonName}:${nameToken}`,
                    height: extractVal(content, 'height', '2.0'),
                    coordinateSystem: content.match(/\.coordinateSystem\s*=\s*(\.(?:left|right)_handed_[yz]_up)/)?.[1] || '.right_handed_z_up',
                    model: `${addonName}:${extractVal(content, 'model', '').split(':').pop()}`,
                    defaultTexture: `${addonName}:${extractVal(content, 'defaultTexture', '').split(':').pop()}`,
                    tags: entityTags
                });

                const modelName = extractVal(content, 'model', '').split(':').pop();
                if (modelName) {
                    if (!window.customEntityModels) window.customEntityModels = {};
                    const baseName = (p) => {
                        const file = p.split('/').pop();
                        const dot = file.lastIndexOf('.');
                        return dot === -1 ? file : file.slice(0, dot);
                    };
                    const modelPath = filePaths.find((p) =>
                        pathHasCategorySubfolder(p, entityFolder, 'models') && baseName(p) === modelName);
                    const modelKey = `${addonName}:${modelName}`;
                    if (modelPath && !window.customEntityModels[modelKey]) {
                        const modelBlob = await zip.files[modelPath].async("blob");
                        const modelExt = modelPath.slice(modelPath.lastIndexOf('.'));
                        window.customEntityModels[modelKey] = new File(
                            [modelBlob], `${modelName}${modelExt}`, { type: "application/octet-stream" });
                    }
                }

            } else if (pathHasCategory(path, 'particles') && isZonFile(path)) {
                const content = withDefaultsMerged(path, await zipEntry.async("string"));
                const speedRange = extractMinMax(content, 'speed');
                const lifeRange = extractMinMax(content, 'lifeTime');
                const densityRange = extractMinMax(content, 'density');
                const rotRange = extractMinMax(content, 'rotationVelocity');
                const dragRange = extractMinMax(content, 'dragCoefficient');
                const directionVectorMatch = content.match(/\.direction\s*=\s*\.\{\s*([^,\s}]+)\s*,\s*([^,\s}]+)\s*,\s*([^,\s}]+)\s*\}/);

                window.projectData.particles.push({
                    id: nameToken,
                    texture: extractVal(content, 'texture', '').replace(/^[^:]+:/, ''),
                    hasEmission: content.includes('_emission'),
                    speedMin: speedRange.min,
                    speedMax: speedRange.max,
                    lifeMin: lifeRange.min,
                    lifeMax: lifeRange.max,
                    densityMin: densityRange.min,
                    densityMax: densityRange.max,
                    rotVelMin: rotRange.min,
                    rotVelMax: rotRange.max,
                    dragMin: dragRange.min,
                    dragMax: dragRange.max,
                    randomRotate: !content.includes('.randomRotate = false'),
                    collides: !content.includes('.collides = false'),
                    shape: extractVal(content, 'shape', 'point'),
                    shapeRadius: extractVal(content, 'radius', '1.0'),
                    shapeSize: extractVal(content, 'size', '1.0'),
                    mode: extractVal(content, 'mode', 'spread'),
                    dirX: directionVectorMatch ? directionVectorMatch[1] : "0.0",
                    dirY: directionVectorMatch ? directionVectorMatch[2] : "0.0",
                    dirZ: directionVectorMatch ? directionVectorMatch[3] : "1.0"
                });

            } else if (pathHasCategory(path, 'recipes') && isZonFile(path)) {
                const nameToken = stripZonExtension(path.split('/').pop()).replace('_recipes', '');
                const content = await zipEntry.async("string");

                const recipeBlocks = splitTopLevelBlocks(content);
                const blocksToParse = recipeBlocks.length ? recipeBlocks : [content];

                const parsedRecipes = blocksToParse.map((block) => {
                    let inputsParsed = [];
                    const inputsMatch = block.match(/\.inputs\s*=\s*\.\{\s*([\s\S]*?)\}/);
                    if (inputsMatch) {
                        inputsParsed = inputsMatch[1].split(',')
                            .map(i => i.trim().replace(/"/g, ''))
                            .filter(i => i.length > 0);
                    }
                    return {
                        inputs: inputsParsed,
                        output: extractVal(block, 'output', '').replace(/"/g, '')
                    };
                }).filter((r) => r.inputs.length || r.output);

                window.projectData.recipes[nameToken] = parsedRecipes.length ? parsedRecipes : [{ inputs: [], output: '' }];

            } else if (pathHasCategory(path, 'biomes') && isZonFile(path)) {
                const content = withDefaultsMerged(path, await zipEntry.async("string"));
                const parsedStructures = [];
                let startIdx = content.indexOf('.structures');

                if (startIdx !== -1) {
                    let openBrace = content.indexOf('{', startIdx);
                    if (openBrace !== -1) {
                        let idx = openBrace + 1, braceCount = 1, structuresText = "";
                        while (idx < content.length && braceCount > 0) {
                            let char = content[idx];
                            if (char === '{') braceCount++;
                            if (char === '}') braceCount--;
                            if (braceCount > 0) structuresText += char;
                            idx++;
                        }

                        let sIdx = 0;
                        while (sIdx < structuresText.length) {
                            let openObj = structuresText.indexOf('.{', sIdx);
                            if (openObj === -1) break;

                            let subCount = 1, subIdx = openObj + 2, objText = "";
                            while (subIdx < structuresText.length && subCount > 0) {
                                let c = structuresText[subIdx];
                                if (c === '{') subCount++;
                                if (c === '}') subCount--;
                                if (subCount > 0) objText += c;
                                subIdx++;
                            }

                            const lines = objText.split('\n');
                            let attrs = {};
                            lines.forEach(line => {
                                const match = line.trim().match(/^\.(\w+)\s*=\s*(.+?)(?:,)?$/);
                                if (match) {
                                    let val = match[2].trim();
                                    if (val.endsWith(',')) val = val.slice(0, -1).trim();
                                    attrs[match[1].trim()] = val.replace(/^["']|["']$/g, '').replace(/^\.\{\s*["']?|["']?\s*\}$/g, '');
                                }
                            });

                            if (attrs.id) {
                                let structObj = { id: attrs.id, chance: parseFloat(attrs.chance) || 0.05 };
                                if (attrs.generationMode) structObj.generationMode = attrs.generationMode;
                                if (attrs.priority !== undefined) structObj.priority = parseFloat(attrs.priority);
                                if (attrs.id === 'cubyz:simple_tree') {
                                    structObj.log = attrs.log || 'cubyz:oak_log';
                                    structObj.leaves = attrs.leaves || 'cubyz:leaves/oak';
                                    structObj.height = parseInt(attrs.height) || 6;
                                    structObj.height_variation = parseInt(attrs.height_variation) || 3;
                                    structObj.leafRadius = parseFloat(attrs.leafRadius) || 2;
                                } else if (attrs.id === 'cubyz:simple_vegetation') {
                                    structObj.block = attrs.block || 'cubyz:fern';
                                    structObj.height = parseInt(attrs.height) || 1;
                                    structObj.height_variation = parseInt(attrs.height_variation) || 0;
                                } else if (attrs.id === 'cubyz:flower_patch') {
                                    structObj.block = attrs.block || attrs.blocks || 'cubyz:daffodil';
                                    structObj.width = parseInt(attrs.width) || 10;
                                    structObj.variation = parseInt(attrs.variation) || 6;
                                    structObj.density = parseFloat(attrs.density) || 0.3;
                                } else if (attrs.id === 'cubyz:boulder') {
                                    structObj.block = attrs.block || 'cubyz:slate/rough';
                                    structObj.size = parseInt(attrs.size) || 5;
                                    structObj.size_variance = parseInt(attrs.size_variance) || 4;
                                } else if (attrs.id === 'cubyz:ground_patch') {
                                    structObj.block = attrs.block || 'cubyz:gravel';
                                    structObj.width = parseInt(attrs.width) || 5;
                                    structObj.depth = parseInt(attrs.depth) || 2;
                                    structObj.smoothness = parseFloat(attrs.smoothness) || 0.2;
                                } else if (attrs.id === 'cubyz:fallen_tree') {
                                    structObj.log = attrs.log || 'cubyz:oak_log';
                                    structObj.height = parseInt(attrs.height) || 6;
                                    structObj.height_variation = parseInt(attrs.height_variation) || 3;
                                } else if (attrs.id === 'cubyz:sbb') {
                                    structObj.structure = attrs.structure || '';
                                    structObj.placeMode = attrs.placeMode || '.degradable';
                                } else if (attrs.id === 'cubyz:stalagmite') {
                                    structObj.block = attrs.block || 'cubyz:stalagmite';
                                    structObj.size = parseFloat(attrs.size) || 12;
                                    structObj.size_variation = parseFloat(attrs.size_variation) || 8;
                                    structObj.baseSlope = parseFloat(attrs.baseSlope) || 4;
                                    structObj.topSlope = attrs.topSlope !== undefined ? parseFloat(attrs.topSlope) : structObj.baseSlope;
                                }
                                parsedStructures.push(structObj);
                            }
                            sIdx = subIdx;
                        }
                    }
                }

                let climate = "temperate", humidity = "neitherWetNorDry", zone = "inland", growth = "balanced", elevationType = "balanced";
                const properties = [];
                const propMatch = content.match(/\.(?:properties|climate)\s*=\s*\.\{\s*([\s\S]*?)\}/);
                if (propMatch) {
                    const props = propMatch[1].split(',').map(p => p.trim().replace(/^\./, '')).filter(p => p.length > 0);
                    props.forEach(p => {
                        properties.push('.' + p);
                        if (['hot', 'temperate', 'cold'].includes(p)) climate = p;
                        if (['wet', 'neitherWetNorDry', 'dry'].includes(p)) humidity = p;
                        if (['inland', 'land', 'ocean'].includes(p)) zone = p;
                        if (['barren', 'balanced', 'overgrown'].includes(p)) growth = p;
                        if (['mountain', 'lowTerrain', 'antiMountain', 'balanced'].includes(p)) elevationType = p;
                    });
                }

                const tagsMatch = content.match(/\.tags\s*=\s*\.\{\s*([\s\S]*?)\}/);
                const biomeTags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/^\./, '')).filter(Boolean) : [];
                const caveLayerTag = biomeTags.find(t => t.endsWith('_layer')) || "";

                const parseGround = (entry) => {
                    const rangeM = entry.match(/^(\d+)\s+to\s+(\d+)\s+(.+)$/);
                    if (rangeM) return { block: rangeM[3], min: rangeM[1], max: rangeM[2] };
                    const countM = entry.match(/^(\d+)\s+(.+)$/);
                    if (countM) return { block: countM[2], min: countM[1], max: countM[1] };
                    return { block: entry, min: '', max: '' };
                };
                const groundMatch = content.match(/\.ground_structure\s*=\s*\.\{\s*([\s\S]*?)\}/);
                const parsedGround = groundMatch
                    ? groundMatch[1].split(',').map(l => l.trim().replace(/^"|"$/g, '')).filter(l => l.length > 0).map(parseGround)
                    : [];
                const surfaceBlock = parsedGround[0]?.block || "cubyz:grass";
                const subBlock = parsedGround[1]?.block || "cubyz:soil";
                const subMin = parsedGround[1]?.min ?? '';
                const subMax = parsedGround[1]?.max ?? '';
                const groundLayers = parsedGround.slice(2);

                const parentBiomes = [];
                {
                    const pStart = content.indexOf('.parentBiomes');
                    if (pStart !== -1) {
                        const rest = content.slice(pStart + '.parentBiomes'.length);
                        const nextField = rest.search(/\n\s*\.[a-zA-Z]+\s*=/);
                        const block = nextField === -1 ? rest : rest.slice(0, nextField);
                        const entryRe = /\.\{\s*([\s\S]*?)\s*\}/g;
                        let pm;
                        while ((pm = entryRe.exec(block)) !== null) {
                            const inner = pm[1];
                            const rid = inner.match(/\.id\s*=\s*"([^"]+)"/)?.[1];
                            if (!rid) continue;
                            parentBiomes.push({
                                id: rid,
                                chance: inner.match(/\.chance\s*=\s*([\d.]+)/)?.[1] ?? '',
                                parentEdgeDistance: inner.match(/\.parentEdgeDistance\s*=\s*([\d.]+)/)?.[1] ?? '',
                            });
                        }
                    }
                }

                // `.radius` is the single-value form the game prefers; the panel
                // edits min/max, so fold it in. rawBlocks keeps every top-level
                // field verbatim so fields the UI does not edit (caveModels,
                // stripes, transitionBiomes, type, ...) survive import -> export.
                const radiusVal = extractVal(content, 'radius', '');
                let minRadiusVal = extractVal(content, 'minRadius', '');
                let maxRadiusVal = extractVal(content, 'maxRadius', '');
                if (radiusVal !== '') {
                    if (minRadiusVal === '') minRadiusVal = radiusVal;
                    if (maxRadiusVal === '') maxRadiusVal = radiusVal;
                }

                const rawBlocks = {};
                {
                    let curKey = null, curLines = [];
                    const flushRaw = () => { if (curKey) rawBlocks[curKey] = curLines.join("\n"); };
                    for (const rawLine of content.split("\n")) {
                        const line = rawLine.replace(/\r$/, "");
                        const km = line.match(/^\t\.([A-Za-z_0-9]+)\s*=/);
                        if (km) { flushRaw(); curKey = km[1]; curLines = [line]; }
                        else if (curKey) {
                            if (line.trimEnd() === "}") { flushRaw(); curKey = null; }
                            else curLines.push(line);
                        }
                    }
                    flushRaw();
                }

                window.projectData.biomes.push({
                    id: nameToken,
                    subFolder: extractedSubFolder,
                    rawBlocks,
                    chance: extractVal(content, 'chance', '1.0'),
                    interpolation: extractVal(content, 'interpolation', '.square'),
                    interpolationWeight: extractVal(content, 'interpolationWeight', '1.0'),
                    minRadius: minRadiusVal || '256',
                    maxRadius: maxRadiusVal || '320',
                    smoothBeaches: content.includes('.smoothBeaches = true'),
                    minHeight: extractVal(content, 'minHeight', '20'),
                    maxHeight: extractVal(content, 'maxHeight', '40'),
                    minHeightLimit: extractVal(content, 'minHeightLimit', '7'),
                    maxHeightLimit: extractVal(content, 'maxHeightLimit', '50'),
                    roughness: extractVal(content, 'roughness', '1.0'),
                    hills: extractVal(content, 'hills', '0.0'),
                    mountains: extractVal(content, 'mountains', '0.0'),
                    soilCreep: extractVal(content, 'soilCreep', '1.0'),
                    keepOriginalTerrain: extractVal(content, 'keepOriginalTerrain', '1.0'),
                    rivers: content.includes('.rivers = true'),
                    maxSubBiomeCount: content.match(/\.maxSubBiomeCount\s*=\s*([\d.]+)/)?.[1] || '',
                    surfaceBlock, subBlock, subMin, subMax, groundLayers,
                    stoneBlock: extractVal(content, 'stoneBlock', 'cubyz:slate/smooth'),
                    isCave: content.includes('.isCave = true'),
                    caveLayerTag,
                    caves: extractVal(content, 'caves', '1.0'),
                    caveRadiusFactor: extractVal(content, 'caveRadiusFactor', '1.0'),
                    caveSmoothness: extractVal(content, 'caveSmoothness', '4.0'),
                    caveNoiseStrength: extractVal(content, 'caveNoiseStrength', '8.0'),
                    crystals: extractVal(content, 'crystals', '0'),
                    music: extractVal(content, 'music', 'cubyz:sunrise'),
                    fogDensity: extractVal(content, 'fogDensity', '1.5'),
                    fogLower: extractVal(content, 'fogLower', '100'),
                    fogHigher: extractVal(content, 'fogHigher', '1000'),
                    isValidPlayerSpawn: !content.includes('.validPlayerSpawn = false') && !content.includes('.isValidPlayerSpawn = false'),
                    skyColorHex: "#75b2ff", fogColorHex: "#e2f2ff",
                    skyColorVector: ".{ 0.46, 0.70, 1.00 }", fogColorVector: ".{ 0.89, 0.95, 1.00 }",
                    properties, structures: parsedStructures,
                    tags: biomeTags, parentBiomes,
                    climate, humidity, zone, growth, elevationType
                });
            }
        }

        const finalAddonName = document.getElementById('addonName').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (originalNamespace && finalAddonName && originalNamespace !== finalAddonName) {
            const rewriteNamespace = (value) => {
                if (typeof value === 'string') {
                    return value.replace(new RegExp(`\\b${originalNamespace}:`, 'g'), `${finalAddonName}:`);
                }
                if (Array.isArray(value)) return value.map(rewriteNamespace);
                if (value && typeof value === 'object') {
                    const out = {};
                    for (const [k, v] of Object.entries(value)) out[k] = rewriteNamespace(v);
                    return out;
                }
                return value;
            };
            ['blocks', 'items', 'biomes', 'entities', 'particles'].forEach((cat) => {
                window.projectData[cat] = window.projectData[cat].map(rewriteNamespace);
            });
            if (window.projectData.recipes) {
                window.projectData.recipes = rewriteNamespace(window.projectData.recipes);
            }
        }

        if (typeof window.updateSearchableItems === 'function') window.updateSearchableItems();
        if (typeof window.updateSidebarProjectTree === 'function') window.updateSidebarProjectTree();

        const importedNothing = ["blocks", "items", "biomes", "entities", "particles"].every((k) => !window.projectData[k]?.length)
            && !Object.keys(window.projectData.recipes || {}).length;
        const hadCategoryFiles = filePaths.some((p) =>
            ['blocks', 'items', 'biomes', 'recipes', 'particles', entityFolder].some((cat) => pathHasCategory(p, cat)));

        const cavesMissingLayer = (window.projectData.biomes || [])
            .filter((b) => b.isCave && !b.caveLayerTag)
            .map((b) => b.id);

        if (importedNothing && hadCategoryFiles) {
            alert(`Imported "${file.name}", but nothing was recognized - the zip has files under a blocks/items/biomes/entities/particles/recipes folder, but none of them matched this importer's expected file structure. Nothing was added to your project.`);
            return;
        }

        if (cavesMissingLayer.length && typeof window.showMigrationResults === 'function') {
            await window.showMigrationResults({ appliedSteps: [], conflicts: [], unresolved: [], changes: [] }, sourceVersion, targetVersion, cavesMissingLayer);
        }

        window.VERSION_PATH = sourceVersion;

        if (typeof window.validateProject === 'function' && typeof window.showValidationReport === 'function') {
            const report = window.validateProject();
            if (report.length) await window.showValidationReport(report, `Imported "${file.name}" as v${sourceVersion}, but found some issues:`);
        }

        if (typeof window.showPostImportChoice === 'function') {
            await window.showPostImportChoice(sourceVersion);
        } else {
            alert(`Successfully imported "${file.name}"!`);
        }
    } catch (e) {
        alert(`Failed parsing addon zip payload: ${e.message}`);
    }
}
window.importExistingAddon = importExistingAddon;

async function loadMigrationRulesForImport() {
    const res = await fetch("migrations/cubyz-addon-migrations.json");
    if (!res.ok) throw new Error("Failed to load version list.");
    return res.json();
}

function confirmImportVersions(detectedVersion, latestVersion, versionChoices) {
    return new Promise((resolve) => {
        const modal = document.getElementById('versionDetectModal');
        const msg = document.getElementById('versionDetectMessage');
        const sourceSelect = document.getElementById('versionDetectSelect');

        if (!modal || !sourceSelect) {
            return resolve(detectedVersion || latestVersion);
        }

        const effectiveGuess = detectedVersion || latestVersion;
        msg.textContent = detectedVersion
            ? `We think this addon was made for version ${detectedVersion} - is that right?`
            : `We couldn't confidently detect which version this addon targets. Please pick one.`;

        sourceSelect.innerHTML = versionChoices.map((v) =>
            `<option value="${v.version}" ${v.version === effectiveGuess ? 'selected' : ''}>${versionLabel(v.version)}</option>`
        ).join('');

        modal.style.display = 'flex';

        window.versionDetectContinue = () => {
            modal.style.display = 'none';
            resolve(sourceSelect.value);
        };
        window.versionDetectCancel = () => {
            modal.style.display = 'none';
            resolve(null);
        };
    });
}
