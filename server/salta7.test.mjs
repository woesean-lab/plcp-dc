import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createSalta7Client } from "./salta7.mjs";

function fixture(options = {}) {
  let time = 0; const calls = [];
  const client = createSalta7Client({ loadKey: async () => "secret-api-key", now: () => time, sleep: async ms => { time += ms; }, pollMs: 1, maxWaitMs: 3,
    fetch: async (url, init) => {
      const path = url.pathname; calls.push({ url: String(url), ...init });
      if (options.fetch) return options.fetch(url, init, calls);
      if (path === "/balance") return Response.json({ balance: 12.4, token: "must-not-escape" });
      if (path === "/task/create") return Response.json({ job_id: "job-1", status: "running" });
      if (path === "/task/status") return Response.json({ job_id: "job-1", status: options.pending ? "running" : "completed", total: 1 });
      if (path === "/task/items") return Response.json({ job_id: "job-1", items: [{ line: "sample-token", status: "joined", boosts: options.boosts ?? 2, note: "private credential" }] });
      assert.fail(path);
    }
  });
  return { client, calls };
}

test("BYOT boost payload contains only tool, invite and our token; proxy is never transmitted", async () => {
  const api = fixture();const saved=[];
  const result = await api.client.run("sample-token", "invite", { proxy: "secret-proxy", onTaskCreated: async id => saved.push(id) });
  assert.deepEqual(JSON.parse(api.calls[0].body), { tool: "boost", invite: "invite", tokens: ["sample-token"] });
  assert.equal(api.calls[0].headers.Authorization,"Bearer secret-api-key");
  assert.ok(api.calls.every(call => !JSON.stringify(call).includes("secret-proxy")));
  assert.deepEqual(saved,["job-1"]);assert.equal(result.boostCount,2);assert.equal(result.boosted,true);
  assert.equal(result.dcordTaskId,"job-1");
  assert.ok(!JSON.stringify(result).includes("private credential"));
});

test("re-join uses join tool and never applies boosts", async () => {
  const api=fixture();const result=await api.client.run("sample-token","invite",{boost:false});
  assert.equal(JSON.parse(api.calls[0].body).tool,"join");assert.equal(result.boostCount,0);assert.equal(result.success,true);
});

test("one applied boost is counted as one, with no assumed full delivery", async () => {
  const result=await fixture({boosts:1}).client.run("sample-token","invite");
  assert.equal(result.boostCount,1);assert.equal(result.boosted,false);assert.equal(result.status,"partial");
});

test("saved jobs resume without resubmitting tokens, including status polling failures", async () => {
  let statusCalls=0;
  const api=fixture({fetch:async url=>{
    if(url.pathname==="/task/status") {if(++statusCalls===1)throw Error("Network down");return Response.json({job_id:"job-1",status:"completed",total:1});}
    if(url.pathname==="/task/items")return Response.json({job_id:"job-1",items:[{line:"sample-token",status:"already_in",boosts:2}]});
    assert.fail("must not create");
  }});
  const result=await api.client.run("sample-token","invite",{existingTaskId:"job-1"});
  assert.equal(result.boostCount,2);assert.ok(api.calls.every(call=>call.method==="GET"));
});

test("running jobs retain saved IDs after deadline instead of duplicating work",async()=>{
  const api=fixture({pending:true});const result=await api.client.run("sample-token","invite");
  assert.equal(result.taskPending,true);assert.equal(result.dcordTaskId,"job-1");assert.equal(api.calls.filter(call=>call.method==="POST").length,1);
});

test("uncertain submission never retries a POST or leaks upstream credentials",async()=>{
  for (const mode of ["network","missing-id","invalid-json","upstream"]) {
    const api=fixture({fetch:async()=>{
      if(mode==="network")throw Error("secret-api-key sample-token");
      if(mode==="missing-id")return Response.json({status:"running"});
      if(mode==="invalid-json")return new Response("<html>secret</html>");
      return Response.json({detail:"secret-api-key sample-token"},{status:502});
    }});
    const result=await api.client.run("sample-token","invite");
    assert.equal(result.transportUncertain,true,mode);assert.equal(api.calls.length,1);
    assert.ok(!JSON.stringify(result).includes("secret-api-key"));assert.ok(!JSON.stringify(result).includes("sample-token"));
  }
});

test("known API failures keep actionable safe messages and distinguish rejected from uncertain jobs",async()=>{
  for(const status of [400,401,403,409,429,503]) {
    const api=fixture({fetch:async()=>Response.json({detail:"secret-token"},{status})});
    const result=await api.client.run("sample-token","invite");
    assert.equal(result.transportUncertain,false);assert.equal(result.providerBlocked,[401,403,429,503].includes(status));
    assert.equal(result.httpStatus,status);assert.ok(!JSON.stringify(result).includes("secret-token"));
  }
});

test("wrong job IDs and missing results cannot establish successful delivery",async()=>{
  for(const mode of ["wrong-id","missing-item","pending-item"]) {
    const api=fixture({fetch:async url=>url.pathname==="/task/status"?Response.json({job_id:mode==="wrong-id"?"other":"job-1",status:"completed",total:1}):Response.json({job_id:"job-1",items:mode==="missing-item"?[]:[{line:"sample-token",status:"pending"}]})});
    const result=await api.client.run("sample-token","invite",{existingTaskId:"job-1"});assert.equal(result.taskPending,true);assert.equal(result.success,false);
  }
});

test("connection check exposes balance only, never the API token returned by /balance",async()=>{
  const api=fixture();assert.deepEqual(await api.client.check(),{connected:true,status:"ok",message:"Salta7 API is reachable.",balance:12.4});
  assert.equal(api.calls.length,1);assert.equal(api.calls[0].method,"GET");
});

const source=fs.readFileSync(new URL("./index.mjs",import.meta.url),"utf8");
const ast=ts.createSourceFile("index.mjs",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const code=name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast);
test("production provider dispatcher sends Salta7 orders to Salta7 and preserves Dcord as default",async()=>{
  const sent=[];const context={salta7Client:{run:async(...args)=>{sent.push(args);return {boostCount:2}}},removeBoostTokenTwoFactor:value=>value,redactToken:()=>"masked",requestDcord:async()=>{throw Object.assign(Error("Dcord route"),{providerBlocked:true})},dcordTaskCreatePath:"/api/task/create",extractDcordApiToken:value=>value,isDcordUpstreamVerificationMessage:()=>false};
  vm.runInNewContext(code("runDcordBoostToken")+";this.run=runDcordBoostToken;",context);
  assert.equal((await context.run("sample-token","invite",{boostProvider:"salta7"})).boostCount,2);assert.equal(sent.length,1);
  await context.run("sample-token","invite",{});assert.equal(sent.length,1);
});
