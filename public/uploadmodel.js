
const OFFICIAL_MODELS = [
  { id: "snale", title: "Snale", identifier: "cubyz:snale", glb: "/models-official/snale.glb?v=20261004-1", texture: "/models-official/snale.png", rotateX: false, rotationOffsetY: 0 },
  { id: "snela", title: "Snela", identifier: "cubyz:snela", glb: "/models-official/snela.glb?v=20261004-1", texture: "/models-official/snela.png", rotateX: false, rotationOffsetY: 0 },
  { id: "snail", title: "Snail", identifier: "cubyz:snail", glb: "/models-official/snail.glb?v=20261004-1", texture: "/models-official/snail.png", rotateX: false, rotationOffsetY: Math.PI },
  { id: "moffalo", title: "Moffalo", identifier: "cubyz:moffalo", glb: "/models-official/moffalo.glb?v=20261004-1", texture: "/models-official/moffalo.png", rotateX: false, rotationOffsetY: Math.PI },
  { id: "cubert", title: "Cubert", identifier: "cubyz:cubert", glb: "/models-official/cubert.glb?v=20261004-1", texture: "/models-official/cubert.png", rotateX: false, rotationOffsetY: 0 },
];

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function requireLogin() {
  document.body.classList.add("um-locked");
  let attempts = 0;
  const tryOpen = setInterval(() => {
    const authBtn = document.querySelector("#authBtn,[data-open-auth]");
    if (authBtn) {
      clearInterval(tryOpen);
      authBtn.click();
    } else if (++attempts > 40) {
      clearInterval(tryOpen);
    }
  }, 100);
}

let currentUser = null;

async function loadCurrentUser() {
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();
    if (data.ok && data.user) {
      currentUser = data.user;
      return true;
    }
  } catch (_) {}
  return false;
}


const params = new URLSearchParams(window.location.search);
const remixOfId = params.get("remixOf");
const editId = params.get("edit");
const baseId = params.get("base");


let parentModelId = null;
let associatedModel = null;
let editingModelId = null;
let baseGlbPath = null;
let baseRotateX = false;
let baseRotationOffsetY = 0;
let baseTextureUrl = null;
let customGlbFile = null;
let customCoordinateSystem = null;
let isFullCustomModel = false;


const stepEls = {
  1: document.getElementById("umStep1"),
  2: document.getElementById("umStep2"),
  3: document.getElementById("umStep3"),
};
const stepIndicators = {
  1: document.getElementById("umStep1Indicator"),
  2: document.getElementById("umStep2Indicator"),
  3: document.getElementById("umStep3Indicator"),
};

function goToStep(n) {
  [1, 2, 3].forEach((i) => {
    stepEls[i].classList.toggle("hidden", i !== n);
    stepIndicators[i].classList.toggle("active", i === n);
  });
  if (n === 2 && !painterInitialized) {
    initPainter();
  }
}


const baseGrid = document.getElementById("umBaseGrid");
const customToggleBtn = document.getElementById("umCustomModelToggle");
const customModelBox = document.getElementById("umCustomModelBox");
const customGlbInput = document.getElementById("umCustomGlbInput");
const customTextureInput = document.getElementById("umCustomTextureInput");
const customModelError = document.getElementById("umCustomModelError");
const customModelNextBtn = document.getElementById("umCustomModelNext");

function renderBaseGrid() {
  baseGrid.innerHTML = "";
  OFFICIAL_MODELS.forEach((model) => {
    const card = document.createElement("div");
    card.className = "um-base-card";
    card.dataset.base = model.id;
    const img = document.createElement("img");
    img.src = model.texture;
    img.alt = model.title;
    const label = document.createElement("span");
    label.textContent = model.title;
    card.appendChild(img);
    card.appendChild(label);
    card.addEventListener("click", () => selectOfficialBase(model, card));
    baseGrid.appendChild(card);
  });
}

function selectOfficialBase(model, cardEl) {
  baseGrid.querySelectorAll(".um-base-card").forEach((c) => c.classList.remove("selected"));
  if (cardEl) cardEl.classList.add("selected");

  isFullCustomModel = false;
  customGlbFile = null;
  associatedModel = model.identifier;
  baseGlbPath = model.glb;
  baseRotateX = model.rotateX;
  baseRotationOffsetY = model.rotationOffsetY;
  baseTextureUrl = model.texture;

  goToStep(2);
}

customToggleBtn.addEventListener("click", () => {
  customModelBox.classList.toggle("hidden");
});

customModelNextBtn.addEventListener("click", () => {
  customModelError.hidden = true;
  const glbFile = customGlbInput.files[0];
  const textureFile = customTextureInput.files[0];
  if (!glbFile) {
    customModelError.textContent = "A .glb model file is required.";
    customModelError.hidden = false;
    return;
  }
  if (!textureFile) {
    customModelError.textContent = "A .png texture file is required.";
    customModelError.hidden = false;
    return;
  }
  const coordChoice = document.querySelector('input[name="umCoordSystem"]:checked');
  if (!coordChoice) {
    customModelError.textContent = "Select the coordinate system (Y up or Z up).";
    customModelError.hidden = false;
    return;
  }

  isFullCustomModel = true;
  associatedModel = null;
  customGlbFile = glbFile;
  customCoordinateSystem = coordChoice.value;
  baseGlbPath = URL.createObjectURL(glbFile);
  baseRotateX = false;
  baseRotationOffsetY = 0;
  baseTextureUrl = URL.createObjectURL(textureFile);

  goToStep(2);
});


let painterInitialized = false;
let activeTool = "paint";
let isDragging = false;
let panStartX = 0, panStartY = 0, scrollStartX = 0, scrollStartY = 0;
let zoomLevel = 1;
let scaleMultiplier = 8;

let paintCanvas, paintCtx, gridCanvas, gridCtx;
let isPainting = false;
let updateTimer = null;
let loadedBaseImage = null;
let undoStack = [];
const MAX_UNDO_STEPS = 25;

// Selection / clipboard (copy-paste) state.
let clipboardCanvas = null;
let selection = null; // { x, y, w, h } in texture pixels
let selectStart = null;
let pasteState = null; // { canvas, x, y }
let pastePos = null; // { x, y } cursor position in texture pixels

let previewScene, previewCamera, previewRenderer, previewMeshInstance, previewThreeTexture;
let previewAnimId = null;

const paintStatusEl = document.getElementById("umPaintStatus");
const toolPaintBtn = document.getElementById("umToolPaint");
const toolPanBtn = document.getElementById("umToolPan");
const toolEyedropperBtn = document.getElementById("umToolEyedropper");
const zoomInBtn = document.getElementById("umZoomIn");
const zoomOutBtn = document.getElementById("umZoomOut");
const paintColorInput = document.getElementById("umPaintColor");
const brushSizeInput = document.getElementById("umBrushSize");
const showGridToggle = document.getElementById("umShowGridToggle");
const undoBtn = document.getElementById("umUndoBtn");
const resetBtn = document.getElementById("umResetBtn");
const canvasScrollContainer = document.getElementById("umCanvasScrollContainer");
const paintAreaContainer = document.getElementById("umPaintAreaContainer");
const toolEraserBtn = document.getElementById("umToolEraser");
const toolSelectBtn = document.getElementById("umToolSelect");
const opacityInput = document.getElementById("umOpacity");
const opacityValueEl = document.getElementById("umOpacityValue");
const cloudStatusEl = document.getElementById("umCloudStatus");
const saveBtn = document.getElementById("umSaveBtn");
const cloudBtn = document.getElementById("umCloudBtn");
const cloudOverlay = document.getElementById("umCloudOverlay");
const cloudList = document.getElementById("umCloudList");
const cloudCloseBtn = document.getElementById("umCloudClose");
const brushCursorEl = document.getElementById("umBrushCursor");

function eraseMode() {
  return activeTool === "eraser" || Number(opacityInput.value) === 0;
}

function setTool(tool) {
  activeTool = tool;
  toolPaintBtn.classList.toggle("active", tool === "paint");
  toolEraserBtn.classList.toggle("active", tool === "eraser");
  toolSelectBtn.classList.toggle("active", tool === "select");
  toolPanBtn.classList.toggle("active", tool === "pan");
  toolEyedropperBtn.classList.toggle("active", tool === "eyedropper");
  if (gridCanvas) {
    gridCanvas.style.cursor = tool === "pan" ? "grab" : "crosshair";
  }
  if (brushCursorEl && tool !== "paint" && tool !== "eraser") brushCursorEl.hidden = true;
}
toolPaintBtn.addEventListener("click", () => setTool("paint"));
toolEraserBtn.addEventListener("click", () => setTool("eraser"));
toolSelectBtn.addEventListener("click", () => setTool("select"));
toolPanBtn.addEventListener("click", () => setTool("pan"));
toolEyedropperBtn.addEventListener("click", () => setTool("eyedropper"));

opacityInput.addEventListener("input", () => {
  opacityValueEl.textContent = opacityInput.value + "%";
  if (Number(opacityInput.value) === 0 && activeTool === "paint") {
    paintStatusEl.textContent = "Opacity 0 - painting erases";
    paintStatusEl.classList.add("visible");
    setTimeout(() => paintStatusEl.classList.remove("visible"), 1400);
  }
});

function pickColor(e) {
  const rect = gridCanvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * paintCanvas.width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * paintCanvas.height);
  const pixel = paintCtx.getImageData(x, y, 1, 1).data;
  if (pixel[3] === 0) return;
  const hex = "#" + [pixel[0], pixel[1], pixel[2]].map((c) => c.toString(16).padStart(2, "0")).join("");
  paintColorInput.value = hex;
  setTool("paint");
}

function changeZoom(delta) {
  zoomLevel = Math.max(0.5, Math.min(5, zoomLevel + delta));
  applyCanvasZoom();
}
zoomInBtn.addEventListener("click", () => changeZoom(0.5));
zoomOutBtn.addEventListener("click", () => changeZoom(-0.5));

canvasScrollContainer.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    changeZoom(e.deltaY < 0 ? 0.25 : -0.25);
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  const onPaintStep = !stepEls[2].classList.contains("hidden");
  const mod = e.ctrlKey || e.metaKey;
  const key = (e.key || "").toLowerCase();
  if (mod && key === "z" && onPaintStep) {
    e.preventDefault();
    undoPaint();
  } else if (mod && key === "c" && onPaintStep) {
    e.preventDefault();
    copySelection();
  } else if (mod && key === "v" && onPaintStep) {
    e.preventDefault();
    beginPaste();
  } else if (e.key === "Escape" && onPaintStep) {
    if (pasteState) cancelPaste();
    else if (selection) { selection = null; drawOverlays(); }
  }
});

function applyCanvasZoom(onDone) {
  if (!loadedBaseImage || !paintCanvas || !gridCanvas) return;

  const baseWidth = loadedBaseImage.width;
  const baseHeight = loadedBaseImage.height;
  const displayWidth = baseWidth * scaleMultiplier * zoomLevel;
  const displayHeight = baseHeight * scaleMultiplier * zoomLevel;
  const drawingBackup = paintCanvas.toDataURL();

  const prevWidth = gridCanvas.width || displayWidth;
  const prevHeight = gridCanvas.height || displayHeight;
  const centerFracX = (canvasScrollContainer.scrollLeft + canvasScrollContainer.clientWidth / 2) / prevWidth;
  const centerFracY = (canvasScrollContainer.scrollTop + canvasScrollContainer.clientHeight / 2) / prevHeight;

  paintCanvas.width = baseWidth;
  paintCanvas.height = baseHeight;
  gridCanvas.width = displayWidth;
  gridCanvas.height = displayHeight;

  [paintCanvas, gridCanvas].forEach((c) => {
    c.style.width = displayWidth + "px";
    c.style.height = displayHeight + "px";
  });

  paintAreaContainer.style.width = displayWidth + "px";
  paintAreaContainer.style.height = displayHeight + "px";

  canvasScrollContainer.scrollLeft = centerFracX * displayWidth - canvasScrollContainer.clientWidth / 2;
  canvasScrollContainer.scrollTop = centerFracY * displayHeight - canvasScrollContainer.clientHeight / 2;

  const tempImg = new Image();
  tempImg.src = drawingBackup;
  tempImg.onload = () => {
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    paintCtx.drawImage(tempImg, 0, 0);
    drawOverlays();
    if (onDone) onDone();
  };
}

function drawGridOverlay() {
  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  if (!showGridToggle.checked) return;

  gridCtx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  gridCtx.lineWidth = 1;

  for (let x = 0; x <= gridCanvas.width; x += scaleMultiplier) {
    gridCtx.beginPath(); gridCtx.moveTo(x, 0); gridCtx.lineTo(x, gridCanvas.height); gridCtx.stroke();
  }
  for (let y = 0; y <= gridCanvas.height; y += scaleMultiplier) {
    gridCtx.beginPath(); gridCtx.moveTo(0, y); gridCtx.lineTo(gridCanvas.width, y); gridCtx.stroke();
  }
}

function pixelToDisplay(v) {
  return v * scaleMultiplier * zoomLevel;
}

// Grid + selection marquee + paste ghost, all on the overlay canvas.
function drawOverlays() {
  if (!gridCtx) return;
  drawGridOverlay();

  if (selection) {
    const s = pixelToDisplay(1);
    gridCtx.save();
    gridCtx.setLineDash([6, 4]);
    gridCtx.strokeStyle = "#5BA65B";
    gridCtx.lineWidth = 1;
    gridCtx.strokeRect(selection.x * s + 0.5, selection.y * s + 0.5, selection.w * s, selection.h * s);
    gridCtx.restore();
  }

  if (pasteState && pastePos) {
    const s = pixelToDisplay(1);
    const cw = pasteState.canvas.width;
    const ch = pasteState.canvas.height;
    const px = (pastePos.x - Math.floor(cw / 2)) * s;
    const py = (pastePos.y - Math.floor(ch / 2)) * s;
    gridCtx.save();
    gridCtx.imageSmoothingEnabled = false;
    gridCtx.globalAlpha = 0.85;
    gridCtx.drawImage(pasteState.canvas, px, py, cw * s, ch * s);
    gridCtx.globalAlpha = 1;
    gridCtx.setLineDash([6, 4]);
    gridCtx.strokeStyle = "#5BA65B";
    gridCtx.strokeRect(px + 0.5, py + 0.5, cw * s, ch * s);
    gridCtx.restore();
  }
}

function eventToPixel(e) {
  const rect = gridCanvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * paintCanvas.width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * paintCanvas.height);
  return {
    x: Math.max(0, Math.min(paintCanvas.width - 1, x)),
    y: Math.max(0, Math.min(paintCanvas.height - 1, y)),
  };
}

let lastBrushPointer = null;

// Square outline following the cursor, sized to the brush in texture pixels,
// so you can see how big a stroke will be before painting.
function updateBrushCursor(e) {
  if (!brushCursorEl || !paintCanvas) return;
  lastBrushPointer = e;
  if (activeTool === "pan" || activeTool === "eyedropper" || activeTool === "select" || pasteState) {
    brushCursorEl.hidden = true;
    return;
  }
  const pt = eventToPixel(e);
  const size = parseInt(brushSizeInput.value, 10) || 1;
  const s = scaleMultiplier * zoomLevel;
  brushCursorEl.hidden = false;
  brushCursorEl.style.left = (pt.x - Math.floor(size / 2)) * s + "px";
  brushCursorEl.style.top = (pt.y - Math.floor(size / 2)) * s + "px";
  brushCursorEl.style.width = size * s + "px";
  brushCursorEl.style.height = size * s + "px";
}

brushSizeInput.addEventListener("input", () => {
  if (lastBrushPointer && brushCursorEl && !brushCursorEl.hidden) updateBrushCursor(lastBrushPointer);
});

function copySelection() {
  if (!paintCanvas) return;
  const region = selection || { x: 0, y: 0, w: paintCanvas.width, h: paintCanvas.height };
  if (region.w < 1 || region.h < 1) return;
  const c = document.createElement("canvas");
  c.width = region.w;
  c.height = region.h;
  c.getContext("2d").drawImage(paintCanvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
  clipboardCanvas = c;
  showPaintStatus("Copied " + region.w + "\u00d7" + region.h + " - Ctrl+V to paste");
}

function beginPaste() {
  if (!clipboardCanvas || !paintCanvas) {
    showPaintStatus("Nothing copied yet - select an area and Ctrl+C first");
    return;
  }
  pasteState = { canvas: clipboardCanvas };
  if (selection) {
    pastePos = { x: selection.x + Math.floor(selection.w / 2), y: selection.y + Math.floor(selection.h / 2) };
  } else {
    pastePos = { x: Math.floor(paintCanvas.width / 2), y: Math.floor(paintCanvas.height / 2) };
  }
  showPaintStatus("Click to place the pasted area - Esc to cancel");
  drawOverlays();
}

function cancelPaste() {
  pasteState = null;
  pastePos = null;
  drawOverlays();
}

function stampPaste(pt) {
  if (!pasteState) return;
  saveToUndoStack();
  const c = pasteState.canvas;
  paintCtx.drawImage(c, pt.x - Math.floor(c.width / 2), pt.y - Math.floor(c.height / 2));
  cancelPaste();
  update3DTextureFrom2DCanvas();
}

showGridToggle.addEventListener("change", drawOverlays);

function showPaintStatus(text, ms) {
  if (!paintStatusEl) return;
  paintStatusEl.classList.add("visible");
  paintStatusEl.textContent = text;
  clearTimeout(showPaintStatus._t);
  showPaintStatus._t = setTimeout(() => paintStatusEl.classList.remove("visible"), ms || 1400);
}

function draw(e) {
  const pt = eventToPixel(e);
  const size = parseInt(brushSizeInput.value, 10) || 1;

  paintCtx.save();
  if (eraseMode()) {
    paintCtx.globalCompositeOperation = "destination-out";
    paintCtx.globalAlpha = 1;
    paintCtx.fillStyle = "#000";
  } else {
    paintCtx.globalCompositeOperation = "source-over";
    paintCtx.globalAlpha = Math.max(0, Math.min(1, Number(opacityInput.value) / 100));
    paintCtx.fillStyle = paintColorInput.value;
  }
  paintCtx.fillRect(pt.x - Math.floor(size / 2), pt.y - Math.floor(size / 2), size, size);
  paintCtx.restore();

  if (updateTimer) clearTimeout(updateTimer);

  paintStatusEl.classList.add("visible");
  paintStatusEl.textContent = "Drawing…";

  updateTimer = setTimeout(() => {
    update3DTextureFrom2DCanvas();
    paintStatusEl.textContent = "Saved to 3D view.";
    setTimeout(() => paintStatusEl.classList.remove("visible"), 1000);
  }, 300);
}

function updateUndoButtonState() {
  undoBtn.disabled = undoStack.length <= 1;
}

function saveToUndoStack() {
  if (undoStack.length >= MAX_UNDO_STEPS) undoStack.shift();
  undoStack.push(paintCanvas.toDataURL());
  updateUndoButtonState();
}

function undoPaint() {
  if (undoStack.length <= 1) return;
  undoStack.pop();
  updateUndoButtonState();
  const previousStateURL = undoStack[undoStack.length - 1];

  const img = new Image();
  img.onload = () => {
    if (loadedBaseImage) {
      paintCanvas.width = loadedBaseImage.width;
      paintCanvas.height = loadedBaseImage.height;
    }
    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    paintCtx.drawImage(img, 0, 0);
    applyCanvasZoom(() => update3DTextureFrom2DCanvas());
  };
  img.onerror = () => {
    console.error("Undo failed: could not load the previous canvas state.");
  };
  img.src = previousStateURL;
}
undoBtn.addEventListener("click", undoPaint);

function clearToBaseTexture() {
  if (!loadedBaseImage) return;
  saveToUndoStack();
  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  paintCtx.drawImage(loadedBaseImage, 0, 0);
  update3DTextureFrom2DCanvas();
}
resetBtn.addEventListener("click", () => {
  if (confirm("Reset the texture back to the original base? This can't be undone.")) {
    clearToBaseTexture();
  }
});

function update3DTextureFrom2DCanvas() {
  if (!previewThreeTexture || !paintCanvas) return;

  const imgData = paintCanvas.toDataURL();
  const loader = new THREE.TextureLoader();
  loader.load(imgData, (newTexture) => {
    newTexture.flipY = false;
    if (THREE.sRGBEncoding) newTexture.encoding = THREE.sRGBEncoding;
    newTexture.magFilter = THREE.NearestFilter;
    newTexture.minFilter = THREE.NearestFilter;

    const oldTexture = previewThreeTexture;
    previewThreeTexture = newTexture;
    if (previewMeshInstance) {
      previewMeshInstance.traverse((child) => {
        if (child.isMesh) {
          child.material.map = previewThreeTexture;
          child.material.needsUpdate = true;
        }
      });
    }
    if (oldTexture && oldTexture !== newTexture) oldTexture.dispose();
  });
}

function setupPainterCanvas(textureUrl) {
  paintCanvas = document.getElementById("umTexturePainter");
  paintCtx = paintCanvas.getContext("2d");
  gridCanvas = document.getElementById("umGridOverlayCanvas");
  gridCtx = gridCanvas.getContext("2d");

  loadedBaseImage = new Image();
  loadedBaseImage.crossOrigin = "anonymous";
  loadedBaseImage.src = textureUrl;
  loadedBaseImage.onload = () => {
    scaleMultiplier = loadedBaseImage.width <= 64 ? 12 : 6;
    zoomLevel = 1.0;

    paintCanvas.width = loadedBaseImage.width;
    paintCanvas.height = loadedBaseImage.height;

    paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
    paintCtx.drawImage(loadedBaseImage, 0, 0);

    applyCanvasZoom();
    saveToUndoStack();

    if (previewThreeTexture) update3DTextureFrom2DCanvas();
    setTool("paint");
  };

  gridCanvas.onmousedown = (e) => {
    if (activeTool === "pan") {
      isDragging = true;
      gridCanvas.style.cursor = "grabbing";
      panStartX = e.clientX;
      panStartY = e.clientY;
      scrollStartX = canvasScrollContainer.scrollLeft;
      scrollStartY = canvasScrollContainer.scrollTop;
    } else if (pasteState) {
      stampPaste(eventToPixel(e));
    } else if (activeTool === "eyedropper") {
      pickColor(e);
    } else if (activeTool === "select") {
      const pt = eventToPixel(e);
      selectStart = pt;
      selection = { x: pt.x, y: pt.y, w: 0, h: 0 };
      drawOverlays();
    } else {
      isPainting = true;
      saveToUndoStack();
      draw(e);
    }
  };

  gridCanvas.onmousemove = (e) => {
    updateBrushCursor(e);
    if (activeTool === "pan" && isDragging) {
      canvasScrollContainer.scrollLeft = scrollStartX - (e.clientX - panStartX);
      canvasScrollContainer.scrollTop = scrollStartY - (e.clientY - panStartY);
      return;
    }
    if (pasteState) {
      pastePos = eventToPixel(e);
      drawOverlays();
      return;
    }
    if (activeTool === "select" && selectStart) {
      const pt = eventToPixel(e);
      selection = {
        x: Math.min(selectStart.x, pt.x),
        y: Math.min(selectStart.y, pt.y),
        w: Math.abs(pt.x - selectStart.x) + 1,
        h: Math.abs(pt.y - selectStart.y) + 1,
      };
      drawOverlays();
      return;
    }
    if (activeTool === "paint" && isPainting) {
      draw(e);
    }
  };

  window.addEventListener("mouseup", () => {
    isPainting = false;
    isDragging = false;
    selectStart = null;
    if (activeTool === "pan" && gridCanvas) gridCanvas.style.cursor = "grab";
  });

  gridCanvas.onmouseleave = () => {
    if (brushCursorEl) brushCursorEl.hidden = true;
  };
}

let previewPivot = null;
let previewYaw = 0;
let previewPitch = 0;
let previewDistance = 3.2;
let previewDragging = false;
let previewLastX = 0;
let previewLastY = 0;

function setupPreviewViewer() {
  const container = document.getElementById("umPreviewCanvasContainer");

  // Tear down any previous renderer so switching saves doesn't leak contexts.
  if (previewRenderer) {
    cancelAnimationFrame(previewAnimId);
    previewRenderer.dispose();
    previewRenderer.domElement.remove();
    previewRenderer = null;
    previewPivot = null;
    previewMeshInstance = null;
    previewThreeTexture = null;
  }

  container.innerHTML = "";

  previewScene = new THREE.Scene();
  previewScene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight.position.set(5, 10, 7.5);
  previewScene.add(dirLight);

  previewCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  previewYaw = baseRotationOffsetY || 0;
  previewPitch = 0;
  previewDistance = 3.2;
  previewCamera.position.set(0, 0.2, previewDistance);

  previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  previewRenderer.setSize(container.clientWidth, container.clientHeight);
  if (THREE.sRGBEncoding) previewRenderer.outputEncoding = THREE.sRGBEncoding;
  previewRenderer.domElement.style.cursor = "grab";
  container.appendChild(previewRenderer.domElement);

  previewPivot = new THREE.Group();
  previewScene.add(previewPivot);

  previewRenderer.domElement.addEventListener("pointerdown", (e) => {
    previewDragging = true;
    previewLastX = e.clientX;
    previewLastY = e.clientY;
    previewRenderer.domElement.style.cursor = "grabbing";
  });
  window.addEventListener("pointerup", () => {
    previewDragging = false;
    if (previewRenderer) previewRenderer.domElement.style.cursor = "grab";
  });
  window.addEventListener("pointermove", (e) => {
    if (!previewDragging) return;
    previewYaw += (e.clientX - previewLastX) * 0.008;
    previewPitch = Math.max(-1.2, Math.min(1.2, previewPitch + (e.clientY - previewLastY) * 0.008));
    previewLastX = e.clientX;
    previewLastY = e.clientY;
  });
  previewRenderer.domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      previewDistance = Math.max(1.2, Math.min(8, previewDistance + e.deltaY * 0.003));
    },
    { passive: false }
  );

  const loader = new THREE.GLTFLoader();
  loader.load(encodeURI(baseGlbPath), (gltf) => {
    previewMeshInstance = gltf.scene;
    if (baseRotateX) previewMeshInstance.rotation.x = -Math.PI / 2;

    new THREE.TextureLoader().load(encodeURI(baseTextureUrl), (texture) => {
      texture.flipY = false;
      if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      previewThreeTexture = texture;

      previewMeshInstance.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshBasicMaterial({
            map: previewThreeTexture,
            transparent: true,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
          });
          child.material.needsUpdate = true;
        }
      });
      update3DTextureFrom2DCanvas();
    });

    const box = new THREE.Box3().setFromObject(previewMeshInstance);
    const center = box.getCenter(new THREE.Vector3());
    previewMeshInstance.position.sub(center);
    previewPivot.add(previewMeshInstance);
  });

  function run() {
    previewAnimId = requestAnimationFrame(run);
    if (previewPivot) {
      previewPivot.rotation.y = previewYaw;
      previewPivot.rotation.x = previewPitch;
    }
    previewCamera.position.set(0, 0.2, previewDistance);
    previewCamera.lookAt(0, 0, 0);
    previewRenderer.render(previewScene, previewCamera);
  }
  run();
}

function initPainter() {
  if (!baseGlbPath || !baseTextureUrl) return;
  painterInitialized = true;
  undoStack = [];
  selection = null;
  selectStart = null;
  pasteState = null;
  pastePos = null;
  if (saveBtn) saveBtn.disabled = false;
  setupPainterCanvas(baseTextureUrl);
  requestAnimationFrame(() => {
    setTimeout(() => setupPreviewViewer(), 5);
  });
}

document.getElementById("umBackToStep1").addEventListener("click", () => goToStep(1));
document.getElementById("umToStep3").addEventListener("click", () => goToStep(3));
document.getElementById("umBackToStep2").addEventListener("click", () => goToStep(2));


const titleInput = document.getElementById("umTitleInput");
const descriptionInput = document.getElementById("umDescriptionInput");
const detailsError = document.getElementById("umDetailsError");
const saveDraftBtn = document.getElementById("umSaveDraftBtn");
const publishBtn = document.getElementById("umPublishBtn");

const MODEL_TITLE_MAX_LENGTH = 80;
const MODEL_TITLE_PATTERN = /^[\p{L}\p{N} .,'"!?()&:-]+$/u;
const MODEL_DESCRIPTION_MAX_LENGTH = 500;

/* ---- Cloud saves: manual save + a library of your saved models ---- */
let cloudSaving = false;
let savedModelId = null;

function setCloudStatus(text, isError) {
  if (!cloudStatusEl) return;
  if (!text) {
    cloudStatusEl.hidden = true;
    cloudStatusEl.textContent = "";
    return;
  }
  cloudStatusEl.hidden = false;
  cloudStatusEl.textContent = text;
  cloudStatusEl.classList.toggle("error", !!isError);
}

async function saveToCloud() {
  if (!currentUser || !paintCanvas || !painterInitialized) return;
  if (cloudSaving) return;
  cloudSaving = true;
  const id = editingModelId || savedModelId;
  try {
    setCloudStatus("Saving…");
    const blob = await new Promise((resolve) => paintCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't export the texture.");
    const fd = new FormData();
    fd.append("title", titleInput.value.trim() || "Untitled skin");
    fd.append("description", descriptionInput.value.trim());
    fd.append("texture", blob, "texture.png");
    let url;
    if (id) {
      // Don't touch status: editing a published model must not unpublish it.
      url = `/api/models/${id}/update`;
      if (associatedModel) fd.append("associated_model", associatedModel);
    } else {
      url = "/api/models/upload";
      fd.append("status", "draft");
      fd.append("asset_type", isFullCustomModel ? "full_model" : "skin_only");
      if (associatedModel) fd.append("associated_model", associatedModel);
      if (parentModelId) fd.append("parent_model_id", String(parentModelId));
      if (isFullCustomModel && customGlbFile) fd.append("glb", customGlbFile);
      if (isFullCustomModel && customCoordinateSystem) fd.append("coordinate_system", customCoordinateSystem);
    }
    const res = await fetch(url, { method: "POST", body: fd });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Save failed.");
    if (!id) {
      savedModelId = data.model.id;
      editingModelId = data.model.id;
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("remixOf");
        u.searchParams.set("edit", String(data.model.id));
        window.history.replaceState({}, "", u);
      } catch (_) {
        /* ignore */
      }
    }
    setCloudStatus("Saved to your account");
    clearTimeout(saveToCloud._hide);
    saveToCloud._hide = setTimeout(() => {
      if (cloudStatusEl && cloudStatusEl.textContent === "Saved to your account") setCloudStatus("");
    }, 2500);
  } catch (err) {
    console.warn("Cloud save failed:", err);
    setCloudStatus("Cloud save failed", true);
  } finally {
    cloudSaving = false;
  }
}

function closeCloudPanel() {
  if (cloudOverlay) cloudOverlay.classList.add("hidden");
}

async function loadModelIntoEditor(id) {
  painterInitialized = false;
  editingModelId = null;
  savedModelId = null;
  const ok = await loadEditSource(id);
  if (ok && saveBtn) saveBtn.disabled = false;
}

function renderCloudList(models) {
  if (!cloudList) return;
  cloudList.innerHTML = "";
  if (!models.length) {
    const p = document.createElement("p");
    p.className = "um-cloud-empty";
    p.textContent = "Nothing saved yet. Paint something and press Save.";
    cloudList.appendChild(p);
    return;
  }
  models.forEach((m) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "um-cloud-item";

    const img = document.createElement("img");
    img.className = "um-cloud-thumb";
    img.loading = "lazy";
    img.alt = "";
    img.src = m.texture_path || "";

    const body = document.createElement("div");
    body.className = "um-cloud-item-body";
    const title = document.createElement("span");
    title.className = "um-cloud-item-title";
    title.textContent = m.title || "Untitled";
    const meta = document.createElement("span");
    meta.className = "um-cloud-item-meta";
    const when = (m.created_at || "").slice(0, 10);
    meta.textContent = (m.status === "draft" ? "Draft" : "Published") + (when ? " \u00b7 " + when : "");
    body.append(title, meta);

    item.append(img, body);
    item.addEventListener("click", () => {
      closeCloudPanel();
      loadModelIntoEditor(m.id);
    });
    cloudList.appendChild(item);
  });
}

async function openCloudPanel() {
  if (!cloudOverlay) return;
  cloudOverlay.classList.remove("hidden");
  cloudList.innerHTML = '<p class="um-cloud-empty">Loading\u2026</p>';
  try {
    const res = await fetch("/api/user/models", { credentials: "include" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load your saves.");
    renderCloudList(data.models || []);
  } catch (err) {
    cloudList.innerHTML = "";
    const p = document.createElement("p");
    p.className = "um-cloud-empty";
    p.textContent = err.message || "Failed to load your saves.";
    cloudList.appendChild(p);
  }
}

if (saveBtn) saveBtn.addEventListener("click", saveToCloud);
if (cloudBtn) cloudBtn.addEventListener("click", openCloudPanel);
if (cloudCloseBtn) cloudCloseBtn.addEventListener("click", closeCloudPanel);
if (cloudOverlay) {
  cloudOverlay.addEventListener("click", (e) => {
    if (e.target === cloudOverlay) closeCloudPanel();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cloudOverlay && !cloudOverlay.classList.contains("hidden")) closeCloudPanel();
});

function validateDetails() {
  const title = titleInput.value.trim();
  if (!title) return "Title is required.";
  if (title.length > MODEL_TITLE_MAX_LENGTH) return `Title must be ${MODEL_TITLE_MAX_LENGTH} characters or fewer.`;
  if (!MODEL_TITLE_PATTERN.test(title)) return "Title can only contain letters, numbers, spaces, and basic punctuation.";
  if (descriptionInput.value.length > MODEL_DESCRIPTION_MAX_LENGTH) return `Description must be ${MODEL_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  return null;
}

async function submitModel(status) {
  detailsError.hidden = true;
  const validationError = validateDetails();
  if (validationError) {
    detailsError.textContent = validationError;
    detailsError.hidden = false;
    return;
  }

  saveDraftBtn.disabled = true;
  publishBtn.disabled = true;

  try {
    if (!paintCanvas) throw new Error("Nothing painted yet.");

    const blob = await new Promise((resolve) => paintCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Failed to export texture.");

    const fd = new FormData();
    fd.append("title", titleInput.value.trim());
    fd.append("description", descriptionInput.value.trim());
    fd.append("status", status);
    fd.append("texture", blob, "texture.png");

    let url;
    if (editingModelId) {
      url = `/api/models/${editingModelId}/update`;
      if (isFullCustomModel && customCoordinateSystem) fd.append("coordinate_system", customCoordinateSystem);
    } else {
      url = "/api/models/upload";
      fd.append("asset_type", isFullCustomModel ? "full_model" : "skin_only");
      if (associatedModel) fd.append("associated_model", associatedModel);
      if (parentModelId) fd.append("parent_model_id", String(parentModelId));
      if (isFullCustomModel && customGlbFile) fd.append("glb", customGlbFile);
      if (isFullCustomModel && customCoordinateSystem) fd.append("coordinate_system", customCoordinateSystem);
    }

    const res = await fetch(url, { method: "POST", body: fd });
    const data = await res.json();
    if (!data.ok) {
      detailsError.textContent = data.error || "Save failed.";
      detailsError.hidden = false;
      return;
    }

    // Return the user to what they were doing: a remix goes back to the
    // source model's viewer, an edit goes back to that model, and a brand-new
    // upload lands on the dashboard.
    if (parentModelId) {
      window.location.href = `/models?model=${encodeURIComponent(parentModelId)}`;
    } else if (editingModelId) {
      window.location.href = `/models?model=${encodeURIComponent(editingModelId)}`;
    } else {
      window.location.href = "/dashboard";
    }
  } catch (err) {
    console.error("Save model failed:", err);
    detailsError.textContent = err.message || "Save failed.";
    detailsError.hidden = false;
  } finally {
    saveDraftBtn.disabled = false;
    publishBtn.disabled = false;
  }
}

saveDraftBtn.addEventListener("click", () => submitModel("draft"));
publishBtn.addEventListener("click", () => submitModel("published"));


async function loadRemixSource(modelId) {
  const res = await fetch(`/api/models/${modelId}`);
  const data = await res.json();
  if (!data.ok) {
    toast.error("That model couldn't be found or isn't available to remix.");
    return false;
  }
  const model = data.model;
  parentModelId = model.id;
  associatedModel = model.associated_model;
  const baseMatch = OFFICIAL_MODELS.find((m) => m.identifier === model.associated_model) || OFFICIAL_MODELS[0];
  baseTextureUrl = model.texture_path;
  titleInput.value = `${model.title} Remix`;

  // Remixing a custom full model keeps its own mesh (the server reuses the
  // parent's .glb on upload) instead of falling back to an official base.
  if (model.asset_type === "full_model" && model.glb_path) {
    isFullCustomModel = true;
    customCoordinateSystem = model.coordinate_system || null;
    baseGlbPath = model.glb_path;
    baseRotateX = false;
    baseRotationOffsetY = 0;
  } else {
    isFullCustomModel = false;
    baseGlbPath = baseMatch.glb;
    baseRotateX = baseMatch.rotateX;
    baseRotationOffsetY = baseMatch.rotationOffsetY;
  }

  document.getElementById("umStep1Title").textContent = `Remixing "${escapeHTML(model.title)}"`;
  document.getElementById("umStep1Subtitle").textContent = "Starting from this model's current texture. Continue to paint your own version.";
  baseGrid.classList.add("hidden");
  document.querySelector(".um-divider").classList.add("hidden");
  document.querySelector(".um-custom-toggle-row").classList.add("hidden");

  goToStep(2);
  return true;
}

async function loadEditSource(modelId) {
  const res = await fetch(`/api/models/${modelId}`);
  const data = await res.json();
  if (!data.ok) {
    toast.error("That model couldn't be found.");
    return false;
  }
  const model = data.model;
  if (!currentUser || model.user_id !== currentUser.id) {
    toast.error("You can only edit your own models.");
    return false;
  }

  editingModelId = model.id;
  isFullCustomModel = model.asset_type === "full_model";
  associatedModel = model.associated_model;
  parentModelId = model.parent_model_id;

  if (isFullCustomModel && model.glb_path) {
    baseGlbPath = model.glb_path;
    baseRotateX = false;
    baseRotationOffsetY = 0;
    customCoordinateSystem = model.coordinate_system || customCoordinateSystem;
  } else {
    const baseMatch = OFFICIAL_MODELS.find((m) => m.identifier === model.associated_model) || OFFICIAL_MODELS[0];
    baseGlbPath = baseMatch.glb;
    baseRotateX = baseMatch.rotateX;
    baseRotationOffsetY = baseMatch.rotationOffsetY;
  }
  baseTextureUrl = model.texture_path;
  titleInput.value = model.title || "";
  descriptionInput.value = model.description || "";

  document.getElementById("umStep1Title").textContent = `Editing "${escapeHTML(model.title)}"`;
  document.getElementById("umStep1Subtitle").textContent = "Continue to repaint this model's texture.";
  baseGrid.classList.add("hidden");
  document.querySelector(".um-divider").classList.add("hidden");
  document.querySelector(".um-custom-toggle-row").classList.add("hidden");

  goToStep(2);
  return true;
}

(async function init() {
  const loggedIn = await loadCurrentUser();
  if (!loggedIn) {
    requireLogin();
    return;
  }

  renderBaseGrid();

  if (editId) {
    await loadEditSource(editId);
  } else if (remixOfId) {
    await loadRemixSource(remixOfId);
  } else if (baseId) {
    // Deep link from the models page: pick that official model and jump to paint.
    const match = OFFICIAL_MODELS.find((m) => m.id === baseId || m.identifier === baseId);
    if (match) {
      const cardEl = baseGrid.querySelector(`.um-base-card[data-base="${match.id}"]`);
      selectOfficialBase(match, cardEl);
    }
  }
})();
