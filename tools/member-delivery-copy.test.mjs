import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const output=await build({
  stdin:{contents:'export { MemberDeliveryRow } from "./src/components/MemberDeliveryRow.tsx";',resolveDir:fileURLToPath(new URL("../",import.meta.url)),loader:"tsx"},
  bundle:true,write:false,jsx:"automatic",format:"cjs",platform:"node",packages:"external",loader:{".css":"empty"},logLevel:"silent"
});
const module={exports:{}};
new Function("require","module","exports",output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const item={
  index:0,username:"m***r",avatarUrl:null,state:"failed",
  authorizationStatus:"inactive",authorizationDetails:"OAuth token_expired HTTP 401",
  onlinerLive:false,onlinerDetails:"Onliner Gateway proxy connection failed",
  details:"Discord Add Guild Member failed (HTTP 403, Discord code 50178): The user account must first be verified.",
  reactionState:"failed",reactionEmoji:"👍",reactionDetails:"REST HTTP 403 raw diagnostic",
  autoLeaveStatus:"failed",autoLeaveDetails:"Gateway session token_invalid"
};
const render=(audience,overrides={})=>renderToStaticMarkup(React.createElement(module.exports.MemberDeliveryRow,{item:{...item,...overrides},audience,formatTime:value=>value}));

test("Monitor labels, tooltips and collapsed notes contain no raw technical diagnostics",()=>{
  const html=render("public");
  for(const text of ["OAuth","Onliner","Gateway","proxy connection","HTTP 403","HTTP 401","token_expired","token_invalid","REST","raw diagnostic"])assert.equal(html.includes(text),false,text);
  for(const text of ["Access","Status","Offline","Delivery","Account verification is required.","Member could not leave the server.","Reaction could not be added."])assert.ok(html.includes(text),text);
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('hidden=""'),"details remain collapsible");
});

test("admin keeps its original labels and full diagnostics",()=>{
  const html=render(undefined);
  for(const text of ["OAuth","Onliner","HTTP 403","token_expired","Gateway session token_invalid"])assert.ok(html.includes(text),text);
});

test("plain public wording preserves explicit inactive/offline states without adding absent fields",()=>{
  const html=render("public",{authorizationStatus:undefined,onlinerLive:undefined,autoLeaveStatus:undefined,autoLeaveDetails:undefined,state:"already_member"});
  assert.equal(html.includes("<span>Access</span>"),false);
  assert.equal(html.includes("<span>Status</span>"),false);
  assert.ok(html.includes("Already a member"));
  assert.ok(html.includes("Member was already in the server."));
});

test("an unrecognized server diagnostic is replaced with a plain failure, never exposed as a fallback",()=>{
  const html=render("public",{details:"TLS proxy certificate verify failed HTTP 502 secret-diagnostic",authorizationStatus:"token_unknown_internal"});
  assert.equal(html.includes("secret-diagnostic"),false);
  assert.equal(html.includes("token_unknown_internal</span>"),false);
  assert.ok(html.includes("Member could not join the server."));
  assert.equal(html.includes("Account verification is required."),false,"transport failures must not be called account verification");
});

