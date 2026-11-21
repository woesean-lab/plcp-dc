import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = fs.readFileSync(new URL("../src/lib/stock-account-input.ts", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, Error, Set });
const { parseStockAccountPairs } = exports;
const token = index => "sample-account-token-number-" + index;
const proxy = index => "http://proxy-" + index + ":8080";

test("500 accounts keep their exact proxy and retry pairing, including email:password:token imports", () => {
  const tokens = Array.from({length:500}, (_,i) => i % 2 ? "email:password:" + token(i) : token(i));
  const proxies = Array.from({length:500}, (_,i) => proxy(i));
  const pairs = parseStockAccountPairs(tokens.join("\r\n") + "\r\n", proxies.join("\n") + "\n");
  assert.equal(pairs.length,500);
  pairs.forEach((pair,i) => {assert.equal(pair.token,token(i));assert.equal(pair.proxy,proxy(i));assert.equal(pair.lineNumber,i+1);});
  const failures = [pairs[1],pairs[210],pairs[499]];
  const retry = parseStockAccountPairs(failures.map(p=>p.token).join("\n"), failures.map(p=>p.proxy).join("\n"));
  retry.forEach((pair,i)=>{assert.equal(pair.token,failures[i].token);assert.equal(pair.proxy,failures[i].proxy);});
});

test("count mismatches, blank rows and duplicates cannot shift tokens onto another proxy", () => {
  const a=token(1), b=token(2), p=proxy(1), q=proxy(2);
  for (const [tokens,proxies] of [
    [a+"\n"+b,p], [a,p+"\n"+q], [a+"\n\n"+b,p+"\n"+q],
    [a+"\n"+b,p+"\n\n"+q], ["\n"+a,p+"\n"+q], [a+"\n"+a,p+"\n"+q],
    [a+"\n"+b,p+"\n"+p], ["", ""], ["short",p]
  ]) assert.throws(()=>parseStockAccountPairs(tokens,proxies));
});

test("over 500 pairs are rejected before requests", () => {
  assert.throws(()=>parseStockAccountPairs(Array.from({length:501},(_,i)=>token(i)).join("\n"),Array.from({length:501},(_,i)=>proxy(i)).join("\n")),/500/);
});

