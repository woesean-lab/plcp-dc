import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
import { authorizeCommunityStockAccount, getReusableAuthorizationGatewayUser, onlinerAuthorizationRouteKey, pruneStockAuthProxyPool, validateStockAuthProxy } from "./community-stock-authorization.mjs";

const user = { id: "123456789012345678", username: "sample" };
const proxy = "http://assigned-proxy:8080";
const token = "sample-account-token";
const input = { config: { clientId: "application", clientSecret: "sample-secret" }, accountToken: token, proxyUrl: proxy, redirectUri: "https://panel.example/api/community/oauth/callback" };
const oauth = { accessToken: "access-token-value-with-length", refreshToken: "refresh-token-value-with-length", expiresAt: new Date("2027-01-01"), expiresIn: 3600 };
function fixture(overrides = {}, gatewayRequired = true) {
  const events = [];
  const dependencies = {
    normalizeProxy: value => value?.startsWith("http://") ? value : "",
    getConnectedGatewayUser: async () => null,
    withGatewaySession: async (account, task) => { assert.equal(account.proxyUrl,proxy); assert.equal(account.token,token); events.push("READY"); return task(user); },
    requestThroughProxy: async (path, route, options) => {
      assert.equal(route,proxy); if (gatewayRequired) assert.equal(events[0],"READY"); events.push(path);
      if (path === "users/@me") return { response: {ok:true}, payload:user };
      if (path.startsWith("oauth2/authorize?")) {
        assert.equal(options.headers.Authorization,token);
        assert.deepEqual(JSON.parse(options.body),{authorize:true,permissions:"0"});
        assert.equal(new URLSearchParams(path.split("?")[1]).get("scope"),"identify guilds.join");
        return { response:{ok:true},payload:{location:input.redirectUri+"?code=sample-code"} };
      }
      assert.equal(path,"oauth2/@me");assert.equal(options.headers.Authorization,"Bearer "+oauth.accessToken);
      return {response:{ok:true},payload:{user,scopes:["identify","guilds.join"]}};
    },
    exchangeCode: async (config,code,redirectUri,route) => { assert.equal(route,proxy);assert.equal(code,"sample-code");assert.equal(redirectUri,input.redirectUri);events.push("exchange");return oauth; },
    ...overrides
  };
  return { events,dependencies };
}

test("new stock accounts wait for READY and all identity/auth/token verification steps use one proxy", async () => {
  const {events,dependencies}=fixture();
  const result=await authorizeCommunityStockAccount(input,dependencies);
  assert.equal(result.discordUserId,user.id);assert.equal(result.oauth,oauth);
  assert.equal(events.length,5);assert.equal(events[0],"READY");assert.equal(events[1],"users/@me");assert.ok(events[2].startsWith("oauth2/authorize?"));assert.equal(events[3],"exchange");assert.equal(events[4],"oauth2/@me");
});

test("proxy and Gateway failures prevent all authorization requests instead of falling back direct", async () => {
  const noRequests=async()=>assert.fail("no REST request may be sent");
  await assert.rejects(authorizeCommunityStockAccount({...input,proxyUrl:""},fixture({requestThroughProxy:noRequests,withGatewaySession:noRequests,getConnectedGatewayUser:noRequests}).dependencies),error=>error.statusCode===409);
  await assert.rejects(authorizeCommunityStockAccount(input,fixture({requestThroughProxy:noRequests,withGatewaySession:async()=>{throw Error("Gateway rejected");}}).dependencies),/Gateway rejected/);
  await assert.rejects(authorizeCommunityStockAccount(input,fixture({withGatewaySession:async(_account,task)=>task(null),requestThroughProxy:noRequests}).dependencies),/valid account identity/);
});

test("ready Onliner sessions are reused without reconnecting", async () => {
  const {events,dependencies}=fixture({getConnectedGatewayUser:async()=>user,withGatewaySession:async()=>assert.fail("must reuse")});
  events.push("READY");
  await authorizeCommunityStockAccount({...input,onlinerAccount:{id:"linked",discordUserId:user.id}},dependencies);
  assert.equal(events.filter(event=>event==="READY").length,1);
});

test("Gateway off skips session lookup and connection while every OAuth step keeps its proxy", async () => {
  const { events, dependencies } = fixture({
    getConnectedGatewayUser: async () => assert.fail("Gateway lookup must be skipped"),
    withGatewaySession: async () => assert.fail("Gateway must not connect")
  }, false);
  const result = await authorizeCommunityStockAccount({ ...input, gatewayBeforeAuth: false, onlinerAccount: { id: "existing" } }, dependencies);
  assert.equal(result.discordUserId, user.id);
  assert.equal(result.oauth, oauth);
  assert.equal(events[0], "users/@me");
  assert.equal(events.length, 4);
  assert.equal(events.includes("READY"), false);
});

test("Gateway off still requires a proxy, valid REST identity, consent and OAuth user/scope verification", async () => {
  const direct = { ...input, gatewayBeforeAuth: false };
  await assert.rejects(authorizeCommunityStockAccount({ ...direct, proxyUrl: "" }, fixture({}, false).dependencies), error => error.statusCode === 409);
  for (const mode of ["invalid-id", "token-rejected", "oauth-user", "scope", "no-consent"]) {
    const { dependencies } = fixture({}, false);
    const original = dependencies.requestThroughProxy;
    dependencies.withGatewaySession = async () => assert.fail("Gateway disabled");
    dependencies.requestThroughProxy = async (...args) => {
      if (args[0] === "users/@me" && mode === "invalid-id") return { response: { ok: true }, payload: {} };
      if (args[0] === "users/@me" && mode === "token-rejected") return { response: { ok: false, status: 401 } };
      if (args[0] === "oauth2/@me" && ["oauth-user", "scope"].includes(mode)) return { response: { ok: true }, payload: { user: mode === "oauth-user" ? { id: "999999999999999999" } : user, scopes: mode === "scope" ? [] : ["guilds.join"] } };
      if (args[0].startsWith("oauth2/authorize?") && mode === "no-consent") return { response: { ok: true }, payload: {} };
      return original(...args);
    };
    await assert.rejects(authorizeCommunityStockAccount(direct, dependencies), error => [401, 409, 502].includes(error.statusCode), mode);
  }
});

test("REST identity mismatches and OAuth verification errors never produce authorized stock", async () => {
  for(const mode of ["identity", "oauth-user", "scopes"]) {
    const {dependencies}=fixture();const original=dependencies.requestThroughProxy;
    dependencies.requestThroughProxy=async(...args)=>{
      if(mode==="identity" && args[0]==="users/@me")return {response:{ok:true},payload:{id:"999999999999999999"}};
      if(args[0]==="oauth2/@me")return {response:{ok:true},payload:{user:mode==="oauth-user"?{id:"999999999999999999"}:user,scopes:mode==="scopes"?["identify"]:["guilds.join"]}};
      return original(...args);
    };
    await assert.rejects(authorizeCommunityStockAccount(input,dependencies),error=>[409,502].includes(error.statusCode),mode);
  }
});

test("authorization rejection stops the flow, preserves 429 and never exchanges an absent consent code", async () => {
  for(const status of [401,403,429,500,200]) {
    const {dependencies}=fixture();const original=dependencies.requestThroughProxy;
    dependencies.requestThroughProxy=async(...args)=>args[0].startsWith("oauth2/authorize?")?{response:{ok:status===200,status},payload:{message:"Rejected"}}:original(...args);
    dependencies.exchangeCode=async()=>assert.fail("must not exchange");
    await assert.rejects(authorizeCommunityStockAccount(input,dependencies),error=>error.statusCode===(status===429?429:status===500?502:409));
  }
});

test("remote Gateway reuse requires a current worker, exact account and matching token/proxy route", () => {
  const now=Date.parse("2026-11-22T00:00:00Z");const account={id:"linked",botToken:token,discordUserId:user.id};
  const runtime={connectionState:"connected",bot:user,authorizationRouteKey:onlinerAuthorizationRouteKey(token,proxy)};
  const worker={status:"online",heartbeat_at:new Date(now).toISOString()};
  assert.equal(getReusableAuthorizationGatewayUser(account,proxy,runtime,worker,now),user);
  for(const patch of [{connectionState:"connecting"},{authorizationRouteKey:onlinerAuthorizationRouteKey("other-token",proxy)},{authorizationRouteKey:onlinerAuthorizationRouteKey(token,"other-proxy")},{bot:{id:"999999999999999999"}}])assert.equal(getReusableAuthorizationGatewayUser(account,proxy,{...runtime,...patch},worker,now),null);
  assert.equal(getReusableAuthorizationGatewayUser(account,proxy,runtime,{...worker,heartbeat_at:new Date(now-60000).toISOString()},now),null);
  assert.equal(getReusableAuthorizationGatewayUser(account,proxy,runtime,{...worker,status:"offline"},now),null);
});

const source=fs.readFileSync(new URL("./index.mjs",import.meta.url),"utf8");
const ast=ts.createSourceFile("index.mjs",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functionCode=name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast);

test("OAuth code exchange uses proxy transport, never direct fetch on failure; ordinary callback remains supported", async () => {
  const options=[];const payload={access_token:oauth.accessToken,refresh_token:oauth.refreshToken,expires_in:3600};
  const context={URLSearchParams,AbortSignal,discordApiBase:"https://discord.com/api/v10",fetch:async()=>assert.fail("direct request forbidden"),
    requestDiscordThroughProxy:async(path,route,init)=>{options.push(init);assert.equal(path,"oauth2/token");assert.equal(route,proxy);return {response:{ok:true},payload};}};
  vm.runInNewContext(functionCode("exchangeCommunityOAuthAuthorizationCode")+";this.exchange=exchangeCommunityOAuthAuthorizationCode;",context);
  assert.equal((await context.exchange(input.config,"code",input.redirectUri,proxy)).accessToken,oauth.accessToken);
  assert.equal(new URLSearchParams(options[0].body).get("grant_type"),"authorization_code");
  context.requestDiscordThroughProxy=async()=>{throw Error("Proxy failed");};
  await assert.rejects(context.exchange(input.config,"code",input.redirectUri,proxy),/Proxy failed/);
  let directCalls=0;context.fetch=async()=>{directCalls++;return {ok:true,json:async()=>payload};};
  await context.exchange(input.config,"code",input.redirectUri);
  assert.equal(directCalls,1,"standard browser OAuth callback uses its existing server exchange");
});

function gatewayFixture() {
  const sockets=[];const cleared=[];
  class Socket extends EventEmitter {static OPEN=1;readyState=1;sent=[];constructor(url,options){super();this.url=url;this.options=options;sockets.push(this);}send(data){this.sent.push(JSON.parse(data));}close(){this.closed=true;this.emit("close",1000);}}
  const context={WebSocket:Socket,discordOnlinerRuntimes:new Map(),onlinerAuthorizationRouteKey,createDiscordOnlinerProxyAgent:value=>value,createDiscordGatewayIdentityProperties:()=>({}),createDiscordGatewayClientState:()=>({}),
    setTimeout:()=>"ready-timeout",clearTimeout:id=>cleared.push(id),setInterval:()=>({unref(){}}),clearInterval(){}};
  vm.runInNewContext(functionCode("runWithHumanizerGatewaySession")+";this.withGateway=runWithHumanizerGatewaySession;",context);
  return {context,sockets,cleared};
}

test("Gateway starts authorization only after READY, runs once, clears readiness deadline and closes temporary socket", async () => {
  const {context,sockets,cleared}=gatewayFixture();let calls=0;let finish;
  const result=context.withGateway({token,proxyUrl:proxy},async(identity)=>{calls++;assert.equal(identity.id,user.id);return new Promise(resolve=>{finish=resolve;});});
  assert.equal(calls,0);assert.equal(sockets[0].options.agent,proxy);
  sockets[0].emit("message",JSON.stringify({op:10,d:{heartbeat_interval:45000}}));
  assert.equal(calls,0);assert.equal(sockets[0].sent[0].op,2);
  sockets[0].emit("message",JSON.stringify({op:0,t:"READY",d:{user}}));
  sockets[0].emit("message",JSON.stringify({op:0,t:"READY",d:{user}}));
  await Promise.resolve();assert.equal(calls,1);assert.ok(cleared.includes("ready-timeout"));
  finish("authorized");assert.equal(await result,"authorized");assert.equal(sockets[0].closed,true);
});

test("Gateway rejection or wrong READY identity prevents auth and closes temporary socket", async () => {
  for(const mode of ["close","mismatch"]) {
    const {context,sockets}=gatewayFixture();
    const result=context.withGateway({id:user.id,token,proxyUrl:proxy},()=>assert.fail("auth must not run"));
    const rejection=assert.rejects(result,/Gateway/);
    if(mode==="close")sockets[0].emit("close",4004);
    else sockets[0].emit("message",JSON.stringify({op:0,t:"READY",d:{user:{id:"999999999999999999"}}}));
    await rejection;assert.equal(sockets[0].closed,true);
  }
});

const normalizerContext = {
  crypto:{randomUUID:()=>"generated-profile"},normalizeDiscordOnlinerProxyUrl:value=>value||"",
  isDiscordGuildId:value=>/^\d{17,20}$/.test(value),discordOnlinerAccountLimit:3000,pruneStockAuthProxyPool,
  discordOnlinerStatuses:new Set(["online"]),discordOnlinerActivityTypes:new Set(["playing"]),
  defaultDiscordOnlinerGames:[],discordOnlinerStatusValues:["online"],discordOnlinerActivityTypeValues:["playing"],
  defaultDiscordOnlinerSpotifyPlaylistId:"",normalizeDiscordOnlinerYouTubePlaylistId:()=>"",
  defaultDiscordOnlinerTwitchUsers:[],defaultDiscordOnlinerStreamingCategories:[],defaultDiscordOnlinerStreamingTitles:[]
};
vm.runInNewContext(functionCode("normalizeDiscordOnlinerConfig")+";this.normalize=normalizeDiscordOnlinerConfig;",normalizerContext);
const normalizeConfig=normalizerContext.normalize;
test("bot profiles retain Rich Presence off while ordinary account settings remain editable", () => {
  const config = normalizeConfig({ accounts: [
    { id: "bot-profile", botToken: "bot-token", isBot: true, richPresenceEnabled: true },
    { id: "user-profile", botToken: token, richPresenceEnabled: true }
  ] });
  assert.equal(config.accounts[0].richPresenceEnabled, false);
  assert.equal(config.accounts[0].isBot, true);
  assert.equal(config.accounts[1].richPresenceEnabled, true);
});
function response() { return { statusCode:200,status(code){this.statusCode=code;return this;},set(){return this;},json(value){this.body=value;return this;} }; }
function accountRoute({connect=true,proxyAvailable=true,authFailure=false,customProxy=false,occupied=false,linked=false,gatewayBeforeAuth}={}) {
  const writes=[];const stored=[];const starts=[];const stops=[];const authEvents=[];
  const other={id:"other-profile",botToken:"other-token",proxyUrl:"http://other-proxy:8080"};
  let handler;
  const scope={
    getCommunityOAuthConfig:async()=>({...input.config,configured:true,guildId:"guild"}),parseCommunityCategoryId:value=>value,
    getDiscordOnlinerConfig:async()=>({enabled:true,accounts:[occupied ? {...other,proxyUrl:proxy} : other, ...(linked ? [{id:"existing",botToken:token,discordUserId:user.id,proxyUrl:"http://previous-proxy:8080"}] : [])],proxyPool:[...(proxyAvailable?[proxy]:[]),...(linked?["http://previous-proxy:8080"]:[])],stockAuthProxyPool:linked?["http://previous-proxy:8080"]:[]}),
    validateStockAuthProxy,
    discordOnlinerAccountLimit:3000,selectDiscordOnlinerProxy:()=>proxyAvailable?proxy:"",normalizeDiscordOnlinerProxyUrl:value=>value,
    pool:{query:async(sql,args)=>{
      if(sql.includes("SELECT id, name FROM community_stock_categories"))return {rowCount:1,rows:[{id:"offline",name:"Offline"}]};
      if(sql.includes("MAX(sort_position)"))return {rows:[{maximum:0}]};
      assert.ok(sql.includes("INSERT INTO community_oauth_joins"));writes.push({sql,args});
      return {rows:[{discord_user_id:user.id,username:user.username,display_name:null,avatar_url:null,status:"authorized",stock_type:"offline",sort_position:1024}]};
    }},
    authorizeCommunityStockAccount:async(args,dependencies)=>{
      assert.equal(args.proxyUrl,proxy);assert.equal(args.accountToken,token);
      if(authFailure)throw Error("Gateway failed");
      const auth=fixture({},args.gatewayBeforeAuth);
      const result=await authorizeCommunityStockAccount(args,{...auth.dependencies,normalizeProxy:dependencies.normalizeProxy});
      authEvents.push(...auth.events);
      return result;
    },
    requestDiscordThroughProxy(){assert.fail("test helper supplies its mock proxy transport");},
    runWithHumanizerGatewaySession(){assert.fail("test helper supplies its mock Gateway");},
    getConnectedCommunityAuthorizationGatewayUser(){},exchangeCommunityOAuthAuthorizationCode(){},
    crypto:{randomUUID:()=>"new-profile"},normalizeDiscordOnlinerConfig:normalizeConfig,encryptCredential:()=>"encrypted",
    discordOnlinerSettingKey:"onliner",saveEncryptedSetting:async(key,value)=>stored.push(JSON.parse(value)),
    discordOnlinerRuntimes:new Map(linked?[["existing",{accountId:"existing"}]]:[]),
    stopDiscordOnlinerRuntime:runtime=>stops.push(runtime.accountId),
    serviceRunsOnliner:true,startDiscordOnlinerAccounts:(config,accounts)=>starts.push({config,accounts}),discordOnlinerWorkerLockClient:null,appendDiscordOnlinerLog(){},
    requireSession(){},app:{post(_path,_auth,callback){handler=callback;}}
  };
  const route=ast.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==="app.post"&&node.expression.arguments[0]?.text==="/api/community/categories/:categoryId/accounts");
  vm.runInNewContext(route.getText(ast),scope);
  const request={params:{categoryId:"offline"},body:{accountToken:token,connectToOnliner:connect,...(gatewayBeforeAuth !== undefined ? {gatewayBeforeAuth} : {}),...(customProxy?{authProxy:proxy}:{})},protocol:"https",get:()=>"panel.example"};
  return {handler,request,writes,stored,starts,stops,other,authEvents};
}

test("authorization Gateway choice and persistent Onliner choice are independent in the single/bulk endpoint", async () => {
  for (const gatewayBeforeAuth of [true, false]) for (const connect of [true, false]) {
    const state=accountRoute({gatewayBeforeAuth,connect});
    const res=response();
    await state.handler(state.request,res,error=>{throw error;});
    assert.equal(res.statusCode,201);
    assert.equal(state.authEvents.includes("READY"),gatewayBeforeAuth);
    assert.equal(state.writes.length,1);
    assert.equal(state.stored.length,connect?1:0);
    assert.equal(state.starts.length,connect?1:0);
  }
});

test("invalid Gateway option types are rejected before authorization or persistence", async () => {
  for (const gatewayBeforeAuth of ["false", 0, null, {}]) {
    const state=accountRoute({gatewayBeforeAuth});const res=response();
    await state.handler(state.request,res,error=>{throw error;});
    assert.equal(res.statusCode,400);
    assert.equal(state.writes.length,0);assert.equal(state.authEvents.length,0);
  }
});

test("shared single/bulk endpoint only persists stock after proxied Gateway authorization and retains its proxy in Onliner",async()=>{
  for(const connect of [true,false]) {
    const fixture=accountRoute({connect});const res=response();
    await fixture.handler(fixture.request,res,error=>{throw error;});
    assert.equal(res.statusCode,201);assert.equal(fixture.writes.length,1);assert.equal(res.body.onlinerConnected,connect);
    assert.equal(fixture.stored.length,connect?1:0);
    if(connect) {
      const account=fixture.stored[0].accounts.find(item=>item.id==="new-profile");
      assert.equal(account.proxyUrl,proxy);assert.equal(account.botToken,token);
      assert.ok(fixture.stored[0].accounts.some(item=>item.id===fixture.other.id));
      assert.equal(fixture.starts[0].accounts[0].proxyUrl,proxy);
    }
  }
});

test("shared single/bulk endpoint saves nothing when a proxy or ready Gateway is unavailable",async()=>{
  for(const options of [{proxyAvailable:false},{authFailure:true}]) {
    const fixture=accountRoute(options);const res=response();let error;
    await fixture.handler(fixture.request,res,value=>{error=value;});
    assert.equal(fixture.writes.length,0);assert.equal(fixture.stored.length,0);assert.equal(fixture.starts.length,0);
    if(options.authFailure)assert.match(error.message,/Gateway failed/);else assert.equal(res.statusCode,409);
  }
});

test("paired auth proxy works without a central pool and is saved only for persistent Onliner connections",async()=>{
  for(const connect of [true,false]) {
    const state=accountRoute({connect,proxyAvailable:false,customProxy:true});
    const res=response();
    await state.handler(state.request,res,error=>{throw error;});
    assert.equal(res.statusCode,201);
    assert.equal(state.writes.length,1);
    assert.equal(state.stored.length,connect?1:0);
    if(connect) {
      const saved=state.stored[0];
      assert.ok(saved.proxyPool.includes(proxy));
      assert.ok(saved.stockAuthProxyPool.includes(proxy));
      assert.equal(saved.accounts.find(account=>account.id==="new-profile").proxyUrl,proxy);
      const disconnected=normalizeConfig({...saved,accounts:saved.accounts.filter(account=>account.id!=="new-profile")});
      assert.ok(!disconnected.proxyPool.includes(proxy));
      assert.equal(disconnected.stockAuthProxyPool.length,0);
    }
  }
});

test("dedicated auth failure and proxies assigned to another account save no stock or proxy",async()=>{
  for(const options of [{authFailure:true},{occupied:true}]) {
    const state=accountRoute({customProxy:true,...options});
    const res=response();let error;
    await state.handler(state.request,res,value=>{error=value;});
    assert.match(error.message,options.occupied?/already assigned/:/Gateway failed/);
    assert.equal(state.writes.length,0);assert.equal(state.stored.length,0);assert.equal(state.starts.length,0);
  }
});

test("an existing account can move to its paired proxy without leaving the prior dedicated proxy behind",async()=>{
  const state=accountRoute({customProxy:true,linked:true});
  const res=response();
  await state.handler(state.request,res,error=>{throw error;});
  assert.equal(res.statusCode,201);
  const saved=state.stored[0];
  const account=saved.accounts.find(account=>account.id==="existing");
  assert.equal(account.proxyUrl,proxy);
  assert.ok(saved.stockAuthProxyPool.includes(proxy));
  assert.ok(!saved.proxyPool.includes("http://previous-proxy:8080"));
  assert.ok(!saved.stockAuthProxyPool.includes("http://previous-proxy:8080"));
  assert.equal(saved.accounts.filter(account=>account.botToken===token).length,1);
  assert.deepEqual(state.stops,["existing"],"close the previous socket before starting its new proxy route");
});

test("single and bulk profile removal prune dedicated proxies while retaining ordinary pool proxies and other accounts",()=>{
  const general="http://general:8080",second="http://second:8080";
  const accounts=[
    {id:"one",botToken:token,proxyUrl:proxy},
    {id:"two",botToken:"second-account-token",proxyUrl:second},
    {id:"three",botToken:"ordinary-account-token",proxyUrl:general}
  ];
  const current=normalizeConfig({accounts,proxyPool:[general,proxy,second],stockAuthProxyPool:[proxy,second]});
  const single=normalizeConfig({...current,accounts:current.accounts.filter(account=>account.id!=="one")});
  assert.deepEqual(Array.from(single.proxyPool),[general,second]);
  assert.deepEqual(Array.from(single.stockAuthProxyPool),[second]);
  const bulk=normalizeConfig({...current,accounts:current.accounts.filter(account=>account.id==="three")});
  assert.deepEqual(Array.from(bulk.proxyPool),[general]);
  assert.equal(bulk.stockAuthProxyPool.length,0);
  assert.equal(bulk.accounts[0].id,"three");
  assert.ok(current.proxyPool.includes(proxy),"input configuration remains unchanged");
});

test("shared dedicated proxies are retained until their last referencing profile is removed",()=>{
  const config={proxyPool:[proxy,"http://ordinary:8080"],stockAuthProxyPool:[proxy]};
  assert.deepEqual(pruneStockAuthProxyPool(config,[{proxyUrl:proxy}]).proxyPool,config.proxyPool);
  assert.deepEqual(pruneStockAuthProxyPool(config,[]).proxyPool,["http://ordinary:8080"]);
});

test("automatic pool assignment never lends another account's dedicated auth proxy",()=>{
  const scope={discordOnlinerProxyHealth:new Map(),discordOnlinerProxySelectionSequence:0};
  vm.runInNewContext(functionCode("selectDiscordOnlinerProxy")+";this.select=selectDiscordOnlinerProxy;",scope);
  const general="http://ordinary:8080";
  assert.equal(scope.select({accounts:[],proxyPool:[proxy],stockAuthProxyPool:[proxy]}),"");
  assert.equal(scope.select({accounts:[],proxyPool:[proxy,general],stockAuthProxyPool:[proxy]}),general);
});
