
window.cloudSaveState = { currentProjectId: null, currentProjectName: null };

async function isLoggedIn() {
  try {
    const res = await fetch("/api/auth/status", { credentials: "include" });
    const data = await res.json();
    return data.ok && data.user ? data.user : null;
  } catch (_) {
    return null;
  }
}

function serializeCurrentProject() {
  const customTextures = (window.serverTextures || [])
    .filter((t) => t.isCustom)
    .map((t) => ({
      name: t.name,
      dataUrl: t.dataUrl,
      isBlockType: !!t.isBlockType,
      isEntityType: !!t.isEntityType,
      isParticleType: !!t.isParticleType,
    }));

  return {
    addonName: document.getElementById("addonName")?.value || "",
    projectData: window.projectData,
    deletedAddonElements: window.deletedAddonElements,
    customTextures,
  };
}

function base64ToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mime = meta.match(/data:(.*);base64/)?.[1] || "image/png";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function applyLoadedProject(saved) {
  const data = saved.data;

  Object.assign(window.projectData, {
    blocks: data.projectData?.blocks || [],
    items: data.projectData?.items || [],
    recipes: data.projectData?.recipes || {},
    biomes: data.projectData?.biomes || [],
    entities: data.projectData?.entities || [],
    particles: data.projectData?.particles || [],
  });
  window.deletedAddonElements = data.deletedAddonElements || { blocks: [], items: [], recipes: [], biomes: [], entities: [], particles: [] };

  const addonNameInput = document.getElementById("addonName");
  if (addonNameInput) addonNameInput.value = data.addonName || "";

  (data.customTextures || []).forEach((t) => {
    if (window.serverTextures.some((existing) => existing.name === t.name)) return;
    window.serverTextures.unshift({
      name: t.name,
      dataUrl: t.dataUrl,
      isCustom: true,
      isBlockType: t.isBlockType,
      isEntityType: t.isEntityType,
      isParticleType: t.isParticleType,
      rawFile: new File([base64ToBlob(t.dataUrl)], `${t.name}.png`, { type: "image/png" }),
    });
  });

  if (typeof window.rebuildDropdowns === "function") window.rebuildDropdowns();
  if (typeof window.updateSidebarProjectTree === "function") window.updateSidebarProjectTree();

  window.hasUnsavedChanges = false;
  window.cloudSaveState.currentProjectId = saved.id;
  window.cloudSaveState.currentProjectName = saved.name;
}

window.saveCurrentProject = async function () {
  const user = await isLoggedIn();
  if (!user) {
    if (typeof window.persistCreatorDraft === "function") window.persistCreatorDraft();
    if (confirm("You need to be signed in to save to your account. Open Cubyz Hub's login?")) {
      document.querySelector("[data-open-auth]")?.click();
    }
    return;
  }

  const keys = ["blocks", "items", "biomes", "entities", "particles"];
  if (keys.every((k) => !window.projectData[k]?.length) && !Object.keys(window.projectData.recipes || {}).length) {
    return alert("Your project is empty - add at least one block, item, biome, entity or particle before saving.");
  }

  let name = window.cloudSaveState.currentProjectName;
  if (!name) {
    name = prompt("Name this save:", document.getElementById("addonName")?.value || "My Addon");
    if (!name || !name.trim()) return;
    name = name.trim();
  }

  const payload = { name, gameVersion: window.VERSION_PATH, data: serializeCurrentProject() };
  const btn = document.getElementById("cloudSaveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

  try {
    const url = window.cloudSaveState.currentProjectId
      ? `/api/creator-projects/${window.cloudSaveState.currentProjectId}`
      : "/api/creator-projects";
    const method = window.cloudSaveState.currentProjectId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "Save failed.");

    window.cloudSaveState.currentProjectId = window.cloudSaveState.currentProjectId || result.id;
    window.cloudSaveState.currentProjectName = name;
  } catch (err) {
    alert(`Could not save: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
};

async function loadProjectList() {
  const listEl = document.getElementById("cloudSaveProjectList");
  const msgEl = document.getElementById("cloudSaveModalMessage");
  if (!listEl) return;

  const user = await isLoggedIn();
  if (!user) {
    msgEl.textContent = "Sign in to save your progress to your account and pick it back up later.";
    listEl.innerHTML = "";

    const loginBtn = document.createElement("button");
    loginBtn.type = "button";
    loginBtn.className = "btn-primary modal-btn";
    loginBtn.textContent = "Log In";
    loginBtn.style.marginTop = "8px";
    loginBtn.onclick = () => {
      document.getElementById("cloudSaveModal").style.display = "none";
      document.querySelector("[data-open-auth]")?.click();
    };
    listEl.appendChild(loginBtn);
    return;
  }

  msgEl.textContent = "Loading a save will replace your current unsaved work.";
  listEl.innerHTML = "<p style=\"color:#888;\">Loading...</p>";

  try {
    const res = await fetch("/api/creator-projects", { credentials: "include" });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error);

    if (!result.projects.length) {
      listEl.innerHTML = "<p style=\"color:#888;\">No saved projects yet.</p>";
      return;
    }

    listEl.innerHTML = "";
    result.projects.forEach((p) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; background:#1c1c1c; border:1px solid #2d2d2d; border-radius:4px;";

      const info = document.createElement("div");
      const title = document.createElement("div");
      title.textContent = p.name;
      title.style.cssText = "font-weight:600; color:#eee;";
      const meta = document.createElement("div");
      meta.textContent = `v${p.game_version} · updated ${new Date(p.updated_at).toLocaleString()}`;
      meta.style.cssText = "font-size:12px; color:#888;";
      info.append(title, meta);

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex; gap:6px;";

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "btn-primary modal-btn";
      loadBtn.textContent = "Load";
      loadBtn.onclick = () => window.loadCloudProject(p.id);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-secondary modal-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.onclick = () => window.deleteCloudProject(p.id);

      actions.append(loadBtn, deleteBtn);
      row.append(info, actions);
      listEl.appendChild(row);
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:#f66;">Failed to load saves: ${err.message}</p>`;
  }
}

window.loadCloudProject = async function (id) {
  if (window.hasUnsavedChanges) {
    if (!(await window.showCustomConfirm("Unsaved Changes", "Loading a save will discard your current unsaved work. Continue?"))) return;
  }

  try {
    const res = await fetch(`/api/creator-projects/${id}`, { credentials: "include" });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error);

    applyLoadedProject(result.project);
    const wasOpenedFromStartGate = window.cloudSaveState.openedFromStartGate;
    window.cloudSaveState.openedFromStartGate = false;
    window.closeCloudSaveModal();

    if (wasOpenedFromStartGate && typeof window.dismissStartModal === "function") {
      window.dismissStartModal();
    }

    const firstNonEmpty = ["blocks", "items", "biomes", "entities", "particles"].find((k) => window.projectData[k]?.length) || "blocks";
    document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));
    const names = ["blocks", "items", "recipes", "biomes", "entities", "particles"];
    document.querySelectorAll(".nav-btn")[names.indexOf(firstNonEmpty)]?.classList.add("active");
    if (typeof loadStudioPanel === "function") loadStudioPanel(firstNonEmpty, null);
  } catch (err) {
    alert(`Could not load project: ${err.message}`);
  }
};

window.deleteCloudProject = async function (id) {
  if (!confirm("Delete this saved project? This can't be undone.")) return;
  try {
    const res = await fetch(`/api/creator-projects/${id}`, { method: "DELETE", credentials: "include" });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error);
    if (window.cloudSaveState.currentProjectId === id) {
      window.cloudSaveState.currentProjectId = null;
      window.cloudSaveState.currentProjectName = null;
    }
    loadProjectList();
  } catch (err) {
    alert(`Could not delete project: ${err.message}`);
  }
};

window.openCloudSaveModal = function (openedFromStartGate) {
  window.cloudSaveState.openedFromStartGate = !!openedFromStartGate;
  document.getElementById("cloudSaveModal").style.display = "flex";
  loadProjectList();
};

window.closeCloudSaveModal = function () {
  document.getElementById("cloudSaveModal").style.display = "none";

  if (window.cloudSaveState.openedFromStartGate && !window.cloudSaveState.currentProjectId) {
    if (typeof window.showStartModal === "function") window.showStartModal();
  }
  window.cloudSaveState.openedFromStartGate = false;
};
