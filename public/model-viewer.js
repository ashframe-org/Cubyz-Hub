// Shared static 3D model viewer used by the models page and the dashboard.
// Renders a single auto-rotating GLB preview; keeps a hard cap on live WebGL
// contexts by exposing dispose() and a module-level registry.
(function () {
  "use strict";

  // Which official base GLB/texture each skin targets.
  var OFFICIAL_MODELS = {
    "cubyz:snale": { glb: "/models-official/snale.glb?v=20261004-1", texture: "/models-official/snale.png", rotateX: false, rotationOffsetY: 0 },
    "cubyz:snela": { glb: "/models-official/snela.glb?v=20261004-1", texture: "/models-official/snela.png", rotateX: false, rotationOffsetY: 0 },
    "cubyz:snail": { glb: "/models-official/snail.glb?v=20261004-1", texture: "/models-official/snail.png", rotateX: false, rotationOffsetY: Math.PI },
    "cubyz:moffalo": { glb: "/models-official/moffalo.glb?v=20261004-1", texture: "/models-official/moffalo.png", rotateX: false, rotationOffsetY: Math.PI },
    "cubyz:cubert": { glb: "/models-official/cubert.glb?v=20261004-1", texture: "/models-official/cubert.png", rotateX: false, rotationOffsetY: 0 },
  };

  // Does the loaded GLB scene already carry a texture of its own?
  function glbHasTexture(model) {
    let has = false;
    model.traverse(function (child) {
      if (has || !child.isMesh) return;
      const mat = child.material;
      const mats = Array.isArray(mat) ? mat : [mat];
      if (mats.some(function (m) { return m && m.map; })) has = true;
    });
    return has;
  }

  // Resolve the mesh/texture/rotation for a model row (mirrors the models page).
  function resolveModel(model) {
    if (model.asset_type === "skin_only") {
      const base = OFFICIAL_MODELS[model.associated_model] || OFFICIAL_MODELS["cubyz:snale"];
      return {
        glbPath: base.glb,
        texturePath: model.texture_path || base.texture,
        rotateX: base.rotateX,
        offsetY: base.rotationOffsetY,
        keepEmbedded: false,
      };
    }
    return {
      glbPath: model.glb_path,
      texturePath: model.texture_path,
      rotateX: false,
      offsetY: 0,
      keepEmbedded: true,
    };
  }

  const liveViewers = [];

  function disposeViewer(v) {
    if (v.animId) cancelAnimationFrame(v.animId);
    if (v.renderer) {
      try { if (v.renderer.setAnimationLoop) v.renderer.setAnimationLoop(null); } catch (_) {}
      try { if (v.renderer.forceContextLoss) v.renderer.forceContextLoss(); } catch (_) {}
      v.renderer.dispose();
      if (v.renderer.domElement && v.renderer.domElement.parentNode) {
        v.renderer.domElement.parentNode.removeChild(v.renderer.domElement);
      }
    }
    if (v.scene) {
      v.scene.traverse(function (child) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(function (m) { m.dispose(); });
          else child.material.dispose();
        }
      });
    }
  }

  function disposeAll() {
    while (liveViewers.length) disposeViewer(liveViewers.pop());
  }

  function mount(container, model, opts) {
    if (!container || !window.THREE || !window.THREE.GLTFLoader) return null;
    opts = opts || {};
    const resolved = resolveModel(model);
    if (!resolved.glbPath) return null;

    const width = container.clientWidth || 200;
    const height = container.clientHeight || 140;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0.2, 3.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    const record = { animId: null, renderer: scene };
    liveViewers.push(record);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    const loader = new THREE.GLTFLoader();
    loader.load(encodeURI(resolved.glbPath), function (gltf) {
      const mesh = gltf.scene;
      if (resolved.rotateX) {
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = resolved.offsetY;
      } else {
        mesh.rotation.y = resolved.offsetY;
      }

      if (resolved.texturePath && !(resolved.keepEmbedded && glbHasTexture(mesh))) {
        new THREE.TextureLoader().load(encodeURI(resolved.texturePath), function (texture) {
          texture.flipY = false;
          if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          mesh.traverse(function (child) {
            if (child.isMesh) {
              child.material = new THREE.MeshBasicMaterial({
                map: texture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
              });
              child.material.needsUpdate = true;
            }
          });
        });
      }

      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      mesh.position.sub(center);
      scene.add(mesh);

      const speed = opts.spinSpeed != null ? opts.spinSpeed : 0.004;
      function animate() {
        record.animId = requestAnimationFrame(animate);
        const ctx = renderer.getContext && renderer.getContext();
        if (!ctx || (ctx.isContextLost && ctx.isContextLost())) return;
        if (resolved.rotateX) mesh.rotation.z += speed;
        else mesh.rotation.y += speed;
        try { renderer.render(scene, camera); } catch (_) {}
      }
      animate();
    }, undefined, function (err) {
      if (opts.onError) opts.onError(err);
    });

    return record;
  }

  window.ModelViewer = { mount: mount, disposeAll: disposeAll, resolveModel: resolveModel };
})();
