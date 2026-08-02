import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const licensesDir = path.join(projectRoot, "licenses");
const outputPath = path.join(licensesDir, "DEPENDENCIES.md");
const frontendLicenseOutputPath = path.join(
  licensesDir,
  "FRONTEND_LICENSES.txt",
);

const lock = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"),
);
const frontendPackages = Object.entries(lock.packages)
  .filter(([packagePath, metadata]) => packagePath && metadata.dev !== true)
  .map(([packagePath, metadata]) => {
    const packageRoot = path.join(projectRoot, packagePath);
    const packageMetadata = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
    return {
      name: packagePath.split("node_modules/").at(-1),
      version: metadata.version,
      license: metadata.license ?? "UNKNOWN",
      source: normalizeRepository(packageMetadata),
      licenseFiles: readLicenseFiles(packageRoot),
    };
  })
  .sort(comparePackages);

const cargoMetadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      path.join(projectRoot, "src-tauri", "Cargo.toml"),
      "--format-version",
      "1",
      "--locked",
      "--offline",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
    },
  ),
);
const rustPackages = cargoMetadata.packages
  .filter((metadata) => metadata.name !== "ytloadster")
  .map((metadata) => ({
    name: metadata.name,
    version: metadata.version,
    license: metadata.license ?? "UNKNOWN",
    source:
      metadata.repository ??
      `https://crates.io/crates/${encodeURIComponent(metadata.name)}/${metadata.version}`,
  }))
  .sort(comparePackages);

const unknown = [
  ...frontendPackages.filter((item) => item.license === "UNKNOWN"),
  ...rustPackages.filter((item) => item.license === "UNKNOWN"),
];
if (unknown.length > 0) {
  throw new Error(
    `Dependencies without license metadata: ${unknown
      .map((item) => `${item.name}@${item.version}`)
      .join(", ")}`,
  );
}

const frontendRows = frontendPackages
  .map(
    ({ name, version, license, source }) =>
      `| ${escapeCell(name)} | ${escapeCell(version)} | ${escapeCell(license)} | ${source} |`,
  )
  .join("\n");
const rustRows = rustPackages
  .map(
    ({ name, version, license, source }) =>
      `| ${escapeCell(name)} | ${escapeCell(version)} | ${escapeCell(license)} | ${source} |`,
  )
  .join("\n");

const output = `# Реестр лицензий зависимостей

Файл сгенерирован командой \`node scripts/generate-license-inventory.mjs\` из
\`package-lock.json\`, \`Cargo.lock\` и лицензионных метаданных пакетов.

Он охватывает frontend-зависимости, входящие в production bundle, и полный
разрешённый Cargo-граф для поддерживаемых платформ. Условия внешних CLI,
которые распространяются рядом с приложением, описаны отдельно в
\`THIRD_PARTY_NOTICES.md\`.

## Frontend runtime

| Пакет | Версия | SPDX-лицензия | Исходный код |
| --- | --- | --- | --- |
${frontendRows}

## Rust и Tauri

| Пакет | Версия | SPDX-лицензия | Исходный код |
| --- | --- | --- | --- |
${rustRows}
`;

fs.mkdirSync(licensesDir, { recursive: true });
fs.writeFileSync(outputPath, output, "utf8");
fs.writeFileSync(
  frontendLicenseOutputPath,
  buildFrontendLicenseReport(frontendPackages),
  "utf8",
);
console.log(`Generated ${path.relative(projectRoot, outputPath)}`);
console.log(
  `Generated ${path.relative(projectRoot, frontendLicenseOutputPath)}`,
);

function comparePackages(left, right) {
  return (
    left.name.localeCompare(right.name, "en") ||
    left.version.localeCompare(right.version, "en", { numeric: true })
  );
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function normalizeRepository(packageMetadata) {
  const repository =
    typeof packageMetadata.repository === "string"
      ? packageMetadata.repository
      : packageMetadata.repository?.url;
  return (
    repository
      ?.replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/\.git$/, "") ??
    packageMetadata.homepage ??
    `https://www.npmjs.com/package/${encodeURIComponent(packageMetadata.name)}`
  );
}

function readLicenseFiles(packageRoot) {
  const files = fs
    .readdirSync(packageRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(LICENSE|LICENCE|COPYING|NOTICE)([._-].*|\..*|$)/i.test(entry.name),
    )
    .map((entry) => ({
      name: entry.name,
      text: fs
        .readFileSync(path.join(packageRoot, entry.name), "utf8")
        .replaceAll("\r\n", "\n")
        .trim(),
    }))
    .filter((entry) => entry.text.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  if (files.length === 0) {
    throw new Error(
      `No packaged license or notice file found in ${path.relative(
        projectRoot,
        packageRoot,
      )}`,
    );
  }
  return files;
}

function buildFrontendLicenseReport(packages) {
  const separator = "=".repeat(80);
  const subsection = "-".repeat(80);
  const sections = packages.map(
    ({ name, version, license, source, licenseFiles }) => `${separator}
${name} ${version}
Declared license: ${license}
Source: ${source}

${licenseFiles
  .map(({ name: fileName, text }) => `${subsection}
Packaged notice: ${fileName}
${subsection}
${text}`)
  .join("\n\n")}
`,
  );

  return `YTLoadster frontend runtime third-party licenses

Generated from package-lock.json and the license/notice files distributed in
the installed production npm packages. Development-only packages are excluded.

The Tauri packages are dual-licensed under MIT or Apache-2.0. Their packaged
SPDX notices identify the copyright holder; the complete standard license texts
are included by @tauri-apps/api in this report.

${sections.join("\n")}
`;
}
