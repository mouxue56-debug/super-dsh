import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBoard } from "../lib/board.mjs";

const who = { name: "w1", type: "external" };
const boss = { name: "b1", type: "owner" };
const input = { title: "t", goal: "g" };
async function fresh() {
  const board = createBoard({ root: await mkdtemp(join(tmpdir(), "board-guard-")) });
  const ticketValue = await board.create(boss, { ...input, to: [who.name] }); // 只能领派给它的卡
  return { board, id: ticketValue.id };
}

test("done only from working; closed tickets cannot be reopened by block/fail/handoff", async () => {
  const { board, id } = await fresh();
  await board.claim(who, id);
  await board.report(who, id, { summary: "r" });
  await board.block(who, id, "stuck");
  await assert.rejects(board.done(who, id), { code: "CONFLICT" });
  await board.resume(who, id);
  await board.done(who, id);
  await board.accept(boss, id);
  for (
    const call of [
      () => board.block(who, id, "x"),
      () => board.fail(boss, id, "x"),
      () => board.handoff(boss, id, "z"),
    ]
  ) {
    await assert.rejects(call(), { code: "CONFLICT" });
  }
  assert.equal((await board.get(id)).state, "completed");
});
