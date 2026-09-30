import assert from "node:assert/strict";
import test from "node:test";
import { runNative, windowsTargetDir } from "./run-native.mjs";

for (const cli of ["tauri", "cargo"]) {
  test(`${cli}: Windows overrides an inherited target directory`, () => {
    const env = { CARGO_TARGET_DIR: "G:\\ytloadster_temp", PATH: "preserved" };
    let launched = false;
    const args = cli === "tauri" ? ["dev", "--no-watch"] : ["test", "--manifest-path", "src-tauri/Cargo.toml", "storage::tests"];
    const status = runNative(cli, args, {
      platform: "win32", env,
      mkdir: (directory) => assert.equal(directory, windowsTargetDir),
      spawn: (_command, commandArgs, options) => {
        launched = true;
        assert.equal(options.env.CARGO_TARGET_DIR, "G:\\ytloadster_dev");
        assert.equal(options.env.PATH, "preserved");
        assert.deepEqual(commandArgs.slice(-args.length), args);
        return { status: 7 };
      },
    });
    assert.equal(launched, true);
    assert.equal(status, 7);
    assert.equal(env.CARGO_TARGET_DIR, "G:\\ytloadster_temp");
  });
}

test("Windows does not launch a build when G is unavailable", () => {
  assert.throws(() => runNative("tauri", ["dev"], {
    platform: "win32", env: {},
    mkdir: () => { throw new Error("Unavailable drive"); },
    spawn: () => assert.fail("A build must not start"),
  }), /Не удалось открыть каталог сборки G:\\ytloadster_dev/);
});

test("Cargo cannot redirect a local build with --target-dir", () => {
  for (const args of [["check", "--target-dir", "target-codex"], ["check", "--target-dir=target-codex"]]) {
    assert.throws(() => runNative("cargo", args, {
      platform: "win32", env: {},
      spawn: () => assert.fail("A build must not start"),
    }), /не передавайте --target-dir/);
  }
});

test("macOS preserves its build environment without requiring G", () => {
  runNative("tauri", ["build"], {
    platform: "darwin", env: { CARGO_TARGET_DIR: "/tmp/tauri-target" },
    mkdir: () => assert.fail("Windows directory must not be created"),
    spawn: (_command, _args, options) => {
      assert.equal(options.env.CARGO_TARGET_DIR, "/tmp/tauri-target");
      return { status: 0 };
    },
  });
});
