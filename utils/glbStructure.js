import fs from "fs";

// Cubyz's entity-model loader (src/entityModel.zig) rejects a model when any
// mesh node has no parent node (error.EntityModelPrimitiveHasNoParent) or
// when two group nodes share a name, and then silently swaps in the
// "missing" model. Blender exports that drop the part groups (Head, Torso,
// LeftArm, ...) hit this, so check uploads before they reach players.
export function checkGlbStructure(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.length < 20 || data.toString("latin1", 0, 4) !== "glTF") {
    throw new Error("The model is not a valid .glb file.");
  }
  const jsonLength = data.readUInt32LE(12);
  if (data.toString("latin1", 16, 20) !== "JSON" || 20 + jsonLength > data.length) {
    throw new Error("The model is not a valid .glb file.");
  }
  let gltf;
  try {
    gltf = JSON.parse(data.toString("utf8", 20, 20 + jsonLength));
  } catch {
    throw new Error("The model is not a valid .glb file.");
  }

  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const hasParent = new Set(nodes.flatMap((n) => n.children || []));
  const loose = nodes
    .filter((n, i) => n.mesh !== undefined && !hasParent.has(i))
    .map((n) => n.name || "unnamed");
  if (loose.length > 0) {
    throw new Error(
      `This model won't load in Cubyz: every mesh must be inside a parent group (e.g. Head, Torso, LeftArm), ` +
      `but ${loose.slice(0, 5).join(", ")}${loose.length > 5 ? ", ..." : ""} ${loose.length === 1 ? "has" : "have"} no parent. ` +
      `In Blender, parent each part to an Empty named after the body part and export the Empties too. ` +
      `To reskin Cubert or Snail, use the "Skin only" upload instead.`,
    );
  }

  const groupNames = nodes.filter((n) => n.children?.length).map((n) => n.name);
  const duplicate = groupNames.find((name, i) => groupNames.indexOf(name) !== i);
  if (duplicate !== undefined) {
    throw new Error(`This model won't load in Cubyz: two groups are both named "${duplicate}". Group names must be unique.`);
  }
}
