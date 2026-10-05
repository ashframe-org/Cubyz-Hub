import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { slugify } from "../utils/common.js";

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const baseDir = path.join(process.cwd(), "uploads");
    let folder;

    if (req._uploadFolder) {
      folder = req._uploadFolder;
    } else {
      const identifier = req.body.identifier || req.body.name || "unknown";
      const uniqueSuffix = crypto.randomBytes(4).toString('hex');
      folder = `${slugify(identifier)}-${uniqueSuffix}`;
    }

    const uploadDir = path.join(baseDir, folder);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    req._uploadFolder = folder;
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const allowedImageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

const MAX_ADDON_FILE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_ADDON_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'file') {
      if (ext !== '.zip') return cb(new Error('Only .zip files allowed'));
      return cb(null, true);
    }
    if (allowedImageExts.includes(ext)) return cb(null, true);
    return cb(new Error('Invalid file type'));
  }
});

const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(process.cwd(), "avatars");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const userId = req.session?.user?.id;
    if (!userId) return cb(new Error("Not authenticated"));
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${userId}.tmp${ext}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedImageExts.includes(ext)) return cb(null, true);
    return cb(new Error('Invalid file type'));
  }
});

const changelogScreenshotStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const entryId = req.params.id;
    const dir = path.join(process.cwd(), "uploads", "changelog", String(entryId));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString("hex") + ext);
  }
});

const uploadChangelogScreenshots = multer({
  storage: changelogScreenshotStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedImageExts.includes(ext)) return cb(null, true);
    return cb(new Error("Invalid file type"));
  }
});

const bannerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(process.cwd(), "banners");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const userId = req.session?.user?.id;
    if (!userId) return cb(new Error("Not authenticated"));
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `${userId}.tmp${ext}`);
  }
});

const uploadBanner = multer({
  storage: bannerStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedImageExts.includes(ext)) return cb(null, true);
    return cb(new Error('Invalid file type'));
  }
});

const forumImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(process.cwd(), "uploads", "forum", String(req.session?.user?.id || "anon"));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, crypto.randomBytes(16).toString("hex") + ext);
  }
});

const uploadForumImage = multer({
  storage: forumImageStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedImageExts.includes(ext)) return cb(null, true);
    return cb(new Error("Invalid image type"));
  }
});

const MAX_MODEL_FILE_BYTES = 50 * 1024 * 1024;
const modelStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const baseDir = path.join(process.cwd(), "uploads", "models");
    let folder;
    if (req._modelUploadFolder) {
      folder = req._modelUploadFolder;
    } else {
      const identifier = req.body.title || "untitled";
      const uniqueSuffix = crypto.randomBytes(4).toString('hex');
      folder = `${slugify(identifier)}-${uniqueSuffix}`;
    }
    const uploadDir = path.join(baseDir, folder);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    req._modelUploadFolder = folder;
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  }
});

const uploadModel = multer({
  storage: modelStorage,
  limits: { fileSize: MAX_MODEL_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'glb') {
      if (ext !== '.glb') return cb(new Error('Only .glb files allowed'));
      return cb(null, true);
    }
    if (file.fieldname === 'texture') {
      if (ext !== '.png') return cb(new Error('Only .png textures allowed'));
      return cb(null, true);
    }
    return cb(new Error('Invalid file type'));
  }
});
const serverIconStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const baseDir = path.join(process.cwd(), "uploads", "servers");
    let folder;
    if (req._serverUploadFolder) {
      folder = req._serverUploadFolder;
    } else {
      const identifier = req.body.name || "server";
      const uniqueSuffix = crypto.randomBytes(4).toString('hex');
      folder = `${slugify(identifier)}-${uniqueSuffix}`;
    }
    const uploadDir = path.join(baseDir, folder);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    req._serverUploadFolder = folder;
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  }
});

const uploadServerIcon = multer({
  storage: serverIconStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'icon') {
      if (!allowedImageExts.includes(ext)) return cb(new Error('Invalid image type'));
      return cb(null, true);
    }
    return cb(new Error('Invalid file type'));
  }
});

export { upload, uploadAvatar, uploadChangelogScreenshots, uploadBanner, uploadModel, uploadServerIcon, uploadForumImage };

const MAGIC_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAGIC_JPG = [0xff, 0xd8, 0xff];
const MAGIC_WEBP_RIFF = [0x52, 0x49, 0x46, 0x46];
const MAGIC_WEBP_TAG = [0x57, 0x45, 0x42, 0x50];
const MAGIC_GLB = [0x67, 0x6c, 0x54, 0x46];
const MAGIC_ZIP = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

function startsWithBytes(buf, sig, offset = 0) {
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

function readHead(absPath, length = 16) {
  const fd = fs.openSync(absPath, "r");
  try {
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

export function detectFileKind(absPath) {
  let head;
  try {
    head = readHead(absPath);
  } catch {
    return null;
  }
  if (startsWithBytes(head, MAGIC_PNG)) return "png";
  if (startsWithBytes(head, MAGIC_JPG)) return "jpg";
  const ascii6 = head.subarray(0, 6).toString("ascii");
  if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return "gif";
  if (startsWithBytes(head, MAGIC_WEBP_RIFF) && startsWithBytes(head, MAGIC_WEBP_TAG, 8)) return "webp";
  if (MAGIC_ZIP.some((sig) => startsWithBytes(head, sig))) return "zip";
  if (startsWithBytes(head, MAGIC_GLB)) return "glb";
  return null;
}

const IMAGE_KINDS = ["png", "jpg", "gif", "webp"];

function assertKind(absPath, kinds, label) {
  const kind = detectFileKind(absPath);
  if (!kinds.includes(kind)) {
    throw new Error(`Invalid ${label} file: content does not match its type.`);
  }
  return kind;
}

export function assertImageFile(absPath) {
  return assertKind(absPath, IMAGE_KINDS, "image");
}

export function assertZipFile(absPath) {
  return assertKind(absPath, ["zip"], "archive");
}

export function assertGlbFile(absPath) {
  return assertKind(absPath, ["glb"], "model");
}

export function assertPngFile(absPath) {
  return assertKind(absPath, ["png"], "texture");
}

export function verifyFiles(files, kind) {
  const list = Array.isArray(files) ? files : files ? [files] : [];
  const asserters = { image: assertImageFile, zip: assertZipFile, glb: assertGlbFile, png: assertPngFile };
  const assert = asserters[kind];
  if (!assert) throw new Error(`Unknown upload kind: ${kind}`);
  for (const f of list) {
    try {
      assert(f.path);
    } catch (err) {
      try {
        fs.unlinkSync(f.path);
      } catch {
      }
      throw err;
    }
  }
}

const SERVED_DATA_DIRS = ["uploads", "avatars", "banners"];
export function resolveLocalFile(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  const abs = path.resolve(process.cwd(), fileUrl.replace(/^\/+/, ""));
  const jailed = SERVED_DATA_DIRS.some((dir) => {
    const root = path.resolve(process.cwd(), dir) + path.sep;
    return abs.startsWith(root);
  });
  return jailed ? abs : null;
}

export function promoteStableUpload(tmpAbsPath, dir, userId) {
  const ext = path.extname(tmpAbsPath);
  const finalName = `${userId}${ext}`;
  const finalPath = path.join(dir, finalName);
  fs.renameSync(tmpAbsPath, finalPath);
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (full !== finalPath && entry.startsWith(`${userId}.`)) {
      try {
        fs.unlinkSync(full);
      } catch {
      }
    }
  }
  return `/${path.basename(dir)}/${finalName}`;
}
