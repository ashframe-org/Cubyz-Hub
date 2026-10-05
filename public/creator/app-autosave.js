const AUTOSAVE_DELAY_MS = 600;
const DRAFT_KEY = "cubyzCreatorDraft";

const PANEL_SAVE_FN = {
    blocks: "saveBlockToProject",
    items: "saveItemToProject",
    recipes: "saveRecipeToProject",
    biomes: "saveBiomeToProject",
    entities: "saveEntityToProject",
    particles: "saveParticleToProject",
};

let autosaveTimer = null;

function setSaveStatus(text, color) {
    const el = document.getElementById("panelSaveStatus");
    if (el) {
        el.textContent = text;
        el.style.color = color;
    }
}

// Persist the whole in-progress project to localStorage. The site's login flow
// reloads the page (public/auth.js), so without this a sign-in would wipe the
// project before it could be saved to the account.
function persistCreatorDraft() {
    try {
        if (typeof window.serializeCurrentProject !== "function") return;
        const draft = window.serializeCurrentProject();
        draft.version = window.VERSION_PATH || "";
        draft.savedAt = Date.now();
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (_) {
        // Quota exceeded (large custom textures) - ignore, the project is still
        // in memory and cloud save still works while signed in.
    }
}
window.persistCreatorDraft = persistCreatorDraft;

function clearCreatorDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
}
window.clearCreatorDraft = clearCreatorDraft;

function restoreCreatorDraft() {
    let draft;
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return false;
        draft = JSON.parse(raw);
    } catch (_) {
        return false;
    }
    if (!draft || !draft.projectData) return false;
    const pd = draft.projectData;
    const hasContent =
        ["blocks", "items", "biomes", "entities", "particles"].some((k) => (pd[k] || []).length) ||
        Object.keys(pd.recipes || {}).length > 0;
    if (!hasContent) return false;
    if (typeof window.applyLoadedProject !== "function") return false;
    try {
        window.applyLoadedProject({ data: draft, id: null, name: draft.name || null });
    } catch (_) {
        return false;
    }
    if (typeof window.dismissStartModal === "function") window.dismissStartModal();
    setSaveStatus("Restored your last project", "#5BA65B");
    persistCreatorDraft();
    return true;
}
window.restoreCreatorDraft = restoreCreatorDraft;

function scheduleAutosave() {
    setSaveStatus("Saving", "#e0a030");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        const fnName = PANEL_SAVE_FN[window.currentPanelName];
        const fn = fnName && window[fnName];
        if (typeof fn === "function") {
            const ok = fn(true);
            setSaveStatus(ok ? "Saved" : "Warning", ok ? "#5BA65B" : "#dc3545");
        }
        persistCreatorDraft();
    }, AUTOSAVE_DELAY_MS);
}

function initAutosave() {
    const workspace = document.getElementById("dynamicWorkspace");
    if (workspace) {
        workspace.addEventListener("input", () => {
            if (window.isInitializingPanel) return;
            scheduleAutosave();
        });
        workspace.addEventListener("change", () => {
            if (window.isInitializingPanel) return;
            scheduleAutosave();
        });
    }

    document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.addEventListener("click", () => setSaveStatus("", ""));
    });

    window.addEventListener("beforeunload", persistCreatorDraft);

    // Restore a draft (e.g. after the login reload). Deferred so the welcome
    // modal has already been shown and can be dismissed.
    setTimeout(restoreCreatorDraft, 0);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAutosave);
} else {
    initAutosave();
}
