(function () {
  "use strict";

  function isWhitespaceText(node) {
    return node.nodeType === 3 && !node.textContent.trim();
  }

  // Returns the <img>s if the node is an image-only block (an <img>, or a
  // <p>/<div>/<figure> containing only images, <br>s and whitespace).
  function isImageOnly(node) {
    if (node.nodeType !== 1) return null;
    var tag = node.tagName.toLowerCase();
    if (tag === "img") return [node];
    if (tag !== "p" && tag !== "div" && tag !== "figure") return null;
    var imgs = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (isWhitespaceText(child)) continue;
      if (child.nodeType !== 1) return null;
      var childTag = child.tagName.toLowerCase();
      if (childTag === "img") {
        imgs.push(child);
        continue;
      }
      if (childTag === "br") continue;
      return null;
    }
    return imgs.length ? imgs : null;
  }

  function wire(img, list) {
    if (!img || img.dataset.galleryWired) return;
    // Images used as links keep their link behaviour.
    if (img.closest("a")) return;
    img.dataset.galleryWired = "1";
    img.addEventListener("click", function (e) {
      e.preventDefault();
      open(list, list.indexOf(img));
    });
  }

  function buildGallery(blocks, container) {
    var gallery = document.createElement("div");
    var imgs = [];
    blocks.forEach(function (block) {
      block.imgs.forEach(function (img) {
        img.loading = "lazy";
        img.decoding = "async";
        imgs.push(img);
        gallery.appendChild(img);
      });
    });
    // A run of explicitly-sized images keeps its natural aspect ratio and uses
    // the relative size classes to sit side by side; otherwise use the grid.
    var allSized = imgs.length > 0 && imgs.every(function (img) {
      return /(^|\s)img-s[1-4](\s|$)/.test(img.className);
    });
    if (allSized) {
      gallery.className = "img-row";
    } else {
      gallery.className = "post-gallery";
      gallery.dataset.count = String(imgs.length);
    }
    container.insertBefore(gallery, blocks[0].node);
    blocks.forEach(function (block) {
      if (block.node.parentNode === container && !block.node.querySelector("img")) {
        container.removeChild(block.node);
      }
    });
    imgs.forEach(function (img) {
      wire(img, imgs);
    });
  }

  function enhance(container) {
    if (!container) return;
    var nodes = Array.prototype.slice.call(container.childNodes);
    var run = [];
    function flush() {
      var total = run.reduce(function (n, block) {
        return n + block.imgs.length;
      }, 0);
      if (total >= 2) buildGallery(run, container);
      run = [];
    }
    nodes.forEach(function (node) {
      if (isWhitespaceText(node)) return;
      var imgs = isImageOnly(node);
      if (imgs) run.push({ node: node, imgs: imgs });
      else flush();
    });
    flush();
    // Lone images are still clickable.
    Array.prototype.forEach.call(container.querySelectorAll("img"), function (img) {
      if (!img.dataset.galleryWired) wire(img, [img]);
    });
  }

  var box = null;
  var state = { list: [], index: 0 };

  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.className = "forum-lightbox";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Image viewer");
    box.innerHTML =
      '<button type="button" class="forum-lightbox-close" aria-label="Close image viewer">&times;</button>' +
      '<button type="button" class="forum-lightbox-nav forum-lightbox-prev" aria-label="Previous image">&#8249;</button>' +
      '<img class="forum-lightbox-img" alt="">' +
      '<button type="button" class="forum-lightbox-nav forum-lightbox-next" aria-label="Next image">&#8250;</button>' +
      '<div class="forum-lightbox-dots"></div>';
    document.body.appendChild(box);

    box.addEventListener("click", function (e) {
      if (e.target === box) close();
    });
    box.querySelector(".forum-lightbox-close").addEventListener("click", close);
    box.querySelector(".forum-lightbox-prev").addEventListener("click", function () { step(-1); });
    box.querySelector(".forum-lightbox-next").addEventListener("click", function () { step(1); });
    box.querySelector(".forum-lightbox-dots").addEventListener("click", function (e) {
      var dot = e.target.closest(".forum-lightbox-dot");
      if (dot) show(parseInt(dot.dataset.index, 10) || 0);
    });
    document.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    });
    return box;
  }

  function render() {
    var img = box.querySelector(".forum-lightbox-img");
    var source = state.list[state.index];
    img.src = source ? (source.dataset.full || source.currentSrc || source.src) : "";
    img.alt = source ? source.alt || "" : "";
    var many = state.list.length > 1;
    box.querySelector(".forum-lightbox-prev").hidden = !many;
    box.querySelector(".forum-lightbox-next").hidden = !many;
    var dots = box.querySelector(".forum-lightbox-dots");
    dots.innerHTML = "";
    dots.hidden = !many;
    if (many) {
      state.list.forEach(function (_, i) {
        var dot = document.createElement("button");
        dot.type = "button";
        dot.className = "forum-lightbox-dot" + (i === state.index ? " active" : "");
        dot.dataset.index = String(i);
        dot.setAttribute("aria-label", "Image " + (i + 1));
        dots.appendChild(dot);
      });
    }
  }

  function show(index) {
    state.index = index;
    render();
  }

  function open(list, index) {
    if (!list || !list.length) return;
    ensureBox();
    state.list = list.slice();
    state.index = Math.max(0, Math.min(index || 0, list.length - 1));
    render();
    box.hidden = false;
    document.body.classList.add("lightbox-open");
  }

  function close() {
    if (!box) return;
    box.hidden = true;
    state.list = [];
    document.body.classList.remove("lightbox-open");
  }

  function step(delta) {
    if (state.list.length < 2) return;
    state.index = (state.index + delta + state.list.length) % state.list.length;
    render();
  }

  window.ForumGallery = { enhance: enhance, open: open, close: close };
})();
