import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const command = process.argv[2];
const requestedVersion = process.argv[3]?.replace(/^v/, "");
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function writeJson(relativePath, value) {
  write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function matchVersion(content, pattern, source) {
  const match = content.match(pattern);
  if (!match) throw new Error(`Could not read the version from ${source}`);
  return match[1];
}

function currentVersions() {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  const cargoToml = read("src-tauri/Cargo.toml");
  const cargoLock = read("src-tauri/Cargo.lock");

  return {
    "package.json": packageJson.version,
    "package-lock.json": packageLock.version,
    "package-lock.json workspace": packageLock.packages?.[""]?.version,
    "src-tauri/tauri.conf.json": tauriConfig.version,
    "src-tauri/Cargo.toml": matchVersion(
      cargoToml,
      /\[package\][\s\S]*?\nversion = "([^"]+)"/,
      "src-tauri/Cargo.toml",
    ),
    "src-tauri/Cargo.lock": matchVersion(
      cargoLock,
      /\[\[package\]\]\nname = "portlens"\nversion = "([^"]+)"/,
      "src-tauri/Cargo.lock",
    ),
  };
}

function assertVersion(version) {
  if (!version || !semverPattern.test(version)) {
    throw new Error(`Invalid semantic version: ${version ?? "<missing>"}`);
  }
}

function check(expectedVersion) {
  assertVersion(expectedVersion);
  const versions = currentVersions();
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expectedVersion);
  if (mismatches.length > 0) {
    const details = mismatches.map(([file, version]) => `  ${file}: ${version}`).join("\n");
    throw new Error(`Expected every project version to be ${expectedVersion}:\n${details}`);
  }
  console.log(`All project versions are ${expectedVersion}.`);
}

function setVersion(version) {
  assertVersion(version);

  const packageJson = readJson("package.json");
  packageJson.version = version;
  writeJson("package.json", packageJson);

  const packageLock = readJson("package-lock.json");
  packageLock.version = version;
  packageLock.packages[""].version = version;
  writeJson("package-lock.json", packageLock);

  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  tauriConfig.version = version;
  writeJson("src-tauri/tauri.conf.json", tauriConfig);

  const cargoTomlSource = read("src-tauri/Cargo.toml");
  const cargoTomlPattern = /(\[package\][\s\S]*?\nversion = ")[^"]+("\r?\n)/;
  if (!cargoTomlPattern.test(cargoTomlSource)) {
    throw new Error("Could not update src-tauri/Cargo.toml");
  }
  write("src-tauri/Cargo.toml", cargoTomlSource.replace(cargoTomlPattern, `$1${version}$2`));

  const cargoLockSource = read("src-tauri/Cargo.lock");
  const cargoLockPattern = /(\[\[package\]\]\nname = "portlens"\nversion = ")[^"]+("\r?\n)/;
  if (!cargoLockPattern.test(cargoLockSource)) {
    throw new Error("Could not update src-tauri/Cargo.lock");
  }
  write("src-tauri/Cargo.lock", cargoLockSource.replace(cargoLockPattern, `$1${version}$2`));

  check(version);
}

if (command === "set") {
  setVersion(requestedVersion);
} else if (command === "check") {
  const versions = currentVersions();
  check(requestedVersion ?? versions["package.json"]);
} else {
  console.error("Usage: node scripts/version.mjs <set|check> [version]");
  process.exit(1);
}
