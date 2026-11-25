import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = fs.readFileSync(new URL("../src/components/ui/filter-dropdown.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("filter-dropdown.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = [];
function visit(node) { if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onKeyDown") handlers.push(node.initializer.expression.getText(ast)); ts.forEachChild(node, visit); }
visit(ast);
test("Escape dismisses an open filter before the containing dialog; a closed filter leaves Escape available", () => {
  for (const handler of handlers) {
    let prevented = false, stopped = false, opened = true;
    const scope = { isOpen: true, setOpen: value => { opened = value; }, triggerRef: { current: { focus() {} } } };
    const keydown = vm.runInNewContext(`(${handler})`, scope);
    keydown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(opened, false); assert.equal(prevented, true); assert.equal(stopped, true);
  }
  let prevented = false;
  const closed = vm.runInNewContext(`(${handlers.at(-1)})`, { isOpen: false, setOpen() {} });
  closed({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, false);
});
