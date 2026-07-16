import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentPath = path.join(root, "shared/content.json");
const publicRoot = path.join(root, "client/public/content-assets");
const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));

let audioFiles = 0;
let characterFiles = 0;

for (const [id, asset] of Object.entries(content.audioAssets ?? {})) {
  const decoded = decodeDataUrl(asset.src);
  if (!decoded) continue;
  const extension = extensionForMime(decoded.mimeType);
  const fileName = `${safeName(id)}.${extension}`;
  writeAsset("audio", fileName, decoded.bytes);
  asset.src = `/content-assets/audio/${fileName}`;
  asset.mimeType ??= decoded.mimeType;
  audioFiles += 1;
}

for (const [id, character] of Object.entries(content.characters ?? {})) {
  const decoded = decodeDataUrl(character.facePhoto);
  if (!decoded) continue;
  const extension = extensionForMime(decoded.mimeType);
  const fileName = `${safeName(id)}.${extension}`;
  writeAsset("characters", fileName, decoded.bytes);
  character.facePhoto = `/content-assets/characters/${fileName}`;
  characterFiles += 1;
}

fs.writeFileSync(contentPath, `${JSON.stringify(content, null, 2)}\n`);

console.log(JSON.stringify({
  audioFiles,
  characterFiles,
  contentBytes: fs.statSync(contentPath).size,
  publicRoot,
}, null, 2));

function decodeDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) return null;
  return { mimeType: match[1], bytes: Buffer.from(match[2], "base64") };
}

function extensionForMime(mimeType) {
  return ({
    "audio/x-m4a": "m4a",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  })[mimeType] ?? "bin";
}

function writeAsset(group, fileName, bytes) {
  const directory = path.join(publicRoot, group);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileName), bytes);
}

function safeName(value) {
  return String(value).normalize("NFKD").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}
