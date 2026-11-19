import test from "node:test";
import assert from "node:assert/strict";
import { convertOnlinerProxyImport, normalizeOnlinerProxyImportDraft, mergeOnlinerProxyImports } from "../shared/onliner-proxy-import.mjs";

test("five-field provider exports preserve the first endpoint and ignore the old IP", () => {
  assert.equal(convertOnlinerProxyImport("192.0.2.10:6738:demo:secret:198.51.100.25"), "socks5://demo:secret@192.0.2.10:6738");
  assert.equal(convertOnlinerProxyImport("192.0.2.10:6738:demo:secret:198.51.100.25\\"), "socks5://demo:secret@192.0.2.10:6738");
  assert.equal(convertOnlinerProxyImport("192.0.2.10:6738:demo@name:p#ss:198.51.100.25"), "socks5://demo%40name:p%23ss@192.0.2.10:6738");
});

test("multiline input converts each provider line while preserving existing formats", () => {
  const converted = normalizeOnlinerProxyImportDraft("192.0.2.10:6738:demo:secret:198.51.100.25\r\nsocks5://demo:secret@192.0.2.11:7124\r\n192.0.2.12:6385:demo:secret");
  assert.equal(converted, "socks5://demo:secret@192.0.2.10:6738\r\nsocks5://demo:secret@192.0.2.11:7124\r\n192.0.2.12:6385:demo:secret");
  for (const invalid of ["192.0.2.10:99999:demo:secret:198.51.100.25", "192.0.2.10:6738:demo:secret:999.51.100.25"]) {
    assert.equal(convertOnlinerProxyImport(invalid), invalid);
  }
});

test("saved endpoints and duplicates within the same import are skipped across formats", () => {
  const existing = ["http://demo:secret@192.0.2.10:6738/"];
  const result = mergeOnlinerProxyImports(existing, [
    convertOnlinerProxyImport("192.0.2.10:6738:demo:secret:198.51.100.25"),
    "socks5://demo:secret@192.0.2.11:7124",
    "socks5://demo:secret@192.0.2.11:7124/",
    "http://other:password@192.0.2.11:7124/",
    "socks5://demo:secret@192.0.2.11:7125"
  ]);
  assert.equal(result.duplicateCount, 3);
  assert.deepEqual(result.newProxies, ["socks5://demo:secret@192.0.2.11:7124", "socks5://demo:secret@192.0.2.11:7125"]);
  assert.deepEqual(existing, ["http://demo:secret@192.0.2.10:6738/"]);
});
