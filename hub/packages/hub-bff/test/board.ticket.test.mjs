import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTicket, convertLegacyTicket, newTicketId, validateTicket } from "../lib/ticket.mjs";
const actor = { name: "author", type: "assistant" }, time = Date.UTC(2026, 0, 2, 3, 4, 5);
const make = () => buildTicket({ id: "T-20260102-030405-aB12", title: "Title", goal: "Goal" }, actor, time);
for (
  const [label, change] of [["defaults", () => {}], ["to", (ticketValue) => {
    ticketValue.to = ["worker"];
  }], ["project", (ticketValue) => {
    ticketValue.project = "x";
  }], ["parent", (ticketValue) => {
    ticketValue.parentId = "parent";
  }], ["acceptance", (ticketValue) => {
    ticketValue.acceptance = [{ check: "x", expect: "y" }];
  }], ["routing", (ticketValue) => {
    ticketValue.routing.hint = "x";
  }]]
) {
  test(`valid ${label}`, () => {
    const ticketValue = make();
    change(ticketValue);
    assert.deepEqual(validateTicket(ticketValue), { ok: true });
  });
}
for (
  const [label, change] of [["id", (ticketValue) => {
    ticketValue.id = "../x";
  }], ["state", (ticketValue) => {
    ticketValue.state = "unknown";
  }], ["creator", (ticketValue) => {
    ticketValue.from.type = "other";
  }], ["goal", (ticketValue) => {
    ticketValue.goal = "";
  }], ["progress", (ticketValue) => {
    ticketValue.progress = [{}];
  }], ["reports", (ticketValue) => {
    ticketValue.reports = [{ selfReported: false }];
  }], ["routing", (ticketValue) => {
    ticketValue.routing = null;
  }], ["time", (ticketValue) => {
    ticketValue.updatedAt = "bad";
  }]]
) {
  test(`invalid ${label}`, () => {
    const ticketValue = make();
    change(ticketValue);
    assert.equal(validateTicket(ticketValue).ok, false);
  });
}
function legacy(status) {
  return `---\nid: T-20260102-030405-aB12\nkind: delegation\ncreator: author\nassignee: worker\n` +
    `status: ${status}\ncreatedAt: 2026-01-02T03:04:05.000Z\nupdatedAt: 2026-01-02T03:04:06.000Z\n` +
    `fromSession: abc\ntoSession: def\nsteps: 1\n---\n## 任务\nA task\n## 进度\n` +
    `- 2026-01-02T03:04:05.000Z started\n## 回报\nA result\n`;
}
for (
  const [old, current] of [["queued", "queued"], ["running", "progress"], ["done", "completed"], [
    "failed",
    "failed",
  ], [
    "blocked",
    "blocked",
  ]]
) {
  test(`legacy ${old}`, () => {
    const ticketValue = convertLegacyTicket(legacy(old), "T-20260102-030405-aB12.md");
    assert.equal(ticketValue.state, current);
    assert.equal(ticketValue.progress[0].text, "started");
    assert.equal(ticketValue.reports[0].selfReported, true);
  });
}
test("bad legacy returns null", () => assert.equal(convertLegacyTicket("bad", "bad.md"), null));
test("new id format", () => assert.match(newTicketId(time), /^T-20260102-030405-[a-zA-Z0-9]{4}$/u));
