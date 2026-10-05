// Structure feature type metadata (crisp SVG icons instead of emoji).
if (!window.STRUCT_META) {
    const svg = (paths) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    window.STRUCT_META = {
        '': { label: 'Select a feature…', icon: svg('<path d="M12 5v14M5 12h14"/>') },
        'cubyz:simple_tree': { label: 'Standard Tree', icon: svg('<path d="M12 2 6 11h12L12 2Z"/><path d="M12 11v9"/>') },
        'cubyz:simple_vegetation': { label: 'Single Foliage Sprite', icon: svg('<path d="M12 21V9"/><path d="M12 15c-4 0-6-2-6-6 4 0 6 2 6 6Z"/><path d="M12 12c4 0 6-2 6-6-4 0-6 2-6 6Z"/>') },
        'cubyz:flower_patch': { label: 'Foliage Cluster/Patch', icon: svg('<circle cx="12" cy="7" r="3"/><circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><circle cx="12" cy="17" r="3"/><circle cx="12" cy="12" r="1.6"/>') },
        'cubyz:boulder': { label: 'Rock Boulder', icon: svg('<path d="M4 19h16l-3-9-4 2-3-6-6 13Z"/>') },
        'cubyz:ground_patch': { label: 'Ground Surface Patch', icon: svg('<rect x="3" y="6" width="8" height="6" rx="1"/><rect x="13" y="12" width="8" height="6" rx="1"/>') },
        'cubyz:fallen_tree': { label: 'Fallen Log', icon: svg('<rect x="3" y="10" width="15" height="5" rx="2.5"/><path d="M18 12.5h3"/>') },
        'cubyz:sbb': { label: 'SBB Structure', icon: svg('<path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M4 7l8 4 8-4"/><path d="M12 11v10"/>') },
        'cubyz:stalagmite': { label: 'Stalagmite / Stalactite', icon: svg('<path d="M12 3 7 20h10L12 3Z"/>') },
    };
    window.selectStructType = function (rowId, key) {
        const m = window.STRUCT_META[key] || window.STRUCT_META[''];
        const val = document.getElementById(`${rowId}_value`);
        if (val) val.value = key;
        const btn = document.getElementById(`${rowId}_search`);
        if (btn) {
            const iconEl = btn.querySelector('.struct-type-icon');
            const labelEl = btn.querySelector('.struct-type-label');
            if (iconEl) iconEl.innerHTML = m.icon;
            if (labelEl) labelEl.textContent = m.label;
        }
        window.toggleStructSubFields(rowId, key);
        const dd = document.getElementById(`${rowId}_selectDropdown`);
        if (dd) dd.style.display = 'none';
        if (typeof window.markFormAsDirty === 'function') window.markFormAsDirty();
    };
}

window.handleRotationChange = function(val) {
    const fb = document.getElementById('hasItemIcon');
    if (fb) {
        fb.checked = val === 'cubyz:ore' ? true : fb.checked;
        fb.disabled = val === 'cubyz:ore';
        if (typeof window.toggleItemIconInput === 'function') window.toggleItemIconInput(fb);
    }

    if (!window.isInitializingPanel) {
        const setCheck = (id, state) => { const el = document.getElementById(id); if (el) el.checked = state; };
        if (val === 'cubyz:decayable') {
            ['blockTransparent', 'blockDegradable', 'blockViewThrough', 'blockAlwaysViewThrough', 'blockHasBackFace'].forEach(id => setCheck(id, true));
            setCheck('blockAllowOres', false);
        } else if (val === 'cubyz:ore' || val === 'cubyz:stairs') {
            ['blockTransparent', 'blockDegradable', 'blockViewThrough', 'blockAlwaysViewThrough', 'blockHasBackFace'].forEach(id => setCheck(id, false));
            setCheck('blockAllowOres', val === 'cubyz:ore');
        }
    }

    const container = document.getElementById('simpleEnvDropdown');
    const envVal = document.getElementById('simpleEnvPreset');
    const envSrc = document.getElementById('simpleEnvPresetSearch');

    if (container && envVal && envSrc) {
        container.innerHTML = '';
        const addOpt = (v, txt) => {
            const opt = document.createElement('div');
            opt.className = 'dropdown-option';
            opt.style = 'padding: 6px 12px; cursor: pointer;';
            opt.textContent = txt;
            opt.onmousedown = (e) => {
                e.preventDefault();
                envVal.value = v;
                envSrc.value = txt;
                window.handleSimpleEnvChange(v);
                container.style.display = 'none';
            };
            container.appendChild(opt);
        };

        if (val === 'cubyz:stairs' || val === 'cubyz:ore' || val === 'cubyz:direction') {
            addOpt('none', 'Default'); addOpt('support', 'Breaks if ground below is gone');
        } else if (val === 'cubyz:decayable') {
            addOpt('decay', 'Decays into air if away from logs'); addOpt('none', 'Default');
        } else if (val === 'cubyz:hanging') {
            addOpt('vine_decay', 'Breaks if ceiling disappears'); addOpt('none', 'Default');
        } else if (val === 'cubyz:carpet') {
            addOpt('support', 'Breaks if ground below is gone'); addOpt('none', 'Default');
        } else {
            addOpt('none', 'Default'); addOpt('support', 'Breaks if ground below is gone');
        }

        const isDecay = val === 'cubyz:decayable';
        envVal.value = isDecay ? 'decay' : 'none';
        envSrc.value = isDecay ? 'Decays into air if away from logs' : 'Default';
        window.handleSimpleEnvChange(envVal.value);
    }
};

window.toggleDropInput = checkbox => {
    const w = document.getElementById('customDropWrapper');
    if (w) w.style.display = checkbox.checked ? 'none' : 'block';
};

window.toggleItemIconInput = checkbox => {
    const w = document.getElementById('itemIconWrapper');
    if (w) w.style.display = checkbox.checked ? 'block' : 'none';
};

window.autoToggleTransparentTag = () => {};

window.initDynamicTagSystem = function(containerId, inputId, activeTagsArray = []) {
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    if (!container || !input) return;

    container.querySelectorAll('.tag-pill').forEach(p => p.remove());

    const renderTag = (tag) => {
        const clean = tag.trim().toLowerCase().replace(/^\./, "").replace(/[^a-z0-9_]/g, "");
        if (!clean || Array.from(container.querySelectorAll('.tag-pill')).some(p => p.dataset.tag === clean)) return;

        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.dataset.tag = clean;
        pill.style = "background: #007acc; color: white; padding: 2px 8px; border-radius: 3px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; margin: 2px; line-height: 1.2;";
        pill.innerHTML = `.${clean} <span class="remove-tag" style="cursor:pointer; font-weight:bold; color: #ff8888;">×</span>`;

        pill.querySelector('.remove-tag').onclick = (e) => {
            e.stopPropagation(); pill.remove();
            window.updateTagSuggestionVisibility(containerId);
            window.markFormAsDirty();
        };
        container.insertBefore(pill, input);
    };

    activeTagsArray.forEach(t => renderTag(t));
    window.updateTagSuggestionVisibility(containerId);

    input.onkeydown = (e) => {
        if (e.key === ',' || e.key === 'Enter') {
            e.preventDefault(); renderTag(input.value); input.value = '';
            window.updateTagSuggestionVisibility(containerId);
            window.markFormAsDirty();
        }
    };
    container.onclick = () => input.focus();
};

window.handleSimpleTouchChange = function(val) {
    const rawTouch = document.getElementById('logicTouchType');
    const rawMode = document.getElementById('logicTouchMode');
    const settingsSub = document.getElementById('simpleTouchSettings');
    if (!rawTouch) return;

    if (val === 'none') {
        rawTouch.value = 'none';
        if (settingsSub) settingsSub.style.display = 'none';
    } else {
        rawTouch.value = 'hurt';
        rawMode.value = val;
        if (settingsSub) settingsSub.style.display = 'block';
        const variantDropdown = document.getElementById('logicTouchTypeVariant');
        if (variantDropdown) variantDropdown.value = (val === 'heal') ? 'heal' : 'heat';
    }
    if (!window.isInitializingPanel) window.markFormAsDirty();
};

window.handleSimpleInteractChange = function(val) {
    const rawInteract = document.getElementById('logicInteractType');
    const settingsSub = document.getElementById('advInteractWindowWrapper');
    if (!rawInteract) return;
    rawInteract.value = val;
    if (settingsSub) settingsSub.style.display = (val === 'open_window') ? 'block' : 'none';
    if (!window.isInitializingPanel) window.markFormAsDirty();
};

window.handleSimpleEnvChange = function(val) {
    const rawUpdate = document.getElementById('logicUpdateType');
    const decaySub = document.getElementById('simpleDecaySettings');
    if (!rawUpdate) return;

    const rotationField = document.getElementById('blockRotation');
    const rotationSearchField = document.getElementById('blockRotationSearch');
    const setRotationIfIncompatible = (validModes, fallbackMode, fallbackLabel) => {
        if (!rotationField || validModes.includes(rotationField.value)) return;
        rotationField.value = fallbackMode;
        if (rotationSearchField) rotationSearchField.value = fallbackLabel;
        if (typeof window.handleRotationChange === 'function') window.handleRotationChange(fallbackMode);
    };

    if (val === 'none') {
        rawUpdate.value = 'none';
        if (decaySub) decaySub.style.display = 'none';
    } else if (val === 'support') {
        rawUpdate.value = 'check_support_blocks';
        if (decaySub) decaySub.style.display = 'none';
        setRotationIfIncompatible(['cubyz:carpet', 'cubyz:planar', 'cubyz:no_rotation', 'cubyz:torch', 'cubyz:texture_pile', 'cubyz:direction'], 'cubyz:carpet', 'Flat Layer / Carpet (cubyz:carpet)');
    } else {
        rawUpdate.value = val;
        if (decaySub) {
            decaySub.style.display = (val === 'decay') ? 'block' : 'none';
            if (val === 'decay') {
                document.getElementById('decayReplacement').value = "cubyz:air";
                document.getElementById('decayPrevention').value = ".log, .branch";
                setRotationIfIncompatible(['cubyz:decayable', 'cubyz:branch'], 'cubyz:decayable', 'Decayable / Leaf (cubyz:decayable)');
            }
        }
    }
    if (!window.isInitializingPanel) window.markFormAsDirty();
};

window.addDynamicTagPill = function(containerId, inputId, tag) {
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    if (!container || !input) return;

    const clean = tag.trim().toLowerCase().replace(/^\./, "").replace(/[^a-z0-9_]/g, "");
    if (Array.from(container.querySelectorAll('.tag-pill')).some(p => p.dataset.tag === clean)) return;

    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.dataset.tag = clean;
    pill.style = "background: #007acc; color: white; padding: 2px 8px; border-radius: 3px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; margin: 2px; line-height: 1.2;";
    pill.innerHTML = `.${clean} <span class="remove-tag" style="cursor:pointer; font-weight:bold; color: #ff8888;">×</span>`;

    pill.querySelector('.remove-tag').onclick = (e) => {
        e.stopPropagation(); pill.remove();
        window.updateTagSuggestionVisibility(containerId);
        window.markFormAsDirty();
    };

    container.insertBefore(pill, input);
    window.updateTagSuggestionVisibility(containerId);
    window.markFormAsDirty();
};

window.removeDynamicTagPill = function(containerId, tag) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const clean = tag.trim().toLowerCase().replace(/^\./, "").replace(/[^a-z0-9_]/g, "");
    container.querySelectorAll('.tag-pill').forEach(pill => {
        if (pill.dataset.tag === clean) {
            pill.remove();
            window.updateTagSuggestionVisibility(containerId);
            window.markFormAsDirty();
        }
    });
};

window.updateTagSuggestionVisibility = function(containerId) {
    const container = document.getElementById(containerId);
    const formGroup = container?.closest('.form-group');
    if (!formGroup) return;

    const activeTags = Array.from(container.querySelectorAll('.tag-pill')).map(p => p.dataset.tag);
    formGroup.querySelectorAll('button[onclick*="addDynamicTagPill"]').forEach(btn => {
        const m = btn.getAttribute('onclick').match(/'([^']+)'\s*\)$/);
    if (m?.[1]) btn.style.display = activeTags.includes(m[1].trim().toLowerCase()) ? 'none' : 'inline-block';
    });
};

window.showCustomConfirm = (title, message) => {
    return new Promise(resolve => {
        const modal = document.getElementById('customConfirmModal');
        if (!modal) return resolve(true);
        document.getElementById('customConfirmTitle').textContent = title;
        document.getElementById('customConfirmMessage').textContent = message;
        modal.style.display = 'flex';
        const done = res => { modal.style.display = 'none'; resolve(res); };
        document.getElementById('customConfirmOkBtn').onclick = () => done(true);
        document.getElementById('customConfirmCancelBtn').onclick = () => done(false);
    });
};

async function loadStudioPanel(panelName, buttonElement, targetIdToEdit = null) {
    if (window.hasUnsavedChanges && window.currentPanelName !== null && targetIdToEdit === null) {
        if (!(await window.showCustomConfirm("Unsaved Changes Warning", "You have unsaved changes! Discard and switch panels?"))) return;
    }

    if (window.currentPanelName === 'biomes' && panelName !== 'biomes' && typeof window.disposeBiomePreview === 'function') {
        window.disposeBiomePreview();
    }

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) buttonElement.classList.add('active');
    else {
        const names = ['blocks', 'items', 'recipes', 'biomes', 'entities', 'particles'];
        document.querySelectorAll('.nav-btn')[names.indexOf(panelName)]?.classList.add('active');
    }

    try {
        window.isInitializingPanel = true;
        const res = await fetch(`${panelName}.html?v=20261004-1`);
        if (!res.ok) throw new Error("Panel template fetch failed.");

        document.getElementById('dynamicWorkspace').innerHTML = await res.text();
        window.dropdownsGenerated = false;
        Object.assign(window, { hasUnsavedChanges: false, currentPanelName: panelName, editingId: targetIdToEdit });

        if (['blocks', 'items', 'entities', 'particles'].includes(panelName)) window.rebuildDropdowns();

        document.querySelectorAll('#dynamicWorkspace input, #dynamicWorkspace select').forEach(el => {
            if (!['blockId', 'itemId', 'recipeFilename', 'biomeId', 'entityId', 'particleId'].includes(el.id)) {
                const trigger = () => { if (!window.isInitializingPanel) window.markFormAsDirty(); };
                el.addEventListener('input', trigger); el.addEventListener('change', trigger);
            }
        });

        if (panelName === 'blocks') {
            if (document.getElementById('blockRotation')) window.handleRotationChange(document.getElementById('blockRotation').value);
            window.initDynamicTagSystem('blockTagsContainer', 'tagTextInput', []);
        } else if (panelName === 'items') {
            window.initDynamicTagSystem('itemTagsContainer', 'itemTagTextInput', []);
        } else if (panelName === 'entities') {
            window.initDynamicTagSystem('entityTagsContainer', 'entityTagTextInput', []);
        } else if (panelName === 'particles') {
            window.toggleParticleShapeFields('point'); window.toggleParticleDirectionFields('spread');
        } else if (panelName === 'biomes') {
            window.initDynamicTagSystem('biomeTagsContainer', 'biomeTagTextInput', []);
            ['bioGroundLayers', 'bioParentBiomes', 'biomeStructuresContainer'].forEach(elId => { const el = document.getElementById(elId); if (el) el.innerHTML = ''; });
        }

        if (targetIdToEdit) {
            const funcMap = { blocks: 'Block', items: 'Item', recipes: 'Recipe', biomes: 'Biome', entities: 'Entity', particles: 'Particle' };
            window[`populate${funcMap[panelName]}FormValues`](targetIdToEdit);
        }

        window.isInitializingPanel = false;

        if (panelName === 'biomes' && typeof window.initBiomePreview === 'function') window.initBiomePreview();

        if (['recipes', 'biomes', 'entities', 'particles'].includes(panelName)) {
            if (typeof window.renderDropOptions === 'function') window.renderDropOptions();
        }
        if (panelName === 'particles') {
            if (typeof window.rebuildDropdowns === 'function') window.rebuildDropdowns();
        }

        if (typeof window.initDropdownClearButtons === 'function') window.initDropdownClearButtons();
        window.updateSidebarProjectTree();
    } catch (err) {
        window.isInitializingPanel = false;
        document.getElementById('dynamicWorkspace').innerHTML = `<p style="color:red">Error rendering panel view: ${err.message}</p>`;
    }
}
window.loadStudioPanel = loadStudioPanel;

window.populateBlockFormValues = function(id) {
    const d = window.projectData.blocks.find(b => b.id === id);
    if (!d) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

    ['blockId', 'blockHealth', 'blockResistance'].forEach(k => setVal(k, d[k.replace('block', '').toLowerCase()]));
    ['Collide', 'Transparent', 'Replaceable', 'Degradable', 'ViewThrough', 'AlwaysViewThrough', 'HasBackFace', 'AllowOres'].forEach(k => setCheck(`block${k}`, d[k.charAt(0).toLowerCase() + k.slice(1)]));
    ['friction', 'bounciness', 'density', 'terminalVelocity', 'mobility', 'emittedLightColor', 'absorbedLightColor'].forEach(k => setVal(`block${k.charAt(0).toUpperCase() + k.slice(1)}`, d[k]));

    setCheck('dropAuto', d.dropAuto); setVal('dropSearch', d.dropSearch);
    setCheck('hasItemIcon', d.hasItemIcon); setVal('itemIconSearch', d.itemIconSearch);
    setVal('topSearch', d.baseTexture);

    ['front', 'left', 'right', 'up', 'bottom'].forEach(f => setVal(`${f}Search`, d.sides[f]));
    if (d.rotation) { setVal('blockRotation', d.rotation); window.handleRotationChange(d.rotation); }

    window.toggleDropInput(document.getElementById('dropAuto'));
    window.toggleItemIconInput(document.getElementById('hasItemIcon'));
    window.initDynamicTagSystem('blockTagsContainer', 'tagTextInput', d.tags || []);

    const cb = d.callbacks || {};
    ['TouchType', 'TouchMode', 'TouchTypeVariant', 'UpdateType', 'DecayReplacement', 'DecayPrevention', 'UpdateReplaceBlockSearch', 'TickType', 'DecayTickReplacement', 'DecayTickPrevention', 'TickReplaceBlockSearch', 'BreakType', 'BreakReplaceBlockSearch', 'InteractType', 'InteractWindowName'].forEach(k => {
        let fieldId = `logic${k}`;
        if (k.startsWith('Decay') || k.endsWith('Search') || k === 'InteractWindowName') fieldId = k.charAt(0).toLowerCase() + k.slice(1);
        setVal(fieldId, cb[k.charAt(0).toLowerCase() + k.slice(1)] || "");
    });
    document.getElementById('logicTouchDps').value = Math.abs(cb.touchDps || 0.6);

    const touchSearch = document.getElementById('simpleTouchPresetSearch');
    if (touchSearch) {
        document.getElementById('simpleTouchPreset').value = cb.touchType === 'hurt' ? cb.touchMode : 'none';
        touchSearch.value = cb.touchType === 'hurt' ? (cb.touchMode === 'heal' ? 'Heals the player (like a Healing Pad)' : 'Hurts the player (like Spikes/Lava)') : 'Does nothing.';
        document.getElementById('simpleTouchSettings').style.display = cb.touchType === 'hurt' ? 'block' : 'none';
    }

    const envDropdown = document.getElementById('simpleEnvPreset');
    if (envDropdown) {
        envDropdown.value = (cb.updateType === 'check_support_blocks' || cb.updateType === 'checkSupportBlocks') ? 'support' : (['decay', 'vine_decay'].includes(cb.updateType) ? cb.updateType : 'none');
        const labels = { support: "Breaks if ground below is gone", decay: "Decays into air if away from logs", vine_decay: "Breaks if ceiling disappears", none: "Default" };
        document.getElementById('simpleEnvPresetSearch').value = labels[envDropdown.value];
        window.handleSimpleEnvChange(envDropdown.value);
    }

    ['Tick', 'Break'].forEach(h => document.getElementById(`adv${h}ReplaceWrapper`).style.display = cb[`${h.toLowerCase()}Type`] === 'replace_block' ? 'block' : 'none');
    document.getElementById('advInteractWindowWrapper').style.display = cb.interactType === 'open_window' ? 'block' : 'none';

    setTimeout(window.updateBlockFacePreviews, 20);
};

window.populateItemFormValues = function(id) {
    const d = window.projectData.items.find(i => i.id === id);
    if (!d) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

    setVal('itemId', d.id); setVal('itemStackSize', d.stackSize); setVal('itemTextureSearch', d.texture);
    if (document.getElementById('itemFoodValue')) setVal('itemFoodValue', d.foodValue || 0);
    if (document.getElementById('itemBlockPlacementSearch')) setVal('itemBlockPlacementSearch', d.blockPlacement || "");

    const mat = d.material || {};
    ['Durability', 'SwingSpeed', 'TexRoughness', 'MassDamage', 'HardnessDamage', 'ModifierType', 'ModifierStrength'].forEach(k => setVal(`mat${k}`, mat[k.charAt(0).toLowerCase() + k.slice(1)]));
    if (d.baseColor) setVal('matColorBase', d.baseColor);

    window.initDynamicTagSystem('itemTagsContainer', 'itemTagTextInput', d.tags || []);
};

window.populateRecipeFormValues = function(filename) {
    const list = window.projectData.recipes[filename];
    if (!list?.[0]) return;
    const item = list[0];

    document.getElementById('recipeFilename').value = filename;
    let out = item.output, outCount = 1, outM = out.match(/^(\d+)\s+(.+)$/);
    if (outM) { outCount = outM[1]; out = outM[2]; }
    document.getElementById('recipeOutputSearch').value = out.includes(':') ? out.split(':')[1] : out;
    document.getElementById('recipeOutputCount').value = outCount;

    for (let i = 1; i <= 4; i++) {
        const inp = item.inputs[i - 1];
        let inClean = inp || "", inCount = 1;
        if (inp) {
            let inM = inp.match(/^(\d+)\s+(.+)$/);
            if (inM) { inCount = inM[1]; inClean = inM[2]; }
            if (inClean.includes(':')) inClean = inClean.split(':')[1];
        }
        document.getElementById(`recipeInputSearch${i}`).value = inClean;
        document.getElementById(`recipeInputCount${i}`).value = inCount;
    }
};

window.populateBiomeFormValues = function(id) {
    const d = window.projectData.biomes.find(b => b.id === id);
    if (!d) return;
    const setVal = (elId, val) => { const el = document.getElementById(elId); if (el && val !== undefined && val !== null) el.value = val; };
    const setChecked = (elId, val) => { const el = document.getElementById(elId); if (el) el.checked = !!val; };

    setVal('biomeId', d.id);
    setVal('biomeChance', d.chance);
    setVal('bioInterpolation', d.interpolation || '.square');
    setVal('bioMinRadius', d.minRadius);
    setVal('bioMaxRadius', d.maxRadius);
    setVal('bioMinHeight', d.minHeight);
    setVal('bioMaxHeight', d.maxHeight);
    setVal('bioMinHeightLimit', d.minHeightLimit);
    setVal('bioMaxHeightLimit', d.maxHeightLimit);
    setVal('bioRoughness', d.roughness);
    setVal('bioHills', d.hills);
    setVal('bioMountains', d.mountains);
    setVal('bioSoilCreep', d.soilCreep);
    setVal('bioKeepOriginalTerrain', d.keepOriginalTerrain);
    setVal('bioInterpolationWeight', d.interpolationWeight);
    setVal('bioMaxSubBiomeCount', d.maxSubBiomeCount);
    setVal('bioSurfaceBlock', d.surfaceBlock);
    setVal('bioSubBlock', d.subBlock);
    setVal('bioSubMin', d.subMin);
    setVal('bioSubMax', d.subMax);
    setVal('bioStoneBlock', d.stoneBlock);
    setVal('bioCaves', d.caves);
    setVal('bioCaveRadiusFactor', d.caveRadiusFactor);
    setVal('bioCaveSmoothness', d.caveSmoothness);
    setVal('bioCaveNoiseStrength', d.caveNoiseStrength);
    setVal('bioCrystals', d.crystals);
    setVal('bioMusic', d.music);
    setVal('bioFogDensity', d.fogDensity);
    setVal('bioFogLower', d.fogLower);
    setVal('bioFogHigher', d.fogHigher);

    const interpLabels = { '.square': '.square (Smooth Default)', '.linear': '.linear', '.none': '.none' };
    setVal('bioInterpolationSearch', interpLabels[d.interpolation] || interpLabels['.square']);

    setChecked('bioSmoothBeaches', d.smoothBeaches);
    setChecked('bioIsCave', d.isCave);
    setChecked('bioSpawn', d.isValidPlayerSpawn);
    setChecked('bioRivers', d.rivers);
    setVal('bioSkyColor', d.skyColorHex || "#75b2ff");
    setVal('bioFogColor', d.fogColorHex || "#e2f2ff");
    if (document.getElementById('caveSettings')) document.getElementById('caveSettings').style.display = d.isCave ? 'grid' : 'none';

    const caveLayerSelect = document.getElementById('bioCaveLayer');
    const caveLayerCustom = document.getElementById('bioCaveLayerCustom');
    if (caveLayerSelect) {
        const knownLayers = Array.from(caveLayerSelect.options).map((o) => o.value);
        const savedLayer = d.caveLayerTag || "";
        if (savedLayer && knownLayers.includes(savedLayer)) {
            caveLayerSelect.value = savedLayer;
            if (caveLayerCustom) caveLayerCustom.style.display = 'none';
        } else if (savedLayer) {
            caveLayerSelect.value = '__custom__';
            if (caveLayerCustom) { caveLayerCustom.value = savedLayer; caveLayerCustom.style.display = 'block'; }
        } else {
            caveLayerSelect.value = "";
            if (caveLayerCustom) caveLayerCustom.style.display = 'none';
        }
    }

    const checkRadio = (name, val) => { const r = document.querySelector(`input[name="${name}"][value="${val}"]`); if (r) r.checked = true; };
    checkRadio('bioTemp', d.climate); checkRadio('bioWet', d.humidity); checkRadio('bioZone', d.zone); checkRadio('bioGrowth', d.growth); checkRadio('bioHeightProp', d.elevationType);

    window.initDynamicTagSystem('biomeTagsContainer', 'biomeTagTextInput', d.tags || []);

    const groundCont = document.getElementById('bioGroundLayers');
    if (groundCont) { groundCont.innerHTML = ''; (d.groundLayers || []).forEach(l => window.addGroundLayerRow(l)); }

    const parentCont = document.getElementById('bioParentBiomes');
    if (parentCont) { parentCont.innerHTML = ''; (d.parentBiomes || []).forEach(p => window.addParentBiomeRow(p)); }

    const cont = document.getElementById('biomeStructuresContainer');
    if (cont) { cont.innerHTML = ''; if (d.structures?.length) d.structures.forEach(s => window.addStructureRow(s)); }
};

window.populateEntityFormValues = function(id) {
    const d = window.projectData.entities?.find(e => e.id === id);
    if (!d) return;
    document.getElementById('entityId').value = d.id;
    document.getElementById('entityHeight').value = d.height || "2.0";
    document.getElementById('entityCoordSystem').value = d.coordinateSystem || ".right_handed_z_up";
    const coordOption = Array.from(document.querySelectorAll('#entityCoordSystemDropdown .dropdown-option'))
        .find(el => el.getAttribute('onmousedown')?.includes(`'${document.getElementById('entityCoordSystem').value}'`));
    if (coordOption) document.getElementById('entityCoordSystemSearch').value = coordOption.textContent.trim();
    document.getElementById('entityModelSearch').value = d.model || "";
    document.getElementById('entityTextureSearch').value = d.defaultTexture || "";
    window.initDynamicTagSystem('entityTagsContainer', 'entityTagTextInput', d.tags || []);
};

window.populateParticleFormValues = function(id) {
    const d = window.projectData.particles?.find(p => p.id === id);
    if (!d) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

    setVal('particleId', d.id); setVal('particleTextureSearch', d.texture || "");
    document.getElementById('particleHasEmission').checked = d.hasEmission || false;
    document.getElementById('emissionWarning').style.display = d.hasEmission ? 'block' : 'none';

    ['SpeedMin', 'SpeedMax', 'LifeMin', 'LifeMax', 'DensityMin', 'DensityMax', 'RotVelMin', 'RotVelMax', 'DragMin', 'DragMax', 'SpawnShape', 'DirectionMode', 'DirX', 'DirY', 'DirZ'].forEach(k => {
        let key = k.charAt(0).toLowerCase() + k.slice(1);
        if (k === 'SpawnShape') key = 'shape'; if (k === 'DirectionMode') key = 'mode';
        setVal(`particle${k}`, d[key]);
    });

    document.getElementById('particleRandomRotate').checked = d.randomRotate;
    document.getElementById('particleCollides').checked = d.collides;

    window.toggleParticleShapeFields(d.shape);
    if (d.shape === 'sphere') document.getElementById('particleShapeRadius').value = d.shapeRadius || "1";
    else if (d.shape === 'cube') document.getElementById('particleShapeSize').value = d.shapeSize || "1";
    window.toggleParticleDirectionFields(d.mode);
};

window.toggleParticleShapeFields = function(shape) {
    const w = document.getElementById('shapeParamWrapper');
    if (!w) return;
    w.style.display = shape === 'point' ? 'none' : 'block';
    w.innerHTML = shape === 'sphere' ? `<label for="particleShapeRadius">Sphere Radius</label><input type="number" id="particleShapeRadius" value="1.0" step="0.1">` :
    shape === 'cube' ? `<label for="particleShapeSize">Cube Bounds Vector Size</label><input type="text" id="particleShapeSize" value="1.0">` : '';
};

window.toggleParticleDirectionFields = mode => {
    const w = document.getElementById('directionVectorWrapper');
    if (w) w.style.display = mode === 'direction' ? 'flex' : 'none';
};

window.loadBlockPreset = function(presetKey) {
    const p = {
        log: { health: 4, resistance: 4, rotation: 'cubyz:stairs', collide: true, transparent: false, tags: ['choppable'], baseTexture: 'oak_log', up: 'oak_log_top', bottom: 'oak_log_top', touch: 'none', env: 'none' },
        leaves: { health: 0.5, resistance: 0.5, rotation: 'cubyz:decayable', collide: true, transparent: true, tags: ['cuttable', 'leaf'], baseTexture: 'leaves/oak', touch: 'none', env: 'decay' },
        ore: { health: 8, resistance: 12, rotation: 'cubyz:ore', collide: true, transparent: false, tags: ['mineable'], baseTexture: 'ruby_ore', itemIcon: 'ruby_ore', touch: 'none', env: 'none' },
        stone: { health: 6, resistance: 8, rotation: 'cubyz:stairs', collide: true, transparent: false, tags: ['mineable'], baseTexture: 'slate/smooth', touch: 'none', env: 'none' },
        dirt: { health: 2, resistance: 2, rotation: 'cubyz:stairs', collide: true, transparent: false, tags: ['diggable'], baseTexture: 'soil', touch: 'none', env: 'none' }
    }[presetKey];
    if (!p) return;

    ['Health', 'Resistance', 'Rotation'].forEach(k => document.getElementById(`block${k}`).value = p[k.toLowerCase()]);
    document.getElementById('blockCollide').checked = p.collide;
    document.getElementById('blockTransparent').checked = p.transparent;
    document.getElementById('topSearch').value = p.baseTexture;
    ['front', 'left', 'right', 'up', 'bottom'].forEach(f => document.getElementById(`${f}Search`).value = p[f] || '');
    document.getElementById('itemIconSearch').value = p.itemIcon || '';

    window.handleRotationChange(p.rotation);
    window.initDynamicTagSystem('blockTagsContainer', 'tagTextInput', p.tags || []);
    window.toggleDropInput(document.getElementById('dropAuto'));
    window.markFormAsDirty();
    setTimeout(window.updateBlockFacePreviews, 20);
};

window.loadItemPreset = function(key) {
    const p = {
        amber: { id: 'amber_gem', stack: 120, tags: ['material', 'precious'], durability: 600, speed: 1.2, rough: 0.0, mass: 1.5, hardness: 4.0, color: '#ffaa00', mod: 'none', str: 1.0, tex: 'amber' },
        ruby: { id: 'ruby_crystal', stack: 120, tags: ['material', 'precious'], durability: 850, speed: 1.5, rough: 0.0, mass: 2.0, hardness: 5.5, color: '#e6194b', mod: 'powerful', str: 1.2, tex: 'ruby' },
        iron: { id: 'iron_ingot', stack: 120, tags: ['material', 'metal'], durability: 1000, speed: 8.3, rough: 0.1, mass: 3.0, hardness: 6.0, color: '#9c9c9c', mod: 'none', str: 1.0, tex: 'iron_ingot' }
    }[key];
    if (!p) return;

    document.getElementById('itemId').value = p.id;
    document.getElementById('itemStackSize').value = p.stack;
    document.getElementById('itemTextureSearch').value = p.tex;
    ['Durability', 'SwingSpeed', 'TexRoughness', 'MassDamage', 'HardnessDamage', 'ModifierStrength'].forEach(k => document.getElementById(`mat${k}`).value = p[k.charAt(0).toLowerCase() + k.slice(1)]);
    document.getElementById('matColorBase').value = p.color;

    if (document.getElementById('matModifierType') && document.getElementById('matModifierTypeSearch')) {
        document.getElementById('matModifierType').value = p.mod;
        const lbls = { none: 'None / Standard Material', powerful: 'powerful (Increases raw base weapon damage)' };
        document.getElementById('matModifierTypeSearch').value = lbls[p.mod] || 'None / Standard Material';
    }

    window.initDynamicTagSystem('itemTagsContainer', 'itemTagTextInput', p.tags || []);
    window.markFormAsDirty();
};

window.loadRecipePreset = key => {
    if (key === 'planks') {
        Object.assign(document.getElementById('recipeFilename'), { value: "oak_planks_crafting" });
        document.getElementById('recipeInputSearch1').value = "cubyz:oak_log";
        document.getElementById('recipeOutputSearch').value = "cubyz:planks/oak";
        document.getElementById('recipeOutputCount').value = 4;
    } else if (key === 'workbench') {
        Object.assign(document.getElementById('recipeFilename'), { value: "workbench_production" });
        document.getElementById('recipeInputSearch1').value = "cubyz:planks/oak";
        document.getElementById('recipeInputCount1').value = 4;
        document.getElementById('recipeOutputSearch').value = "cubyz:workbench";
    }
    for (let i = 2; i <= 4; i++) document.getElementById(`recipeInputSearch${i}`).value = "";
    window.markFormAsDirty();
};

window.loadBiomePreset = function(key) {
    const cont = document.getElementById('biomeStructuresContainer');
    if (cont) cont.innerHTML = '';
    ['bioGroundLayers', 'bioParentBiomes'].forEach(elId => { const el = document.getElementById(elId); if (el) el.innerHTML = ''; });
    window.initDynamicTagSystem('biomeTagsContainer', 'biomeTagTextInput', []);

    if (key === 'mountain') {
        Object.assign(document.getElementById('biomeId'), { value: "misty_peaks" });
        document.getElementById('bioMinHeight').value = 100; document.getElementById('bioMaxHeight').value = 150;
        document.getElementById('bioSurfaceBlock').value = "cubyz:cold_grass"; document.getElementById('bioSubBlock').value = "cubyz:permafrost";
        document.getElementById('bioStoneBlock').value = "cubyz:glacite/smooth";
        document.getElementById('bioRivers').checked = true;
        ['cubyz:sbb', 'cubyz:sbb', 'cubyz:ground_patch', 'cubyz:flower_patch', 'cubyz:boulder'].forEach(id => window.addStructureRow({ id, chance: 0.01 }));
    } else if (key === 'cave') {
        Object.assign(document.getElementById('biomeId'), { value: "deep_abyss_caves" });
        document.getElementById('bioMinHeight').value = -600; document.getElementById('bioMaxHeight').value = -512;
        document.getElementById('bioSurfaceBlock').value = "cubyz:slate/rough"; document.getElementById('bioIsCave').checked = true;
    }
    window.markFormAsDirty();
};

window.updateBlockFacePreviews = function() {
    const base = document.getElementById('topSearch')?.value.trim() || "";
    const mappings = {
        up: document.getElementById('upSearch')?.value.trim() || base,
        front: document.getElementById('frontSearch')?.value.trim() || base,
        left: document.getElementById('leftSearch')?.value.trim() || base,
        right: document.getElementById('rightSearch')?.value.trim() || base,
        bottom: document.getElementById('bottomSearch')?.value.trim() || base,
        back: base
    };

    ['up','left','front','right','bottom','back'].forEach(face => {
        const img = document.getElementById(`view_${face}`);
        if (!img) return;
        let target = mappings[face];
        if (!target) return img.style.display = 'none';

        let m = window.serverTextures.find(t => t.name === target && t.isBlockType) ||
        window.serverTextures.find(t => t.isBlockType && t.name.endsWith('/' + target));

        if (!m && base) m = window.serverTextures.find(t => t.name === base);
        m = m || window.blockTexturesOnly[0];

        if (m) { img.src = m.dataUrl; img.style.display = 'block'; }
        else img.style.display = 'none';
    });

        ['topSearch', 'frontSearch', 'leftSearch', 'rightSearch', 'upSearch', 'bottomSearch', 'itemTextureSearch', 'itemIconSearch', 'itemBlockPlacementSearch', 'bioSurfaceBlock', 'bioSubBlock', 'bioStoneBlock', 'entityTextureSearch', 'particleTextureSearch'].forEach(id => {
            const input = document.getElementById(id);
            const thumb = document.getElementById(`thumb_${id}`);
            if (!input || !thumb) return;

            let name = input.value.trim();
            if (!name) return thumb.style.display = 'none';

            if (id === 'entityTextureSearch' && !entityTextureMatches(name, name.split('/').pop())) {
                name = `${entityFolderForVersion(window.VERSION_PATH)}/textures/${name}`;
            }
            if (id === 'particleTextureSearch' && !name.startsWith('particles/textures/')) name = 'particles/textures/' + name;

            const m = window.serverTextures.find(t => t.name === name || (id === 'entityTextureSearch' && entityTextureMatches(t.name, name.split('/').pop())));
            if (m) { thumb.src = m.dataUrl; thumb.style.display = 'block'; }
            else thumb.style.display = 'none';
        });
};

window.handleCustomEntityModel = function(inputElement, targetSearchId) {
    if (inputElement.files?.[0]) {
        const file = inputElement.files[0];
        const addonName = document.getElementById('addonName')?.value || 'my_addon';
        const name = file.name.split('.')[0].toLowerCase().replace(/[^a-z0-9_]/g, "");

        document.getElementById(targetSearchId).value = `${addonName}:${name}`;

        if (!window.customEntityModels) window.customEntityModels = {};
        window.customEntityModels[`${addonName}:${name}`] = file;

        window.markFormAsDirty();
    }
};

window.handleCustomEntityTexture = async function(inputElement, targetSearchId) {
    if (inputElement.files?.[0]) {
        const file = inputElement.files[0];
        const addonName = document.getElementById('addonName')?.value || 'my_addon';
        const name = file.name.split('.')[0].toLowerCase().replace(/[^a-z0-9_]/g, "");
        const texturePath = `${entityFolderForVersion(window.VERSION_PATH)}/textures/${name}`;

        const url = await new Promise(r => {
            const rd = new FileReader();
            rd.onloadend = () => r(rd.result);
            rd.readAsDataURL(file);
        });

        window.serverTextures.unshift({
            name: texturePath,
            dataUrl: url,
            isCustom: true,
            isBlockType: false,
            isEntityType: true
        });

        document.getElementById(targetSearchId).value = name;
        window.updateBlockFacePreviews();
        window.markFormAsDirty();
    }
};

window.handleCustomBlockTexture = async function(inputElement, targetSearchId) {
    if (inputElement.files?.[0]) {
        const file = inputElement.files[0];
        const name = file.name.split('.')[0].toLowerCase().replace(/[^a-z0-9_]/g, "");

        const url = await new Promise(r => {
            const rd = new FileReader();
            rd.onloadend = () => r(rd.result);
            rd.readAsDataURL(file);
        });

        const textureObject = {
            name: name,
            dataUrl: url,
            isCustom: true,
            isBlockType: true,
            isEntityType: false,
            isParticleType: false,
            rawFile: file
        };

        window.serverTextures.unshift(textureObject);
        if (window.blockTexturesOnly) window.blockTexturesOnly.unshift(textureObject);

        const inputField = document.getElementById(targetSearchId);
        if (inputField) {
            inputField.value = name;
            inputField.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (typeof window.updateBlockFacePreviews === 'function') window.updateBlockFacePreviews();
        if (typeof window.rebuildDropdowns === 'function') window.rebuildDropdowns();
        window.markFormAsDirty();
    }
};
window.handleCustomTexture = window.handleCustomBlockTexture;

window.addGroundLayerRow = function(savedData = null) {
    const container = document.getElementById('bioGroundLayers');
    if (!container) return;
    const rowId = 'ground_layer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const row = document.createElement('div');
    row.className = 'ground-layer-row';
    row.id = rowId;
    row.style = 'display: grid; grid-template-columns: 2fr 76px 76px auto; gap: 8px; align-items: end; background: #1e1e1e; padding: 10px; border-radius: 4px; border: 1px solid #3c3c3c;';
    row.innerHTML = `
    <div class="texture-select-wrapper" style="position: relative;">
        <label style="font-size:11px; color:#888; display:block; margin-bottom:4px;">Layer Block</label>
        <input type="text" id="${rowId}_in" class="ground-layer-block" value="${savedData?.block || ''}" placeholder="cubyz:soil" autocomplete="off" onfocus="window.showRecipeDropdown('${rowId}_drop', '${rowId}_in', 'blocks')" oninput="window.filterDropdown('${rowId}_in', '${rowId}_drop')" style="padding:6px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box;">
        <div id="${rowId}_drop" class="dropdown-options"></div>
    </div>
    <div>
        <label style="font-size:11px; color:#888; display:block; margin-bottom:4px;">Min</label>
        <input type="number" class="ground-layer-min" value="${savedData?.min ?? ''}" placeholder="1" min="0" style="padding:6px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box;">
    </div>
    <div>
        <label style="font-size:11px; color:#888; display:block; margin-bottom:4px;">Max</label>
        <input type="number" class="ground-layer-max" value="${savedData?.max ?? ''}" placeholder="3" min="0" style="padding:6px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box;">
    </div>
    <button type="button" onclick="document.getElementById('${rowId}').remove(); window.markFormAsDirty();" style="background:#dc3545; padding:8px 12px; height:34px; cursor:pointer; border:none; color:white; border-radius:4px;">Remove</button>
    `;
    container.appendChild(row);
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { if (!window.isInitializingPanel) window.markFormAsDirty(); }));
};

window.addParentBiomeRow = function(savedData = null) {
    const container = document.getElementById('bioParentBiomes');
    if (!container) return;
    const rowId = 'parent_biome_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const row = document.createElement('div');
    row.className = 'parent-biome-row';
    row.id = rowId;
    row.style = 'display: grid; grid-template-columns: 2fr 80px 100px auto; gap: 8px; align-items: end; background: #1e1e1e; padding: 10px; border-radius: 4px; border: 1px solid #3c3c3c;';
    row.innerHTML = `
    <div>
        <label style="font-size:11px; color:#888; display:block; margin-bottom:4px;">Parent Biome ID</label>
        <input type="text" class="parent-biome-id" value="${savedData?.id || ''}" placeholder="forest" autocomplete="off" style="padding:6px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box;">
    </div>
    <div>
        <label style="font-size:11px; color:#888; display:block; margin-bottom:4px;">Chance</label>
        <input type="number" class="parent-biome-chance" value="${savedData?.chance ?? ''}" placeholder="1.0" step="0.01" style="padding:6px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box;">
    </div>
    <div>
        <label style="font-size:11px; color:#888; display:block; margin-bottom:4px;">Edge Distance</label>
        <input type="number" class="parent-biome-distance" value="${savedData?.parentEdgeDistance ?? ''}" placeholder="default" style="padding:6px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box;">
    </div>
    <button type="button" onclick="document.getElementById('${rowId}').remove(); window.markFormAsDirty();" style="background:#dc3545; padding:8px 12px; height:34px; cursor:pointer; border:none; color:white; border-radius:4px;">Remove</button>
    `;
    container.appendChild(row);
    row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => { if (!window.isInitializingPanel) window.markFormAsDirty(); }));
};

window.addStructureRow = function(savedData = null) {
    const container = document.getElementById('biomeStructuresContainer');
    if (!container) return;
    // Guard against accidental double-adds (e.g. double click while lagging).
    const now = Date.now();
    if (window._lastAddStructureAt && now - window._lastAddStructureAt < 250) return;
    window._lastAddStructureAt = now;
    const rowId = 'struct_row_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'structure-row-entry';
    row.style = 'background: #1e1e1e; padding: 12px; border-radius: 4px; border: 1px solid #3c3c3c; margin-bottom: 8px;';

    const typeValue = savedData ? (savedData.id || '') : '';
    const chanceValue = savedData ? savedData.chance : 0.05;
    const modeValue = savedData?.generationMode || '';
    const priorityValue = savedData?.priority ?? '';

    const meta = window.STRUCT_META;
    const modeOptions = ['floor', 'ceiling', 'floor_and_ceiling', 'air', 'underground', 'water_surface'];
    const current = meta[typeValue] || meta[''];

    row.innerHTML = `
    <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
    <div style="flex: 2; min-width: 200px; position: relative;">
    <label style="font-size:12px; color:#aaa;">Structure Feature Type</label>
    <input type="hidden" class="struct-type-selector" id="${rowId}_value" value="${typeValue}">
    <button type="button" id="${rowId}_search" onclick="document.getElementById('${rowId}_selectDropdown').style.display='block'" style="display:flex; align-items:center; gap:8px; padding:9px 10px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box; cursor:pointer; text-align:left; font-size:13px;">
      <span class="struct-type-icon" style="display:inline-flex; width:16px; flex-shrink:0;">${current.icon}</span>
      <span class="struct-type-label">${current.label}</span>
    </button>
    <div id="${rowId}_selectDropdown" class="dropdown-options" style="display: none; position: absolute; width: 100%; background: #1e1e1e; border: 1px solid #3c3c3c; z-index: 1000; box-sizing: border-box;">
    ${Object.keys(meta).map(k => `<div class="dropdown-option" style="padding: 6px 12px; cursor: pointer; display:flex; align-items:center; gap:8px;" onmousedown="window.selectStructType('${rowId}', '${k}')"><span style="display:inline-flex; width:16px; flex-shrink:0;">${meta[k].icon}</span><span>${meta[k].label}</span></div>`).join('')}
    </div>
    </div>
    <div style="width: 130px;">
    <label style="font-size:12px; color:#aaa;">Spawn Chance</label>
    <input type="number" class="struct-chance" value="${chanceValue}" step="0.001" min="0" max="1" style="padding:8px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; box-sizing:border-box; width:100%;">
    </div>
    <div style="width: 160px;">
    <label style="font-size:12px; color:#aaa;">Generation Mode</label>
    <select class="struct-generation-mode" style="padding:8px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; box-sizing:border-box; width:100%;">
    <option value="">(type default)</option>
    ${modeOptions.map(m => `<option value="${m}"${m === modeValue ? ' selected' : ''}>${m}</option>`).join('')}
    </select>
    </div>
    <div style="width: 90px;">
    <label style="font-size:12px; color:#aaa;">Priority</label>
    <input type="number" class="struct-priority" value="${priorityValue}" placeholder="1" step="0.1" style="padding:8px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; box-sizing:border-box; width:100%;">
    </div>
    <button type="button" onclick="document.getElementById('${rowId}').remove(); window.markFormAsDirty();" style="background:#dc3545; padding:8px 12px; margin-top:18px; font-size:12px; height:36px; cursor:pointer; border:none; color:white; border-radius:4px;">Remove</button>
    </div>
    <div class="struct-subfields-wrapper" style="margin-top:12px; padding-top:10px; border-top:1px dashed #3c3c3c; display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px;"></div>
    `;
    container.appendChild(row);
    row.querySelectorAll('.struct-chance, .struct-generation-mode, .struct-priority').forEach(inp => inp.addEventListener('input', () => { if (!window.isInitializingPanel) window.markFormAsDirty(); }));
    window.toggleStructSubFields(rowId, typeValue, savedData);
};

window.toggleStructSubFields = function(rowId, type, data = null) {
    const wrapper = document.querySelector(`#${rowId} .struct-subfields-wrapper`);
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const createInputHTML = (label, className, val, placeholder, dropdownId, searchId, assetType = 'blocks') => `
    <div class="texture-select-wrapper" style="position: relative;">
    <label style="font-size:11px; color:#888; display:block; margin-bottom:4px;">${label}</label>
    <input type="text" class="${className}" id="${searchId}" ${val ? `value="${val}"` : ''} placeholder="${placeholder}" autocomplete="off" onfocus="window.showRecipeDropdown('${dropdownId}', '${searchId}', '${assetType}')" oninput="window.filterDropdown('${searchId}', '${dropdownId}')" style="padding:6px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box;">
    <div id="${dropdownId}" class="dropdown-options"></div>
    </div>`;

    const createNormalInputHTML = (label, className, val, placeholder) => `
    <div>
    <label style="font-size:11px; color:#888; display:block; margin-bottom:4px;">${label}</label>
    <input type="text" class="${className}" ${val ? `value="${val}"` : ''} placeholder="${placeholder}" style="padding:6px; background:#252526; border:1px solid #3c3c3c; color:white; border-radius:4px; width:100%; box-sizing:border-box;">
    </div>`;

    if (type === 'cubyz:simple_tree') {
        wrapper.innerHTML = createInputHTML('Log Block', 'field-log', data?.log, 'cubyz:oak_log', rowId+'_logDrop', rowId+'_logIn', 'logs') +
        createInputHTML('Leaves Block', 'field-leaves', data?.leaves, 'cubyz:leaves/oak', rowId+'_leDrop', rowId+'_leIn', 'leaves') +
        createNormalInputHTML('Base Trunk Height', 'field-height', data?.height, '6') +
        createNormalInputHTML('Height Variance', 'field-height-var', data?.height_variation, '3') +
        createNormalInputHTML('Crown Size (leafRadius)', 'field-leaf-radius', data?.leafRadius, '2');
    } else if (type === 'cubyz:simple_vegetation') {
        wrapper.innerHTML = createInputHTML('Foliage Sprite Block', 'field-block', data?.block, 'cubyz:fern', rowId+'_vegDrop', rowId+'_vegIn', 'plants') + createNormalInputHTML('Sprite Max Height', 'field-height', data?.height, '1') + createNormalInputHTML('Height Variance', 'field-height-var', data?.height_variation, '0');
    } else if (type === 'cubyz:flower_patch') {
        wrapper.innerHTML = createInputHTML('Foliage/Flower Block', 'field-block', data?.block, 'cubyz:daffodil', rowId+'_flDrop', rowId+'_flIn', 'plants') + createNormalInputHTML('Patch Width Scale', 'field-width', data?.width, '10') + createNormalInputHTML('Patch Variance', 'field-variation', data?.variation, '6') + createNormalInputHTML('Patch Density', 'field-density', data?.density, '0.3');
    } else if (type === 'cubyz:boulder') {
        wrapper.innerHTML = createInputHTML('Stone Block Variant', 'field-block', data?.block, 'cubyz:slate/rough', rowId+'_boDrop', rowId+'_boIn') + createNormalInputHTML('Base Radius Size', 'field-size', data?.size, '5') + createNormalInputHTML('Size Variance Step', 'field-size-var', data?.size_variance, '4');
    } else if (type === 'cubyz:ground_patch') {
        wrapper.innerHTML = createInputHTML('Replacement Block', 'field-block', data?.block, 'cubyz:gravel', rowId+'_gpDrop', rowId+'_gpIn') + createNormalInputHTML('Patch Width', 'field-width', data?.width, '5') + createNormalInputHTML('Patch Depth layers', 'field-depth', data?.depth, '2') + createNormalInputHTML('Edge Smoothness (0-1)', 'field-smoothness', data?.smoothness, '0.2');
    } else if (type === 'cubyz:fallen_tree') {
        wrapper.innerHTML = createInputHTML('Log Block Type', 'field-log', data?.log, 'cubyz:oak_log', rowId+'_ftDrop', rowId+'_ftIn', 'logs') + createNormalInputHTML('Log Length size', 'field-height', data?.height, '6') + createNormalInputHTML('Length Variance', 'field-height-var', data?.height_variation, '3');
    } else if (type === 'cubyz:sbb') {
        wrapper.innerHTML = createInputHTML('SBB Structure (presets: pick a tree...)', 'field-structure', data?.structure, 'cubyz:tree/oak/young', rowId+'_sbbDrop', rowId+'_sbbIn', 'sbb') + createNormalInputHTML('Place Mode flag', 'field-placemode', data?.placeMode, '.degradable');
    } else if (type === 'cubyz:stalagmite') {
        wrapper.innerHTML = createInputHTML('Stalagmite Block', 'field-block', data?.block, 'cubyz:stalagmite', rowId+'_stDrop', rowId+'_stIn') + createNormalInputHTML('Base Size', 'field-size', data?.size, '12') + createNormalInputHTML('Size Variation', 'field-size-var', data?.size_variation, '8') + createNormalInputHTML('Base Slope', 'field-base-slope', data?.baseSlope, '4') + createNormalInputHTML('Top Slope', 'field-top-slope', data?.topSlope, '4');
    }

    wrapper.querySelectorAll('input, select').forEach(input => input.addEventListener('input', () => { if (!window.isInitializingPanel) window.markFormAsDirty(); }));
};

window.initDropdownClearButtons = function() {
    document.querySelectorAll('.texture-select-wrapper').forEach(wrapper => {
        const input = wrapper.querySelector('input[type="text"]');
        if (!input || input.readOnly) return;

        let container = input.parentElement;
        if (!container.classList.contains('input-clear-inner-wrap')) {
            container = document.createElement('div');
            container.className = 'input-clear-inner-wrap';
            container.style = 'position: relative; width: 100%;';
            input.parentNode.insertBefore(container, input);
            container.appendChild(input);
        }

        let btn = container.querySelector('.clear-input-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'clear-input-btn';
            btn.innerHTML = '✕';
            btn.style = 'position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: #888; font-size: 14px; cursor: pointer; padding: 4px; display: none; z-index: 10; line-height: 1;';
            btn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                input.value = ''; btn.style.display = 'none'; input.focus();
                if (typeof window.updateBlockFacePreviews === 'function') window.updateBlockFacePreviews();
                window.markFormAsDirty();
            };
            container.appendChild(btn);
            const toggle = () => btn.style.display = input.value.trim() !== '' ? 'block' : 'none';
            input.addEventListener('input', toggle); input.addEventListener('change', toggle);
        }
        btn.style.display = input.value.trim() !== '' ? 'block' : 'none';
    });
};

window.showRecipeDropdown = function(dropdownId, inputId, assetType = 'blocks') {
    const dropdown = document.getElementById(dropdownId);
    const input = document.getElementById(inputId);
    if (!dropdown || !input) return;

    dropdown.innerHTML = '';
    dropdown.style.display = 'block';

    const short = (n) => String(n || '').replace(/^[a-z0-9_]+:/, '');
    const blockMap = new Map();
    const itemMap = new Map();
    const addBlock = (name) => { const n = short(name); if (n && !n.endsWith('_reflectivity') && !blockMap.has(n)) blockMap.set(n, n); };
    const addItem = (name) => { const n = short(name); if (n && !itemMap.has(n)) itemMap.set(n, n); };

    (window.projectData?.blocks || []).forEach((b) => addBlock(b.id));
    (window.serverBlocks || []).forEach(addBlock);
    (window.projectData?.items || []).forEach((it) => addItem(it.id));
    (window.serverItems || []).forEach(addItem);
    (window.serverTextures || []).forEach((t) => {
        if (t.isBlockType) addBlock(t.name);
        else if (!t.isEntityType && !t.isParticleType) addItem(t.name);
    });

    const bt = window.blockTextures || {};
    const isPlant = (name) => {
        const info = bt[name];
        if (!info) return /flower|dais|dandelion|vegetation|fern|sprout|lily|mushroom|glimmergill|cactus|vine|monstera|sapling|bluebell|bush/.test(name);
        const model = info.model || 'cube';
        return model === 'cross' || model === 'plane' || model === 'fern' || model.startsWith('flower/') || !!info.viewThrough;
    };
    const isLog = (name) => /(^|\/)log(\/|$)|log$|wood|trunk/.test(name);
    const isLeaves = (name) => /leaves?(\/|$)|needles/.test(name);

    let pool;
    if (assetType === 'items') {
        pool = [...itemMap.values()];
    } else if (assetType === 'music') {
        pool = (window.serverMusicList || []).slice();
    } else if (assetType === 'sbb' || assetType === 'trees') {
        let list = (window.serverSbbList || []).map((n) => `cubyz:${n}`);
        if (assetType === 'trees') list = list.filter((n) => n.startsWith('cubyz:tree/'));
        pool = list;
    } else {
        let blocks = [...blockMap.values()];
        if (assetType === 'plants') blocks = blocks.filter(isPlant);
        else if (assetType === 'logs') blocks = blocks.filter(isLog);
        else if (assetType === 'leaves') blocks = blocks.filter(isLeaves);
        else blocks = blocks.filter((n) => !isPlant(n)); // default: solid blocks
        pool = blocks;
    }

    Array.from(new Set(pool)).sort().forEach((name) => {
        if (!name || name.startsWith('music/') || name.includes('sound') || name.startsWith('musicModels/')) return;
        const opt = document.createElement('div');
        opt.className = 'dropdown-option';
        opt.style = 'padding: 6px 12px; cursor: pointer; color: #fff; background: #1e1e1e;';
        opt.textContent = name;

        opt.onmousedown = (e) => {
            e.preventDefault();
            input.value = name;
            dropdown.style.display = 'none';
            input.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof window.initDropdownClearButtons === 'function') window.initDropdownClearButtons();
        };

        dropdown.appendChild(opt);
    });

    window.filterDropdown(inputId, dropdownId);
};

window.filterDropdown = function(inputId, dropdownId) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    const query = input.value.trim().toLowerCase();
    const options = dropdown.querySelectorAll('.dropdown-option');

    options.forEach(opt => {
        const txt = opt.textContent.toLowerCase();
        opt.style.display = txt.includes(query) ? 'block' : 'none';
    });
};

window.updateClearButtonVisibility = function(input) {
    if (!input || input.readOnly) return;
    const btn = input.closest('.texture-select-wrapper')?.querySelector('.clear-input-btn');
    if (btn) btn.style.display = input.value.trim() !== '' ? 'block' : 'none';
};

document.addEventListener('mouseup', () => {
    if (window.currentPanelName === 'blocks') setTimeout(window.updateBlockFacePreviews, 50);
    setTimeout(window.initDropdownClearButtons, 60);
});

document.addEventListener('mousedown', e => {
    if (!e.target.closest('.texture-select-wrapper')) {
        document.querySelectorAll('.dropdown-options').forEach(d => d.style.display = 'none');
    }
});
