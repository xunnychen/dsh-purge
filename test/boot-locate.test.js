import assert from "node:assert/strict";
import test from "node:test";
import { findDesktopAppExecutable, listDesktopPackageRoots } from "../lib/desktop.js";
import { restoreMissingOriginalsAllHosts } from "../lib/core.js";

test("boot desktop locate stays cheap without PowerShell discovery", () => {
  const t0 = Date.now();
  const roots = listDesktopPackageRoots({ discover: false });
  const exe = findDesktopAppExecutable({ discover: false });
  const restored = restoreMissingOriginalsAllHosts({ boot: true });
  const ms = Date.now() - t0;
  assert.ok(Array.isArray(roots));
  assert.equal(typeof exe, "string");
  assert.ok(Array.isArray(restored));
  assert.ok(ms < 1500, `cheap boot locate took ${ms}ms`);
});
