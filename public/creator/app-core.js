window.serverBlocks = [];
window.serverItems = [];
window.serverTextures = [];
window.serverMusicList = [];
window.serverEntityModels = [];
window.serverParticles = [];
window.blockTexturesOnly = [];
window.itemTexturesOnly = [];
window.particleTexturesOnly = [];
window.allSearchableItems = [];
window.dropdownsGenerated = false;
window.VERSION_PATH = "unreleased";

// Game-data snapshots live beside the creator at /creator/gamedata/<version>/
// (bind-mounted from runtime/creator-data on the host). Every version-specific
// asset request goes through this so adding a version is just another folder.
function gameDataUrl(rel) {
    return `gamedata/${window.VERSION_PATH}/${rel}`;
}
window.gameDataUrl = gameDataUrl;

const ENTITY_FOLDER_BY_VERSION = {
    "0.0.0": "entity", "0.0.1": "entity", "0.1.0": "entity", "0.1.1": "entity",
    "0.2.0": "entityModels", "0.3.0": "entityModels",
    "0.4.0": "entity_models", "unreleased": "entity_models"
};
function entityFolderForVersion(version) {
    return ENTITY_FOLDER_BY_VERSION[version] || "entityModels";
}

const UNRELEASED_VERSION_DISPLAY = "0.4.0";
function versionLabel(version) {
    return version === "unreleased"
        ? `${UNRELEASED_VERSION_DISPLAY} (unreleased)`
        : version;
}

function biomeClimateFieldForVersion(version) {
    return (version === "unreleased" || version === "0.4.0") ? "climate" : "properties";
}

function blockEntityRefForVersion(value, version) {
    const bare = String(value || "").split(":").pop().replace(/^\./, "");
    if (!bare) return "";
    return (version === "unreleased" || version === "0.4.0" || version === "0.3.0")
        ? `"cubyz:${bare}"`
        : `.${bare}`;
}

function entityTextureMatches(storedName, bareName) {
    return storedName === bareName
        || storedName === `entityModels/textures/${bareName}`
        || storedName === `entity_models/textures/${bareName}`;
}

window.hasUnsavedChanges = false;
window.currentPanelName = null;
window.editingId = null;

window.projectData = {
    blocks: [],
    items: [],
    recipes: {},
    biomes: [],
    entities: [],
    particles: []
};

window.metricsExpandedState = false;
window.metricCounts = { blocks: 0, items: 0, blockTex: 0, itemTex: 0, music: 0, entities: 0, particles: 0 };

async function loadServerAssets() {
    const statusEl = document.getElementById('folderStatus');
    if (statusEl) {
        statusEl.innerText = `Connecting to ${versionLabel(window.VERSION_PATH)} database...`;
        statusEl.className = "status-badge";
    }

    try {
        const [blocksRes, itemsRes, texturesRes, recipesRes, musicRes, entitiesRes, particlesRes, blockTexturesRes] = await Promise.all([
            fetch(gameDataUrl("blocks.json")),
            fetch(gameDataUrl("items.json")),
            fetch(gameDataUrl("textures.json")),
            fetch(gameDataUrl("recipes.json")).catch(() => null),
            fetch(gameDataUrl("music.json")).catch(() => null),
            fetch(gameDataUrl("entity_models.json")).catch(() => null),
            fetch(gameDataUrl("particles.json")).catch(() => null),
            fetch(gameDataUrl("block_textures.json")).catch(() => null)
        ]);

        if (!blocksRes.ok || !itemsRes.ok || !texturesRes.ok) {
            throw new Error("One or more manifests are missing on the server.");
        }

        window.serverBlocks = await blocksRes.json();
        window.serverItems = await itemsRes.json();
        const rawTexturesList = await texturesRes.json();

        window.serverRecipesList = [];
        if (recipesRes && recipesRes.ok) window.serverRecipesList = await recipesRes.json();

        window.serverMusicList = [];
        if (musicRes && musicRes.ok) {
            const rawTracks = await musicRes.json();
            window.serverMusicList = rawTracks.map(track => `cubyz:${track}`);
        }

        window.serverEntityModels = [];
        if (entitiesRes && entitiesRes.ok) {
            window.serverEntityModels = await entitiesRes.json();
        }

        window.serverParticles = [];
        if (particlesRes && particlesRes.ok) {
            window.serverParticles = await particlesRes.json();
        }

        // Block metadata (model/rotation/transparency) used to filter the
        // contextual search dropdowns (only flowers for flowers, etc.).
        window.blockTextures = {};
        if (blockTexturesRes && blockTexturesRes.ok) {
            window.blockTextures = await blockTexturesRes.json();
        }
        // SBB structure list (trees etc.) for the structure preset picker.
        window.serverSbbList = [];
        try {
            const sbbRes = await fetch(gameDataUrl("sbb.json"));
            if (sbbRes.ok) window.serverSbbList = await sbbRes.json();
        } catch (_) {}

        updateSearchableItems();

        window.blockTexturesOnly = [];
        window.itemTexturesOnly = [];
        window.particleTexturesOnly = [];

        window.serverTextures = rawTexturesList.map(fullTexturePath => {
            let shortName = fullTexturePath;
            let isBlockTexture = false;
            let isEntityTexture = false;
            let isParticleTexture = false;

            if (shortName.includes("items/")) {
                shortName = shortName.replace("items/textures/", "").replace("items/", "");
            } else if (shortName.includes("blocks/")) {
                shortName = shortName.replace("blocks/textures/", "").replace("blocks/", "");
                isBlockTexture = true;
            } else if (shortName.includes("entityModels/") || shortName.includes("entity_models/")) {
                isEntityTexture = true;
            } else if (shortName.includes("particles/")) {
                shortName = shortName.replace("particles/textures/", "").replace("particles/", "");
                isParticleTexture = true;
            }

            const textureObject = {
                name: shortName,
                dataUrl: gameDataUrl(`${fullTexturePath}.png`),
                isCustom: false,
                isBlockType: isBlockTexture,
                isEntityType: isEntityTexture,
                isParticleType: isParticleTexture
            };

            if (isBlockTexture) {
                window.blockTexturesOnly.push(textureObject);
            } else if (isParticleTexture) {
                window.particleTexturesOnly.push(textureObject);
            } else if (!isBlockTexture && !isEntityTexture && !isParticleTexture) {
                window.itemTexturesOnly.push(textureObject);
            }

            return textureObject;
        });

        window.metricCounts = {
            blocks: window.serverBlocks.length,
            items: window.serverItems.length,
            blockTex: window.blockTexturesOnly.length,
            itemTex: window.itemTexturesOnly.length,
            music: window.serverMusicList.length,
            entities: window.serverEntityModels.length,
            particles: window.serverParticles.length
        };

        window.renderMetricsUI();
        rebuildDropdowns();
        if (typeof window.updateSidebarProjectTree === 'function') window.updateSidebarProjectTree();
    } catch (err) {
        console.error("Failed to load server database metrics:", err);
        if (statusEl) {
            statusEl.innerText = `Database load failed: ${err.message}`;
            statusEl.style.backgroundColor = "#722323";
        }
    }
}
window.loadServerAssets = loadServerAssets;

window.renderMetricsUI = function() {
    const statusEl = document.getElementById('folderStatus');
    if (!statusEl) return;

    statusEl.className = `status-container ${window.metricsExpandedState ? "expanded-metrics" : ""}`;

    const hiddenPills = window.metricsExpandedState ? `
    <span class="metric-hidden-pill status-pill">Blocks: ${window.metricCounts.blocks}</span>
    <span class="metric-hidden-pill status-pill">Items: ${window.metricCounts.items}</span>
    <span class="metric-hidden-pill status-pill">Block Tex: ${window.metricCounts.blockTex}</span>
    <span class="metric-hidden-pill status-pill">Item Tex: ${window.metricCounts.itemTex}</span>
    <span class="metric-hidden-pill status-pill">Music: ${window.metricCounts.music}</span>
    <span class="metric-hidden-pill status-pill">Entities: ${window.metricCounts.entities}</span>
    <span class="metric-hidden-pill status-pill">Particles: ${window.metricCounts.particles}</span>
    ` : "";

    statusEl.innerHTML = `${hiddenPills}<span class="status-pill version-active" style="margin-left: auto; cursor: pointer;">v${versionLabel(window.VERSION_PATH)} ${window.metricsExpandedState ? '→' : '←'}</span>`;
};

window.toggleMetricsPanel = function() {
    window.metricsExpandedState = !window.metricsExpandedState;
    window.renderMetricsUI();
};

function updateSearchableItems() {
    const addonName = document.getElementById('addonName').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "") || 'custom_addon';
    const customBlockIds = window.projectData.blocks.map(b => `${addonName}:${b.id}`);
    const customItemIds = window.projectData.items.map(i => `${addonName}:${i.id}`);

    window.allSearchableItems = [
        ...new Set([
            ...window.serverBlocks,
            ...window.serverItems,
            ...window.serverMusicList,
            ...customBlockIds,
            ...customItemIds
        ])
    ].sort();
}
window.updateSearchableItems = updateSearchableItems;

function markFormAsDirty() {
    if (window.isInitializingPanel) return;
    window.hasUnsavedChanges = true;
    if (typeof window.updateSidebarProjectTree === 'function') window.updateSidebarProjectTree();
}
window.markFormAsDirty = markFormAsDirty;

window.renderDropdownOptions = (dropdownId, searchId) => {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    dropdown.innerHTML = '';

    let list = window.blockTexturesOnly;
    if (dropdownId.startsWith('item')) list = window.itemTexturesOnly;
    else if (dropdownId.startsWith('particle')) list = window.particleTexturesOnly;

    const textures = [
        ...window.serverTextures.filter(t => t.isCustom && (
            dropdownId.startsWith('particle') ? t.isParticleType :
            dropdownId.startsWith('item') ? (!t.isBlockType && !t.isEntityType && !t.isParticleType) : t.isBlockType
        )),
        ...list
    ];

    textures.forEach(tex => {
        const opt = document.createElement('div');
        opt.className = 'dropdown-option';
        opt.style = 'padding: 6px 12px; display: flex; align-items: center; gap: 10px; cursor: pointer;';
        opt.setAttribute('data-search', tex.name.toLowerCase().trim());
        opt.innerHTML = `<img src="${tex.dataUrl}" style="width:20px; height:20px; image-rendering:pixelated; background:#000; border-radius:2px;"><span>${tex.name} ${tex.isCustom ? '(Custom)' : ''}</span>`;

        opt.onmousedown = (e) => {
            e.preventDefault();
            const input = document.getElementById(searchId);
            if (input) {
                input.value = tex.name;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            dropdown.style.display = 'none';
            if (typeof window.updateBlockFacePreviews === 'function') window.updateBlockFacePreviews();
        };
            dropdown.appendChild(opt);
    });
};

window.rebuildDropdowns = () => {
    ['top', 'front', 'left', 'right', 'up', 'bottom', 'itemIcon', 'itemTexture', 'particleTexture'].forEach(side => {
        window.renderDropdownOptions(`${side}Dropdown`, `${side}Search`);
    });

    const partInput = document.getElementById('particleTextureSearch');
    if (partInput) {
        partInput.onfocus = () => {
            document.querySelectorAll('.dropdown-options').forEach(d => d.style.display = 'none');
            const dropdown = document.getElementById('particleTextureDropdown');
            if (dropdown) {
                dropdown.style.display = 'block';
                window.filterDropdown('particleTextureSearch', 'particleTextureDropdown');
            }
        };
        partInput.oninput = () => window.filterDropdown('particleTextureSearch', 'particleTextureDropdown');
    }

    if (typeof window.renderDropOptions === 'function') window.renderDropOptions();
    window.dropdownsGenerated = true;
};

window.deletedAddonElements = { blocks: [], items: [], recipes: [], biomes: [], entities: [], particles: [] };
window.updateSidebarProjectTree = function() {
    const panels = { blocks: '', items: '', biomes: '', entities: '', particles: '' };

    Object.keys(panels).forEach(pName => {
        const cont = document.getElementById(`sidebar${pName.charAt(0).toUpperCase() + pName.slice(1)}Tree`);
        if (!cont) return;

        const dataList = window.projectData[pName] || [];
        const isEditingExisting = window.hasUnsavedChanges && window.currentPanelName === pName && window.editingId
            && dataList.some(item => item.id === window.editingId);

        if (!dataList.length) {
            cont.innerHTML = '<span style="color: #666; font-style: italic;">None saved yet</span>';
        } else {
            cont.innerHTML = dataList.map(item => {
                const sub = item.subFolder ? `<span style="color: #6a6a6a; font-size: 11px;">${item.subFolder}/</span>` : "";
                const isThisRowEditing = isEditingExisting && item.id === window.editingId;
                const rowStyle = isThisRowEditing
                    ? "background: #2c251e; border-left: 3px solid #ff9800; color: #ff9800;"
                    : "background: #222;";
                return `<div class="sidebar-tree-row" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; ${rowStyle} border-radius: 3px; margin-bottom: 2px; cursor: pointer;">
                <div onclick="loadStudioPanel('${pName}', null, '${item.id}')" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px;">
                ${panels[pName]} ${sub}${item.id}${isThisRowEditing ? ' <span style="font-size:10px; float:right;">●</span>' : ''}
                </div>
                <span class="delete-sidebar-item" onclick="window.deleteItemFromProject('${pName}', '${item.id}', event)" style="color: var(--danger); font-weight: bold; padding: 0 6px; font-size: 14px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.color='var(--danger-fill)'" onmouseout="this.style.color='var(--danger)'">×</span>
                </div>`;
            }).join('');
        }

        if (window.hasUnsavedChanges && window.currentPanelName === pName && !isEditingExisting) {
            const cur = document.getElementById(`${pName.slice(0, -1)}Id`)?.value.trim() || 'new_element';
            cont.innerHTML += `<div style="padding: 4px 6px; background: #2c251e; border-radius: 3px; border-left: 3px solid #ff9800; color: #ff9800;"> ${cur} <span style="font-size:10px; float:right;">●</span></div>`;
        }
    });

    const recCont = document.getElementById('sidebarRecipesTree');
    if (recCont) {
        const recKeys = Object.keys(window.projectData.recipes || {});
        if (!recKeys.length) recCont.innerHTML = '<span style="color: #666; font-style: italic;">None saved yet</span>';
        else {
            recCont.innerHTML = recKeys.map(k => `
            <div class="sidebar-tree-row" style="display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; background: #222; border-radius: 3px; margin-bottom: 2px; cursor: pointer;">
            <div onclick="loadStudioPanel('recipes', null, '${k}')" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px;"> ${k}</div>
            <span class="delete-sidebar-item" onclick="window.deleteItemFromProject('recipes', '${k}', event)" style="color: var(--danger); font-weight: bold; padding: 0 6px; font-size: 14px; cursor: pointer;" onmouseover="this.style.color='var(--danger-fill)'" onmouseout="this.style.color='var(--danger)'">×</span>
            </div>
            `).join('');
        }
        if (window.hasUnsavedChanges && window.currentPanelName === 'recipes') {
            const curRec = document.getElementById('recipeFilename')?.value.trim() || 'new_recipe';
            recCont.innerHTML += `<div style="padding: 4px 6px; background: #2c251e; border-radius: 3px; border-left: 3px solid #ff9800; color: #ff9800;"> ${curRec} <span style="font-size:10px; float:right;"></span></div>`;
        }
    }
};

window.deleteItemFromProject = async function(pName, elementId, event) {
    if (event) event.stopPropagation();

    const confirmed = await window.showCustomConfirm(
        "Confirm Asset Deletion",
        `Are you sure you want to completely remove "${elementId}" from project?`
    );
    if (!confirmed) return;

    if (pName === 'recipes') {
        if (window.projectData.recipes) delete window.projectData.recipes[elementId];
    } else {
        window.projectData[pName] = (window.projectData[pName] || []).filter(item => item.id !== elementId);
    }

    if (!window.deletedAddonElements) window.deletedAddonElements = {};
    if (!window.deletedAddonElements[pName]) window.deletedAddonElements[pName] = [];
    window.deletedAddonElements[pName].push(elementId);

    if (window.editingId === elementId && window.currentPanelName === pName) {
        window.editingId = null;
        window.hasUnsavedChanges = false;
        document.getElementById('dynamicWorkspace').innerHTML = '<p style="color:#888; text-align:center; margin-top:40px;">Asset deleted. Select an alternative row node from the panel map explorer.</p>';
    }

    window.updateSidebarProjectTree();
    if (typeof window.updateSearchableItems === 'function') window.updateSearchableItems();
};

window.showRecipeDropdown = function(dropdownId, searchId, filterType) {
    document.querySelectorAll('.dropdown-options').forEach(d => d.style.display = 'none');
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    dropdown.innerHTML = '';
    dropdown.style.display = 'block';

    let validationItems = [];
    if (filterType === 'blocks') {
        validationItems = window.allSearchableItems.filter(item => !item.startsWith('cubyz:music'));
    } else if (filterType === 'music') {
        validationItems = window.serverMusicList || [];
    } else if (filterType === 'models') {
        const addonName = document.getElementById('addonName')?.value || 'my_addon';
        const serverModels = (window.serverEntityModels || []).map(m => `cubyz:${m}`);
        const customModels = Object.keys(window.customEntityModels || {});
        validationItems = [...customModels, ...serverModels];
    } else if (filterType === 'textures') {
        validationItems = (window.serverTextures || [])
        .filter(t => t.isEntityType)
        .map(t => t.name.replace('entityModels/textures/', '').replace('entity_models/textures/', ''));
    }

    validationItems.forEach(item => {
        const opt = document.createElement('div');
        opt.className = 'dropdown-option';
        opt.style = 'padding: 6px 12px; cursor: pointer; color: #fff;';
        opt.textContent = item;

        opt.onmousedown = (e) => {
            e.preventDefault();
            const input = document.getElementById(searchId);
            if (input) {
                input.value = item;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            dropdown.style.display = 'none';
            if (typeof window.updateBlockFacePreviews === 'function') window.updateBlockFacePreviews();
        };
            dropdown.appendChild(opt);
    });

    window.filterDropdown(searchId, dropdownId);
};

window.filterDropdown = function(searchId, dropdownId) {
    const input = document.getElementById(searchId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    const filter = input.value.toLowerCase().trim();
    const options = dropdown.querySelectorAll('.dropdown-option');
    let dynamicVisibleCount = 0;

    options.forEach(opt => {
        const text = opt.textContent.toLowerCase();
        if (text.includes(filter)) {
            opt.style.display = 'flex';
            dynamicVisibleCount++;
        } else {
            opt.style.display = 'none';
        }
    });

    dropdown.style.display = dynamicVisibleCount > 0 ? 'block' : 'none';
};

window.renderDropOptions = function() {
    const targets = [
        { id: 'recipeOutputSearch', type: 'blocks' },
        { id: 'recipeInputSearch1', type: 'blocks' },
        { id: 'recipeInputSearch2', type: 'blocks' },
        { id: 'recipeInputSearch3', type: 'blocks' },
        { id: 'recipeInputSearch4', type: 'blocks' },
        { id: 'bioMusic', type: 'music' },
        { id: 'bioSurfaceBlock', type: 'blocks' },
        { id: 'bioSubBlock', type: 'blocks' },
        { id: 'bioStoneBlock', type: 'blocks' },
        { id: 'entityModelSearch', type: 'models' },
        { id: 'entityTextureSearch', type: 'textures' }
    ];

    targets.forEach(t => {
        const input = document.getElementById(t.id);
        if (!input) return;

        const wrapper = input.closest('.texture-select-wrapper');
        if (!wrapper) return;

        let dropdown = wrapper.querySelector('.dropdown-options');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = t.id + 'Dropdown';
            dropdown.className = 'dropdown-options';
            wrapper.appendChild(dropdown);
        }

        input.onfocus = () => window.showRecipeDropdown(dropdown.id, t.id, t.type);
        input.oninput = () => window.filterDropdown(t.id, dropdown.id);
    });
};

document.addEventListener("DOMContentLoaded", loadServerAssets);
