import assert from "node:assert/strict";
import test from "node:test";
import { runNative } from "./run-native.mjs";

const windowsTargetDir = "X:\\test-target";
const localConfig = () => ({ windowsTargetDir });

for (const cli of ["tauri", "cargo"]) {
  test(`${cli}: private Windows settings override an inherited target directory`, () => {
    const env = { CARGO_TARGET_DIR: "X:\\inherited-target", PATH: "preserved" };
    let launched = false;
    const args = cli === "tauri" ? ["dev", "--no-watch"] : ["test", "--manifest-path", "src-tauri/Cargo.toml", "storage::tests"];
    const status = runNative(cli, args, {
      platform: "win32", env, readConfig: localConfig,
      mkdir: (directory) => assert.equal(directory, windowsTargetDir),
      spawn: (_command, commandArgs, options) => {
        launched = true;
        assert.equal(options.env.CARGO_TARGET_DIR, windowsTargetDir);
        assert.equal(options.env.PATH, "preserved");
        assert.deepEqual(commandArgs.slice(-args.length), args);
        return { status: 7 };
      },
    });
    assert.equal(launched, true);
    assert.equal(status, 7);
    assert.equal(env.CARGO_TARGET_DIR, "X:\\inherited-target");
  });
}

test("Windows does not launch a build when the configured directory is unavailable", () => {
  assert.throws(() => runNative("tauri", ["dev"], {
    platform: "win32", env: {}, readConfig: localConfig,
    mkdir: () => { throw new Error("Unavailable drive"); },
    spawn: () => assert.fail("A build must not start"),
  }), /Не удалось открыть каталог сборки из локальных настроек/);
});

test("Cargo cannot override a private target directory", () => {
  for (const args of [["check", "--target-dir", "other-target"], ["check", "--target-dir=other-target"]]) {
    assert.throws(() => runNative("cargo", args, {
      platform: "win32", env: {}, readConfig: localConfig,
      spawn: () => assert.fail("A build must not start"),
    }), /не передавайте --target-dir/);
  }
});

test("Without private settings Windows preserves the normal Cargo environment", () => {
  for (const env of [{}, { CARGO_TARGET_DIR: "X:\\inherited-target" }]) {
    runNative("cargo", ["check"], {
      platform: "win32", env, readConfig: () => ({}),
      mkdir: () => assert.fail("No private directory must be created"),
      spawn: (_command, _args, options) => {
        assert.deepEqual(options.env, env);
        return { status: 0 };
      },
    });
  }
});

test("Relative private target directories are rejected before launch", () => {
  assert.throws(() => runNative("cargo", ["check"], {
    platform: "win32", env: {}, readConfig: () => ({ windowsTargetDir: "relative-target" }),
    spawn: () => assert.fail("A build must not start"),
  }), /абсолютным путём Windows/);
});

test("macOS preserves its environment without reading private Windows settings", () => {
  runNative("tauri", ["build"], {
    platform: "darwin", env: { CARGO_TARGET_DIR: "/tmp/tauri-target" },
    readConfig: () => assert.fail("Windows settings must not be read"),
    mkdir: () => assert.fail("Windows directory must not be created"),
    spawn: (_command, _args, options) => {
      assert.equal(options.env.CARGO_TARGET_DIR, "/tmp/tauri-target");
      return { status: 0 };
    },
  });
});
