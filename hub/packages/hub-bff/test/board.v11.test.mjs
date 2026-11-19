import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canDispatch, canDispatchExternal, createBoard } from "../lib/board.mjs";
const sender = { name: "sender", type: "assistant" },
  worker = { name: "worker", type: "external" },
  other = { name: "other", type: "assistant" },
  human = { name: "human", type: "owner" };
async function setup(options = {}) {
  let numberValue = 0;
  const events = [];
  const root = await mkdtemp(join(tmpdir(), "board-v11-"));
  const board = createBoard({
    root,
    now: () => Date.UTC(2026, 0, 1),
    randomSuffix: () => String(++numberValue).padStart(4, "0"),
    onEvent: (event) => events.push(event),
    ...options,
  });
  return { board, events, root };
}
const input = { title: "title", goal: "goal", to: ["worker"] };
const rejects = (pathValue, code) => assert.rejects(pathValue, { code });
test("idempotency compares normalized content and persists an index", async () => {
  const { board: boardValue, root } = await setup();
  const actorValue = await boardValue.createWithMeta(sender, { ...input, key: "a" });
  const repeated = await boardValue.createWithMeta(sender, { ...input, key: "a", project: "" });
  assert.equal(actorValue.deduped, false);
  assert.equal(repeated.deduped, true);
  assert.deepEqual(actorValue.ticket, repeated.ticket);
  await rejects(boardValue.create(sender, { ...input, key: "a", goal: "different" }), "CONFLICT");
  assert.equal((await boardValue.list()).length, 1);
  assert.equal(
    JSON.parse(await readFile(join(root, "tickets", actorValue.ticket.id + ".json"))).schemaVersion,
    2,
  );
});
test("concurrent identical keys create one ticket", async () => {
  const { board: boardValue } = await setup();
  const resultValue = await Promise.all(
    Array.from({ length: 12 }, () => boardValue.createWithMeta(sender, { ...input, key: "same" })),
  );
  assert.equal(new Set(resultValue.map((itemValue) => itemValue.ticket.id)).size, 1);
  assert.equal(resultValue.filter((itemValue) => !itemValue.deduped).length, 1);
});
test("hop limits on creation and handoff", async () => {
  const { board: boardValue } = await setup({ maxHop: 1 });
  await rejects(boardValue.create(sender, { ...input, hop: 2 }), "INVALID");
  const ticketValue = await boardValue.create(sender, { ...input, hop: 1 });
  await rejects(boardValue.handoff(sender, ticketValue.id, "other"), "CONFLICT");
});
test("report size and hash validation", async () => {
  const { board: boardValue } = await setup();
  const ticketValue = await boardValue.create(sender, input);
  await boardValue.claim(worker, ticketValue.id);
  await rejects(boardValue.report(worker, ticketValue.id, { summary: "猫".repeat(683) }), "INVALID");
  for (const sha256 of ["a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
    await rejects(boardValue.report(worker, ticketValue.id, { summary: "ok", sha256 }), "INVALID");
  }
  const resultValue = await boardValue.report(worker, ticketValue.id, {
    summary: "猫".repeat(682),
    sha256: "a".repeat(64),
  });
  assert.equal(resultValue.report.sha256, "a".repeat(64));
});
test("review, send back, inbox and events", async () => {
  // 这条测的是助理直接验收的旧路径，所以显式用 external_accept=assistant（默认 owner 的新行为见 r37 测试）。
  const { board: boardValue, events } = await setup({ ownerAcceptExternal: false });
  const ticketValue = await boardValue.create(sender, input);
  await boardValue.claim(worker, ticketValue.id);
  await boardValue.report(worker, ticketValue.id, { summary: "first" });
  assert.equal((await boardValue.list({ inboxFor: "sender" })).length, 1);
  await boardValue.done(worker, ticketValue.id);
  await rejects(boardValue.accept(other, ticketValue.id), "FORBIDDEN");
  let resultValue = await boardValue.sendBack(sender, ticketValue.id, "revise");
  assert.equal(resultValue.review, "sent_back");
  assert.equal(resultValue.progress.at(-1).text, "revise");
  assert.equal(resultValue.history.at(-1).detail, "revise");
  await boardValue.report(worker, ticketValue.id, { summary: "second" });
  await boardValue.done(worker, ticketValue.id);
  resultValue = await boardValue.accept(sender, ticketValue.id);
  assert.equal(resultValue.state, "completed");
  assert.equal(resultValue.review, "accepted");
  assert.equal((await boardValue.list({ inboxFor: "sender" })).length, 0);
  assert.ok(
    events.filter((event) => ["reported", "submitted"].includes(event.type)).every((event) =>
      event.inboxFor === "sender" && !event.attention
    ),
  );
  assert.deepEqual(
    events.filter((event) => event.type === "accepted").map((event) => [event.notify, event.attention]),
    [[true, false]],
  );
});
test("attention, answer, timeout and uncertain", async () => {
  const { board: boardValue, events } = await setup();
  const ticketValue = await boardValue.create(sender, input);
  await boardValue.claim(worker, ticketValue.id);
  await boardValue.block(worker, ticketValue.id, "question", { waitHuman: true });
  assert.equal((await boardValue.list({ attention: true })).length, 1);
  await rejects(boardValue.answer(other, ticketValue.id, "answer"), "FORBIDDEN");
  let resultValue = await boardValue.answer(human, ticketValue.id, "answer");
  assert.equal(resultValue.open_ask, null);
  assert.equal(resultValue.history.at(-1).detail, "answer");
  await boardValue.markTimeout(sender, ticketValue.id);
  assert.equal((await boardValue.list({ attention: true })).length, 0);
  await boardValue.resume(worker, ticketValue.id);
  await boardValue.markUncertain(worker, ticketValue.id, "uncertain");
  await boardValue.resume(worker, ticketValue.id);
  await boardValue.block(worker, ticketValue.id, "blocked");
  await boardValue.resume(worker, ticketValue.id);
  await boardValue.fail(sender, ticketValue.id, "failed");
  assert.deepEqual(
    events.filter((event) => event.attention).map((event) => event.attentionKind),
    [
      "waiting-human",
      "blocked",
      "failed",
    ],
  );
  assert.ok(
    events.filter((errorValue) => ["timeout", "uncertain"].includes(errorValue.type)).every((errorValue) =>
      !errorValue.attention && !errorValue.notify
    ),
  );
  assert.equal((await boardValue.list({ state: "failed", attention: true })).length, 1);
});
test("dispatch permissions use name and defaults", () => {
  const roster = [{ name: "a" }, { name: "b", paused: true }, { name: "c", can_dispatch: false }, {
    name: "d",
    can_delegate: false,
  }, { name: "e", can_dispatch_external: true }];
  assert.equal(canDispatch(roster, "a"), true);
  for (const numberValue of ["b", "c", "d", "missing"]) assert.equal(canDispatch(roster, numberValue), false);
  assert.equal(canDispatchExternal(roster, "a"), false);
  assert.equal(canDispatchExternal(roster, "e"), true);
  assert.equal(canDispatchExternal(roster, "missing"), false);
});
