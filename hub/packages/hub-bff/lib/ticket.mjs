import { randomBytes } from "node:crypto";
import { BoardError } from "./board-errors.mjs";
import { begin, newRelay, parseRoute, RELAY_INIT, validRelay } from "./relay-model.mjs";
import { ARRANGE_INIT, SCHEDULE_INIT, validArrange, validSchedule } from "./arrange-model.mjs";
// 开放认领（「谁有空谁接」）。只认后端内部口令（Symbol），外面传来的 JSON 里的 openClaim 一律不理。
export const OPEN_INIT = Symbol("open-claim-init");
export const OPEN_STATES = Object.freeze(["open", "taken", "asked"]);
export const TICKET_STATES = Object.freeze([
  "queued",
  "progress",
  "completed",
  "blocked",
  "waiting-human",
  "failed",
  "waiting-timeout",
  "uncertain",
]);
const REVIEWS = ["none", "submitted", "accepted", "sent_back"];
const KEY = /^[A-Za-z0-9_.:-]{1,128}$/u;
export const ACTOR_TYPES = Object.freeze(["assistant", "owner", "external"]);
export const ID_PATTERN = /^T-\d{8}-\d{6}-[a-zA-Z0-9]{4}$/u;
const NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
const iso = (inputValue) =>
  typeof inputValue === "string" && Number.isFinite(Date.parse(inputValue)) &&
  new Date(inputValue).toISOString() === inputValue;
const obj = (inputValue) =>
  inputValue !== null && typeof inputValue === "object" && !Array.isArray(inputValue);
const strings = (inputValue) =>
  Array.isArray(inputValue) && inputValue.every((itemValue) => typeof itemValue === "string");
// 开放认领的小结构：state 是 open（等人接）、taken（已被接走）、asked（首席拿不准，问主人中）。
export function validOpenClaim(value) {
  const text = (v, max) => v === undefined || typeof v === "string" && Array.from(v).length <= max;
  return obj(value) && OPEN_STATES.includes(value.state) && iso(value.openedAt) &&
    (value.reopenedAt === undefined || iso(value.reopenedAt)) && (value.at === undefined || iso(value.at)) &&
    (value.takenBy === undefined || typeof value.takenBy === "string" && NAME.test(value.takenBy)) &&
    (value.takenType === undefined || ACTOR_TYPES.includes(value.takenType)) &&
    (value.via === undefined || ["chief", "external", "owner"].includes(value.via)) &&
    text(value.takenShown, 64) && text(value.reason, 400) && text(value.answer, 2000);
}

// 校验操作人的身份信息。
export function assertActor(actor) {
  if (!obj(actor) || !NAME.test(actor.name ?? "") || !ACTOR_TYPES.includes(actor.type)) {
    throw new BoardError("INVALID", "Invalid actor");
  }
}

// 按时间与随机后缀生成工单编号。
export function newTicketId(nowMs = Date.now(), rand) {
  const dateValue = new Date(nowMs);
  if (!Number.isFinite(dateValue.getTime())) throw new BoardError("INVALID", "Invalid time");
  const suffix = rand === undefined
    ? [...randomBytes(4)].map((itemValue) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[itemValue % 62]
    ).join("")
    : typeof rand === "function"
    ? rand()
    : rand;
  if (typeof suffix !== "string" || !/^[a-zA-Z0-9]{4}$/u.test(suffix)) {
    throw new BoardError("INVALID", "Invalid random suffix");
  }
  const stamp = dateValue.toISOString().replace(/[-:]/gu, "");
  return `T-${stamp.slice(0, 8)}-${stamp.slice(9, 15)}-${suffix}`;
}

// 校验工单结构和字段。
export function validateTicket(ticketValue) {
  const errors = [];
  const check = (condition, field) => {
    if (!condition) errors.push(field);
  };
  if (!obj(ticketValue)) return { ok: false, errors: ["ticket"] };
  check(ticketValue.schemaVersion === 2, "schemaVersion");
  check(typeof ticketValue.id === "string" && ID_PATTERN.test(ticketValue.id), "id");
  for (const fieldName of ["title", "goal"]) {
    check(typeof ticketValue[fieldName] === "string" && ticketValue[fieldName].trim().length > 0, fieldName);
  }
  check(
    obj(ticketValue.from) && NAME.test(ticketValue.from.name ?? "") &&
      ACTOR_TYPES.includes(ticketValue.from.type),
    "from",
  );
  check(strings(ticketValue.to) && ticketValue.to.every((itemValue) => NAME.test(itemValue)), "to");
  check(
    ticketValue.claimedBy === null ||
      typeof ticketValue.claimedBy === "string" && NAME.test(ticketValue.claimedBy),
    "claimedBy",
  );
  check(TICKET_STATES.includes(ticketValue.state), "state");
  check(REVIEWS.includes(ticketValue.review), "review");
  check(ticketValue.key === null || typeof ticketValue.key === "string" && KEY.test(ticketValue.key), "key");
  check(typeof ticketValue.root === "string" && ticketValue.root.length > 0, "root");
  check(Number.isSafeInteger(ticketValue.hop) && ticketValue.hop >= 0, "hop");
  check(typeof ticketValue.expects_reply === "boolean", "expects_reply");
  check(typeof ticketValue.project === "string", "project");
  check(
    obj(ticketValue.sessions) && typeof ticketValue.sessions.from === "string" &&
      typeof ticketValue.sessions.to === "string",
    "sessions",
  );
  check(
    obj(ticketValue.workdir) &&
      (ticketValue.workdir.path === null || typeof ticketValue.workdir.path === "string") &&
      strings(ticketValue.workdir.writable),
    "workdir",
  );
  check(strings(ticketValue.forbidden), "forbidden");
  check(
    Array.isArray(ticketValue.acceptance) &&
      ticketValue.acceptance.every((itemValue) =>
        obj(itemValue) && typeof itemValue.check === "string" && typeof itemValue.expect === "string"
      ),
    "acceptance",
  );
  check(
    Array.isArray(ticketValue.progress) &&
      ticketValue.progress.every((itemValue) =>
        obj(itemValue) && iso(itemValue.ts) && NAME.test(itemValue.by ?? "") &&
        typeof itemValue.text === "string"
      ),
    "progress",
  );
  const reportOK = (itemValue) =>
    obj(itemValue) && iso(itemValue.ts) && NAME.test(itemValue.by ?? "") &&
    typeof itemValue.summary === "string" && !!itemValue.summary.trim() &&
    Buffer.byteLength(itemValue.summary, "utf8") <= 2048 &&
    (itemValue.file === null || typeof itemValue.file === "string") &&
    (itemValue.sha256 === null ||
      typeof itemValue.sha256 === "string" && /^[a-f0-9]{64}$/u.test(itemValue.sha256)) &&
    itemValue.selfReported === true;
  check(
    Array.isArray(ticketValue.reports) &&
      ticketValue.reports.every((itemValue) => reportOK(itemValue) && strings(itemValue.artifacts)),
    "reports",
  );
  check(
    ticketValue.report === null && Array.isArray(ticketValue.reports) && !ticketValue.reports.length ||
      reportOK(ticketValue.report) && Array.isArray(ticketValue.reports) && ticketValue.reports.length > 0 &&
        ["ts", "by", "summary", "file", "sha256", "selfReported"].every((fieldName) =>
          ticketValue.report[fieldName] === ticketValue.reports.at(-1)[fieldName]
        ),
    "report",
  );
  check(
    Array.isArray(ticketValue.verification) &&
      ticketValue.verification.every((itemValue) =>
        obj(itemValue) && iso(itemValue.ts) && NAME.test(itemValue.by ?? "") &&
        ["pass", "fail", "partial"].includes(itemValue.verdict) &&
        typeof itemValue.note === "string"
      ),
    "verification",
  );
  check(strings(ticketValue.costRefs), "costRefs");
  check(typeof ticketValue.readExternalContent === "boolean", "readExternalContent");
  check(
    ticketValue.open_ask === null ||
      obj(ticketValue.open_ask) && typeof ticketValue.open_ask.text === "string" &&
        iso(ticketValue.open_ask.ts),
    "open_ask",
  );
  check(
    !["status", "creator", "assignees", "needsHuman"].some((fieldName) =>
      Object.hasOwn(ticketValue, fieldName)
    ),
    "legacy fields",
  );
  check(
    obj(ticketValue.routing) &&
      ["requestedBy", "via", "hint"].every((fieldName) => typeof ticketValue.routing[fieldName] === "string"),
    "routing",
  );
  check(ticketValue.parentId === null || typeof ticketValue.parentId === "string", "parentId");
  check(
    Array.isArray(ticketValue.history) &&
      ticketValue.history.every((itemValue) =>
        obj(itemValue) && iso(itemValue.ts) && NAME.test(itemValue.by ?? "") &&
        typeof itemValue.action === "string" &&
        (itemValue.detail === undefined || typeof itemValue.detail === "string")
      ),
    "history",
  );
  // 接力路线（可选）：没有就是普通卡。
  check(ticketValue.relay === undefined || validRelay(ticketValue.relay), "relay");
  check(ticketValue.openClaim === undefined || validOpenClaim(ticketValue.openClaim), "openClaim");
  // 首席安排与卡片定时（可选，没有就是旧卡）。
  check(ticketValue.arrange === undefined || validArrange(ticketValue.arrange), "arrange");
  check(ticketValue.schedule === undefined || validSchedule(ticketValue.schedule), "schedule");
  check(iso(ticketValue.createdAt), "createdAt");
  check(iso(ticketValue.updatedAt), "updatedAt");
  return errors.length ? { ok: false, errors } : { ok: true };
}

// 根据输入创建新工单。
export function buildTicket(input, actor, nowMs = Date.now()) {
  assertActor(actor);
  if (!obj(input)) throw new BoardError("INVALID", "Invalid input");
  let ts;
  try {
    ts = new Date(nowMs).toISOString();
  } catch {
    throw new BoardError("INVALID", "Invalid time");
  }
  const id = input.id ?? newTicketId(nowMs);
  const ticketValue = {
    schemaVersion: 2,
    id,
    title: input.title,
    goal: input.goal,
    key: input.key ?? null,
    from: { ...actor },
    to: input.to ?? [],
    claimedBy: null,
    state: "queued",
    review: "none",
    root: input.root ?? id,
    hop: input.hop ?? 0,
    expects_reply: input.expects_reply ?? false,
    open_ask: null,
    report: null,
    reports: [],
    project: input.project ?? "",
    sessions: input.sessions ?? { from: "", to: "" },
    workdir: input.workdir ?? { path: null, writable: [] },
    forbidden: input.forbidden ?? [],
    acceptance: input.acceptance ?? [],
    progress: [],
    verification: [],
    costRefs: input.costRefs ?? [],
    readExternalContent: input.readExternalContent ?? false,
    routing: input.routing ?? { requestedBy: "", via: "", hint: "" },
    parentId: input.parentId ?? null,
    history: [],
    createdAt: ts,
    updatedAt: ts,
  };
  // 接力只认后端内部口令（Symbol），外面传来的 JSON 里的 relay 字段一律不理。
  if (input[RELAY_INIT]) {
    ticketValue.relay = newRelay(parseRoute(input[RELAY_INIT]));
    begin(ticketValue, ts);
  }
  if (input[OPEN_INIT]) ticketValue.openClaim = { state: "open", openedAt: ts };
  // 新建时就带「交给首席安排」或「定时」，同样只认内部口令。
  if (input[ARRANGE_INIT]) ticketValue.arrange = { state: "wanted", via: input[ARRANGE_INIT].via ?? "new", requestedAt: ts, attempts: 0 };
  if (input[SCHEDULE_INIT]) ticketValue.schedule = { ...input[SCHEDULE_INIT], state: "waiting", createdAt: ts };
  const result = validateTicket(ticketValue);
  if (!result.ok) throw new BoardError("INVALID", `Invalid ticket: ${result.errors.join(", ")}`);
  return ticketValue;
}

// 将旧版 Markdown 工单转换为当前结构。
export function convertLegacyTicket(text, filename) {
  if (typeof text !== "string" || typeof filename !== "string") return null;
  const legacyPattern = new RegExp(
    [
      "^---\\r?\\n([\\s\\S]*?)\\r?\\n---",
      "\\r?\\n## 任务\\r?\\n([\\s\\S]*?)",
      "\\r?\\n## 进度\\r?\\n([\\s\\S]*?)",
      "\\r?\\n## 回报\\r?\\n([\\s\\S]*)$",
    ].join(""),
    "u",
  );
  const matchValue = legacyPattern.exec(text);
  if (!matchValue) return null;
  const meta = {};
  const fields = [
    "id",
    "kind",
    "creator",
    "assignee",
    "status",
    "createdAt",
    "updatedAt",
    "fromSession",
    "toSession",
    "steps",
  ];
  for (const line of matchValue[1].split(/\r?\n/u)) {
    const itemValue = /^([A-Za-z]+): ?([^\r\n]*)$/u.exec(line);
    if (!itemValue || !fields.includes(itemValue[1]) || Object.hasOwn(meta, itemValue[1])) return null;
    meta[itemValue[1]] = itemValue[2].trim();
  }
  if (
    !fields.every((fieldName) => Object.hasOwn(meta, fieldName)) || !ID_PATTERN.test(meta.id) ||
    filename !== `${meta.id}.md` ||
    meta.kind !== "delegation" || !NAME.test(meta.creator) || !NAME.test(meta.assignee) ||
    !["queued", "running", "done", "failed", "blocked"].includes(meta.status) || !meta.fromSession ||
    !/^[A-Za-z0-9_.:-]{1,200}$/u.test(meta.fromSession) ||
    meta.toSession && !/^[A-Za-z0-9_.:-]{1,200}$/u.test(meta.toSession) || !/^\d+$/u.test(meta.steps) ||
    !Number.isFinite(Date.parse(meta.createdAt)) || !Number.isFinite(Date.parse(meta.updatedAt)) ||
    !matchValue[2].trim()
  ) return null;
  try {
    const created = new Date(meta.createdAt).toISOString(), updated = new Date(meta.updatedAt).toISOString();
    const ticketValue = buildTicket(
      {
        id: meta.id,
        title: matchValue[2].trim().split(/\r?\n/u)[0],
        goal: matchValue[2].trim(),
        to: [meta.assignee],
        sessions: { from: meta.fromSession, to: meta.toSession },
      },
      { name: meta.creator, type: "assistant" },
      Date.parse(created),
    );
    ticketValue.state = ({ queued: "queued", running: "progress", done: "completed" })[meta.status] ??
      meta.status;
    ticketValue.claimedBy = ticketValue.state === "queued" ? null : meta.assignee;
    ticketValue.review = ticketValue.state === "completed" ? "accepted" : "none";
    ticketValue.updatedAt = updated;
    for (const line of matchValue[3].trim().split(/\r?\n/u).filter(Boolean)) {
      const pathValue = /^-\s+(\S+)\s+(.+)$/u.exec(line);
      if (!pathValue || !Number.isFinite(Date.parse(pathValue[1]))) return null;
      ticketValue.progress.push({
        ts: new Date(pathValue[1]).toISOString(),
        by: meta.assignee,
        text: pathValue[2],
      });
    }
    if (matchValue[4].trim()) {
      const summary = matchValue[4].trim();
      ticketValue.report = {
        ts: updated,
        by: meta.assignee,
        summary,
        file: null,
        sha256: null,
        selfReported: true,
      };
      ticketValue.reports.push({ ...ticketValue.report, artifacts: [] });
    }
    return validateTicket(ticketValue).ok ? ticketValue : null;
  } catch {
    return null;
  }
}
