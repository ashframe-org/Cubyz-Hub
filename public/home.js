const SECTIONS = [
  {
    title: "Addons & Mods",
    description: "Browse community-made addons and mods for Cubyz.",
    href: "/addons",
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.5 2.5 0 1 0-3.214 3.214c.445.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-3.408 0l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568a2.404 2.404 0 0 1 0-3.408l1.611-1.611a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.5 2.5 0 1 0 3.214-3.214c-.445-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.61-1.61a2.404 2.404 0 0 1 3.408 0l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"></path>
    </svg>`,
    countEndpoint: "/api/addons",
    countLabel: (n) => `${n.toLocaleString()} published`,
  },
  {
    title: "Models",
    description: "Browse community-made models & skins for Cubyz.",
    href: "/models",
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z"></path>
      <path d="M12 3v18"></path>
      <path d="M3 7.5 12 12l9-4.5"></path>
    </svg>`,
    countEndpoint: "/api/models",
    countLabel: (n) => `${n.toLocaleString()} published`,
  },
  {
    title: "Servers",
    description: "Browse community-run servers for Cubyz.",
    href: "/servers",
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="8" rx="2"></rect>
      <rect x="2" y="13" width="20" height="8" rx="2"></rect>
      <line x1="6" y1="7" x2="6.01" y2="7"></line>
      <line x1="6" y1="17" x2="6.01" y2="17"></line>
    </svg>`,
    countEndpoint: "/api/servers",
    countLabel: (n) => `${n.toLocaleString()} listed`,
  },
  {
    title: "Addon Creator",
    description: "Build blocks, items, biomes and more - right in your browser.",
    href: "/creator/",
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
      <path d="M2 2l7.586 7.586"></path>
      <circle cx="11" cy="11" r="2"></circle>
    </svg>`,
  },
  {
    title: "Forum",
    description: "Discuss addons, share ideas and get help from the community.",
    href: "/forum",
    countEndpoint: "/api/forum/stats",
    countLabel: (n) => `${n.toLocaleString()} discussions`,
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
    </svg>`,
  },
  {
    title: "Feedback",
    description: "Found a bug or have an idea? Tell us what to fix or improve.",
    href: "/feedback",
    icon: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 18h6"></path>
      <path d="M10 22h4"></path>
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"></path>
    </svg>`,
  },
];

function renderSections() {
  const grid = document.getElementById("home-section-grid");
  if (!grid) return;

  grid.innerHTML = "";

  SECTIONS.forEach((section) => {
    const card = document.createElement(section.comingSoon ? "div" : "a");
    card.className = "home-tile";
    if (section.comingSoon) {
      card.classList.add("home-tile-disabled");
    } else {
      card.href = section.href;
    }

    const iconWrap = document.createElement("div");
    iconWrap.className = "home-tile-icon";
    iconWrap.innerHTML = section.icon;
    card.appendChild(iconWrap);

    const body = document.createElement("div");
    body.className = "home-tile-body";

    const title = document.createElement("h3");
    title.className = "home-tile-title";
    title.textContent = section.title;
    body.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "home-tile-desc";
    desc.textContent = section.description;
    body.appendChild(desc);

    if (section.comingSoon) {
      const badge = document.createElement("span");
      badge.className = "home-tile-badge";
      badge.textContent = "Coming soon";
      body.appendChild(badge);
    } else if (section.countEndpoint) {
      const count = document.createElement("span");
      count.className = "home-tile-count";
      count.textContent = "Loading…";
      body.appendChild(count);
      section._countEl = count;
    }

    card.appendChild(body);

    if (!section.comingSoon) {
      const arrow = document.createElement("span");
      arrow.className = "home-tile-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "→";
      card.appendChild(arrow);
    }

    grid.appendChild(card);
  });
}

async function loadCounts() {
  await Promise.all(
    SECTIONS.filter((section) => section.countEndpoint).map(async (section) => {
      try {
        const res = await fetch(section.countEndpoint, { credentials: "include" });
        const data = await res.json();
        const total = typeof data?.total === "number" ? data.total : null;
        if (section._countEl) {
          section._countEl.textContent = total !== null ? section.countLabel(total) : "";
        }
      } catch (_) {
        if (section._countEl) {
          section._countEl.textContent = "";
        }
      }
    })
  );
}

renderSections();
loadCounts();
