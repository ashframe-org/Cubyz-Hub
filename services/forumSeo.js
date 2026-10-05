import { slugify } from "../utils/common.js";

export function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function threadPath(thread) {
  return `/forum/t/${thread.id}-${slugify(thread.title)}`;
}

export function stripMarkdown(markdown, maxLength = 160) {
  let text = String(markdown || "");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => alt.replace(/\|[1-4]$/, ""));
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/[*_~]+/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxLength) text = text.slice(0, maxLength - 1).trimEnd() + "\u2026";
  return text;
}

export function isoDate(value) {
  if (!value) return undefined;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s.replace(" ", "T") + "Z";
  return s;
}

function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function metaTags({ title, description, url, image, type = "website", published, modified, author }) {
  const tags = [
    `<link rel="canonical" href="${escHtml(url)}">`,
    `<meta property="og:type" content="${escHtml(type)}">`,
    `<meta property="og:site_name" content="Cubyz Hub">`,
    `<meta property="og:title" content="${escHtml(title)}">`,
    `<meta property="og:description" content="${escHtml(description)}">`,
    `<meta property="og:url" content="${escHtml(url)}">`,
  ];
  if (image) tags.push(`<meta property="og:image" content="${escHtml(image)}">`);
  if (author) tags.push(`<meta name="author" content="${escHtml(author)}">`);
  if (published) tags.push(`<meta property="article:published_time" content="${escHtml(published)}">`);
  if (modified) tags.push(`<meta property="article:modified_time" content="${escHtml(modified)}">`);
  tags.push(`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`);
  return tags.join("\n  ");
}

export function threadSeo(thread, posts, origin) {
  const url = `${origin}${threadPath(thread)}`;
  const title = `${thread.title} \u00b7 Cubyz Hub`;
  const description = stripMarkdown(thread.body) || `A discussion on the CubyzHub forum.`;
  const image = `${origin}/assets/default_banner.png`;

  const head = metaTags({
    title,
    description,
    url,
    image,
    type: "article",
    published: isoDate(thread.createdAt),
    modified: isoDate(thread.editedAt || thread.lastActivityAt || thread.createdAt),
    author: thread.author,
  });

  const data = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: thread.title,
    text: thread.body,
    url,
    author: { "@type": "Person", name: thread.author },
    datePublished: isoDate(thread.createdAt),
    dateModified: isoDate(thread.editedAt || thread.lastActivityAt || thread.createdAt),
    commentCount: posts.length,
    interactionStatistic: [
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/CommentAction",
        userInteractionCount: posts.length,
      },
      {
        "@type": "InteractionCounter",
        interactionType: "https://schema.org/LikeAction",
        userInteractionCount: thread.votes || 0,
      },
    ],
  };
  if (thread.category) data.articleSection = thread.category;
  if (thread.tags && thread.tags.length) data.keywords = thread.tags.join(", ");

  const accepted = thread.acceptedPostId ? posts.find((p) => p.id === thread.acceptedPostId) : null;
  if (accepted) {
    data.acceptedAnswer = {
      "@type": "Answer",
      text: accepted.body,
      datePublished: isoDate(accepted.createdAt),
      author: { "@type": "Person", name: accepted.author },
    };
  }
  if (posts.length) {
    data.comment = posts.slice(0, 25).map((p) => ({
      "@type": "Comment",
      text: p.body,
      datePublished: isoDate(p.createdAt),
      author: { "@type": "Person", name: p.author },
    }));
  }

  const replies = posts
    .map((p) => `<li><p><strong>${escHtml(p.author)}</strong></p>${p.bodyHtml || ""}</li>`)
    .join("");
  const noscript = `<noscript>
  <article>
    <h1>${escHtml(thread.title)}</h1>
    <p>By ${escHtml(thread.author)} in ${escHtml(thread.category)}</p>
    ${thread.bodyHtml || ""}
    <h2>Replies (${posts.length})</h2>
    <ul>${replies}</ul>
  </article>
  </noscript>`;

  return { url, title, description, head: `${head}\n  ${jsonLdScript(data)}`, noscript };
}

export function indexSeo(threads, origin) {
  const url = `${origin}/forum`;
  const title = "Forum \u00b7 Cubyz Hub";
  const description = "Community discussions for Cubyz \u2014 game help, addons, creation and development.";
  const image = `${origin}/assets/default_banner.png`;

  const head = metaTags({ title, description, url, image });

  const data = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "CubyzHub Forum",
    url,
    description,
    hasPart: threads.slice(0, 25).map((t) => ({
      "@type": "DiscussionForumPosting",
      headline: t.title,
      url: `${origin}${threadPath(t)}`,
      datePublished: isoDate(t.created_at),
      author: { "@type": "Person", name: t.author },
    })),
  };

  const items = threads
    .map((t) => `<li><a href="${escHtml(threadPath(t))}">${escHtml(t.title)}</a></li>`)
    .join("");
  const noscript = `<noscript>
  <h1>CubyzHub Forum</h1>
  <p>${escHtml(description)}</p>
  <ul>${items}</ul>
  </noscript>`;

  return { url, title, description, head: `${head}\n  ${jsonLdScript(data)}`, noscript };
}
