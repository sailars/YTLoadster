import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function readLocalBuildConfig() {
  try {
    return JSON.parse(readFileSync(new URL("./native-build.local.json", import.meta.url), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("Не удалось прочитать локальные настройки сборки.", { cause: error });
  }
}

export function runNative(cli, args, {
  platform = process.platform,
  env = process.env,
  mkdir = mkdirSync,
  spawn = spawnSync,
  readConfig = readLocalBuildConfig,
} = {}) {
  if (cli !== "cargo" && cli !== "tauri") {
    throw new Error("Укажите cargo или tauri.");
  }

  const childEnv = { ...env };
  if (platform === "win32") {
    const { windowsTargetDir } = readConfig();
    if (windowsTargetDir !== undefined) {
      if (typeof windowsTargetDir !== "string" || !/^[a-z]:[\\/]/i.test(windowsTargetDir)) {
        throw new Error("Каталог локальной сборки должен быть абсолютным путём Windows.");
      }
      if (cli === "cargo" && args.some((arg) => arg === "--target-dir" || arg.startsWith("--target-dir="))) {
        throw new Error("Каталог сборки задан в локальных настройках; не передавайте --target-dir.");
      }
      try {
        mkdir(windowsTargetDir, { recursive: true });
      } catch (error) {
        throw new Error("Не удалось открыть каталог сборки из локальных настроек.", { cause: error });
      }
      childEnv.CARGO_TARGET_DIR = windowsTargetDir;
      console.log("Используется каталог сборки Rust из локальных настроек.");
    }
  }

  const command = cli === "tauri" ? process.execPath : "cargo";
  const commandArgs = cli === "tauri"
    ? [fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url)), ...args]
    : args;
  const result = spawn(command, commandArgs, {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = runNative(process.argv[2], process.argv.slice(3));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
