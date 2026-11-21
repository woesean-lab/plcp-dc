import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=fs.readFileSync(new URL("./index.mjs",import.meta.url),"utf8");
const ast=ts.createSourceFile("index.mjs",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functionCode=name=>ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast);
const ids={delivered:"100000000000000001",active:"100000000000000002",full:"100000000000000003",fresh:"100000000000000004"};
const guild="900000000000000001",otherGuild="900000000000000002",stockGuild="800000000000000001";

function fixture(){
  const calls=[];
  const history=[{userId:ids.delivered,categoryId:"previous-category",serverId:guild}];
  const assignments=[{userId:ids.active,categoryId:"previous-category",serverId:guild}];
  const queryable={query:async(sql,args)=>{
    calls.push({sql,args:Array.from(args)});
    if(sql.includes("community_stock_categories"))return {rowCount:1,rows:[{id:"new-category",join_methods:["create_invite"]}]};
    if(sql.includes("WITH member_history AS")||sql.includes("SELECT DISTINCT member_result")) {
      assert.deepEqual(Array.from(args),[args[0]],"membership queries take a server, never a stock category");
      assert.ok(!sql.includes("$2"),"history cannot be hidden behind the new category");
      assert.ok(!sql.includes("stockType")&&!sql.includes("categoryId"));
      const rows=(sql.includes("WITH member_history AS")?history:assignments)
        .filter(row=>row.serverId===args[0])
        .map(row=>({discord_user_id:row.userId}));
      return {rowCount:rows.length,rows};
    }
    assert.ok(sql.includes("FROM community_oauth_joins"));
    assert.equal(args[0],stockGuild);
    assert.equal(args[1],"new-category","stock selection still uses the requested category");
    const rows=Object.values(ids).map(discord_user_id=>({discord_user_id,reserved_order_id:null}));
    return {rowCount:rows.length,rows};
  }};
  const scope={
    isDiscordGuildId:value=>/^[0-9]{17,20}$/.test(value),
    loadCommunityAtServerCapacityUserIds:async()=>[ids.full],
    pool:queryable,getCommunityOAuthConfig:async()=>({configured:true,guildId:stockGuild}),
    isCommunityServiceType:()=>true,normalizeCommunityStockType:value=>value,
    normalizeCommunityJoinMethod:()=> "create_invite",parseCommunityCategoryJoinMethods:value=>value,
    communityJoinMethodUsesAccountToken:()=>false,
    requireSession(){},app:{get(_path,_auth,handler){scope.handler=handler;}}
  };
  const names=["loadCommunityPreviouslyDeliveredUserIds","loadCommunityUnavailableUserIdGroups","loadCommunityUnavailableUserIds"];
  vm.runInNewContext(names.map(functionCode).join("\n")+";this.loadUnavailable=loadCommunityUnavailableUserIds;this.loadGroups=loadCommunityUnavailableUserIdGroups;this.loadDelivered=loadCommunityPreviouslyDeliveredUserIds;",scope);
  const route=ast.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==="app.get"&&node.expression.arguments[0]?.text==="/api/community/availability");
  vm.runInNewContext(route.getText(ast),scope);
  return {scope,queryable,calls};
}

test("a member delivered under the old category stays excluded after its stock category changes",async()=>{
  const {scope,queryable}=fixture();
  assert.deepEqual(Array.from(await scope.loadDelivered(queryable,guild)),[ids.delivered]);
  assert.deepEqual(Array.from(await scope.loadUnavailable(queryable,guild)).sort(),[ids.delivered,ids.active,ids.full].sort());
});

test("availability excludes historical deliveries and active assignments from other categories while selecting new-category stock",async()=>{
  const {scope}=fixture();
  const req={query:{categoryId:"new-category",service:"COMMUNITY-OFFLINE",invite:guild,guildId:guild}};
  const res={statusCode:200,status(code){this.statusCode=code;return this;},set(){return this;},json(value){this.body=value;return this;}};
  await scope.handler(req,res,error=>{throw error;});
  assert.equal(res.statusCode,200);
  assert.equal(res.body.available,1);
  assert.equal(res.body.maximum,1);
  assert.deepEqual({...res.body.breakdown},{stockReady:4,previouslyDelivered:1,activeForServer:1,serverLimit:1});
});

test("different Discord servers remain independent even when using the same category",async()=>{
  const {scope,queryable}=fixture();
  assert.deepEqual(Array.from(await scope.loadDelivered(queryable,otherGuild)),[]);
  const groups=await scope.loadGroups(queryable,otherGuild);
  assert.equal(groups.deliveredUserIds.length,0);
  assert.equal(groups.activeAssignmentUserIds.length,0);
  assert.deepEqual(Array.from(await scope.loadUnavailable(queryable,otherGuild)),[ids.full]);
});

test("reservation, top-up and replacement paths all request server-wide exclusions",()=>{
  const seen=[];
  function visit(node){
    if(ts.isCallExpression(node)&&["loadCommunityUnavailableUserIdGroups","loadCommunityUnavailableUserIds","loadCommunityPreviouslyDeliveredUserIds"].includes(node.expression.getText(ast))){
      seen.push(node);
      assert.equal(node.arguments.length,2,"a stock category must never narrow server membership");
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  assert.ok(seen.length>=8);
});

