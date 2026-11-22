import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isCommunityDeliverySettled } from "../shared/community-delivery-state.mjs";
import { canPublicLeaveAll } from "./public-community-leave.mjs";

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const order = (status = "COMPLETED", extra = {}) => ({ uniqid: "order", provider: "community", serverId: "123456789012345678", publicLeaveAllEnabled: true, status, communityResults: [{ state: "joined", discordUserId: "234567890123456789" }], ...extra });
const liveStatuses = ["NEW", "PROCESS", "RECOVERING", "WAITING", "PAUSED", "PAUSED_INVITES", "HUMANIZING"];
const pendingStates = ["queued", "pending", "joining", "replacing", "running", "processing"];

test("Leave all blocks every active delivery status, including partially delivered orders", () => {
  for (const status of [...liveStatuses, undefined]) {
    const current = { ...order(), status };
    assert.equal(isCommunityDeliverySettled(current), false, String(status));
    assert.equal(canPublicLeaveAll(current), false, String(status));
  }
  for (const status of ["COMPLETED", "PARTIAL", "ERROR", "TERMINATED", "CANCELLED", "CANCELED"]) {
    assert.equal(isCommunityDeliverySettled(order(status)), true, status);
  }
});

test("terminal order status cannot override queued or in-flight member results", () => {
  for (const state of pendingStates) {
    const current = order("COMPLETED", { communityResults: [...order().communityResults, { state }] });
    assert.equal(isCommunityDeliverySettled(current), false, state);
    assert.equal(canPublicLeaveAll(current), false, state);
  }
  assert.equal(isCommunityDeliverySettled(order("PARTIAL", { communityResults: [...order().communityResults, { state: "failed" }, { state: "cancelled" }] })), true);
});

function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set() { return this; } }; }
const statement = ast.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "app.post" && node.expression.arguments[0]?.text === "/api/community/orders/:uniqid/leave-all");

test("admin API rejects active delivery for immediate and expired-only Leave all without scheduling or contacting Discord", async () => {
  for (const expiredOnly of ["false", "true"]) {
    for (const current of [order("PROCESS"), order("PARTIAL", { communityResults: [...order().communityResults, { state: "replacing" }] })]) {
      let handler;
      const context = { isCommunityDeliverySettled, requireSession() {}, pool: { query: async () => ({ rows: [{ payload: current }] }) },
        app: { post(_path, _auth, callback) { handler = callback; } }, scheduleExpiredCommunityAutoLeave: () => assert.fail("must not schedule leave"), leaveAllCommunityOrderMembers: () => assert.fail("must not start leave") };
      vm.runInNewContext(statement.getText(ast), context);
      const res = response();
      await handler({ params: { uniqid: "order" }, query: { expiredOnly } }, res, (error) => { throw error; });
      assert.equal(res.statusCode, 409);
    }
  }
});

test("expired-only scheduling rechecks the locked current order before writing", async () => {
  const node = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "scheduleExpiredCommunityAutoLeave");
  const queries = [];
  const context = { isCommunityDeliverySettled, pool: { connect: async () => ({ release() {}, query: async (sql) => { queries.push(sql); return { rows: sql.includes("FOR UPDATE") ? [{ payload: order("PROCESS") }] : [] }; } }) } };
  vm.runInNewContext(node.getText(ast) + ";this.schedule = scheduleExpiredCommunityAutoLeave;", context);
  await assert.rejects(context.schedule("order"), (error) => error.statusCode === 409);
  assert.ok(queries.includes("ROLLBACK"));
  assert.equal(queries.some((sql) => sql.startsWith("UPDATE")), false);
});

const pageText = fs.readFileSync(new URL("../src/pages/OrderPage.tsx", import.meta.url), "utf8");
const page = ts.createSourceFile("OrderPage.tsx", pageText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let eligibility;
const leaveButtons = [];
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(page) === "canLeaveAllCommunityMembers") eligibility = node.initializer.getText(page);
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(page) === "Button") {
    const props = node.attributes.properties;
    const click = props.find((attribute) => attribute.name?.getText(page) === "onClick")?.getText(page) ?? "";
    if (click.includes("handleLeaveAllCommunityMembers") || click.includes("setShowLeaveAllCommunityModal(true)")) leaveButtons.push(props.find((attribute) => attribute.name?.getText(page) === "disabled")?.getText(page));
  }
  ts.forEachChild(node, find);
}
find(page);

test("detail action and already-open confirmation share the same eligibility check", () => {
  assert.equal(leaveButtons.length, 2);
  assert.ok(leaveButtons.every((disabled) => disabled === "disabled={!canLeaveAllCommunityMembers}"));
  const context = { isCommunityProvider: true, isCommunityDeliverySettled, result: order(), communityMembersStillInServerCount: 3,
    leavingAllCommunityMembers: false, checkingCommunityMembers: false, autoLeaveRunning: false, manualLeaveRunning: false, replacingAllCommunityMembers: false, retryingFailedCommunityMembers: false };
  const evaluate = (patch = {}) => vm.runInNewContext(eligibility, { ...context, ...patch });
  assert.equal(evaluate(), true);
  for (const status of liveStatuses) assert.equal(evaluate({ result: order(status) }), false);
  assert.equal(evaluate({ result: order("COMPLETED", { communityResults: [{ state: "joined" }, { state: "replacing" }] }) }), false);
  for (const flag of ["leavingAllCommunityMembers", "checkingCommunityMembers", "autoLeaveRunning", "manualLeaveRunning", "replacingAllCommunityMembers", "retryingFailedCommunityMembers"]) assert.equal(evaluate({ [flag]: true }), false, flag);
});
