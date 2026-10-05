import { createAddonCard } from './addon_cards.js?v=20260919-17';

const DEFAULT_AVATAR = "/assets/Snale_Avatar.webp";

const SOCIAL_SERVICES = {
  discord: {
    label: "Discord",
    placeholder: "https://discord.gg/yourinvite",
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.3 5.3A18 18 0 0 0 15.7 4l-.3.6a13 13 0 0 1 4 1.6 15 15 0 0 0-14.8 0 13 13 0 0 1 4-1.6L8.3 4a18 18 0 0 0-4.6 1.3C1.4 9.6.8 13.7 1 17.8a18 18 0 0 0 5.5 2.8l.9-1.4a11 11 0 0 1-1.9-.9l.5-.4a13 13 0 0 0 11.9 0l.5.4a11 11 0 0 1-1.9.9l.9 1.4a18 18 0 0 0 5.5-2.8c.3-4.7-.7-8.8-3.1-12.5ZM8.7 15.3c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.7.8 1.6 1.8c0 1-.7 1.8-1.6 1.8Zm6.6 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.7.8 1.6 1.8c0 1-.7 1.8-1.6 1.8Z"/></svg>'
  },
  github: {
    label: "GitHub",
    placeholder: "https://github.com/yourname",
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.5c.5.1.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.95 0-1.1.39-1.99 1.03-2.7-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.6 9.6 0 0 1 5 0c1.9-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.71 1.03 1.6 1.03 2.7 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.75c0 .26.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>'
  },
  youtube: {
    label: "YouTube",
    placeholder: "https://youtube.com/@yourchannel",
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M22 12s0-3.2-.4-4.7a3 3 0 0 0-2.1-2.1C18 4.8 12 4.8 12 4.8s-6 0-7.5.4a3 3 0 0 0-2.1 2.1C2 8.8 2 12 2 12s0 3.2.4 4.7a3 3 0 0 0 2.1 2.1c1.5.4 7.5.4 7.5.4s6 0 7.5-.4a3 3 0 0 0 2.1-2.1c.4-1.5.4-4.7.4-4.7ZM10 15.3V8.7L15.8 12Z"/></svg>'
  },
  twitter: {
    label: "X / Twitter",
    placeholder: "https://x.com/yourhandle",
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.9 3H22l-7.2 8.2L23 21h-6.6l-5.2-6.7L5.1 21H2l7.7-8.8L1.5 3H8.3l4.7 6.2Zm-1.2 16h1.7L7.4 5H5.6Z"/></svg>'
  },
  website: {
    label: "Website",
    placeholder: "https://example.com",
    icon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"></path></svg>'
  }
};

function getUsernameFromUrl() {
  const pathMatch = window.location.pathname.match(/^\/profile\/([^\/]+)/);
  if (pathMatch && pathMatch[1]) {
    return decodeURIComponent(pathMatch[1]);
  }
  return new URLSearchParams(window.location.search).get("username");
}

function setText(selector, text) {
  const el = document.getElementById(selector);
  if (!el) return;
  el.textContent = text;
}

function formatNumber(value) {
  if (typeof value !== "number") return "0";
  return new Intl.NumberFormat().format(value);
}

function formatDate(value) {
  if (!value) return "—";
  const isoValue = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB");
}

function formatLastSeen(value) {
  if (!value) return "Offline";
  const isoValue = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "Offline";

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "Last seen just now";
  if (diffMin < 60) return `Last seen ${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Last seen ${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `Last seen ${diffDay}d ago`;
  return `Last seen ${date.toLocaleDateString("en-GB")}`;
}

function renderActivityDot(activity) {
  const dot = document.getElementById("profile-activity-dot");
  if (!dot) return;

  if (!activity || activity.visible === false) {
    dot.classList.add("hidden");
    return;
  }

  dot.classList.remove("hidden");
  dot.classList.toggle("is-online", !!activity.isOnline);
  dot.setAttribute(
    "data-tooltip",
    activity.isOnline ? "Online now" : formatLastSeen(activity.lastSeen)
  );
}

function showEmptyState(message) {
  const noAddons = document.getElementById("no-addons");
  const addonContainer = document.getElementById("addon-container");
  if (addonContainer) addonContainer.classList.add("hidden");
  if (noAddons) {
    noAddons.classList.remove("hidden");
    noAddons.querySelector("p").textContent = message || "This user has not uploaded any addons yet.";
  }
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

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

async function checkProfileOwner(username) {
  try {
    const res = await fetch("/api/auth/status", {
      credentials: "include",
    });
    const json = await res.json();
    return json.ok && json.user && json.user.username === username;
  } catch (err) {
    console.error("PROFILE OWNER CHECK ERROR:", err);
    return false;
  }
}

async function getCurrentUser() {
  try {
    const res = await fetch("/api/auth/status", { credentials: "include" });
    const json = await res.json();
    return json.ok ? json.user : null;
  } catch (err) {
    console.error("AUTH STATUS CHECK ERROR:", err);
    return null;
  }
}

function setFollowButtonState(button, isFollowing) {
  button.classList.toggle("following", isFollowing);
  button.textContent = isFollowing ? "Following" : "Follow";
}

async function setupFollowButton(profileUsername, isFollowingInitial) {
  const container = document.getElementById("profile-follow-container");
  if (!container) return;

  const currentUser = await getCurrentUser();

  if (!currentUser || currentUser.username === profileUsername) {
    container.innerHTML = "";
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "follow-btn";
  setFollowButtonState(button, isFollowingInitial);

  button.addEventListener("click", async () => {
    const currentlyFollowing = button.classList.contains("following");
    const endpoint = `/api/users/${encodeURIComponent(profileUsername)}/${currentlyFollowing ? "unfollow" : "follow"}`;
    button.disabled = true;
    try {
      const res = await fetch(endpoint, { method: "POST", credentials: "include" });
      const json = await res.json();
      if (json.ok) {
        setFollowButtonState(button, json.isFollowing);
      } else {
        toast.error(json.error || "Unable to update follow status.");
      }
    } catch (err) {
      console.error("FOLLOW TOGGLE ERROR:", err);
      toast.error("Unable to update follow status.");
    } finally {
      button.disabled = false;
    }
  });

  container.innerHTML = "";
  container.appendChild(button);
}

function createAboutParagraph(text) {
  const p = document.createElement("p");
  p.id = "profile-about";
  p.className = "profile-about editable";
  p.title = "Click to edit your about section";
  p.textContent = text;
  p.addEventListener("click", startAboutEdit);
  return p;
}

function restoreAboutParagraph(text) {
  const wrapper = document.querySelector(".profile-about-edit-wrapper");
  const paragraph = createAboutParagraph(text);
  if (wrapper && wrapper.parentNode) {
    wrapper.parentNode.replaceChild(paragraph, wrapper);
  }
}

function startAboutEdit() {
  const aboutEl = document.getElementById("profile-about");
  if (!aboutEl || aboutEl.classList.contains("editing")) return;

  aboutEl.classList.add("editing");
  const currentText = aboutEl.textContent.trim();

  const textarea = document.createElement("textarea");
  textarea.className = "profile-about-edit";
  textarea.value = currentText;
  textarea.rows = 4;

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "profile-about-action save";
  saveButton.textContent = "Save";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "profile-about-action cancel";
  cancelButton.textContent = "Cancel";

  const actionRow = document.createElement("div");
  actionRow.className = "profile-about-edit-actions";
  actionRow.append(saveButton, cancelButton);

  const wrapper = document.createElement("div");
  wrapper.className = "profile-about-edit-wrapper";
  wrapper.append(textarea, actionRow);

  aboutEl.replaceWith(wrapper);
  textarea.focus();

  saveButton.addEventListener("click", async () => {
    const updatedText = textarea.value.trim();
    try {
      const res = await fetch("/api/users/about", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ about: updatedText }),
      });
      const json = await res.json();
      if (json.ok) {
        const paragraph = createAboutParagraph(json.about || updatedText);
        wrapper.parentNode.replaceChild(paragraph, wrapper);
      } else {
        toast.error("Unable to save about text: " + (json.error || "Unknown error"));
      }
    } catch (err) {
      console.error("SAVE ABOUT ERROR:", err);
      toast.error("Unable to save about text.");
    }
  });

  cancelButton.addEventListener("click", () => {
    restoreAboutParagraph(currentText);
  });
}

async function submitAvatarFile(avatarFile) {
  const formData = new FormData();
  formData.append("avatar", avatarFile);

  try {
    const res = await fetch("/api/auth/upload-avatar", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const json = await res.json();
    console.log("Avatar upload response:", json);
    if (json.ok && json.avatarUrl) {
      const avatarEl = document.getElementById("profile-avatar");
      if (avatarEl) {
        avatarEl.src = `${json.avatarUrl}?t=${Date.now()}`;
      }

      await loadNavUser();
    } else if (json.ok) {
      window.location.reload();
    } else {
      toast.error("Unable to upload avatar: " + (json.error || "Unknown error"));
    }
  } catch (err) {
    console.error("UPLOAD AVATAR ERROR:", err);
    toast.error("Unable to upload avatar.");
  }
}

function openAvatarUpload() {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      fileInput.remove();
      return;
    }

    if (file.type === "image/gif") {
      submitAvatarFile(file);
      fileInput.remove();
      return;
    }

    openImageCropper(file, 1, async (croppedAvatar) => {
      const compressedAvatar = await compressImage(croppedAvatar, 512, 512, 0.90);
      await submitAvatarFile(compressedAvatar);
    }, { outputWidth: 512, outputHeight: 512 });

    fileInput.remove();
  });

  document.body.appendChild(fileInput);
  fileInput.click();
}

function openBannerUpload() {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      fileInput.remove();
      return;
    }

    openImageCropper(file, 16 / 9, async (croppedBanner) => {
      const compressedBanner = await compressImage(croppedBanner, 1280, 720, 0.85);
      const formData = new FormData();
      formData.append("banner", compressedBanner);

      try {
        const res = await fetch("/api/auth/upload-banner", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const json = await res.json();
        if (json.ok && json.bannerUrl) {
          const bannerEl = document.getElementById("profile-banner");
          if (bannerEl) {
            bannerEl.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.78)), url('${safeUrl(json.bannerUrl, "/assets/default_banner.png")}')`;
          }
        } else {
          toast.error("Unable to upload banner: " + (json.error || "Unknown error"));
        }
      } catch (err) {
        console.error("UPLOAD BANNER ERROR:", err);
        toast.error("Unable to upload banner.");
      }
    }, { outputWidth: 1280, outputHeight: 720 });

    fileInput.remove();
  });

  document.body.appendChild(fileInput);
  fileInput.click();
}

let currentSocialLinks = [];

function renderSocialLinks(links) {
  currentSocialLinks = Array.isArray(links) ? links : [];
  const container = document.getElementById("profile-social-links");
  if (!container) return;
  container.innerHTML = "";
  currentSocialLinks.forEach(({ service, url }) => {
    const meta = SOCIAL_SERVICES[service];
    if (!meta) return;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "profile-social-link";
    link.title = meta.label;
    link.innerHTML = meta.icon;
    container.appendChild(link);
  });
}

function addSocialLinkRow(service = "", url = "") {
  const rowsEl = document.getElementById("social-links-rows");
  if (!rowsEl) return;

  const row = document.createElement("div");
  row.className = "social-links-row";

  const select = document.createElement("select");
  select.className = "social-links-service-select";
  Object.entries(SOCIAL_SERVICES).forEach(([key, meta]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = meta.label;
    if (key === service) opt.selected = true;
    select.appendChild(opt);
  });

  const input = document.createElement("input");
  input.type = "text";
  input.className = "social-links-url-input";
  input.value = url;
  input.placeholder = SOCIAL_SERVICES[select.value]?.placeholder || "https://...";
  select.addEventListener("change", () => {
    input.placeholder = SOCIAL_SERVICES[select.value]?.placeholder || "https://...";
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "social-links-remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => row.remove());

  row.append(select, input, removeBtn);
  rowsEl.appendChild(row);
}

function openSocialLinksModal() {
  const modal = document.getElementById("social-links-modal");
  const rowsEl = document.getElementById("social-links-rows");
  if (!modal || !rowsEl) return;

  rowsEl.innerHTML = "";
  if (currentSocialLinks.length) {
    currentSocialLinks.forEach(({ service, url }) => addSocialLinkRow(service, url));
  } else {
    addSocialLinkRow();
  }
  modal.classList.remove("hidden");
}

function closeSocialLinksModal() {
  document.getElementById("social-links-modal")?.classList.add("hidden");
}

function setupSocialLinksEditing() {
  const editBtn = document.getElementById("edit-social-links-btn");
  const addRowBtn = document.getElementById("add-social-link-row");
  const cancelBtn = document.getElementById("social-links-cancel");
  const saveBtn = document.getElementById("social-links-save");
  const modal = document.getElementById("social-links-modal");

  editBtn?.classList.remove("hidden");
  editBtn?.addEventListener("click", openSocialLinksModal);
  addRowBtn?.addEventListener("click", () => {
    const rowsEl = document.getElementById("social-links-rows");
    if (rowsEl && rowsEl.children.length >= Object.keys(SOCIAL_SERVICES).length) return;
    addSocialLinkRow();
  });
  cancelBtn?.addEventListener("click", closeSocialLinksModal);
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeSocialLinksModal();
  });

  saveBtn?.addEventListener("click", async () => {
    const rows = document.querySelectorAll("#social-links-rows .social-links-row");
    const links = Array.from(rows).map((row) => ({
      service: row.querySelector(".social-links-service-select").value,
      url: row.querySelector(".social-links-url-input").value.trim()
    })).filter((l) => l.url);

    try {
      const res = await fetch("/api/users/social-links", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links })
      });
      const data = await res.json();
      if (data.ok) {
        renderSocialLinks(data.links);
        closeSocialLinksModal();
      } else {
        toast.error(data.error || "Failed to save links.");
      }
    } catch (err) {
      console.error("Failed to save social links:", err);
      toast.error("Failed to save links.");
    }
  });
}

function enableProfileEditing() {
  const avatarShell = document.querySelector(".profile-avatar-shell");
  const bannerEl = document.getElementById("profile-banner");
  const aboutEl = document.getElementById("profile-about");
  if (avatarShell) {
    avatarShell.classList.add("editable");
    avatarShell.title = "Click to upload a new avatar";
    avatarShell.addEventListener("click", openAvatarUpload);
  }
  if (bannerEl) {
    bannerEl.classList.add("editable");
    bannerEl.title = "Click to upload a new banner";
    bannerEl.addEventListener("click", openBannerUpload);
  }
  if (aboutEl) {
    aboutEl.classList.add("profile-about", "editable");
    aboutEl.title = "Click to edit your about section";
    aboutEl.addEventListener("click", startAboutEdit);
  }
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const communityListState = {
  followers: { users: [], offset: 0, hasMore: false, loaded: false },
  following: { users: [], offset: 0, hasMore: false, loaded: false }
};

function appendCommunityUserRows(listEl, users) {
  users.forEach((u) => {
    const li = document.createElement("li");
    li.className = "community-user-row";

    const link = document.createElement("a");
    link.href = `/profile/${encodeURIComponent(u.username)}`;
    link.className = "community-user-link";

    const avatar = document.createElement("img");
    avatar.className = "community-user-avatar";
    avatar.alt = "";
    avatar.src = safeUrl(u.avatarUrl, DEFAULT_AVATAR);
    avatar.onerror = () => { avatar.src = DEFAULT_AVATAR; };

    const name = document.createElement("span");
    name.textContent = u.username;

    link.append(avatar, name);
    li.appendChild(link);
    listEl.appendChild(li);
  });
}

function renderCommunityLoadMore(listEl, tab, username) {
  listEl.querySelector(".community-load-more")?.remove();
  const state = communityListState[tab];
  if (!state.hasMore) return;

  const li = document.createElement("li");
  li.className = "community-load-more";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-ghost btn-sm";
  btn.textContent = "Load more";
  btn.addEventListener("click", () => loadCommunityList(username, tab, { loadMore: true }));
  li.appendChild(btn);
  listEl.appendChild(li);
}

async function loadCommunityList(username, tab, { loadMore = false } = {}) {
  const listEl = document.getElementById(`community-${tab}-list`);
  if (!listEl) return;
  const state = communityListState[tab];

  if (state.loaded && !loadMore) {
    listEl.innerHTML = "";
    appendCommunityUserRows(listEl, state.users);
    renderCommunityLoadMore(listEl, tab, username);
    return;
  }

  try {
    const offset = loadMore ? state.offset : 0;
    const res = await fetch(`/api/users/${encodeURIComponent(username)}/${tab}?offset=${offset}`);
    const json = await res.json();
    const users = json.ok && Array.isArray(json.users) ? json.users : [];

    if (loadMore) {
      state.users = state.users.concat(users);
    } else {
      state.users = users;
      listEl.innerHTML = "";
    }
    state.offset = offset + users.length;
    state.hasMore = !!json.hasMore;
    state.loaded = true;

    if (json.hidden) {
      const li = document.createElement("li");
      li.className = "community-user-empty";
      li.textContent = "This list is private.";
      listEl.appendChild(li);
      return;
    }

    if (!state.users.length) {
      const li = document.createElement("li");
      li.className = "community-user-empty";
      li.textContent = "Nobody here yet.";
      listEl.appendChild(li);
      return;
    }

    listEl.querySelector(".community-load-more")?.remove();
    appendCommunityUserRows(listEl, users);
    renderCommunityLoadMore(listEl, tab, username);
  } catch (err) {
    console.error(`Failed to load ${tab}:`, err);
    if (!loadMore) {
      listEl.innerHTML = "";
      const li = document.createElement("li");
      li.className = "community-user-empty";
      li.textContent = "Could not load this list.";
      listEl.appendChild(li);
    }
  }
}

function setupProfileTabs() {
  const tabs = document.querySelectorAll(".profile-tab-bar .tab-bar-btn");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const which = tab.dataset.profileTab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      document.getElementById("profile-tab-addons")?.classList.toggle("active", which === "addons");
      document.getElementById("profile-tab-models")?.classList.toggle("active", which === "models");
      document.getElementById("profile-tab-servers")?.classList.toggle("active", which === "servers");
      document.getElementById("profile-tab-forum")?.classList.toggle("active", which === "forum");

      if (which === "models") {
        requestAnimationFrame(() => {
          ensureThree()
            .then(() => {
              initProfileModelViewers();
              resumeProfileViewers();
            })
            .catch(() => {});
        });
      } else {
        pauseProfileViewers();
      }
    });
  });
}

function profileForumHref(t) {
  const slug = String(t.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `/forum/t/${t.id}${slug ? "-" + slug : ""}`;
}

function renderProfileForum(threads) {
  const list = document.getElementById("profile-forum-list");
  const noForum = document.getElementById("no-forum");
  if (!list) return;
  list.innerHTML = "";
  const items = Array.isArray(threads) ? threads : [];
  if (!items.length) {
    if (noForum) noForum.classList.remove("hidden");
    return;
  }
  if (noForum) noForum.classList.add("hidden");
  items.forEach((t) => {
    const li = document.createElement("li");
    li.className = "profile-forum-item";

    const a = document.createElement("a");
    a.className = "profile-forum-link";
    a.href = profileForumHref(t);
    a.textContent = t.title;
    li.appendChild(a);

    const bits = [t.category];
    if (t.solved) bits.push("Solved");
    if (t.pinned) bits.push("Pinned");
    bits.push(`${t.votes || 0} votes`);
    bits.push(`${t.replyCount || 0} replies`);
    const meta = document.createElement("div");
    meta.className = "profile-forum-meta";
    meta.textContent = bits.join(" \u00b7 ");
    li.appendChild(meta);

    list.appendChild(li);
  });
}

function renderProfileServers(servers) {
  const list = document.getElementById("profile-server-list");
  const noServers = document.getElementById("no-servers");
  if (!list) return;
  list.innerHTML = "";
  const items = Array.isArray(servers) ? servers : [];
  if (!items.length) {
    if (noServers) noServers.classList.remove("hidden");
    return;
  }
  if (noServers) noServers.classList.add("hidden");
  items.forEach((s) => {
    const li = document.createElement("li");
    li.className = "profile-server-item";

    const icon = document.createElement("img");
    icon.className = "profile-server-icon";
    icon.src = safeUrl(s.icon_url, "/assets/default_icon.png");
    icon.alt = "";
    icon.loading = "lazy";
    li.appendChild(icon);

    const info = document.createElement("div");
    info.className = "profile-server-info";

    const a = document.createElement("a");
    a.className = "profile-server-link";
    a.href = `/server.html?id=${encodeURIComponent(s.id)}`;
    a.textContent = s.name;
    info.appendChild(a);

    const status = s.online
      ? `Online${typeof s.player_count === "number" ? " \u00b7 " + s.player_count + " players" : ""}`
      : "Offline";
    const meta = document.createElement("div");
    meta.className = "profile-server-meta";
    meta.textContent = [status, s.version].filter(Boolean).join(" \u00b7 ");
    info.appendChild(meta);

    if (s.description) {
      const desc = document.createElement("p");
      desc.className = "profile-server-desc";
      desc.textContent = s.description;
      info.appendChild(desc);
    }

    li.appendChild(info);
    list.appendChild(li);
  });
}

const OFFICIAL_MODEL_BASES = {
  "cubyz:snale": { glb: "/models-official/snale.glb?v=20261004-1", texture: "/models-official/snale.png", rotateX: false, offsetY: Math.PI },
  "cubyz:snela": { glb: "/models-official/snela.glb?v=20261004-1", texture: "/models-official/snela.png", rotateX: false, offsetY: Math.PI },
  "cubyz:snail": { glb: "/models-official/snail.glb?v=20261004-1", texture: "/models-official/snail.png", rotateX: false, offsetY: 0 },
  "cubyz:moffalo": { glb: "/models-official/moffalo.glb?v=20261004-1", texture: "/models-official/moffalo.png", rotateX: false, offsetY: 0 },
  "cubyz:cubert": { glb: "/models-official/cubert.glb?v=20261004-1", texture: "/models-official/cubert.png", rotateX: false, offsetY: Math.PI },
};

const profileModels = [];
const profileViewers = [];
let threeLoadPromise = null;

function profileModelRenderInfo(model) {
  if (model.asset_type === "skin_only") {
    const base = OFFICIAL_MODEL_BASES[model.associated_model];
    if (!base) return null;
    return { glb: base.glb, texture: model.texture_path || base.texture, rotateX: base.rotateX, offsetY: base.offsetY };
  }
  if (!model.glb_path) return null;
  return { glb: model.glb_path, texture: model.texture_path, rotateX: false, offsetY: 0 };
}

// three.js is heavy, so only load it the first time the Models tab is opened.
function ensureThree() {
  if (window.THREE && window.THREE.GLTFLoader) return Promise.resolve();
  if (threeLoadPromise) return threeLoadPromise;
  threeLoadPromise = new Promise((resolve, reject) => {
    const three = document.createElement("script");
    three.src = "/vendor/three-r128.min.js";
    three.onload = () => {
      const gltf = document.createElement("script");
      gltf.src = "/vendor/GLTFLoader-r128.js";
      gltf.onload = () => resolve();
      gltf.onerror = () => reject(new Error("GLTFLoader failed to load"));
      document.head.appendChild(gltf);
    };
    three.onerror = () => reject(new Error("three.js failed to load"));
    document.head.appendChild(three);
  });
  return threeLoadPromise;
}

// Renders a rotating 3D preview into a container (mirrors models.js viewer).
function initProfileViewer(container, info) {
  if (!container || !window.THREE || container.dataset.viewerInit === "1") return;
  container.dataset.viewerInit = "1";

  const width = container.clientWidth || 220;
  const height = container.clientHeight || 220;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / Math.max(1, height), 0.1, 100);
  camera.position.set(0, 0.2, 3.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(5, 10, 7.5);
  scene.add(dir);

  const record = { animId: null, renderer, animate: null };
  profileViewers.push(record);

  const loader = new THREE.GLTFLoader();
  loader.load(encodeURI(info.glb), (gltf) => {
    const model = gltf.scene;
    if (info.rotateX) model.rotation.x = -Math.PI / 2;
    model.rotation.y = info.offsetY || 0;

    if (info.texture) {
      new THREE.TextureLoader().load(encodeURI(info.texture), (texture) => {
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
      record.animId = requestAnimationFrame(animate);
      if (info.rotateX) model.rotation.z += 0.004;
      else model.rotation.y += 0.004;
      renderer.render(scene, camera);
    }
    record.animate = animate;
    animate();
  });
}

function initProfileModelViewers() {
  document.querySelectorAll("#model-container .model-canvas-container").forEach((container) => {
    const index = parseInt(container.dataset.index, 10);
    const info = profileModels[index];
    if (!info || !info.glb) return;
    initProfileViewer(container, info);
  });
}

function pauseProfileViewers() {
  profileViewers.forEach((v) => {
    if (v.animId) {
      cancelAnimationFrame(v.animId);
      v.animId = null;
    }
  });
}

function resumeProfileViewers() {
  profileViewers.forEach((v) => {
    if (!v.animId && typeof v.animate === "function") v.animate();
  });
}

function renderProfileModels(models) {
  const modelContainer = document.getElementById("model-container");
  const noModels = document.getElementById("no-models");
  if (!modelContainer) return;

  profileModels.length = 0;

  if (!Array.isArray(models) || models.length === 0) {
    modelContainer.classList.add("hidden");
    if (noModels) noModels.classList.remove("hidden");
    return;
  }

  if (noModels) noModels.classList.add("hidden");
  modelContainer.classList.remove("hidden");
  modelContainer.innerHTML = "";

  models.forEach((model, index) => {
    const info = profileModelRenderInfo(model);
    profileModels[index] = info;

    const card = document.createElement("a");
    card.className = "model-card fade-in-card";
    card.href = `/models?model=${encodeURIComponent(model.id)}`;
    card.innerHTML = `
      <div class="model-card-header">${escapeHtml(model.title)}</div>
      <div class="model-canvas-container" data-index="${index}"></div>
      <div class="model-card-footer">${model.asset_type === "skin_only" ? "Skin" : "Full model"}</div>
    `;

    const holder = card.querySelector(".model-canvas-container");
    if (!info) {
      // No GLB to render — fall back to the texture image.
      holder.dataset.viewerInit = "1";
      holder.innerHTML = `<img class="img-fade loaded" src="${escapeHtml(safeUrl(model.texture_path, "/assets/default_icon.png"))}" alt="${escapeHtml(model.title)}">`;
    }

    modelContainer.appendChild(card);
  });

  if (isProfileTabActive("models")) {
    ensureThree().then(initProfileModelViewers).catch(() => {});
  }
}

function isProfileTabActive(which) {
  return !!document.getElementById(`profile-tab-${which}`)?.classList.contains("active");
}

function setupCommunityTabs(username) {
  const tabs = document.querySelectorAll(".community-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const which = tab.dataset.communityTab;
      tabs.forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      document.getElementById("community-followers-list")?.classList.toggle("hidden", which !== "followers");
      document.getElementById("community-following-list")?.classList.toggle("hidden", which !== "following");
      loadCommunityList(username, which);
    });
  });
}

async function loadProfile() {
  const username = getUsernameFromUrl();
  if (!username) {
    setText("profile-name", "Profile not found");
    setText("profile-bio", "No user was specified.");
    return;
  }

  try {
    const response = await fetch(`/api/users/${encodeURIComponent(username)}`);
    const data = await response.json();

    if (!data.ok) {
      setText("profile-name", "Profile not found");
      setText("profile-bio", data.error || "This profile does not exist.");
      return;
    }

    const user = data.user;
    const stats = data.stats || {};
    const aboutText = data.about || "No profile details have been added yet.";

    document.title = `${user.username} • Cubyz Hub`;
    setText("profile-name", user.username);
    setText("profile-handle", `@${user.username}`);
    setText("tab-count-addons", formatNumber((stats.totalAddons || 0) + (stats.totalMods || 0)));
    setText("tab-count-models", formatNumber(stats.totalModels || 0));
    setText("tab-count-servers", formatNumber(stats.totalServers || 0));
    setText("tab-count-forum", formatNumber(stats.totalForumThreads || 0));
    setText("stat-downloads", formatNumber(stats.totalDownloads || 0));
    setText("stat-forum-threads", formatNumber(stats.totalForumThreads || 0));
    setText("stat-forum-replies", formatNumber(stats.totalForumReplies || 0));
    setText("stat-likes", formatNumber(stats.totalLikes || 0));
    setText("stat-servers", formatNumber(stats.totalServers || 0));
    setText("profile-joined-date", `Member since ${formatDate(user.created_at)}`);
    setText("stat-addons", formatNumber(stats.totalAddons || 0));
    setText("stat-downloads", formatNumber(stats.totalDownloads || 0));
    setText("stat-joined", formatDate(user.created_at));
    setText("stat-location", stats.location || "Earth");
    setText("profile-about", aboutText);

    renderSocialLinks(data.socialLinks);

    if (await checkProfileOwner(user.username)) {
      enableProfileEditing();
      setupSocialLinksEditing();
    }

    setupFollowButton(user.username, !!data.isFollowing);

    setText("profile-followers-count", formatNumber(data.followerCount || 0));
    setText("profile-following-count", formatNumber(data.followingCount || 0));
    loadCommunityList(user.username, "followers");
    setupCommunityTabs(user.username);
    setupProfileTabs();
    renderProfileModels(data.models);
    renderProfileForum(data.forumThreads);
    renderProfileServers(data.servers);
    const roleBadge = document.getElementById("profile-role-badge");
    if (roleBadge) {
      if (data.isForumAdmin) {
        roleBadge.textContent = "Admin";
        roleBadge.classList.remove("hidden");
      } else if (data.isForumModerator) {
        roleBadge.textContent = "Moderator";
        roleBadge.classList.remove("hidden");
      }
    }
    if (data.forumHidden) {
      document.querySelector('[data-profile-tab="forum"]')?.classList.add("hidden");
      document.getElementById("profile-tab-forum")?.classList.add("hidden");
      document.getElementById("profile-forum-count")?.closest(".profile-stat")?.classList.add("hidden");
    }

    const avatarEl = document.getElementById("profile-avatar");
    if (avatarEl) {
      const avatarUrl = data.avatarUrl || DEFAULT_AVATAR;
      avatarEl.classList.add("img-fade");
      const revealAvatar = () => avatarEl.classList.add("loaded");
      avatarEl.addEventListener("load", revealAvatar, { once: true });
      avatarEl.src = safeUrl(avatarUrl, DEFAULT_AVATAR);
      avatarEl.onerror = () => {
        avatarEl.src = DEFAULT_AVATAR;
        revealAvatar();
      };
    }

    renderActivityDot(data.activity);

    const bannerEl = document.getElementById("profile-banner");
    if (bannerEl) {
      const bannerUrl = data.bannerUrl || "/assets/default_banner.png";
      bannerEl.classList.add("fade-in");
      bannerEl.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.78)), url('${safeUrl(bannerUrl, "/assets/default_banner.png")}')`;
    }

    const addonContainer = document.getElementById("addon-container");
    const noAddons = document.getElementById("no-addons");
    if (!addonContainer) return;

    if (!Array.isArray(data.addons) || data.addons.length === 0) {
      showEmptyState();
      return;
    }

    if (noAddons) noAddons.classList.add("hidden");
    addonContainer.classList.remove("hidden");
    addonContainer.innerHTML = "";
    const addons = data.addons || [];

    const cards = addons.map(addon => {
      const card = createAddonCard(addon);
      addonContainer.appendChild(card);
      return { card, addon };
    });

    (async () => {
      let user = null;

      try {
        const auth = await fetch("/api/auth/status", {
          credentials: "include"
        }).then(r => r.json());

        if (auth.ok) user = auth.user;
      } catch {
        return;
      }

      if (!user) return;

      for (const { card, addon } of cards) {
        try {
          const res = await fetch(`/api/addons/${addon.id}/liked`, {
            credentials: "include"
          }).then(r => r.json());

          if (res.ok && res.liked) {
            card.classList.add("liked");
          }
        } catch {

        }
      }
    })();
  } catch (err) {
    console.error("PROFILE LOAD ERROR:", err);
    setText("profile-name", "Profile not found");
    setText("profile-bio", "Unable to load profile details.");
  }
}

loadProfile();
