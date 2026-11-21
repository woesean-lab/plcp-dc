import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = fs.readFileSync(new URL("../src/lib/member-log-order.ts", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, Map });
const { advanceMemberLogOrder, MEMBER_JOINED_HOLD_MS } = exports;
const member = (index,state,details="") => ({index,state,details});
const indices = view => Array.from(view.items,row=>row.index);

test("Joined data renders in its prior slot for exactly 200ms, then normal ordering resumes",()=>{
  assert.equal(MEMBER_JOINED_HOLD_MS,200);
  const initial=advanceMemberLogOrder(null,[member(0,"joining"),member(1,"queued")],"order-a",0);
  const latest=[member(1,"queued"),member(0,"joined","Joined successfully")];
  const joined=advanceMemberLogOrder(initial,latest,"order-a",1000);
  assert.deepEqual(indices(joined),[0,1]);
  assert.equal(joined.items[0].state,"joined","success icon and badge are immediate");
  assert.equal(joined.items[0].details,"Joined successfully","notes are never frozen");
  assert.deepEqual(indices(advanceMemberLogOrder(joined,latest,"order-a",1199)),[0,1]);
  const expired=advanceMemberLogOrder(joined,latest,"order-a",1200);
  assert.deepEqual(indices(expired),[1,0]);
  assert.equal(expired.holds.size,0);
  assert.deepEqual(latest.map(row=>row.index),[1,0],"API ordering is not mutated");
});

test("rapid refreshes update member data without extending the original hold",()=>{
  const initial=advanceMemberLogOrder(null,[member(0,"joining"),member(1,"queued")],"order-a",0);
  const joined=advanceMemberLogOrder(initial,[member(1,"queued"),member(0,"joined")],"order-a",1000);
  const refreshed=advanceMemberLogOrder(joined,[member(1,"joining"),member(0,"joined","new details")],"order-a",1150);
  assert.equal(refreshed.holds.get(0).until,1200);
  assert.equal(refreshed.items[0].details,"new details");
  assert.deepEqual(indices(advanceMemberLogOrder(refreshed,refreshed.source,"order-a",1200)),[1,0]);
});

test("simultaneous joins preserve their positions and disappear from a page only after confirmation",()=>{
  const prior=[member(0,"joining"),member(1,"replacing"),...Array.from({length:498},(_,i)=>member(i+2,"queued"))];
  const initial=advanceMemberLogOrder(null,prior,"large-order",0);
  const latest=[...prior.slice(2),member(0,"joined"),member(1,"joined")];
  const joined=advanceMemberLogOrder(initial,latest,"large-order",1000);
  assert.deepEqual(Array.from(joined.items.slice(0,2),row=>row.index),[0,1]);
  assert.equal(joined.items.slice(0,50).filter(row=>row.state==="joined").length,2);
  const expired=advanceMemberLogOrder(joined,latest,"large-order",1200);
  assert.equal(expired.items.slice(0,50).some(row=>row.state==="joined"),false);
  assert.equal(expired.items.length,500);
});

test("initial completed snapshots, new orders, failures and removed rows never retain stale holds",()=>{
  const latest=[member(1,"queued"),member(0,"joined")];
  const first=advanceMemberLogOrder(null,latest,"order-a",0);
  assert.deepEqual(indices(first),[1,0]);assert.equal(first.holds.size,0);
  const joining=advanceMemberLogOrder(null,[member(0,"joining"),member(1,"queued")],"order-a",0);
  const held=advanceMemberLogOrder(joining,latest,"order-a",1000);
  const changedOrder=advanceMemberLogOrder(held,latest,"order-b",1050);
  assert.deepEqual(indices(changedOrder),[1,0]);assert.equal(changedOrder.holds.size,0);
  const failed=advanceMemberLogOrder(held,[member(1,"queued"),member(0,"failed")],"order-a",1050);
  assert.deepEqual(indices(failed),[1,0]);assert.equal(failed.holds.size,0);
  const removed=advanceMemberLogOrder(held,[member(1,"queued")],"order-a",1050);
  assert.deepEqual(indices(removed),[1]);assert.equal(removed.holds.size,0);
});

test("polls that skip Joining still show the known queued member's Joined transition",()=>{
  const initial=advanceMemberLogOrder(null,[member(0,"queued"),member(1,"queued")],"order-a",0);
  const joined=advanceMemberLogOrder(initial,[member(1,"queued"),member(0,"joined")],"order-a",10);
  assert.deepEqual(indices(joined),[0,1]);assert.equal(joined.holds.get(0).until,210);
});

