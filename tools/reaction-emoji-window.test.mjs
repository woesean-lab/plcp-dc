import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const emojiData = require("emoji-picker-react/dist/data/emojis.json");
function load(relative, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => dependencies[name] });
  return exports;
}
const helpers = load("../src/lib/reaction-emoji-window.ts");
const catalog = helpers.indexReactionEmojis(emojiData);

test("thousands of emojis create only a bounded visible window at the top, middle and end", () => {
  const large = Array.from({length:3000}, (_,index)=>({id:String(index),emoji:"😀",name:"Emoji "+index,search:"emoji "+index,category:"smileys_people"}));
  for (const columns of [4,8,12]) {
    const rows = helpers.buildEmojiRows(large, "", columns);
    assert.equal(rows.reduce((sum,row)=>sum+row.emojis.length,0), 3000);
    for(const scrollTop of [0,2000,999999]) {
      const range = helpers.getEmojiWindow(rows.length,scrollTop);
      assert.ok(range.end-range.start <= 11);
      assert.ok(rows.slice(range.start,range.end).reduce((sum,row)=>sum+row.emojis.length,0) <= 132);
    }
    const bottom = helpers.getEmojiWindow(rows.length,999999);
    assert.equal(rows.slice(bottom.start,bottom.end).at(-1).emojis.at(-1).id, "2999");
  }
});

test("search includes unmounted categories, aliases, compound emojis, flags and variation selectors", () => {
  const all = helpers.buildEmojiRows(catalog,"",8);
  const top = helpers.getEmojiWindow(all.length,0);
  const firstIds = new Set(all.slice(top.start,top.end).flatMap(row=>row.emojis.map(item=>item.id)));
  const flag = catalog.filter(item=>item.category==="flags").at(-1);
  assert.ok(!firstIds.has(flag.id));
  assert.ok(helpers.buildEmojiRows(catalog,flag.emoji,8).some(row=>row.emojis.some(item=>item.id===flag.id)));
  const smile = catalog.find(item=>item.id==="1f600");
  assert.ok(helpers.buildEmojiRows(catalog,"GRINNING",8).some(row=>row.emojis.some(item=>item.id===smile.id)));
  const heart = catalog.find(item=>item.id.startsWith("2764"));
  assert.ok(helpers.buildEmojiRows(catalog,heart.emoji.replace(/\ufe0f/g,""),8).some(row=>row.emojis.some(item=>item.id===heart.id)));
  const compound = catalog.find(item=>item.emoji.includes("‍"));
  assert.ok(helpers.buildEmojiRows(catalog,compound.emoji,8).some(row=>row.emojis.some(item=>item.id===compound.id)));
  assert.equal(helpers.buildEmojiRows(catalog,"this_name_does_not_exist_98765",8).length,0);
});

function picker(initial = {}) {
  const states = [initial.search ?? "", initial.columns ?? 8, initial.scrollTop ?? 0, 222, null];
  const viewport = { scrollTop: initial.scrollTop ?? 0, clientHeight: 222, clientWidth: 320 };
  let stateIndex = 0; let refIndex = 0;
  const hooks = { useState(value) { const index=stateIndex++; if(states[index]===undefined)states[index]=value; return [states[index],value=>{states[index]=typeof value==="function"?value(states[index]):value;}]; }, useMemo:fn=>fn(), useLayoutEffect() {}, useRef:initial=>({current:refIndex++===0?viewport:initial}) };
  const dependencies = { react: hooks, "react/jsx-runtime":jsxRuntime, "lucide-react":{X:()=>null}, "emoji-picker-react/dist/data/emojis.json":emojiData,
    "./ui/input":{Input:props=>React.createElement("input",props)}, "./ui/button":{Button:props=>React.createElement("button",props,props.children)}, "../lib/reaction-emoji-window":helpers };
  const {default:Component} = load("../src/components/VirtualReactionEmojiPicker.tsx",dependencies);
  let selected;
  return { states, viewport, selection:()=>selected, render(){stateIndex=0;refIndex=0;return Component({selectedEmojis:["😀"],onSelect:value=>{selected=value;}});} };
}
function nodes(element) { return !React.isValidElement(element)?[]:[element,...React.Children.toArray(element.props.children).flatMap(nodes)]; }

test("actual picker renders a small DOM window and scroll replaces it rather than appending the entire catalog", () => {
  const fixture=picker(); const initial=fixture.render();
  const first=nodes(initial).filter(node=>node.props["data-emoji-id"]);
  assert.ok(first.length>0 && first.length<=88);
  const scroll=nodes(initial).find(node=>node.props["aria-label"]==="Emoji list");
  scroll.props.onScroll({currentTarget:{scrollTop:999999}});
  const last=nodes(fixture.render()).filter(node=>node.props["data-emoji-id"]);
  assert.ok(last.length<=88);
  assert.equal(last.at(-1).props["data-emoji-id"],catalog.at(-1).id);
  assert.notEqual(last[0].props["data-emoji-id"],first[0].props["data-emoji-id"]);
  const html=renderToStaticMarkup(initial);
  assert.ok((html.match(/data-emoji-id=/g)??[]).length<=88);
  assert.match(html,/aria-pressed="true"/);
});

test("selection emits the original Unicode and keyboard navigation reaches unmounted end rows", () => {
  const fixture=picker();const buttons=nodes(fixture.render()).filter(node=>node.props["data-emoji-id"]);
  buttons[0].props.onClick();
  assert.equal(fixture.selection(),catalog[0].emoji);
  let prevented=false;
  buttons[0].props.onKeyDown({key:"End",preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  assert.equal(fixture.states[4].id,catalog.at(-1).id);
  assert.ok(fixture.viewport.scrollTop>0);
  assert.ok(nodes(fixture.render()).some(node=>node.props["data-emoji-id"]===catalog.at(-1).id));
});

test("input searches the whole catalog and reports an empty state", () => {
  const fixture=picker();
  const input=nodes(fixture.render()).find(node=>node.props["aria-label"]==="Search emojis");
  input.props.onChange({target:{value:catalog.at(-1).emoji}});
  assert.ok(nodes(fixture.render()).some(node=>node.props["data-emoji-id"]===catalog.at(-1).id));
  input.props.onChange({target:{value:"this_name_does_not_exist_98765"}});
  const empty=nodes(fixture.render());
  assert.equal(empty.some(node=>node.props["data-emoji-id"]),false);
  assert.ok(empty.some(node=>node.props.children==="No emojis found."));
});
