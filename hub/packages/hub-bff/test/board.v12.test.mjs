import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBoard } from "../lib/board.mjs";
import { buildTicket, validateTicket } from "../lib/ticket.mjs";

const author = { name: "author", type: "assistant" };
const worker = { name: "worker", type: "external" };
const input = { title: "Title", goal: "Goal", key: "key", to: ["worker"] };
const timestamp = Date.UTC(2026, 0, 2, 3, 4, 5);
async function setup(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "board-v12-"));
  let sequence = 0;
  const make = (extra = {}) =>
    createBoard({
      root,
      now: () => timestamp,
      randomSuffix: () => String(++sequence).padStart(4, "0"),
      ...options,
      ...extra,
    });
  return { root, make };
}

test("repairs a missing index and picks the earliest ticket", async () => {
  const { root, make } = await setup();
  await mkdir(join(root, "tickets"), { recursive: true });
  const earlier = buildTicket({ ...input, id: "T-20260102-030405-0001" }, author, timestamp);
  const later = buildTicket({ ...input, id: "T-20260102-030405-0002" }, author, timestamp + 1000);
  for (const ticket of [later, earlier]) {
    await writeFile(join(root, "tickets", `${ticket.id}.json`), JSON.stringify(ticket));
  }
  const board = make();
  const result = await board.createWithMeta(author, input);
  assert.equal(result.deduped, true);
  assert.equal(result.ticket.id, earlier.id);
  await assert.rejects(board.create(author, { ...input, goal: "different" }), { code: "CONFLICT" });
});

test("recovers from a crash between ticket and index writes", async () => {
  const { root, make } = await setup();
  const board = make({
    __beforeIndexWrite: () => {
      throw new Error("crash");
    },
  });
  await assert.rejects(board.create(author, input), /crash/);
  const files = await readdir(join(root, "tickets"));
  const recovered = await make().createWithMeta(author, input);
  assert.equal(recovered.deduped, true);
  assert.equal(`${recovered.ticket.id}.json`, files[0]);
  assert.equal((await readdir(join(root, "tickets"))).length, 1);
});

test("active limit covers handoffs and concurrent claims, and accept frees capacity", async () => {
  const { make } = await setup({ maxActivePerWorker: 2, ownerAcceptExternal: false }); // 测的是额度，验收走旧路径
  const board = make();
  const tickets = await Promise.all(
    Array.from({ length: 4 }, () => board.create(author, { ...input, key: null })),
  );
  await board.claim(worker, tickets[0].id);
  await board.handoff(author, tickets[1].id, worker.name);
  const claims = await Promise.allSettled(tickets.slice(1).map((ticket) => board.claim(worker, ticket.id)));
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(
    claims.filter((result) => result.status === "rejected").every((result) =>
      result.reason.code === "CONFLICT" && result.reason.message.includes("active limit")
    ),
  );
  await board.report(worker, tickets[0].id, { summary: "done" });
  await board.accept(author, tickets[0].id);
  const queued = (await board.list({ state: "queued" }))[0];
  assert.equal((await board.claim(worker, queued.id)).state, "progress");
});

test("default has no active limit", async () => {
  const { make } = await setup();
  const board = make();
  for (let index = 0; index < 3; index++) {
    const ticket = await board.create(author, { ...input, key: null });
    await board.claim(worker, ticket.id);
  }
  assert.equal((await board.list({ state: "progress" })).length, 3);
});

function legacy(id, status) {
  return `---\nid: ${id}\nkind: delegation\ncreator: author\nassignee: worker\nstatus: ${status}\n` +
    "createdAt: 2026-01-02T03:04:05.000Z\nupdatedAt: 2026-01-02T03:04:06.000Z\n" +
    "fromSession: abc\ntoSession: def\nsteps: 1\n---\n## 任务\nA task\n## 进度\n" +
    "- 2026-01-02T03:04:05.000Z started\n## 回报\nA result\n";
}

test("reads and filters legacy tickets without changing them; new tickets take precedence", async () => {
  const { root, make } = await setup();
  const legacyDir = join(root, "old");
  const records = [["new", "queued"], ["working", "running"], ["done", "done"]];
  const originals = [];
  for (const [index, [folder, status]] of records.entries()) {
    await mkdir(join(legacyDir, folder), { recursive: true });
    const id = `T-20260102-030405-000${index + 1}`;
    const path = join(legacyDir, folder, `${id}.md`);
    await writeFile(path, legacy(id, status));
    originals.push({ id, path, text: await readFile(path, "utf8"), mtime: (await stat(path)).mtimeMs });
  }
  await writeFile(join(legacyDir, "new", "T-20260102-030405-bad1.md"), "bad");
  await writeFile(join(legacyDir, "new", "T-20260102-030405-big1.md"), "x".repeat(512001));
  const board = make({ legacyDir });
  assert.deepEqual((await board.list()).map((ticket) => ticket.state), ["queued", "progress", "completed"]);
  assert.equal((await board.list({ assignee: "worker", creator: "author", state: "progress" })).length, 1);
  const ticket = await board.get(originals[0].id);
  assert.equal(ticket.legacy, true);
  assert.equal(validateTicket(ticket).ok, true);
  for (
    const action of [
      () => board.claim(worker, ticket.id),
      () => board.progress(worker, ticket.id, "x"),
      () => board.report(worker, ticket.id, { summary: "x" }),
      () => board.done(worker, ticket.id),
      () => board.accept(author, ticket.id),
      () => board.sendBack(author, ticket.id, "x"),
      () => board.block(author, ticket.id, "x"),
      () => board.answer(author, ticket.id, "x"),
      () => board.fail(author, ticket.id, "x"),
      () => board.markTimeout(author, ticket.id),
      () => board.markUncertain(author, ticket.id, "x"),
      () => board.verify(author, ticket.id, { verdict: "pass", note: "" }),
      () => board.handoff(author, ticket.id, "worker"),
      () => board.resume(worker, ticket.id),
    ]
  ) {
    await assert.rejects(action(), (error) => error.code === "CONFLICT" && error.message.includes("legacy"));
  }
  for (const record of originals) {
    assert.equal(await readFile(record.path, "utf8"), record.text);
    assert.equal((await stat(record.path)).mtimeMs, record.mtime);
  }
  await mkdir(join(root, "tickets"), { recursive: true });
  const native = buildTicket({ ...input, id: originals[0].id }, author, timestamp);
  await writeFile(join(root, "tickets", `${native.id}.json`), JSON.stringify(native));
  assert.equal((await board.get(native.id)).legacy, undefined);
  assert.equal((await board.list()).length, 3);
  assert.equal((await board.list({ state: "progress" })).length, 1);
  const limitedBoard = make({ legacyDir, maxActivePerWorker: 1, randomSuffix: () => "abcd" });
  const newTicket = await limitedBoard.create(author, { ...input, key: null });
  await assert.rejects(
    limitedBoard.claim(worker, newTicket.id),
    (error) => error.code === "CONFLICT" && error.message.includes("active limit"),
  );
  await assert.rejects(
    limitedBoard.claim(worker, originals[2].id),
    (error) => error.code === "CONFLICT" && error.message.includes("legacy"),
  );
});
