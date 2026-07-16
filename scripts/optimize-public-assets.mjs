import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentPath = path.join(root, "shared/content.json");
const publicRoot = path.join(root, "client/public");
const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));
const beforeBytes = directorySize(publicRoot);

let optimizedImages = 0;
let optimizedAudio = 0;

for (const asset of Object.values(content.mediaAssets ?? {})) {
  const optimized = await optimizeImageReference(asset.src);
  if (!optimized) continue;
  asset.src = optimized.publicPath;
  optimizedImages += 1;
}

for (const character of Object.values(content.characters ?? {})) {
  const optimized = await optimizeImageReference(character.facePhoto);
  if (!optimized) continue;
  character.facePhoto = optimized.publicPath;
  optimizedImages += 1;
}

for (const asset of Object.values(content.audioAssets ?? {})) {
  if (typeof asset.src !== "string" || !asset.src.startsWith("/content-assets/audio/") || !asset.src.endsWith(".m4a")) continue;
  const sourcePath = publicFile(asset.src);
  if (!fs.existsSync(sourcePath)) continue;
  const temporaryPath = `${sourcePath}.optimized.m4a`;
  try {
    fs.rmSync(temporaryPath, { force: true });
    execFileSync("/usr/bin/afconvert", [
      sourcePath,
      "-o", temporaryPath,
      "-f", "m4af",
      "-d", "aac",
      "-b", "96000",
      "-q", "96",
    ], { stdio: "ignore" });
    const originalSize = fs.statSync(sourcePath).size;
    const optimizedSize = fs.statSync(temporaryPath).size;
    if (optimizedSize < originalSize * 0.95) {
      fs.renameSync(temporaryPath, sourcePath);
      optimizedAudio += 1;
    } else {
      fs.rmSync(temporaryPath, { force: true });
    }
  } catch {
    fs.rmSync(temporaryPath, { force: true });
  }
}

fs.writeFileSync(contentPath, `${JSON.stringify(content, null, 2)}\n`);

const afterBytes = directorySize(publicRoot);
console.log(JSON.stringify({
  optimizedImages,
  optimizedAudio,
  beforeBytes,
  afterBytes,
  savedBytes: beforeBytes - afterBytes,
  savedPercent: Number((((beforeBytes - afterBytes) / Math.max(1, beforeBytes)) * 100).toFixed(1)),
}, null, 2));

async function optimizeImageReference(publicPath) {
  if (typeof publicPath !== "string" || !publicPath.startsWith("/") || publicPath.endsWith(".webp")) return null;
  const sourcePath = publicFile(publicPath);
  if (!fs.existsSync(sourcePath)) return null;
  const extension = path.extname(sourcePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(extension)) return null;
  const outputPath = sourcePath.slice(0, -extension.length) + ".webp";
  await sharp(sourcePath)
    .rotate()
    .webp({ quality: 88, alphaQuality: 95, effort: 6, smartSubsample: true })
    .toFile(outputPath);
  if (fs.statSync(outputPath).size >= fs.statSync(sourcePath).size * 0.98) {
    fs.rmSync(outputPath, { force: true });
    return null;
  }
  fs.rmSync(sourcePath);
  return { publicPath: `/${path.relative(publicRoot, outputPath).split(path.sep).join("/")}` };
}

function publicFile(publicPath) {
  return path.join(publicRoot, publicPath.replace(/^\/+/, ""));
}

function directorySize(directory) {
  let size = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    size += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size;
  }
  return size;
}
