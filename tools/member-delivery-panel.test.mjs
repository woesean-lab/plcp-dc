import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const output=await build({
  stdin:{contents:'export { MemberDeliveryPanel } from "./src/components/MemberDeliveryPanel.tsx";',resolveDir:fileURLToPath(new URL("../",import.meta.url)),loader:"tsx"},
  bundle:true,write:false,jsx:"automatic",format:"cjs",platform:"node",packages:"external",loader:{".css":"empty"},logLevel:"silent"
});
const module={exports:{}};
new Function("require","module","exports",output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const render=props=>renderToStaticMarkup(React.createElement(module.exports.MemberDeliveryPanel,{
  completed:12,total:50,status:"PROCESS",audience:"public",
  actions:React.createElement("button",{disabled:true,"aria-label":"Leave all"},"Leave all"),
  children:React.createElement("div",{"data-member-list":true},"Member rows"),...props
}));

test("panel reuses the Reactions frame, shows processed progress and preserves action permissions without a run-results filter",()=>{
  const html=render({id:"member-log"});
  assert.ok(html.includes('id="member-log"'));
  assert.ok(html.includes("monitor-reaction-panel monitor-control-panel is-collapsible"));
  assert.ok(html.includes("monitor-panel-icon"));
  assert.ok(html.includes('class="app-kicker">Member results'));
  assert.ok(html.includes("Delivery in progress"));
  assert.ok(html.includes("12 of 50 processed · 24%"));
  assert.ok(html.includes('aria-valuenow="24"'));
  assert.ok(html.includes('style="width:24%"'));
  assert.ok(html.includes('disabled="" aria-label="Leave all"'));
  assert.ok(html.includes("data-member-list"));
  assert.equal(html.includes("Run results"),false);
});

test("processed members with failures are not described as successful deliveries",()=>{
  const html=render({completed:50,total:50,status:"PARTIAL",attention:true});
  assert.ok(html.includes("Completed with issues"));
  assert.ok(html.includes('data-state="attention"'));
  assert.ok(html.includes("50 of 50 processed"));
  assert.equal(html.includes("Delivery complete"),false);
});

test("paused, stopped and active member checks remain distinct even after all members were processed",()=>{
  const paused=render({completed:50,total:50,status:"PAUSED"});
  assert.ok(paused.includes("Delivery paused"));
  assert.equal(paused.includes('data-state="success"'),false);
  const stopped=render({completed:50,total:50,status:"CANCELLED"});
  assert.ok(stopped.includes("Delivery stopped"));
  assert.equal(stopped.includes('data-state="success"'),false);
  const checking=render({completed:50,total:50,status:"COMPLETED",operation:"checking"});
  assert.ok(checking.includes("Checking members"));
  assert.ok(checking.includes('data-state="running"'));
});

test("empty and over-reported counts keep the accessible progress within its range",()=>{
  for(const props of [{completed:0,total:0,status:"WAITING"},{completed:80,total:50,status:"COMPLETED"}]){
    const html=render(props);
    const progress=Number(html.match(/aria-valuenow="(\d+)"/)[1]);
    assert.ok(progress>=0&&progress<=100);
    assert.equal(html.includes("NaN"),false);
  }
});


test("member panel uses a native disclosure that starts open with controls and content preserved",()=>{
  const html=render({});
  assert.match(html,/^<details open=""[^>]*>/);
  assert.ok(html.includes('<summary class="monitor-panel-heading monitor-reaction-collapse-toggle member-delivery-panel-toggle">'));
  assert.ok(html.includes("member-delivery-panel-chevron"));
  assert.ok(html.includes("Member rows"));
  assert.ok(html.includes('disabled="" aria-label="Leave all"'));
});

test("checking outcome and bar follow the current check instead of the completed delivery",()=>{
  const html=render({completed:25,total:25,status:"COMPLETED",operation:"checking",checkingProgress:{checked:10,total:25}});
  assert.ok(html.includes("10 of 25 checked · 40%"));
  assert.ok(html.includes('aria-label="Member check progress"'));
  assert.ok(html.includes('aria-valuenow="40"'));
  assert.ok(html.includes('style="width:40%"'));
  assert.equal(html.includes("25 of 25 processed"),false);
});
test("check startup begins at zero and completion restores delivery totals",()=>{
  const starting=render({completed:25,total:25,status:"COMPLETED",operation:"checking",checkingProgress:null});
  assert.ok(starting.includes("0 of 25 checked · 0%"));
  const finished=render({completed:25,total:25,status:"COMPLETED",checkingProgress:{checked:10,total:25}});
  assert.ok(finished.includes("25 of 25 processed · 100%"));
  assert.ok(finished.includes('aria-label="Member delivery progress"'));
});
test("check progress stays within the current check total",()=>{
  const html=render({completed:25,total:25,status:"COMPLETED",operation:"checking",checkingProgress:{checked:99,total:10}});
  assert.ok(html.includes("10 of 10 checked · 100%"));
});


test("toolbar actions precede the right-hand outcome card in reading and focus order",()=>{
  const html=render({});
  assert.ok(html.indexOf('aria-label="Leave all"') < html.indexOf('class="humanizer-run-outcome"'));
});
