
import { enhanceSelect } from './custom-select.js?v=20260919-17';

function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

function parseServerDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(" ", "T") + "Z");
  }
  return new Date(value);
}

const urlParams = new URLSearchParams(window.location.search);
let serverId = urlParams.get("id");
const isNewMode = urlParams.get("new") === "1" && !serverId;

const DOM = {
  notFound: document.getElementById("serverNotFound"),
  detail: document.getElementById("serverDetail"),
  icon: document.getElementById("serverIcon"),
  iconDropzone: document.getElementById("serverIconDropzone"),
  iconHint: document.getElementById("serverIconHint"),
  name: document.getElementById("serverName"),
  headerIp: document.getElementById("serverHeaderIp"),
  ownerLink: document.getElementById("serverOwnerLink"),
  draftBadge: document.getElementById("serverDraftBadge"),
  statusBadge: document.getElementById("serverStatusBadge"),
  likeBtn: document.getElementById("serverLikeBtn"),
  likeCount: document.getElementById("serverLikeCount"),
  ip: document.getElementById("serverIp"),
  copyIpBtn: document.getElementById("serverCopyIpBtn"),
  versionValue: document.getElementById("serverVersionValue"),
  gamemodesValue: document.getElementById("serverGamemodesValue"),
  languagesValue: document.getElementById("serverLanguagesValue"),
  modsRow: document.getElementById("serverModsRow"),
  modsValue: document.getElementById("serverModsValue"),
  connectionValue: document.getElementById("serverConnectionValue"),
  websiteRow: document.getElementById("serverWebsiteRow"),
  websiteLink: document.getElementById("serverWebsiteLink"),
  discordRow: document.getElementById("serverDiscordRow"),
  discordLink: document.getElementById("serverDiscordLink"),
  description: document.getElementById("serverDescription"),
  longDescription: document.getElementById("serverLongDescription"),
  apiTokenRow: document.getElementById("serverApiTokenRow"),
  fieldError: document.getElementById("serverFieldError"),
  apiTokenBtn: document.getElementById("apiTokenBtn"),
  apiTokenModal: document.getElementById("apiTokenModal"),
  apiTokenCloseBtn: document.getElementById("apiTokenCloseBtn"),
  createTokenBtn: document.getElementById("createTokenBtn"),
  tokenReveal: document.getElementById("tokenReveal"),
  tokenRevealValue: document.getElementById("tokenRevealValue"),
  tokenRevealHint: document.getElementById("tokenRevealHint"),
  copyTokenBtn: document.getElementById("copyTokenBtn"),
  tokenList: document.getElementById("tokenList"),
};

let currentUser = null;
let currentServer = null;
let isOwnerView = false;

const GAMEMODE_OPTIONS = ["Survival", "Creative", "Hardcore", "PvP", "PvE", "Roleplay", "Minigames", "Economy"];

const CONNECTION_METHOD_OPTIONS = [
  { value: "Cubbie" },
  { value: "Not connected" },
];

const LANGUAGE_OPTIONS = ["English", "German", "French", "Spanish", "Portuguese", "Russian", "Polish", "Dutch"];

let selectedGamemodes = new Set();
let selectedConnectionMethod = "";

function renderChipsInto(containerId, options, isActive, onToggle) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  options.forEach((opt) => {
    const value = typeof opt === "string" ? opt : opt.value;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "server-chip" + (isActive(value) ? " active" : "");
    chip.textContent = value;
    chip.addEventListener("click", () => onToggle(value));
    container.appendChild(chip);
  });
}


function renderGamemodeChips() {
  renderChipsInto("editGamemodesChips", GAMEMODE_OPTIONS, (m) => selectedGamemodes.has(m), (m) => {
    if (selectedGamemodes.has(m)) selectedGamemodes.delete(m);
    else selectedGamemodes.add(m);
    renderGamemodeChips();
    const val = Array.from(selectedGamemodes).join(", ");
    updateServerField({ gamemodes: val }, () => {
      currentServer.gamemodes = val;
      renderGamemodesBadge();
    });
  });
}

function renderConnectionMethodChips() {
  renderChipsInto("editConnectionMethodChips", CONNECTION_METHOD_OPTIONS, (v) => selectedConnectionMethod === v, (v) => {
    selectedConnectionMethod = v;
    renderConnectionMethodChips();
    toggleCubbiePanel();
    updateServerField({ connection_method: v }, () => {
      currentServer.connection_method = v;
      renderConnectionBadge();
    });
  });
  toggleCubbiePanel();
}

function toggleCubbiePanel() {
  const panel = document.getElementById("cubbiePanel");
  if (panel) panel.classList.toggle("hidden", selectedConnectionMethod !== "Cubbie");
}

let createSelectedGamemodes = new Set();
let createSelectedConnectionMethod = "";

function renderCreateGamemodeChips() {
  renderChipsInto("createGamemodesChips", GAMEMODE_OPTIONS, (m) => createSelectedGamemodes.has(m), (m) => {
    if (createSelectedGamemodes.has(m)) createSelectedGamemodes.delete(m);
    else createSelectedGamemodes.add(m);
    renderCreateGamemodeChips();
  });
}

function renderCreateConnectionMethodChips() {
  renderChipsInto("createConnectionMethodChips", CONNECTION_METHOD_OPTIONS, (v) => createSelectedConnectionMethod === v, (v) => {
    createSelectedConnectionMethod = v;
    renderCreateConnectionMethodChips();
  });
}

const CUBBIE_BUILDS = [
  { id: "win", label: "Windows", file: "cubbie-win-x64.exe" },
  { id: "mac-arm", label: "macOS (Apple Silicon)", file: "cubbie-macos-arm64" },
  { id: "mac-intel", label: "macOS (Intel)", file: "cubbie-macos-x64" },
  { id: "linux", label: "Linux", file: "cubbie-linux" },
];

function detectCubbiePlatform() {
  const ua = navigator.userAgent || "";
  if (/Windows/i.test(ua)) return "win";
  if (/Mac OS X/i.test(ua)) {
    return /ARM|arm64/i.test(ua) ? "mac-arm" : "mac-intel";
  }
  return "linux";
}

function setupCubbieDownload() {
  const btn = document.getElementById("cubbieDownloadBtn");
  const otherPlatforms = document.getElementById("cubbieOtherPlatforms");
  if (!btn || !otherPlatforms) return;

  const detected = detectCubbiePlatform();
  const primary = CUBBIE_BUILDS.find((b) => b.id === detected) || CUBBIE_BUILDS[3];
  btn.href = `/downloads/cubbie/${primary.file}`;
  btn.textContent = `Download Cubbie for ${primary.label}`;

  const others = CUBBIE_BUILDS.filter((b) => b.id !== primary.id);
  otherPlatforms.innerHTML = "Other platforms: ";
  others.forEach((b, i) => {
    const a = document.createElement("a");
    a.href = `/downloads/cubbie/${b.file}`;
    a.textContent = b.label;
    a.setAttribute("download", "");
    otherPlatforms.appendChild(a);
    if (i < others.length - 1) otherPlatforms.appendChild(document.createTextNode(" · "));
  });
}

let gameVersionsCache = null;
async function fetchGameVersions() {
  if (gameVersionsCache) return gameVersionsCache;
  try {
    const res = await fetch("/api/game/versions");
    const data = await res.json();
    gameVersionsCache = data.ok && Array.isArray(data.versions) ? data.versions : [];
  } catch (_) {
    gameVersionsCache = [];
  }
  return gameVersionsCache;
}

async function populateVersionAndLanguageSelect(versionSelect, languageSelect) {
  const versions = await fetchGameVersions();
  versionSelect.innerHTML = '<option value="">Any version</option>' +
    versions.map((v) => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("");

  languageSelect.innerHTML = '<option value="">Any language</option>' +
    LANGUAGE_OPTIONS.map((l) => `<option value="${escapeHTML(l)}">${escapeHTML(l)}</option>`).join("");

  enhanceSelect(versionSelect);
  enhanceSelect(languageSelect);
}

function setupIconDropzone() {
  const dropzone = DOM.iconDropzone;
  const input = document.getElementById("editIcon");

  input.addEventListener("change", () => {
    if (!isOwnerView) return;
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    DOM.icon.src = url;
    const fd = new FormData();
    fd.set("icon", file);
    updateServerField(fd, (data) => { DOM.icon.src = data.server.icon_url; });
  });

  ["dragover", "dragenter"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      if (!isOwnerView) return;
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, () => dropzone.classList.remove("dragover"))
  );
  dropzone.addEventListener("drop", (e) => {
    if (!isOwnerView) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event("change"));
    }
  });
  dropzone.addEventListener("click", (e) => {
    if (!isOwnerView) e.preventDefault();
  });
}

async function loadCurrentUser() {
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();
    if (data.ok && data.user) currentUser = data.user;
  } catch (_) {}
}

function setFieldError(message) {
  if (!message) {
    DOM.fieldError.textContent = "";
    DOM.fieldError.classList.add("hidden");
    return;
  }
  DOM.fieldError.textContent = message;
  DOM.fieldError.classList.remove("hidden");
}

async function updateServerField(fields, onSuccess) {
  if (!serverId) return;
  setFieldError(null);
  const fd = fields instanceof FormData ? fields : new FormData();
  if (!(fields instanceof FormData)) {
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  }
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}/update`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      currentServer = data.server;
      if (onSuccess) onSuccess(data);
    } else {
      console.error("Field update failed:", data);
      setFieldError(data.error || "Update failed.");
    }
  } catch (err) {
    console.error("Field update error:", err);
    setFieldError("Update failed.");
  }
}

function makeEditable(el, { value, placeholder, maxLength, multiline, onCommit }) {
  el.addEventListener("click", () => {
    if (!isOwnerView) return;
    if (el.querySelector("input, textarea")) return;
    const current = value();
    const input = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) input.type = "text";
    else input.rows = 6;
    input.className = "inline-edit-input";
    input.value = current || "";
    if (placeholder) input.placeholder = placeholder;
    if (maxLength) input.maxLength = maxLength;
    el.textContent = "";
    el.appendChild(input);
    input.focus();
    if (!multiline) input.select();

    if (multiline) {
      const autoGrow = () => {
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
      };
      autoGrow();
      input.addEventListener("input", autoGrow);
    }

    let finished = false;
    function finish(commit) {
      if (finished) return;
      finished = true;
      const val = input.value.trim();
      if (commit) onCommit(val);
      else onCommit(current);
    }
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !multiline) { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); input.blur(); }
    });
  });
}

function renderLongDescription(el, text, shortDescEmpty) {
  if (text) {
    if (window.ForumMarkdown) {
      el.innerHTML = window.ForumMarkdown.render(text);
    } else {
      const html = marked.parse(text);
      el.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ["img"], ADD_ATTR: ["src", "alt", "title"] });
    }
    if (window.ForumGallery) window.ForumGallery.enhance(el);
    el.classList.remove("hidden");
  } else if (isOwnerView) {
    el.innerHTML = '<span class="server-longdesc-placeholder">Click to add a detailed description (Markdown supported)…</span>';
    el.classList.remove("hidden");
  } else if (shortDescEmpty) {
    el.innerHTML = '<span class="server-longdesc-placeholder">No description provided.</span>';
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderGamemodesBadge() {
  if (currentServer.gamemodes) {
    DOM.gamemodesValue.textContent = currentServer.gamemodes;
  } else if (isOwnerView) {
    DOM.gamemodesValue.textContent = "Click to set";
  } else {
    DOM.gamemodesValue.closest(".server-detail-row").classList.add("hidden");
    return;
  }
  DOM.gamemodesValue.closest(".server-detail-row").classList.remove("hidden");
}

function renderLanguagesBadge() {
  if (currentServer.languages) {
    DOM.languagesValue.textContent = currentServer.languages;
  } else if (isOwnerView) {
    DOM.languagesValue.textContent = "Click to set";
  } else {
    DOM.languagesValue.closest(".server-detail-row").classList.add("hidden");
    return;
  }
  DOM.languagesValue.closest(".server-detail-row").classList.remove("hidden");
}

function renderVersionBadge() {
  if (currentServer.version) {
    DOM.versionValue.textContent = currentServer.version;
  } else if (isOwnerView) {
    DOM.versionValue.textContent = "Click to set";
  } else {
    DOM.versionValue.closest(".server-detail-row").classList.add("hidden");
    return;
  }
  DOM.versionValue.closest(".server-detail-row").classList.remove("hidden");
}

function renderConnectionBadge() {
  const method = currentServer.connection_method;
  if (method) {
    DOM.connectionValue.textContent = method;
  } else if (isOwnerView) {
    DOM.connectionValue.textContent = "Click to set";
  } else {
    DOM.connectionValue.closest(".server-detail-row").classList.add("hidden");
    return;
  }
  DOM.connectionValue.closest(".server-detail-row").classList.remove("hidden");
}

function renderServer(server) {
  currentServer = server;
  isOwnerView = !!(currentUser && currentUser.id === server.owner_id);
  DOM.icon.src = server.icon_url || "assets/default_icon.png";
  DOM.name.textContent = server.name;
  DOM.ownerLink.textContent = server.owner_username;
  DOM.ownerLink.href = `/profile/${encodeURIComponent(server.owner_username)}`;

  DOM.draftBadge.classList.toggle("hidden", server.status !== "draft");

  const isOnline = !!server.online;
  DOM.statusBadge.textContent = isOnline ? `Online - ${server.player_count ?? 0} players` : "Offline";
  DOM.statusBadge.classList.toggle("server-status-online", isOnline);
  DOM.statusBadge.classList.toggle("server-status-offline", !isOnline);

  renderVersionBadge();
  renderGamemodesBadge();
  renderLanguagesBadge();
  renderConnectionBadge();

  DOM.modsRow.classList.toggle("hidden", !server.requires_mods);
  if (server.requires_mods) DOM.modsValue.textContent = "Yes";

  if (server.ip) {
    DOM.ip.textContent = server.ip;
    DOM.headerIp.textContent = server.ip;
    DOM.headerIp.classList.remove("hidden");
  } else if (isOwnerView) {
    DOM.ip.textContent = "Click to set";
    DOM.headerIp.classList.add("hidden");
  } else {
    DOM.ip.textContent = "";
    DOM.headerIp.classList.add("hidden");
  }

  if (server.website_url) {
    DOM.websiteLink.href = server.website_url;
    DOM.websiteRow.classList.remove("hidden");
  } else {
    DOM.websiteRow.classList.add("hidden");
  }
  if (server.chat_url) {
    DOM.discordLink.href = server.chat_url;
    DOM.discordRow.classList.remove("hidden");
  } else {
    DOM.discordRow.classList.add("hidden");
  }

  const onlinePlayers = server.online && Array.isArray(server.player_names) ? server.player_names : [];
  const onlinePlayersBox = document.getElementById("serverOnlinePlayersBox");
  const onlinePlayersList = document.getElementById("serverOnlinePlayersList");
  onlinePlayersList.innerHTML = "";
  if (onlinePlayers.length) {
    onlinePlayers.forEach((name) => {
      const row = document.createElement("span");
      row.className = "server-detail-players-row";
      row.textContent = name;
      onlinePlayersList.appendChild(row);
    });
    onlinePlayersBox.classList.remove("hidden");
  } else {
    onlinePlayersBox.classList.add("hidden");
  }

  const requiredMods = server.required_mods || [];
  const modsBox = document.getElementById("serverRequiredModsBox");
  const modsList = document.getElementById("serverRequiredModsList");
  modsList.innerHTML = "";
  if (requiredMods.length) {
    requiredMods.forEach((mod) => {
      const a = document.createElement("a");
      a.className = "server-chip active";
      a.href = `/addon.html?id=${encodeURIComponent(mod.id)}`;
      a.textContent = mod.name;
      modsList.appendChild(a);
    });
    modsBox.classList.remove("hidden");
  } else {
    modsBox.classList.add("hidden");
  }

  if (server.description) {
    DOM.description.textContent = server.description;
    DOM.description.classList.remove("hidden");
  } else if (isOwnerView) {
    DOM.description.innerHTML = '<span class="server-shortdesc-placeholder">Click to add a short description…</span>';
    DOM.description.classList.remove("hidden");
  } else {
    DOM.description.textContent = "";
    DOM.description.classList.add("hidden");
  }

  renderLongDescription(DOM.longDescription, server.long_description || "", !server.description);

  DOM.likeCount.textContent = server.likes ?? 0;
  DOM.likeBtn.classList.toggle("liked", !!server.liked_by_viewer);

  document.title = `${server.name} - Cubyz Hub`;

  DOM.apiTokenRow.classList.toggle("hidden", !isOwnerView);
  if (isOwnerView) {
    setupOwnerFieldEditing();
  }
}

let ownerFieldEditingWired = false;
async function setupOwnerFieldEditing() {
  DOM.iconHint.classList.remove("hidden");
  DOM.iconDropzone.title = "Click to change icon";
  DOM.ip.title = "Click to edit IP / connect address";
  DOM.description.title = "Click to edit short description";
  DOM.longDescription.title = "Click to edit long description";
  DOM.name.title = "Click to edit name";
  [DOM.name, DOM.description, DOM.longDescription, DOM.ip].forEach((el) => {
    el.classList.add("editable-text");
  });
  [DOM.versionValue, DOM.gamemodesValue, DOM.languagesValue, DOM.connectionValue].forEach((el) => {
    el.classList.add("editable-hint");
  });

  selectedGamemodes = new Set(
    (currentServer.gamemodes || "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  selectedConnectionMethod = currentServer.connection_method || "";

  if (ownerFieldEditingWired) {
    renderGamemodeChips();
    renderConnectionMethodChips();
    return;
  }
  ownerFieldEditingWired = true;

  makeEditable(DOM.name, {
    value: () => currentServer.name,
    maxLength: 60,
    onCommit: (val) => {
      const finalVal = val || currentServer.name;
      DOM.name.textContent = finalVal;
      if (val && val !== currentServer.name) {
        updateServerField({ name: val }, () => { document.title = `${val} - Cubyz Hub`; });
      }
    },
  });

  makeEditable(DOM.description, {
    value: () => currentServer.description || "",
    placeholder: "Short description",
    maxLength: 300,
    onCommit: (val) => {
      if (val) DOM.description.textContent = val;
      else DOM.description.innerHTML = '<span class="server-shortdesc-placeholder">Click to add a short description…</span>';
      if (val !== (currentServer.description || "")) {
        updateServerField({ description: val });
      }
    },
  });

  attachMarkdownEditor(DOM.longDescription, {
    getValue: () => currentServer.long_description || "",
    placeholder: "Detailed description - Markdown supported",
    previewClass: "server-detail-longdesc",
    renderPreview: (el, val) => renderLongDescription(el, val, !currentServer.description),
    onSave: (val) => {
      renderLongDescription(DOM.longDescription, val, !currentServer.description);
      if (val !== (currentServer.long_description || "")) {
        updateServerField({ long_description: val }, () => { currentServer.long_description = val; });
      }
    },
  });

  makeEditable(DOM.ip, {
    value: () => currentServer.ip || "",
    placeholder: "IP / connect address",
    maxLength: 255,
    onCommit: (val) => {
      if (!val) {
        DOM.ip.textContent = currentServer.ip || "Click to set";
        return;
      }
      DOM.ip.textContent = val;
      DOM.headerIp.textContent = val;
      DOM.headerIp.classList.remove("hidden");
      if (val !== (currentServer.ip || "")) {
        updateServerField({ ip: val });
      }
    },
  });

  const versionSelect = document.getElementById("editVersion");
  const languageSelect = document.getElementById("editLanguages");
  await populateVersionAndLanguageSelect(versionSelect, languageSelect);
  versionSelect.value = currentServer.version || "";
  versionSelect.dispatchEvent(new Event("change"));
  languageSelect.value = currentServer.languages || "";
  languageSelect.dispatchEvent(new Event("change"));

  versionSelect.addEventListener("change", () => {
    const val = versionSelect.value;
    if (val === (currentServer.version || "")) return;
    updateServerField({ version: val }, () => {
      currentServer.version = val;
      renderVersionBadge();
    });
  });
  languageSelect.addEventListener("change", () => {
    const val = languageSelect.value;
    if (val === (currentServer.languages || "")) return;
    updateServerField({ languages: val }, () => {
      currentServer.languages = val;
      renderLanguagesBadge();
    });
  });

  DOM.versionValue.addEventListener("click", () => toggleEditRow("versionEditRow"));
  DOM.languagesValue.addEventListener("click", () => toggleEditRow("languagesEditRow"));

  renderGamemodeChips();
  DOM.gamemodesValue.addEventListener("click", () => toggleEditRow("gamemodesEditRow"));

  renderConnectionMethodChips();
  DOM.connectionValue.addEventListener("click", () => toggleEditRow("connectionEditRow"));
}


const EDIT_ROW_IDS = ["versionEditRow", "languagesEditRow", "gamemodesEditRow", "connectionEditRow"];

function toggleEditRow(id) {
  const row = document.getElementById(id);
  const wasHidden = row.classList.contains("hidden");
  EDIT_ROW_IDS.forEach((otherId) => document.getElementById(otherId).classList.add("hidden"));
  if (wasHidden) row.classList.remove("hidden");
}

document.addEventListener("click", (e) => {
  const valueIds = ["serverVersionValue", "serverLanguagesValue", "serverGamemodesValue", "serverConnectionValue"];
  EDIT_ROW_IDS.forEach((id, i) => {
    const row = document.getElementById(id);
    const value = document.getElementById(valueIds[i]);
    if (row && !row.classList.contains("hidden") && !row.contains(e.target) && value && !value.contains(e.target)) {
      row.classList.add("hidden");
    }
  });
});

async function loadServer() {
  if (!serverId) {
    DOM.notFound.classList.remove("hidden");
    return;
  }
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}`, { credentials: "include" });
    const data = await res.json();
    if (!data.ok || !data.server) {
      DOM.notFound.classList.remove("hidden");
      return;
    }
    DOM.detail.classList.remove("hidden");
    renderServer(data.server);
  } catch (err) {
    console.error("Failed to load server:", err);
    DOM.notFound.classList.remove("hidden");
  }
}


function setupCreateIconDropzone() {
  const dropzone = document.getElementById("createIconDropzone");
  const input = document.getElementById("createIcon");
  const preview = document.getElementById("createIconPreview");
  const hint = document.getElementById("createIconHint");

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.hidden = false;
    hint.classList.add("hidden");
  });

  ["dragover", "dragenter"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, () => dropzone.classList.remove("dragover"))
  );
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event("change"));
    }
  });
}

function setCreateFieldError(message) {
  const el = document.getElementById("createFieldError");
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

function enterCreateMode() {
  document.title = "List a server - Cubyz Hub";
  DOM.detail.classList.remove("hidden");
  document.querySelector(".server-detail-header").classList.add("hidden");
  document.querySelector(".server-detail-columns").classList.add("hidden");

  document.getElementById("serverCreateSection").classList.remove("hidden");

  setupCreateIconDropzone();
  populateVersionAndLanguageSelect(
    document.getElementById("createVersion"),
    document.getElementById("createLanguages")
  );
  createSelectedGamemodes = new Set();
  renderCreateGamemodeChips();
  createSelectedConnectionMethod = "";
  renderCreateConnectionMethodChips();

  document.getElementById("createSaveBtn").addEventListener("click", async () => {
    setCreateFieldError(null);
    const name = document.getElementById("createName").value.trim();
    const ip = document.getElementById("createIp").value.trim();
    if (!name) { setCreateFieldError("Server name is required."); return; }
    if (!ip) { setCreateFieldError("IP / connect address is required."); return; }

    const form = new FormData();
    form.set("name", name);
    form.set("ip", ip);
    form.set("description", document.getElementById("createDescription").value.trim());
    form.set("long_description", document.getElementById("createLongDescription").value.trim());
    form.set("version", document.getElementById("createVersion").value.trim());
    form.set("languages", document.getElementById("createLanguages").value.trim());
    form.set("gamemodes", Array.from(createSelectedGamemodes).join(", "));
    form.set("connection_method", createSelectedConnectionMethod);

    const iconFile = document.getElementById("createIcon").files[0];
    if (iconFile) form.set("icon", iconFile);

    const btn = document.getElementById("createSaveBtn");
    btn.disabled = true;
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json();
      if (!data.ok) {
        setCreateFieldError(data.error || "Failed to create server.");
        return;
      }
      window.location.href = `/server.html?id=${encodeURIComponent(data.server.id)}`;
    } catch (err) {
      console.error("Create failed:", err);
      setCreateFieldError("Failed to create server.");
    } finally {
      btn.disabled = false;
    }
  });
}

DOM.copyIpBtn.addEventListener("click", () => {
  navigator.clipboard?.writeText(DOM.ip.textContent).then(() => {
    DOM.copyIpBtn.textContent = "Copied!";
    setTimeout(() => { DOM.copyIpBtn.textContent = "Copy"; }, 1200);
  }).catch(() => {});
});

DOM.likeBtn.addEventListener("click", async () => {
  if (!currentUser) {
    toast.error("You must be logged in to like servers.");
    return;
  }
  if (!serverId) return;
  DOM.likeBtn.disabled = true;
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}/like`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return;
    DOM.likeCount.textContent = data.likes;
    DOM.likeBtn.classList.toggle("liked", data.liked);
  } finally {
    DOM.likeBtn.disabled = false;
  }
});


DOM.apiTokenBtn.addEventListener("click", () => {
  DOM.apiTokenModal.classList.add("active");
  loadTokens();
});

DOM.apiTokenCloseBtn.addEventListener("click", () => {
  DOM.apiTokenModal.classList.remove("active");
});

DOM.apiTokenModal.addEventListener("click", (e) => {
  if (e.target === DOM.apiTokenModal) DOM.apiTokenModal.classList.remove("active");
});

function renderTokenRow(token) {
  const row = document.createElement("div");
  row.className = "server-token-row";
  const created = parseServerDate(token.created_at).toLocaleDateString();
  const lastUsed = token.last_used_at ? parseServerDate(token.last_used_at).toLocaleString() : "Never used";
  row.innerHTML = `
    <span>Created ${escapeHTML(created)} &bull; ${escapeHTML(lastUsed)}</span>
    <button type="button" class="btn btn-danger btn-sm token-revoke-btn" data-token-id="${token.id}">Revoke</button>
  `;
  row.querySelector(".token-revoke-btn").addEventListener("click", async () => {
    if (!confirm("Revoke this token? Any tool using it will stop being able to push updates.")) return;
    try {
      const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}/tokens/${token.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error || "Failed to revoke token.");
        return;
      }
      loadTokens();
    } catch (err) {
      console.error("Revoke token failed:", err);
      toast.error("Failed to revoke token.");
    }
  });
  return row;
}

async function loadTokens() {
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}/tokens`, { credentials: "include" });
    const data = await res.json();
    if (!data.ok) return;
    DOM.tokenList.innerHTML = "";
    data.tokens.forEach((token) => DOM.tokenList.appendChild(renderTokenRow(token)));
  } catch (err) {
    console.error("Failed to load tokens:", err);
  }
}

DOM.createTokenBtn.addEventListener("click", async () => {
  DOM.createTokenBtn.disabled = true;
  try {
    const res = await fetch(`/api/servers/${encodeURIComponent(serverId)}/tokens`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json();
    if (!data.ok) {
      toast.error(data.error || "Failed to create token.");
      return;
    }
    DOM.tokenRevealValue.textContent = data.token;
    DOM.tokenReveal.classList.remove("hidden");
    DOM.tokenRevealHint.classList.remove("hidden");
    loadTokens();
  } catch (err) {
    console.error("Create token failed:", err);
    toast.error("Failed to create token.");
  } finally {
    DOM.createTokenBtn.disabled = false;
  }
});

DOM.copyTokenBtn.addEventListener("click", () => {
  navigator.clipboard?.writeText(DOM.tokenRevealValue.textContent).then(() => {
    DOM.copyTokenBtn.textContent = "Copied!";
    setTimeout(() => { DOM.copyTokenBtn.textContent = "Copy"; }, 1200);
  }).catch(() => {});
});

marked.setOptions({ breaks: true });

setupIconDropzone();
setupCubbieDownload();

(async function init() {
  await loadCurrentUser();
  if (isNewMode) {
    if (!currentUser) {
      window.location.href = "/servers";
      return;
    }
    enterCreateMode();
    return;
  }
  await loadServer();
})();

// "Copy link" button in the detail top bar.
const serverShareBtn = document.getElementById("serverShareBtn");
if (serverShareBtn) {
  serverShareBtn.addEventListener("click", () => {
    const url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => {
          if (typeof window.toast === "function") window.toast.info("Link copied to clipboard.");
        },
        () => window.prompt("Copy this link:", url)
      );
    } else {
      window.prompt("Copy this link:", url);
    }
  });
}
