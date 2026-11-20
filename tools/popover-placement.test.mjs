import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(fs.readFileSync(new URL("../src/lib/popover-placement.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { getPopoverPlacement } = exports;

test("opens below near the top and flips above near the viewport bottom", () => {
  assert.equal(getPopoverPlacement({ top: 100, bottom: 144 }, 500, 900).placement, "bottom");
  const bottom = getPopoverPlacement({ top: 720, bottom: 764 }, 500, 900);
  assert.equal(bottom.placement, "top");
  assert.ok(bottom.maxHeight >= 500);
});

test("when neither side fits, uses the larger space and constrains the height", () => {
  const result = getPopoverPlacement({ top: 350, bottom: 394 }, 500, 600);
  assert.equal(result.placement, "top");
  assert.equal(result.maxHeight, 331);
});

test("scrolling back up and resizing recalculate the opening direction", () => {
  assert.equal(getPopoverPlacement({ top: 620, bottom: 664 }, 500, 800).placement, "top");
  assert.equal(getPopoverPlacement({ top: 120, bottom: 164 }, 500, 800).placement, "bottom");
  assert.equal(getPopoverPlacement({ top: 450, bottom: 494 }, 500, 1100).placement, "bottom");
  assert.equal(getPopoverPlacement({ top: 450, bottom: 494 }, 500, 700).placement, "top");
});

test("height remains non-negative when a trigger reaches the viewport edge", () => {
  for (const trigger of [{ top: -100, bottom: -56 }, { top: 900, bottom: 944 }]) {
    const result = getPopoverPlacement(trigger, 500, 800);
    assert.ok(result.maxHeight >= 0 && result.maxHeight <= 800);
  }
});
