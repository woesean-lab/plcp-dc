import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=fs.readFileSync(new URL("./index.mjs",import.meta.url),"utf8");
const ast=ts.createSourceFile("index.mjs",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fn=name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast);
const route=path=>ast.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==="app.post"&&node.expression.arguments[0]?.text===path).getText(ast);
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this},json(body){this.body=body;return this},set(){return this}});

function createRoute() {
  const saved=[],proxyReservations=[],processing=[];let handler;let remaining;
  const stock={oneMonth:["token1","token2","token3"],threeMonth:["3m-token"]};
  const scope={app:{post:(_path,_auth,fn)=>{handler=fn}},requireSession(){},loadSalta7ApiKey:async()=>"key",extractDiscordInviteCode:value=>value,normalizeDcordBoostConcurrency:()=>1,
    getCommunityOAuthConfig:async()=>({}),normalizeSubmittedDiscordResolution:()=>({guildId:"guild",guildName:"Sample server"}),normalizeDiscordGuildName:value=>value,
    checkDcordBoostMembershipScreening:async()=>({status:"closed"}),loadBoostTokenStock:async()=>stock,saveBoostTokenStock:async value=>{remaining=value;return value},
    createDcordOrderId:()=>"boost-test",reserveDcordProxies:async count=>{proxyReservations.push(count);return ["proxy1","proxy2"]},
    saveDcordOrderTokens:async()=>{},saveDcordOrderProxies:async()=>{},saveTrackedOrderPayload:async order=>saved.push(structuredClone(order)),
    processDcordBoostOrder:async (...args)=>processing.push(args),summarizeBoostTokenStock:value=>value,redactToken:value=>value,console,
    rotatingBoostStock:{reserveForDelivery:async()=>({tokens:["rotating-token"],proxies:[]})}
  };
  vm.runInNewContext(fn("createQueuedDcordResult")+"\n"+route("/api/dcord/boost-orders"),scope);
  return {run:async(body)=>{const res=response();await handler({body:{id:"invite",amount:4,duration:1,...body}},res,error=>{throw error});return res},saved,processing,proxyReservations,get remaining(){return remaining}};
}

test("Salta7 creation reserves our tokens without consuming delivery proxies; Dcord keeps them",async()=>{
  for(const boostProvider of ["salta7","dcord",undefined]){
    const api=createRoute();const res=await api.run({boostProvider});
    assert.equal(res.statusCode,200);assert.equal(api.saved[0].boostProvider,boostProvider??"dcord");
    assert.equal(api.saved[0].useProxy,boostProvider!=="salta7");
    assert.equal(api.proxyReservations.length,boostProvider==="salta7"?0:1);
    assert.deepEqual(Array.from(api.processing[0][1]),["token1","token2"]);
    assert.deepEqual(Array.from(api.remaining.oneMonth),["token3"]);
  }
});

test("invalid provider cannot reserve or submit stock",async()=>{
  const api=createRoute();assert.equal((await api.run({boostProvider:"other"})).statusCode,400);
  assert.equal(api.saved.length,0);assert.equal(api.processing.length,0);assert.equal(api.proxyReservations.length,0);
});

function worker(result) {
  const saved=[],submissions=[],scheduled=[],returned=[];
  const scope={dcordOrderProcessingJobs:new Set(),dcordOrderPausedJobs:new Set(),dcordRetryBaseMs:1,dcordTaskPollIntervalMs:5,dcordMaxRetryAttempts:12,
    saveTrackedOrderPayload:async value=>saved.push(structuredClone(value)),loadDcordOrderProxies:async()=>assert.fail("Salta7 must not load delivery proxies"),
    runDcordBoostToken:async(token,invite,options)=>{submissions.push({token,invite,options});if(!options.existingTaskId)await options.onTaskCreated("saved-job",{});return result},
    recordUsedBoostToken:async()=>({id:"usage"}),updateUsedBoostTokenResult:async()=>{},mutateUsedBoostTokenHistory:async()=>{},getDcordRetryDelay:()=>1,returnDcordTokenToStock:async(_order,token)=>{returned.push(token);return true},
    scheduleDcordOrderRetry:(...args)=>scheduled.push(args),markDcordProviderFailure:()=>assert.fail("Salta7 must not mutate Dcord circuit"),markDcordProviderHealthy:()=>assert.fail("Salta7 must not mutate Dcord circuit"),
    checkDcordProviderAvailability:()=>assert.fail("Salta7 must not use Dcord availability"),redactToken:()=>"masked",normalizeDcordBoostConcurrency:()=>1,isDcordUpstreamVerificationMessage:()=>false
  };
  const names=["getDcordResultBoostCount","isDcordTaskPendingResult","isDcordUnconfirmedRunningResult","isRunnableDcordResult","isDcordCloudflareBlockedResult","isUncertainDcordTransportResult","createQueuedDcordResult","processDcordBoostOrder"];
  vm.runInNewContext(names.map(fn).join("\n")+";this.run=processDcordBoostOrder;",scope);
  return {run:scope.run,saved,submissions,scheduled,returned};
}
const base={uniqid:"boost",boostProvider:"salta7",provider:"dcord",amount:2,useProxy:true,concurrency:1};

test("production worker counts actual partial boosts and stores Salta7 service without proxy traffic",async()=>{
  const api=worker({status:"partial",joinStatus:"joined",boostStatus:"partial",boostCount:1,dcordTaskId:"saved-job"});
  await api.run(base,["token"],"invite");
  assert.equal(api.submissions[0].options.boostProvider,"salta7");assert.equal(api.submissions[0].options.proxy,undefined);
  assert.equal(api.saved.at(-1).added,1);assert.equal(api.saved.at(-1).status,"PARTIAL");assert.equal(api.saved.at(-1).boostProvider,"salta7");
  assert.ok(api.saved.some(order=>order.dcordResults[0]?.dcordTaskId==="saved-job"));
});

test("pending Salta7 jobs schedule another status check with the saved job, never a new submission",async()=>{
  const api=worker({status:"verifying",taskPending:true,transportUncertain:true,dcordTaskId:"saved-job"});
  await api.run({...base,dcordResults:[{status:"verifying",dcordTaskId:"saved-job"}]},["token"],"invite");
  assert.equal(api.submissions[0].options.existingTaskId,"saved-job");assert.equal(api.saved.at(-1).status,"WAITING");assert.equal(api.scheduled.length,1);
});

test("an interrupted Salta7 create without a saved job ID cannot be submitted twice",async()=>{
  const api=worker({});
  await api.run({...base,dcordResults:[{status:"joining"}]},["token"],"invite");
  assert.equal(api.submissions.length,0);assert.equal(api.saved.at(-1).dcordResults[0].transportUncertain,true);
});

test("confirmed unused tokens return to stock, but server restrictions stop queued submissions",async()=>{
  const unused=worker({status:"not_used",boostCount:0});await unused.run(base,["token"],"invite");
  assert.deepEqual(unused.returned,["token"]);assert.equal(unused.saved.at(-1).dcordResults[0].status,"returned");
  const restricted=worker({status:"error",serverBlocked:true,boostCount:0});await restricted.run({...base,amount:4},["one","two"],"invite");
  assert.equal(restricted.submissions.length,1);assert.equal(restricted.saved.at(-1).status,"PAUSED");assert.equal(restricted.scheduled.length,0);
});

test("cancel and replacement routes cannot recycle a Salta7 token with an unknown or pending outcome",async()=>{
  for (const path of ["/api/dcord/boost-orders/:uniqid/cancel","/api/dcord/boost-orders/:uniqid/replace-token"]) for (const result of [{status:"verifying",transportUncertain:true},{status:"verifying",dcordTaskId:"accepted-job",taskPending:true}]) {
    let handler;
    const scope={app:{post:(_path,_auth,callback)=>{handler=callback}},requireSession(){},dcordOrderProcessingJobs:new Set(),
      pool:{query:async()=>({rows:[{payload:{...base,status:"WAITING",dcordResults:[result]}}]})},isDcordUpstreamVerificationMessage:()=>false};
    vm.runInNewContext(["isDcordTaskPendingResult","isDcordUnconfirmedRunningResult","isDcordCloudflareBlockedResult","isRunnableDcordResult","isUncertainDcordTransportResult"].map(fn).join("\n")+route(path),scope);
    const res=response();await handler({params:{uniqid:"boost"},body:{resultIndex:0}},res,error=>{throw error});assert.equal(res.statusCode,409);
  }
});

test("Salta7 Re-join persists accepted job IDs and resumes them without submitting again",async()=>{
  const jobs=[],calls=[];
  const scope={redactToken:()=>"masked",normalizeDcordBoostConcurrency:()=>1,dcordRejoinJobs:new Set(),saveDcordRejoinJob:async(_id,job)=>jobs.push(structuredClone(job)),
    forEachWithConcurrency:async(items,_limit,callback)=>{for(let i=0;i<items.length;i++)await callback(items[i],i)},
    runDcordBoostToken:async(_token,_invite,options)=>{calls.push(options);await options.onTaskCreated("rejoin-job");return {taskPending:true,transportUncertain:true,dcordTaskId:"rejoin-job",status:"verifying"}}};
  vm.runInNewContext(fn("runDcordOrderRejoin")+";this.run=runDcordOrderRejoin;",scope);
  await scope.run({...base,serverInvite:"invite",useProxy:false},["token"],[]);
  assert.equal(calls[0].boostProvider,"salta7");assert.equal(calls[0].boost,false);
  const final=jobs.at(-1);assert.equal(final.results[0].dcordTaskId,"rejoin-job");
  await scope.run({...base,serverInvite:"invite",useProxy:false,dcordRejoinJob:final},["token"],[]);assert.equal(calls[1].existingTaskId,"rejoin-job");
});


test("Rotating creation reserves no delivery proxies with either boost provider", async () => {
  for (const boostProvider of ["salta7", "dcord"]) {
    const api = createRoute(); await api.run({ boostProvider, boostStockPool: "rotating", amount: 2 });
    assert.equal(api.saved[0].useProxy, false); assert.equal(api.proxyReservations.length, 0);
    assert.deepEqual(Array.from(api.processing[0][1]), ["rotating-token"]);
  }
});
