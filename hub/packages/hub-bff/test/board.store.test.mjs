import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canDispatch, createBoard } from "../lib/board.mjs";
const author = { name: "author", type: "assistant" },
  worker = { name: "worker", type: "external" },
  other = { name: "other", type: "external" };
async function setup(onEvent = () => {}) {
  const root = await mkdtemp(join(tmpdir(), "board-test-"));
  let numberValue = 0;
  const board = createBoard({
    root,
    now: () => Date.UTC(2026, 0, 2, 3, 4, 5),
    randomSuffix: () => String(++numberValue).padStart(4, "0"),
    onEvent,
  });
  return { root, board };
}
const create = (boardValue) => boardValue.create(author, { title: "Title", goal: "Goal", to: ["worker"] });
const rejects = (pathValue, code) => assert.rejects(pathValue, (errorValue) => errorValue.code === code);
test("create, list filters and claim", async () => {
  const { board: boardValue } = await setup();
  const ticketValue = await create(boardValue);
  assert.equal((await boardValue.list({ creator: "author", state: "queued", assignee: "worker" })).length, 1);
  assert.equal((await boardValue.list({ creator: "other" })).length, 0);
  assert.equal((await boardValue.claim(worker, ticketValue.id)).state, "progress");
  assert.equal((await boardValue.get(ticketValue.id)).claimedBy, "worker");
});
test("eight simultaneous claims yield one winner", async () => {
  const { board: boardValue } = await setup();
  const ticketValue = await create(boardValue);
  const resultValue = await Promise.allSettled(
    Array.from({ length: 8 }, () => boardValue.claim(worker, ticketValue.id)),
  );
  assert.equal(resultValue.filter((itemValue) => itemValue.status === "fulfilled").length, 1);
  assert.equal(
    resultValue.filter((itemValue) => itemValue.status === "rejected" && itemValue.reason.code === "CONFLICT")
      .length,
    7,
  );
});
test("stale lock is cleared", async () => {
  const { board: boardValue, root } = await setup();
  const ticketValue = await create(boardValue), pathValue = join(root, ".locks", `${ticketValue.id}.lock`);
  await writeFile(pathValue, "");
  const old = new Date(Date.now() - 31000);
  await utimes(pathValue, old, old);
  assert.equal((await boardValue.claim(worker, ticketValue.id)).state, "progress");
});
test("permissions, report, verification, handoff", async () => {
  const { board: boardValue } = await setup();
  const ticketValue = await create(boardValue);
  await rejects(boardValue.claim(other, ticketValue.id), "FORBIDDEN");
  await boardValue.claim(worker, ticketValue.id);
  await rejects(boardValue.progress(other, ticketValue.id, "x"), "FORBIDDEN");
  await rejects(boardValue.done(worker, ticketValue.id), "INVALID");
  await boardValue.progress(worker, ticketValue.id, "x");
  await boardValue.report(worker, ticketValue.id, { summary: "result" });
  await rejects(boardValue.verify(worker, ticketValue.id, { verdict: "pass", note: "" }), "FORBIDDEN");
  await boardValue.verify(other, ticketValue.id, { verdict: "pass", note: "" });
  const historyEntry = await boardValue.handoff(author, ticketValue.id, "other");
  assert.equal(historyEntry.state, "queued");
  assert.deepEqual(historyEntry.to, ["other"]);
  assert.equal(historyEntry.claimedBy, null);
});
test("attention applies only to three event cases", async () => {
  const events = [];
  const { board: boardValue } = await setup((errorValue) => events.push(errorValue));
  const ticketValue = await create(boardValue);
  await boardValue.claim(worker, ticketValue.id);
  await boardValue.block(worker, ticketValue.id, "wait", { waitHuman: true });
  await boardValue.resume(worker, ticketValue.id);
  await boardValue.block(worker, ticketValue.id, "wait");
  await boardValue.resume(worker, ticketValue.id);
  await boardValue.report(worker, ticketValue.id, { summary: "result" });
  await boardValue.done(worker, ticketValue.id);
  assert.deepEqual(
    events.filter((errorValue) => errorValue.attention).map((
      errorValue,
    ) => [errorValue.type, errorValue.attentionKind]),
    [[
      "blocked",
      "waiting-human",
    ], ["blocked", "blocked"]],
  );
  assert.ok(
    events.filter((errorValue) => !errorValue.attention).every((errorValue) =>
      !("attentionKind" in errorValue)
    ),
  );
});
test("event errors do not affect actions", async () => {
  const { board: boardValue } = await setup(() => {
    throw Error("event");
  });
  const ticketValue = await create(boardValue);
  assert.equal((await boardValue.claim(worker, ticketValue.id)).state, "progress");
});
test("bad files skipped and traversal rejected", async () => {
  const { board: boardValue, root } = await setup();
  const ticketValue = await create(boardValue);
  await mkdir(join(root, "tickets"), { recursive: true });
  await writeFile(join(root, "tickets", "T-20260102-030405-bad1.json"), "{");
  assert.equal((await boardValue.list()).length, 1);
  await rejects(boardValue.get("../x"), "INVALID");
  await rejects(boardValue.claim(worker, "../x"), "INVALID");
  assert.equal((await boardValue.get(ticketValue.id)).id, ticketValue.id);
});
test("delegate is based on attributes", () => {
  assert.equal(canDispatch([{ name: "x", can_delegate: true }], "x"), true);
  assert.equal(canDispatch([{ name: "x", can_dispatch: true }], "x"), true);
  assert.equal(canDispatch([], "x"), false);
});
