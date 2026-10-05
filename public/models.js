
import { enhanceSelect } from './custom-select.js?v=20260919-17';

const OFFICIAL_MODELS = [
  { id: "snale", title: "Snale", identifier: "cubyz:snale", glb: "/models-official/snale.glb?v=20261004-1", texture: "/models-official/snale.png", rotateX: false, rotationOffsetY: 0 },
  { id: "snela", title: "Snela", identifier: "cubyz:snela", glb: "/models-official/snela.glb?v=20261004-1", texture: "/models-official/snela.png", rotateX: false, rotationOffsetY: 0 },
  { id: "snail", title: "Snail", identifier: "cubyz:snail", glb: "/models-official/snail.glb?v=20261004-1", texture: "/models-official/snail.png", rotateX: false, rotationOffsetY: Math.PI },
  { id: "moffalo", title: "Moffalo", identifier: "cubyz:moffalo", glb: "/models-official/moffalo.glb?v=20261004-1", texture: "/models-official/moffalo.png", rotateX: false, rotationOffsetY: Math.PI },
  { id: "cubert", title: "Cubert", identifier: "cubyz:cubert", glb: "/models-official/cubert.glb?v=20261004-1", texture: "/models-official/cubert.png", rotateX: false, rotationOffsetY: 0 },
];

function safeUrl(value, fallback) {
  if (!value || typeof value !== "string") return fallback;
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "data:") {
      return url.href;
    }
  } catch (_) {
    return fallback;
  }
  return fallback;
}

function formatModelDate(value) {
  if (!value) return "\u2014";
  const d = new Date(String(value).replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

let communityViewers = [];
let officialViewers = [];

// Does the loaded GLB scene already carry a texture of its own?
function glbHasTexture(model) {
  let has = false;
  model.traverse((child) => {
    if (has || !child.isMesh) return;
    const mat = child.material;
    const mats = Array.isArray(mat) ? mat : [mat];
    if (mats.some((m) => m && m.map)) has = true;
  });
  return has;
}

function disposeViewers(list) {
  list.forEach((v) => {
    if (v.animId) cancelAnimationFrame(v.animId);
    if (v.renderer) {
      try {
        if (v.renderer.setAnimationLoop) v.renderer.setAnimationLoop(null);
      } catch (_) {}
      try {
        // Free the WebGL context eagerly - browsers only allow a handful.
        if (v.renderer.forceContextLoss) v.renderer.forceContextLoss();
      } catch (_) {}
      v.renderer.dispose();
      if (v.renderer.domElement && v.renderer.domElement.parentNode) {
        v.renderer.domElement.parentNode.removeChild(v.renderer.domElement);
      }
    }
    if (v.scene) {
      v.scene.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }
  });
}

function stopCommunityViewers() {
  disposeViewers(communityViewers);
  communityViewers = [];
}

function initThreeViewer(containerId, glbPath, texturePath, shouldRotateX, rotationOffsetY = 0, group = communityViewers, keepEmbeddedTexture = false) {
  const container = document.getElementById(containerId);
  if (!container || !window.THREE) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 0.2, 3.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  const viewerRecord = { animId: null, renderer, scene };
  group.push(viewerRecord);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight.position.set(5, 10, 7.5);
  scene.add(dirLight);

  const loader = new THREE.GLTFLoader();
  loader.load(encodeURI(glbPath), (gltf) => {
    const model = gltf.scene;
    // rotateX models are Z-up: their "turn" axis is local Z, so the yaw offset
    // must go on Z too (putting it on Y tilts them upside down).
    if (shouldRotateX) {
      model.rotation.x = -Math.PI / 2;
      model.rotation.z = rotationOffsetY;
    } else {
      model.rotation.y = rotationOffsetY;
    }

    // Custom full models: keep the texture baked into the GLB when it has one,
    // otherwise fall back to the uploaded texture (some GLBs ship untextured).
    if (texturePath && !(keepEmbeddedTexture && glbHasTexture(model))) {
      new THREE.TextureLoader().load(encodeURI(texturePath), (texture) => {
        texture.flipY = false;
        if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        model.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              alphaTest: 0.5,
              side: THREE.DoubleSide,
            });
            child.material.needsUpdate = true;
          }
        });
      });
    }

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    scene.add(model);

    function animate() {
      viewerRecord.animId = requestAnimationFrame(animate);
      // A lost context (too many contexts / GPU reset) must not crash the page.
      const ctx = renderer.getContext && renderer.getContext();
      if (!ctx || (ctx.isContextLost && ctx.isContextLost())) return;
      if (shouldRotateX) model.rotation.z += 0.004;
      else model.rotation.y += 0.004;
      try {
        renderer.render(scene, camera);
      } catch (_) {}
    }
    animate();
  });
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function voteIconHtml(count) {
  return `
  <span class="like-icon" aria-hidden="true">
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
  <path d="M12 21s-6.7-4.35-9.3-8.1C1 10.1 1.8 6.6 4.9 5.2c2.2-1 4.4-.2 5.6 1.4a1 1 0 0 0 1.6 0c1.2-1.6 3.4-2.4 5.6-1.4 3.1 1.4 3.9 4.9 2.2 7.7C18.7 16.65 12 21 12 21Z"></path>
  </svg>
  </span>
  ${count ?? 0}
  `;
}

let modalViewer = null;

function disposeModalViewer() {
  if (!modalViewer) return;
  disposeViewers([modalViewer]);
  modalViewer = null;
}

function initInteractiveViewer(containerId, glbPath, texturePath, shouldRotateX, rotationOffsetY = 0, keepEmbeddedTexture = false) {
  const container = document.getElementById(containerId);
  if (!container || !window.THREE) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  let distance = 3.5;
  camera.position.set(0, 0.2, distance);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  modalViewer = { animId: null, renderer, scene };

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight.position.set(5, 10, 7.5);
  scene.add(dirLight);

  let yaw = rotationOffsetY;
  let pitch = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pivot = new THREE.Group();
  scene.add(pivot);

  renderer.domElement.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.008;
    pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - lastY) * 0.008));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      distance = Math.max(1.2, Math.min(8, distance + e.deltaY * 0.003));
    },
    { passive: false }
  );

  const loader = new THREE.GLTFLoader();
  loader.load(encodeURI(glbPath), (gltf) => {
    const model = gltf.scene;
    if (shouldRotateX) model.rotation.x = -Math.PI / 2;

    if (texturePath && !(keepEmbeddedTexture && glbHasTexture(model))) {
      new THREE.TextureLoader().load(encodeURI(texturePath), (texture) => {
        texture.flipY = false;
        if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        model.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              alphaTest: 0.5,
              side: THREE.DoubleSide,
            });
            child.material.needsUpdate = true;
          }
        });
      });
    }

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    pivot.add(model);

    function animate() {
      modalViewer.animId = requestAnimationFrame(animate);
      const ctx = renderer.getContext && renderer.getContext();
      if (!ctx || (ctx.isContextLost && ctx.isContextLost())) return;
      pivot.rotation.y = yaw;
      pivot.rotation.x = pitch;
      camera.position.set(0, 0.2, distance);
      camera.lookAt(0, 0, 0);
      try {
        renderer.render(scene, camera);
      } catch (_) {}
    }
    animate();
  });
}

function openModelModal(model, { glbPath, rotationFlag, offsetY, keepsEmbeddedTexture = false }) {
  const overlay = document.getElementById("modelViewerModal");
  document.getElementById("modelViewerTitle").textContent = model.title;
  document.getElementById("modelViewerSubtitle").textContent =
    model.asset_type === "skin_only"
      ? `Skin for ${OFFICIAL_MODELS.find((m) => m.identifier === model.associated_model)?.title || "Unknown"}`
      : "Custom model";
  const descEl = document.getElementById("modelViewerDescription");
  descEl.textContent = model.description || "No description provided.";
  descEl.classList.toggle("is-empty", !model.description);

  document.getElementById("modelViewerAdded").textContent = formatModelDate(model.created_at);

  const coordsLabel =
    model.coordinate_system === "right_handed_z_up" ? "Z up"
      : model.coordinate_system === "left_handed_y_up" || model.coordinate_system === "right_handed_y_up" ? "Y up"
        : "—";
  const coordsEl = document.getElementById("modelViewerCoords");
  if (coordsEl) {
    coordsEl.textContent = coordsLabel;
    coordsEl.title = model.coordinate_system || "";
  }

  const authorLink = document.getElementById("modelViewerAuthor");
  authorLink.textContent = model.username;
  authorLink.href = `/profile/${encodeURIComponent(model.username)}`;

  const voteBtn = document.getElementById("modelViewerVoteBtn");
  const voteCount = document.getElementById("modelViewerVoteCount");
  voteCount.textContent = model.votes || 0;
  voteBtn.disabled = false;
  voteBtn.onclick = async () => {
    try {
      const res = await fetch(`/api/models/${model.id}/vote`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error || "Failed to vote.");
        return;
      }
      voteCount.textContent = data.votes;
      voteBtn.classList.add("liked");
      voteBtn.disabled = true;
    } catch (err) {
      console.error("Vote failed:", err);
      toast.error("Failed to vote.");
    }
  };

  const meshLink = document.getElementById("modelViewerMeshLink");
  if (glbPath) {
    meshLink.href = encodeURI(glbPath);
    meshLink.download = `${model.title}.glb`;
    meshLink.classList.remove("hidden");
  } else {
    meshLink.classList.add("hidden");
  }

  const textureLink = document.getElementById("modelViewerTextureLink");
  textureLink.href = encodeURI(model.texture_path);
  textureLink.download = `${model.title}.png`;

  // Owners can delete straight from the viewer (the dashboard's Models tab is
  // easy to miss, and deletion is otherwise only available there).
  const deleteBtn = document.getElementById("modelViewerDeleteBtn");
  if (deleteBtn) {
    const isOwner = currentUsername && model.username === currentUsername;
    deleteBtn.classList.toggle("hidden", !isOwner);
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete "${model.title}"? This can't be undone.`)) return;
      deleteBtn.disabled = true;
      try {
        const res = await fetch(`/api/models/${model.id}`, { method: "DELETE", credentials: "include" });
        const data = await res.json();
        if (!data.ok) {
          deleteBtn.disabled = false;
          toast.error(data.error || "Failed to delete.");
          return;
        }
        closeModelModal();
        await loadModels();
        toast.success("Model deleted.");
      } catch (err) {
        console.error("Delete model failed:", err);
        deleteBtn.disabled = false;
        toast.error("Failed to delete.");
      }
    };
  }

  const remixBtn = document.getElementById("modelViewerRemixBtn");
  remixBtn.href = `/uploadmodel.html?remixOf=${encodeURIComponent(model.id)}`;
  remixBtn.classList.remove("hidden");
  remixBtn.onclick = (e) => {
    e.preventDefault();
    chooseRemix(model.id);
  };

  loadRemixes(model.id);

  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    initInteractiveViewer("modelViewerCanvas", glbPath, model.texture_path, rotationFlag, offsetY, keepsEmbeddedTexture);
  });
}

const remixesSection = document.getElementById("modelViewerRemixesSection");
const remixesStrip = document.getElementById("modelViewerRemixesStrip");

async function chooseRemix(modelId) {
  const go = (url) => { window.location.href = url; };
  if (!currentUsername) {
    go(`/uploadmodel.html?remixOf=${encodeURIComponent(modelId)}`);
    return;
  }

  let mine = null;
  try {
    const res = await fetch(`/api/models/${modelId}/remixes`);
    const data = await res.json();
    if (data.ok && Array.isArray(data.models)) {
      mine = data.models.find((m) => String(m.username).toLowerCase() === currentUsername.toLowerCase());
    }
  } catch (err) {
    console.error("Failed to check for an existing remix:", err);
  }

  if (!mine) {
    go(`/uploadmodel.html?remixOf=${encodeURIComponent(modelId)}`);
    return;
  }

  const editExisting = window.confirm(
    "You already have a remix of this model.\n\nOK - Edit your existing remix\nCancel - Choose to create another"
  );
  if (editExisting) {
    go(`/uploadmodel.html?edit=${encodeURIComponent(mine.id)}`);
    return;
  }
  if (window.confirm("Create another remix instead?")) {
    go(`/uploadmodel.html?remixOf=${encodeURIComponent(modelId)}`);
  }
}

const remixesLabel = remixesSection ? remixesSection.querySelector(".model-viewer-remixes-label") : null;

function setRemixesEmpty(message) {
  remixesSection.classList.remove("hidden");
  remixesStrip.innerHTML = "";
  if (remixesLabel) remixesLabel.textContent = "Remixes";
  const empty = document.createElement("p");
  empty.className = "model-viewer-remixes-empty";
  empty.textContent = message;
  remixesStrip.appendChild(empty);
}

async function loadRemixes(modelId) {
  remixesSection.classList.remove("hidden");
  remixesStrip.innerHTML = "";
  if (remixesLabel) remixesLabel.textContent = "Remixes";
  try {
    const res = await fetch(`/api/models/${modelId}/remixes`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.models) || data.models.length === 0) {
      setRemixesEmpty("No remixes yet \u2014 be the first to make one.");
      return;
    }

    if (remixesLabel) remixesLabel.textContent = `Remixes (${data.models.length})`;

    data.models.forEach((remix) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "model-remix-thumb";
      thumb.title = remix.title;

      const img = document.createElement("img");
      img.src = safeUrl(remix.texture_path, "");
      img.alt = remix.title;
      thumb.appendChild(img);

      const label = document.createElement("span");
      label.textContent = remix.title;
      thumb.appendChild(label);

      thumb.addEventListener("click", () => openRemixModel(remix.id));
      remixesStrip.appendChild(thumb);
    });
  } catch (err) {
    console.error("Failed to load remixes:", err);
    setRemixesEmpty("Couldn't load remixes.");
  }
}

async function openRemixModel(modelId) {
  try {
    const res = await fetch(`/api/models/${modelId}`);
    const data = await res.json();
    if (!data.ok) return;

    const model = data.model;
    let glbPath = model.glb_path;
    let rotationFlag = false;
    let offsetY = 0;
    let keepsEmbeddedTexture = false;
    if (model.asset_type === "skin_only") {
      const baseMatch = OFFICIAL_MODELS.find((m) => m.identifier === model.associated_model) || OFFICIAL_MODELS[0];
      glbPath = baseMatch.glb;
      rotationFlag = baseMatch.rotateX;
      offsetY = baseMatch.rotationOffsetY;
    } else {
      keepsEmbeddedTexture = true;
    }
    disposeModalViewer();
    document.getElementById("modelViewerCanvas").innerHTML = "";
    openModelModal(model, { glbPath, rotationFlag, offsetY, keepsEmbeddedTexture });
  } catch (err) {
    console.error("Failed to open remix model:", err);
    if (typeof window.toast === "function") window.toast.error("Could not open that model.");
  }
}

function closeModelModal() {
  const overlay = document.getElementById("modelViewerModal");
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  disposeModalViewer();
  document.getElementById("modelViewerCanvas").innerHTML = "";
}

document.getElementById("modelViewerClose").addEventListener("click", closeModelModal);
document.getElementById("modelViewerModal").addEventListener("click", (e) => {
  if (e.target.id === "modelViewerModal") closeModelModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModelModal();
});

const DOM = {
  officialGrid: document.getElementById("model-official-grid"),
  container: document.getElementById("model-container"),
  emptyState: document.getElementById("model-empty-state"),
  search: document.getElementById("modelSearchBar"),
  sort: document.getElementById("modelSortSelect"),
  type: document.getElementById("modelTypeSelect"),
  pagination: document.getElementById("model-pagination"),
};

let currentUsername = null;
let currentPage = 1;
let totalPages = 1;

async function loadCurrentUser() {
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();
    if (data.ok && data.user) currentUsername = data.user.username;
  } catch (_) {}
}

function renderOfficialGrid() {
  DOM.officialGrid.innerHTML = "";
  OFFICIAL_MODELS.forEach((model, idx) => {
    const card = document.createElement("a");
    card.className = "model-card model-card-clickable";
    card.href = `/uploadmodel.html?base=${encodeURIComponent(model.id)}`;
    card.title = `Paint your own version of ${model.title}`;
    card.innerHTML = `
      <div class="model-card-header">
        <span>${escapeHTML(model.title)}</span>
        <span class="model-card-paint-hint">Paint</span>
      </div>
      <div class="model-canvas-container" id="canvas-official-${idx}"></div>
    `;
    DOM.officialGrid.appendChild(card);
  });
  requestAnimationFrame(() => {
    OFFICIAL_MODELS.forEach((model, idx) => {
      initThreeViewer(`canvas-official-${idx}`, model.glb, model.texture, model.rotateX, model.rotationOffsetY, officialViewers);
    });
  });
}

function renderModelCard(model, index) {
  const card = document.createElement("div");
  card.className = "model-card";

  let glbPath = model.glb_path;
  let rotationFlag = false;
  let offsetY = 0;
  let keepsEmbeddedTexture = false;
  let subtitleHTML = "";

  if (model.asset_type === "skin_only") {
    const baseMatch = OFFICIAL_MODELS.find((m) => m.identifier === model.associated_model) || OFFICIAL_MODELS[0];
    glbPath = baseMatch.glb;
    rotationFlag = baseMatch.rotateX;
    offsetY = baseMatch.rotationOffsetY;
    subtitleHTML = `<span class="model-card-subtitle">Skin for ${escapeHTML(baseMatch.title)}</span>`;
  } else {
    // Custom full models carry their own texture inside the .glb.
    keepsEmbeddedTexture = true;
    subtitleHTML = `<span class="model-card-subtitle model-card-subtitle-custom">Custom model</span>`;
  }

  const coordLabel =
    model.coordinate_system === "right_handed_z_up" ? "Z up"
      : model.coordinate_system === "left_handed_y_up" || model.coordinate_system === "right_handed_y_up" ? "Y up"
        : "";
  const coordChip = coordLabel
    ? `<span class="model-coord-chip" title="${escapeHTML(model.coordinate_system || "")}">${coordLabel}</span>`
    : "";

  card.innerHTML = `
    <div class="model-card-header model-card-header-stacked">
      <div class="model-card-title-row">
        <span class="model-card-title">${escapeHTML(model.title)}</span>
        ${coordChip}
      </div>
      ${subtitleHTML}
    </div>
    <div class="model-canvas-container" id="canvas-community-${index}"></div>
    <div class="model-card-footer">
      <div class="model-meta-line">
        <span>By <a class="model-author-link" href="/profile/${encodeURIComponent(model.username)}">${escapeHTML(model.username)}</a></span>
        <button type="button" class="title-likes like-btn model-vote-btn" data-model-id="${model.id}">
          ${voteIconHtml(model.votes)}
        </button>
      </div>
    </div>
  `;

  card.querySelector(".model-vote-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    const voteBtn = card.querySelector(".model-vote-btn");
    try {
      const res = await fetch(`/api/models/${model.id}/vote`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error || "Failed to vote.");
        return;
      }
      voteBtn.innerHTML = voteIconHtml(data.votes);
      voteBtn.classList.add("liked");
      voteBtn.disabled = true;
    } catch (err) {
      console.error("Vote failed:", err);
      toast.error("Failed to vote.");
    }
  });

  card.querySelector(".model-author-link").addEventListener("click", (e) => e.stopPropagation());

  card.addEventListener("click", () => openModelModal(model, { glbPath, rotationFlag, offsetY, keepsEmbeddedTexture }));

  DOM.container.appendChild(card);
  if (glbPath) {
    initThreeViewer(`canvas-community-${index}`, glbPath, model.texture_path, rotationFlag, offsetY, communityViewers, keepsEmbeddedTexture);
  }
}

async function loadModels() {
  try {
    const params = new URLSearchParams();
    params.set("page", String(currentPage));
    if (DOM.search.value.trim()) params.set("search", DOM.search.value.trim());
    if (DOM.sort.value) params.set("sort", DOM.sort.value);
    if (DOM.type.value) params.set("type", DOM.type.value);

    const res = await fetch(`/api/models?${params.toString()}`);
    const data = await res.json();
    if (!data.ok) return;

    currentPage = data.page || 1;
    totalPages = data.totalPages || 1;

    // Dispose the previous page's WebGL contexts before mounting the new ones
    // (keeps the live total at 5 official + MODEL_PAGE_SIZE community).
    stopCommunityViewers();
    DOM.container.innerHTML = "";
    const countEl = document.getElementById("modelCount");
    if (countEl) countEl.textContent = `${data.total ?? data.models.length}`;
    renderPagination();
    if (!data.models.length) {
      DOM.emptyState.style.display = "";
      return;
    }
    DOM.emptyState.style.display = "none";
    data.models.forEach((model, index) => renderModelCard(model, index));
  } catch (err) {
    console.error("Failed to load models:", err);
  }
}

function renderPagination() {
  const el = DOM.pagination;
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }
  el.hidden = false;

  const pageBtn = (page, label, opts = {}) =>
    `<button type="button" class="page-btn${page === currentPage ? " active" : ""}" data-page="${page}" ${opts.disabled ? "disabled" : ""}>${label}</button>`;

  const parts = [pageBtn(currentPage - 1, "‹ Prev", { disabled: currentPage <= 1 })];
  const nums = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  let prev = null;
  for (let p = 1; p <= totalPages; p++) {
    if (!nums.has(p)) continue;
    if (prev !== null && p - prev > 1) parts.push('<span class="page-ellipsis">…</span>');
    parts.push(pageBtn(p, String(p)));
    prev = p;
  }
  parts.push(pageBtn(currentPage + 1, "Next ›", { disabled: currentPage >= totalPages }));
  el.innerHTML = parts.join("");
}

if (DOM.pagination) {
  DOM.pagination.addEventListener("click", (e) => {
    const btn = e.target.closest(".page-btn");
    if (!btn || btn.disabled) return;
    const page = parseInt(btn.dataset.page, 10);
    if (!page || page < 1 || page > totalPages || page === currentPage) return;
    currentPage = page;
    loadModels();
    DOM.container.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

let searchDebounce;
DOM.search.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentPage = 1;
    loadModels();
  }, 250);
});
DOM.sort.addEventListener("change", () => {
  currentPage = 1;
  loadModels();
});
DOM.type.addEventListener("change", () => {
  currentPage = 1;
  loadModels();
});

enhanceSelect(DOM.sort);
enhanceSelect(DOM.type);

(async function init() {
  await loadCurrentUser();
  renderOfficialGrid();
  await loadModels();

  const deepLinkModelId = new URLSearchParams(window.location.search).get("model");
  if (deepLinkModelId) {
    openRemixModel(deepLinkModelId);
  }
})();
