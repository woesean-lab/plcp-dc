import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { COMMUNITY_ORDER_CATEGORY_GUARD_SQL } from "./community-order-category-guard.mjs";
import { planCommunityOrderCategoryTransfer } from "./community-order-category-transfer.mjs";
import { getCommunityResultAllocation, communityResultMatchesAllocation } from "../shared/community-order-allocations.mjs";

// Optional isolated PostgreSQL runtime; never connects to the application's DB.
const runtime = process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(path.resolve(process.env.PGLITE_MODULE_PATH))
  : new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);

test("PostgreSQL preserves transfers across live workers and stale upserts", { skip: !fs.existsSync(fileURLToPath(runtime)) }, async (t) => {
  const { PGlite } = await import(runtime.href);
  const db = new PGlite();
  const source = { id: "premium", name: "OAuth Premium", color_key: "violet" };
  const target = { id: "online", name: "OAuth Online", color_key: "cyan", check_replacement_enabled: true, reaction_use_enabled: true };
  const initial = { uniqid: "live", provider: "community", service: "COMMUNITY-ONLINE", categoryId: source.id, stockType: source.id, categoryName: source.name,
    status: "PROCESS", amount: 2, added: 1, expiredAt: "2026-11-01", durationMonths: 1, categoryIsPeriodic: true,
    autoLeaveJob: { id: "leave-job", status: "running", processed: 2, total: 10, left: 1, alreadyLeft: 0, failed: 1 },
    categoryAllocations: [{ categoryId: source.id, categoryName: source.name, isPeriodic: true, expiredAt: "2026-11-01", durationMonths: 1, amount: 2, added: 1 }],
    communityResults: [{ discordUserId: "one", categoryId: source.id, state: "joined", autoLeaveStatus: "waiting" }, { discordUserId: "two", categoryId: source.id, state: "joining" }]
  };
  const save = (payload) => db.query("UPDATE tracked_orders SET payload = $2::jsonb WHERE uniqid = $1", [payload.uniqid, JSON.stringify(payload)]);
  const read = async (id = "live") => (await db.query("SELECT payload FROM tracked_orders WHERE uniqid = $1", [id])).rows[0].payload;
  try {
    await db.exec("CREATE TABLE tracked_orders (uniqid text PRIMARY KEY, payload jsonb NOT NULL)");
    await db.exec(COMMUNITY_ORDER_CATEGORY_GUARD_SQL);
    await db.exec(COMMUNITY_ORDER_CATEGORY_GUARD_SQL); // startup installation is repeatable
    await db.query("INSERT INTO tracked_orders VALUES ($1, $2::jsonb)", [initial.uniqid, JSON.stringify(initial)]);

    await t.test("an active delivery and Auto Leave job can move without resetting their state", async () => {
      const plan = planCommunityOrderCategoryTransfer(initial, source, target, "2026-11-20");
      assert.ok(plan.order);
      await save(plan.order);
      const moved = await read();
      assert.equal(moved.categoryName, target.name);
      assert.equal(moved.status, "PROCESS");
      assert.deepEqual(moved.autoLeaveJob, initial.autoLeaveJob);
      assert.equal(moved.expiredAt, initial.expiredAt);
      assert.equal(moved.communityResults[1].state, "joining");
    });

    await t.test("a pre-transfer worker keeps new progress and the Online category", async () => {
      const stale = structuredClone(initial);
      stale.added = 2; stale.status = "COMPLETED";
      stale.categoryAllocations[0].added = 2;
      stale.communityResults[1].state = "joined";
      await save(stale);
      const saved = await read();
      assert.equal(saved.categoryId, target.id);
      assert.equal(saved.stockType, target.id);
      assert.equal(saved.categoryAllocations[0].categoryId, target.id);
      assert.ok(saved.communityResults.every((member) => member.categoryId === target.id));
      assert.equal(saved.categoryAllocations[0].added, 2);
      assert.equal(saved.added, 2);
      assert.equal(saved.status, "COMPLETED");
      assert.equal(saved.categoryTransferHistory.length, 1);
    });

    await t.test("stale upserts cannot reset current support dates or Leave all claims/progress", async () => {
      const fresh = await read();
      fresh.expiredAt = "2026-12-01"; fresh.categoryAllocations[0].expiredAt = "2026-12-01";
      fresh.autoLeaveJob.processed = 4; fresh.autoLeaveJob.left = 3;
      fresh.publicLeaveAllRequestedAt = "2026-11-20T01:00:00Z";
      Object.assign(fresh.communityResults[0], { autoLeaveStatus: "left", autoLeaveCompletedAt: "2026-11-20T01:05:00Z", leftServerAt: "2026-11-20T01:05:00Z", membershipStatus: "removed" });
      await save(fresh);
      const stale = { ...structuredClone(initial), details: "Worker finished its next step", added: 2 };
      await db.query("INSERT INTO tracked_orders VALUES ($1, $2::jsonb) ON CONFLICT (uniqid) DO UPDATE SET payload = EXCLUDED.payload", [stale.uniqid, JSON.stringify(stale)]);
      const saved = await read();
      assert.equal(saved.categoryId, target.id);
      assert.equal(saved.expiredAt, fresh.expiredAt);
      assert.equal(saved.categoryAllocations[0].expiredAt, fresh.expiredAt);
      assert.equal(saved.publicLeaveAllRequestedAt, fresh.publicLeaveAllRequestedAt);
      assert.equal(saved.autoLeaveJob.processed, 4);
      assert.equal(saved.communityResults[0].autoLeaveStatus, "left");
      assert.equal(saved.communityResults[0].membershipStatus, "removed");
      assert.equal(saved.details, stale.details);
    });

    await t.test("mixed old/new member category references retain accurate allocation progress", async () => {
      const stale = structuredClone(initial);
      stale.added = 2; stale.categoryAllocations[0].added = 1;
      stale.communityResults[1] = { ...stale.communityResults[1], categoryId: target.id, state: "joined" };
      await save(stale);
      const saved = await read();
      assert.equal(saved.categoryAllocations[0].added, 2);
      assert.equal(saved.added, 2);
      assert.ok(saved.communityResults.every((member) => member.categoryId === target.id));
    });

    await t.test("new Auto Leave progress is still accepted", async () => {
      const fresh = await read();
      fresh.autoLeaveJob.processed = 5; fresh.autoLeaveJob.left = 4;
      await save(fresh);
      assert.equal((await read()).autoLeaveJob.processed, 5);
    });

    await t.test("chained transfers survive snapshots from either older category", async () => {
      const online = await read();
      const next = { ...target, id: "next", name: "Next pool", color_key: "emerald" };
      await save(planCommunityOrderCategoryTransfer(online, target, next, "2026-11-21").order);
      for (const stale of [initial, online]) {
        await save({ ...stale, details: "Latest worker progress" });
        const saved = await read();
        assert.equal(saved.categoryId, next.id);
        assert.equal(saved.categoryName, next.name);
        assert.equal(saved.categoryTransferHistory.length, 2);
        assert.equal(saved.details, "Latest worker progress");
      }
    });

    await t.test("two purchased portions retain distinct support and counters across stale delivery writes", async () => {
      const mixed = { ...structuredClone(initial), uniqid: "mixed", categoryId: target.id, stockType: target.id, categoryName: "2 categories", amount: 4, added: 2,
        categoryAllocations: [
          { categoryId: target.id, categoryName: target.name, amount: 2, added: 1, isPeriodic: true, expiredAt: "2027-02-01", durationMonths: 3 },
          { categoryId: source.id, categoryName: source.name, amount: 2, added: 1, isPeriodic: true, expiredAt: "2026-11-01", durationMonths: 1 }
        ],
        communityResults: [
          { discordUserId: "online-one", categoryId: target.id, state: "joined" },
          { discordUserId: "online-two", categoryId: target.id, state: "queued" },
          { discordUserId: "premium-one", categoryId: source.id, state: "joined" },
          { discordUserId: "premium-two", categoryId: source.id, state: "joining" }
        ]
      };
      await db.query("INSERT INTO tracked_orders VALUES ($1, $2::jsonb)", [mixed.uniqid, JSON.stringify(mixed)]);
      await save(planCommunityOrderCategoryTransfer(mixed, source, target, "now").order);
      let moved = await read(mixed.uniqid);
      assert.equal(moved.categoryName, target.name);
      assert.deepEqual(moved.categoryAllocations.map((allocation) => allocation.expiredAt), ["2027-02-01", "2026-11-01"]);
      assert.equal(getCommunityResultAllocation(moved, moved.communityResults[0]).expiredAt, "2027-02-01");
      assert.equal(getCommunityResultAllocation(moved, moved.communityResults[2]).expiredAt, "2026-11-01");

      // A support extension and a Leave all claim happen while an older worker runs.
      moved.categoryAllocations[0].expiredAt = "2027-03-01";
      moved.categoryAllocations[1].expiredAt = "2026-12-01";
      moved.publicLeaveAllRequestedAt = "2026-11-20T01:00:00Z";
      await save(moved);
      const stale = structuredClone(mixed);
      stale.added = 3; stale.communityResults[1].state = "joined";
      await db.query("INSERT INTO tracked_orders VALUES ($1, $2::jsonb) ON CONFLICT (uniqid) DO UPDATE SET payload = EXCLUDED.payload", [stale.uniqid, JSON.stringify(stale)]);
      moved = await read(mixed.uniqid);
      assert.equal(moved.categoryName, target.name);
      assert.ok(moved.communityResults.every((member) => member.categoryId === target.id && member.allocationId));
      assert.deepEqual(moved.categoryAllocations.map((allocation) => allocation.expiredAt), ["2027-03-01", "2026-12-01"]);
      assert.deepEqual(moved.categoryAllocations.map((allocation) => allocation.added), [2, 1]);
      assert.equal(moved.added, 3);
      assert.equal(moved.publicLeaveAllRequestedAt, "2026-11-20T01:00:00Z");

      // An older replacement writer still knows the original Premium category.
      const replacement = structuredClone(stale);
      replacement.communityResults[3] = { discordUserId: "new-premium", categoryId: source.id, state: "joined" };
      replacement.added = 4;
      await save(replacement);
      moved = await read(mixed.uniqid);
      assert.equal(getCommunityResultAllocation(moved, moved.communityResults[3]).expiredAt, "2026-12-01");
      assert.deepEqual(moved.categoryAllocations.map((allocation) => allocation.added), [2, 2]);
      for (const allocation of moved.categoryAllocations) assert.equal(moved.communityResults.filter((member) => communityResultMatchesAllocation(moved, member, allocation)).length, 2);

      // A subsequent move keeps the same portions even though their pool is shared.
      const next = { ...target, id: "next", name: "Next pool" };
      await save(planCommunityOrderCategoryTransfer(moved, target, next, "later").order);
      await save(replacement);
      const chained = await read(mixed.uniqid);
      assert.equal(chained.categoryName, next.name);
      assert.ok(chained.communityResults.every((member) => member.categoryId === next.id));
      assert.deepEqual(chained.categoryAllocations.map((allocation) => allocation.expiredAt), ["2027-03-01", "2026-12-01"]);
      assert.deepEqual(chained.categoryAllocations.map((allocation) => allocation.added), [2, 2]);
    });

    await t.test("ordinary orders and unrelated providers are unchanged", async () => {
      for (const provider of ["community", "dcord"]) {
        const order = { uniqid: provider, provider, status: "PROCESS", categoryId: "untouched", communityResults: [] };
        await db.query("INSERT INTO tracked_orders VALUES ($1, $2::jsonb)", [order.uniqid, JSON.stringify(order)]);
        await save({ ...order, status: "COMPLETED" });
        assert.deepEqual(await read(provider), { ...order, status: "COMPLETED" });
      }
    });
  } finally { await db.close(); }
});
