import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {hideCommunityLeaveInformation,canPublicLeaveAll} from "./public-community-leave.mjs";
import {isCommunityDeliverySettled} from "../shared/community-delivery-state.mjs";
const source=fs.readFileSync(new URL("./index.mjs",import.meta.url),"utf8");
const ast=ts.createSourceFile("index.mjs",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const code=name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);
const user="234567890123456789",guild="123456789012345678";
const base=()=>({uniqid:"departure-order",provider:"community",status:"COMPLETED",serverId:guild,communityResults:[{discordUserId:user,username:"member",state:"joined"}]});
const scope={hideCommunityLeaveInformation,canPublicLeaveAll,getCustomerReactionSummary:()=>({}),getCommunityOrderJoinMethod:()=>"directly"};
vm.runInNewContext(code("sanitizePublicCommunityOrder")+";this.sanitize=sanitizePublicCommunityOrder;",scope);

test("Monitor preserves the removed badge and safe source through the complete public sanitizer",()=>{
  for(const leaveSource of ["customer","admin","automatic",undefined,"untrusted-value"]) {
    const order=base();
    Object.assign(order.communityResults[0],{membershipStatus:"removed",membershipLeaveSource:leaveSource,membershipDetails:"private proxy diagnostic",membershipCheckedAt:"private-timestamp",leftServerAt:"private-left-time",autoLeaveJobId:"private-job"});
    const result=scope.sanitize(order);
    assert.equal(result.communityResults[0].membershipStatus,"removed");
    assert.equal(result.communityResults[0].membershipDetails,"Member is no longer in the server.");
    assert.equal(result.communityResults[0].membershipLeaveSource,["customer","admin","automatic"].includes(leaveSource)?leaveSource:"unknown");
    assert.equal(JSON.stringify(result).includes("private"),false);
    assert.equal(JSON.stringify(result).includes("untrusted-value"),false);
    assert.equal(result.communityResults[0].discordUserId,undefined);
    assert.equal(order.communityResults[0].membershipDetails,"private proxy diagnostic","admin source is not mutated");
  }
});
test("legacy automatic departures are recognized while unattributed departures stay unknown",()=>{
  const order=base();
  Object.assign(order.communityResults[0],{membershipStatus:"removed",autoLeaveStatus:"left"});
  assert.equal(scope.sanitize(order).communityResults[0].membershipLeaveSource,"automatic");
  delete order.communityResults[0].autoLeaveStatus;
  order.publicLeaveAllRequestedAt="earlier";
  assert.equal(scope.sanitize(order).communityResults[0].membershipLeaveSource,"unknown","an order-level request is not proof of a particular member's cause");
});

function leaveFixture(outcome="left"){
  let saved=base();
  const pool={
    query:async sql=>({rows:sql.includes("SELECT discord_user_id")?[{discord_user_id:user}]:[]}),
    connect:async()=>({release(){},query:async(sql,args)=>{
      if(sql.includes("SELECT payload"))return {rows:[{payload:saved}]};
      if(sql.startsWith("UPDATE tracked_orders SET payload"))saved=JSON.parse(args[1]);
      return {rows:[]};
    }})
  };
  const s={
    pool,isCommunityDeliverySettled,isDiscordGuildId:v=>/^[0-9]{17,20}$/.test(v),
    communityOrderLeaveAllActive:new Set(),
    getDiscordOnlinerConfig:async()=>({}),
    forEachWithConcurrency:async(items,_limit,task)=>{for(const item of items)await task(item);},
    leaveCommunityOrderMember:async()=>({state:outcome,details:"private leave diagnostic"}),
    updateCommunityMemberServerMembershipCache(){}
  };
  vm.runInNewContext(code("leaveAllCommunityOrderMembers")+";this.leave=leaveAllCommunityOrderMembers;",s);
  return {leave:s.leave,read:()=>saved};
}
test("successful leave operations persist an explicit customer/admin origin; failures do not mark removal",async()=>{
  for(const origin of ["customer","admin"]){
    for(const outcome of ["left","already_left","failed"]){
      const state=leaveFixture(outcome);
      const result=await state.leave(base(),{source:origin});
      const member=result.order.communityResults[0];
      if(outcome==="failed"){assert.equal(member.membershipStatus,undefined);assert.equal(member.membershipLeaveSource,undefined);}
      else {assert.equal(member.membershipStatus,"removed");assert.equal(member.membershipLeaveSource,origin);assert.ok(member.leftServerAt);}
    }
  }
  const defaultAdmin=leaveFixture();
  assert.equal((await defaultAdmin.leave(base())).order.communityResults[0].membershipLeaveSource,"admin");
});
test("public endpoint explicitly marks customer origin rather than the default admin origin",async()=>{
  const route=ast.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==="app.post"&&n.expression.arguments[0]?.text==="/api/public/orders/:uniqid/leave-all");
  let handler,origin;
  const s={pool:{},app:{post(_path,callback){handler=callback;}},communityOrderLeaveAllActive:new Set(),getCommunityOAuthConfig:async()=>({configured:true,guildId:guild}),
    claimPublicLeaveAll:async()=>base(),leaveAllCommunityOrderMembers:async(order,options)=>{origin=options.source;return {order,summary:{}};},sanitizePublicCommunityOrder:order=>order};
  vm.runInNewContext(route.getText(ast),s);
  await handler({params:{uniqid:"departure-order"}},{set(){return this;},json(){}},error=>{throw error;});
  assert.equal(origin,"customer");
});

