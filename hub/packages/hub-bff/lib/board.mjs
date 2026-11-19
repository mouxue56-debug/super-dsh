import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { BoardError } from "./board-errors.mjs";
import { withFileLock } from "./board-lock.mjs";
import { createRelayOps } from "./board-relay.mjs";
import { createClaimOps } from "./board-claim.mjs";
import { createArrangeOps, canArrange } from "./board-arrange.mjs";
import { release as releaseRelayGate } from "./relay-model.mjs";
import {
  assertActor,
  buildTicket,
  convertLegacyTicket,
  ID_PATTERN,
  newTicketId,
  TICKET_STATES,
  validateTicket,
} from "./ticket.mjs";
const error = (code, message) => {
  throw new BoardError(code, message);
};
const nameOK = (numberValue) =>
  typeof numberValue === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(numberValue);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (inputValue) =>
  Array.isArray(inputValue)
    ? inputValue.map(canonical)
    : inputValue && typeof inputValue === "object"
    ? Object.fromEntries(
      Object.keys(inputValue).sort().map((fieldName) => [fieldName, canonical(inputValue[fieldName])]),
    )
    : inputValue;
// 判断名册成员是否可以派单。
export function canDispatch(roster, name) {
  const errorValue = Array.isArray(roster) &&
    roster.find((itemValue) => itemValue && itemValue.name === name);
  return !!errorValue && errorValue.paused !== true && errorValue.can_dispatch !== false &&
    errorValue.can_delegate !== false;
}

// 判断名册成员是否可以派单。
// 判断名册成员是否可以派给外部工作者。
export function canDispatchExternal(roster, name) {
  const errorValue = Array.isArray(roster) &&
    roster.find((itemValue) => itemValue && itemValue.name === name);
  return !!errorValue && errorValue.can_dispatch_external === true;
}

// 创建支持持久化与状态流转的工单板。
export function createBoard(
  {
    root,
    now = () => Date.now(),
    onEvent = () => {},
    randomSuffix,
    maxHop = 4,
    maxActivePerWorker = 0,
    legacyDir,
    reservedNames = [],
    // 外部身份交回的卡，内部助理只能写验收意见，由主人点完成（false=旧行为，助理可直接验收）。
    ownerAcceptExternal = true,
    // 没负责人的卡被拖到「在做」时请首席安排（false=旧行为，主人自己当负责人）；本地时区偏移（分钟，给夜间判断用）。
    arrangeOnDrag = true,
    utcOffsetMinutes = () => -new Date().getTimezoneOffset(),
    __beforeIndexWrite,
  } = {},
) {
  if (
    typeof root !== "string" || !root || !Number.isSafeInteger(maxHop) || maxHop < 0 ||
    !Number.isSafeInteger(maxActivePerWorker) || maxActivePerWorker < 0 ||
    (legacyDir !== undefined && typeof legacyDir !== "string") ||
    typeof reservedNames !== "function" &&
      (!Array.isArray(reservedNames) || !reservedNames.every((item) => typeof item === "string")) ||
    (__beforeIndexWrite !== undefined && typeof __beforeIndexWrite !== "function")
  ) error("INVALID", "Invalid board configuration");
  const ensure = async () =>
    Promise.all(
      ["tickets", ".locks", ".keys"].map((dateValue) => mkdir(join(root, dateValue), { recursive: true })),
    );
  const fixedReserved = typeof reservedNames === "function" ? null : new Set(reservedNames);
  // 保留名可以是函数（接线处按名册现读）；读不出来时按「全部外部身份都不可信」拒绝。
  const isReserved = (name) => {
    if (fixedReserved) return fixedReserved.has(name);
    let names;
    try {
      names = reservedNames();
    } catch {
      return true;
    }
    return !Array.isArray(names) || names.includes(name);
  };
  // 外部身份不得使用名册保留名（冒充同名助理）。
  const guardActor = (actorValue) => {
    assertActor(actorValue);
    if (actorValue.type === "external" && isReserved(actorValue.name)) {
      error("FORBIDDEN", "Reserved actor name");
    }
  };
  const checkId = (id) => {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) error("INVALID", "Invalid ticket id");
  };
  const readNative = async (id) => {
    checkId(id);
    try {
      const ticketValue = JSON.parse(await readFile(join(root, "tickets", `${id}.json`), "utf8"));
      if (ticketValue.id === id && validateTicket(ticketValue).ok) return ticketValue;
    } catch (errorValue) {
      if (errorValue.code !== "ENOENT" && !(errorValue instanceof SyntaxError)) throw errorValue;
    }
    error("NOT_FOUND", "Ticket not found");
  };
  const legacyTickets = async () => {
    if (!legacyDir) return [];
    const result = [];
    for (const folder of ["new", "working", "done", "blocked", "failed"]) {
      let files;
      try {
        files = await readdir(join(legacyDir, folder));
      } catch (err) {
        if (err.code === "ENOENT") continue;
        throw err;
      }
      for (const filename of files) {
        if (!filename.endsWith(".md") || !ID_PATTERN.test(filename.slice(0, -3))) continue;
        let handle;
        try {
          handle = await open(join(legacyDir, folder, filename), "r");
          const info = await handle.stat();
          if (!info.isFile() || info.size > 512000) continue;
          const ticket = convertLegacyTicket(await handle.readFile("utf8"), filename);
          if (ticket) result.push({ ...ticket, legacy: true });
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        } finally {
          await handle?.close();
        }
      }
    }
    return result;
  };
  const read = async (id) => {
    try {
      return await readNative(id);
    } catch (err) {
      if (err.code !== "NOT_FOUND") throw err;
    }
    const ticket = (await legacyTickets()).find((item) => item.id === id);
    if (ticket) return ticket;
    error("NOT_FOUND", "Ticket not found");
  };
  const locked = async (key, fn) => {
    await ensure();
    try {
      return await withFileLock(join(root, ".locks", `${key}.lock`), fn);
    } catch (errorValue) {
      if (errorValue.code === "LOCK_TIMEOUT") error("CONFLICT", "Ticket is locked");
      throw errorValue;
    }
  };
  const save = async (ticketValue) => {
    const target = join(root, "tickets", `${ticketValue.id}.json`),
      tmp = join(root, "tickets", `.${ticketValue.id}.${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(tmp, JSON.stringify(ticketValue, null, 2) + "\n", { flag: "wx" });
    await rename(tmp, target);
  };
  const event = async (type, ticketValue, actorValue, ts, extra = {}) => {
    try {
      await onEvent({ type, id: ticketValue.id, by: actorValue.name, ts, attention: false, ...extra });
    } catch {}
  };
  const mutate = async (actorValue, id, type, fn) => {
    guardActor(actorValue);
    checkId(id);
    return locked(id, async () => {
      const ticketValue = await read(id);
      if (ticketValue.legacy) error("CONFLICT", "Cannot modify legacy ticket");
      const seenUpdatedAt = ticketValue.updatedAt, seenHistory = ticketValue.history.length;
      const ts = new Date(now()).toISOString();
      const result = fn(ticketValue, ts) ?? {};
      ticketValue.updatedAt = ts;
      const historyEntry = { ts, by: actorValue.name, action: type };
      if (result.detail !== undefined) historyEntry.detail = result.detail;
      ticketValue.history.push(historyEntry);
      const valid = validateTicket(ticketValue);
      if (!valid.ok) error("INVALID", `Invalid ticket: ${valid.errors.join(", ")}`);
      // 写盘前核对版本：锁被误夺时，后到者不得覆盖先到者。
      const current = await readNative(id).catch((errorValue) => {
        if (errorValue.code !== "NOT_FOUND") throw errorValue;
      });
      if (current && (current.updatedAt !== seenUpdatedAt || current.history.length !== seenHistory)) {
        error("CONFLICT", "Ticket changed concurrently");
      }
      await save(ticketValue);
      const { detail, ...extra } = result;
      await event(type, ticketValue, actorValue, ts, extra);
      return ticketValue;
    });
  };
  const isSender = (ticketValue, actorValue) =>
    ticketValue.from.name === actorValue.name && ticketValue.from.type === actorValue.type;
  const isWorker = (ticketValue, actorValue) =>
    ticketValue.claimedBy === actorValue.name &&
    (ticketValue.claimedByType == null || ticketValue.claimedByType === actorValue.type);
  const owner = (ticketValue, actorValue) => {
    if (!isWorker(ticketValue, actorValue) && !isSender(ticketValue, actorValue)) {
      error("FORBIDDEN", "Not permitted");
    }
  };
  const worker = (ticketValue, actorValue) => {
    if (!isWorker(ticketValue, actorValue)) error("FORBIDDEN", "Not responsible");
    if (ticketValue.state !== "progress") error("CONFLICT", "Ticket is not in progress");
  };
  // 等主人放行的关口，接棒人和发起人不能把卡挪走。只有主人的动作能过。
  const gateLocked = (ticketValue, actorValue) => {
    if (ticketValue.relay?.phase === "gate" && actorValue?.type !== "owner") {
      error("FORBIDDEN", "Owner only");
    }
  };
  const open_ = (ticketValue) => {
    if (["completed", "failed"].includes(ticketValue.state)) error("CONFLICT", "Ticket is closed");
  };
  const text = (inputValue, label) => {
    if (typeof inputValue !== "string" || !inputValue.trim()) error("INVALID", `Invalid ${label}`);
  };
  const from = (ticketValue, actorValue) => {
    if (!isSender(ticketValue, actorValue)) error("FORBIDDEN", "Not the sender");
    if (ticketValue.review !== "submitted") error("CONFLICT", "Report not submitted");
  };
  const IDEMPOTENT_FIELDS = ["title", "goal", "to", "project", "workdir", "forbidden", "acceptance", "expects_reply"];
  const legacyHashOf = (ticket) =>
    hash(JSON.stringify(canonical(Object.fromEntries(IDEMPOTENT_FIELDS.map((field) => [field, ticket[field]])))));
  // 发起时规整后的整条路线。后来改路线不改这枚摘要，旧索引仍按没有路线的算法认。
  const routeStamp = (ticket) => {
    const steps = ticket.relay?.steps;
    if (!Array.isArray(steps)) return null;
    return steps.map((step) => ({
      doneWhen: step.doneWhen ?? "",
      gate: step.gate === true,
      task: step.task ?? "",
      type: step.who?.type ?? "",
      who: step.who?.name ?? "",
    }));
  };
  const contentHashOf = (ticket) => {
    const fields = Object.fromEntries(IDEMPOTENT_FIELDS.map((field) => [field, ticket[field]]));
    const route = routeStamp(ticket);
    if (route) fields.route = route;
    return hash(JSON.stringify(canonical(fields)));
  };
  const storedHashOf = (ticket) =>
    typeof ticket.keyDigest === "string" && /^[0-9a-f]{64}$/u.test(ticket.keyDigest)
      ? ticket.keyDigest
      : legacyHashOf(ticket);
  let recovery;
  const recoverIndexes = () => {
    if (!recovery) {
      recovery = (async () => {
        await ensure();
        const files = await readdir(join(root, "tickets"));
        const tickets = [];
        for (const file of files) {
          if (!file.endsWith(".json") || !ID_PATTERN.test(file.slice(0, -5))) continue;
          try {
            const ticket = await readNative(file.slice(0, -5));
            if (ticket.key !== null) tickets.push(ticket);
          } catch (err) {
            if (err.code !== "NOT_FOUND") throw err;
          }
        }
        tickets.sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
        );
        for (const ticket of tickets) {
          const digest = hash(ticket.from.name + "\0" + ticket.key);
          await locked(`key-${digest}`, async () => {
            try {
              await writeFile(
                join(root, ".keys", `${digest}.json`),
                JSON.stringify({ id: ticket.id, contentHash: storedHashOf(ticket) }) + "\n",
                { flag: "wx" },
              );
            } catch (err) {
              if (err.code !== "EEXIST") throw err;
            }
          });
        }
      })().catch((err) => {
        recovery = undefined;
        throw err;
      });
    }
    return recovery;
  };
  const createWithMeta = async (actorValue, input) => {
    guardActor(actorValue);
    const time = now(),
      id = newTicketId(time, randomSuffix),
      ticketValue = buildTicket({ ...input, id }, actorValue, time);
    if (ticketValue.hop > maxHop) error("INVALID", "Hop limit exceeded");
    if (ticketValue.key !== null) ticketValue.keyDigest = contentHashOf(ticketValue);
    const create = async () =>
      locked(id, async () => {
        try {
          await read(id);
          error("CONFLICT", "Ticket already exists");
        } catch (errorValue) {
          if (errorValue.code !== "NOT_FOUND") throw errorValue;
        }
        ticketValue.history.push({ ts: ticketValue.createdAt, by: actorValue.name, action: "created" });
        await save(ticketValue);
        return ticketValue;
      });
    if (ticketValue.key === null) {
      await create();
      await event("created", ticketValue, actorValue, ticketValue.createdAt);
      return { ticket: ticketValue, deduped: false };
    }
    await recoverIndexes();
    const digest = hash(actorValue.name + "\0" + ticketValue.key);
    const contentHash = ticketValue.keyDigest ?? contentHashOf(ticketValue);
    return locked(`key-${digest}`, async () => {
      const path = join(root, ".keys", `${digest}.json`);
      let index;
      try {
        index = JSON.parse(await readFile(path, "utf8"));
      } catch (errorValue) {
        if (errorValue.code !== "ENOENT") throw errorValue;
      }
      if (index) {
        // 新索引含整条路线。旧索引没有路线：原样重试仍认，避免把已有的卡打成冲突。
        if (index.contentHash !== contentHash && index.contentHash !== legacyHashOf(ticketValue)) {
          error("CONFLICT", "Idempotency key content differs");
        }
        return { ticket: await read(index.id), deduped: true };
      }
      await create();
      try {
        if (__beforeIndexWrite) await __beforeIndexWrite(ticketValue);
        await writeFile(path, JSON.stringify({ id, contentHash }) + "\n", { flag: "wx" });
      } catch (errorValue) {
        // 单已落盘而索引没写成：下次请求重新恢复索引，避免同键再建一张。
        recovery = undefined;
        throw errorValue;
      }
      await event("created", ticketValue, actorValue, ticketValue.createdAt);
      return { ticket: ticketValue, deduped: false };
    });
  };
  const board = {
    ...createRelayOps({ mutate, locked, readNative, checkId, guardActor, createWithMeta }),
    ...createClaimOps({ mutate, createWithMeta, guardActor }),
    ...createArrangeOps({ mutate, createWithMeta, guardActor, now, offset: () =>
      (typeof utcOffsetMinutes === "function" ? utcOffsetMinutes() : utcOffsetMinutes) }),
    createWithMeta,
    async create(actorValue, input) {
      return (await createWithMeta(actorValue, input)).ticket;
    },

    async get(id) {
      return read(id);
    },

    async list({ state, assignee, creator, inboxFor, attention, open } = {}) {
      if (state !== undefined && !TICKET_STATES.includes(state)) error("INVALID", "Invalid state");
      let files;
      try {
        files = await readdir(join(root, "tickets"));
      } catch (errorValue) {
        if (errorValue.code === "ENOENT") files = [];
        else throw errorValue;
      }
      const out = [];
      for (const fileName of files) {
        if (!fileName.endsWith(".json") || !ID_PATTERN.test(fileName.slice(0, -5))) continue;
        try {
          const ticketValue = await readNative(fileName.slice(0, -5));
          if (
            state && ticketValue.state !== state ||
            assignee && !ticketValue.to.includes(assignee) && ticketValue.claimedBy !== assignee ||
            creator && ticketValue.from.name !== creator ||
            inboxFor && (ticketValue.from.name !== inboxFor || ticketValue.review !== "submitted") ||
            attention === true && !["blocked", "waiting-human", "failed"].includes(ticketValue.state) ||
            open === true && !(ticketValue.openClaim?.state === "open" && ticketValue.state === "queued" && !ticketValue.claimedBy)
          ) continue;
          out.push(ticketValue);
        } catch (errorValue) {
          if (errorValue.code !== "NOT_FOUND") throw errorValue;
        }
      }
      const ids = new Set(out.map((ticket) => ticket.id));
      for (const ticketValue of await legacyTickets()) {
        if (ids.has(ticketValue.id)) continue;
        try {
          await readNative(ticketValue.id);
          continue;
        } catch (err) {
          if (err.code !== "NOT_FOUND") throw err;
        }
        if (
          state && ticketValue.state !== state ||
          assignee && !ticketValue.to.includes(assignee) && ticketValue.claimedBy !== assignee ||
          creator && ticketValue.from.name !== creator ||
          inboxFor && (ticketValue.from.name !== inboxFor || ticketValue.review !== "submitted") ||
          attention === true && !["blocked", "waiting-human", "failed"].includes(ticketValue.state) ||
          open === true
        ) continue;
        ids.add(ticketValue.id);
        out.push(ticketValue);
      }
      return out.sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
    },

    async claim(actorValue, id) {
      guardActor(actorValue);
      return locked(`worker-${hash(actorValue.name)}`, async () => {
        const target = await read(id);
        if (target.legacy) error("CONFLICT", "Cannot modify legacy ticket");
        if (maxActivePerWorker) {
          const active = (await board.list()).filter((ticket) =>
            ticket.claimedBy === actorValue.name &&
            ["progress", "blocked", "waiting-human", "waiting-timeout", "uncertain"].includes(ticket.state)
          );
          if (active.length >= maxActivePerWorker) error("CONFLICT", "Worker active limit reached");
        }
        return mutate(actorValue, id, "claimed", (ticketValue, ts) => {
          if (ticketValue.state !== "queued") error("CONFLICT", "Ticket already claimed");
          const open = ticketValue.openClaim;
          if (open?.state === "taken" && open.takenBy !== actorValue.name && !ticketValue.to.includes(actorValue.name)) {
            error("CONFLICT", "Already taken");
          }
          if (open?.state === "open") {
            // 开放认领：外部身份可以直接领（先到先得）；内部助理由首席派，自己不能抢。
            if (actorValue.type !== "external") error("FORBIDDEN", "Open card: chief assigns");
            ticketValue.to = [actorValue.name];
            ticketValue.openClaim = {
              ...open, state: "taken", takenBy: actorValue.name, takenType: "external",
              takenShown: actorValue.name, via: "external", at: ts,
            };
          } else if (ticketValue.to.length && !ticketValue.to.includes(actorValue.name)) {
            error("FORBIDDEN", "Not an assignee");
          } else if (actorValue.type === "external" && !ticketValue.to.includes(actorValue.name)) {
            // 外部身份只能领明确派给它的卡，或开放认领的卡；没写负责人的普通卡不行。
            error("FORBIDDEN", "Not an assignee");
          }
          ticketValue.state = "progress";
          ticketValue.claimedBy = actorValue.name;
          ticketValue.claimedByType = actorValue.type;
        });
      });
    },

    async resume(actorValue, id) {
      return mutate(actorValue, id, "resumed", (ticketValue) => {
        if (!isWorker(ticketValue, actorValue)) error("FORBIDDEN", "Not responsible");
        gateLocked(ticketValue, actorValue);
        if (
          !["blocked", "waiting-human", "waiting-timeout", "uncertain", "progress"].includes(
            ticketValue.state,
          )
        ) {
          error("CONFLICT", "Cannot resume");
        }
        ticketValue.state = "progress";
        ticketValue.open_ask = null;
      });
    },

    async progress(actorValue, id, value) {
      text(value, "progress");
      return mutate(actorValue, id, "progress", (ticketValue, ts) => {
        worker(ticketValue, actorValue);
        ticketValue.progress.push({ ts, by: actorValue.name, text: value });
        const relay = ticketValue.relay;
        const step = relay?.steps?.[relay.current];
        if (relay?.phase === "running" && step?.who?.name === actorValue.name && step.stalledAt) {
          step.stalledAt = null;
          step.stalledMin = null;
        }
      });
    },

    async report(actorValue, id, data) {
      if (!data || typeof data !== "object") error("INVALID", "Invalid report");
      text(data.summary, "summary");
      if (
        Buffer.byteLength(data.summary, "utf8") > 2048 ||
        data.file != null && typeof data.file !== "string" ||
        data.sha256 != null && (typeof data.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(data.sha256)) ||
        data.artifacts !== undefined &&
          (!Array.isArray(data.artifacts) ||
            !data.artifacts.every((itemValue) => typeof itemValue === "string"))
      ) error("INVALID", "Invalid report");
      return mutate(actorValue, id, "reported", (ticketValue, ts) => {
        worker(ticketValue, actorValue);
        ticketValue.report = {
          summary: data.summary,
          file: data.file ?? null,
          sha256: data.sha256 ?? null,
          by: actorValue.name,
          ts,
          selfReported: true,
        };
        ticketValue.reports.push({ ...ticketValue.report, artifacts: data.artifacts ?? [] });
        ticketValue.review = "submitted";
        return { inboxFor: ticketValue.from.name };
      });
    },

    async done(actorValue, id) {
      return mutate(actorValue, id, "submitted", (ticketValue) => {
        worker(ticketValue, actorValue);
        if (!ticketValue.reports.length) error("INVALID", "Report required");
        // 打回后须有新报告才能再提交；报告须出自当前负责人。
        if (ticketValue.review === "sent_back" || ticketValue.reports.at(-1).by !== actorValue.name) {
          error("INVALID", "New report required");
        }
        ticketValue.review = "submitted";
        return { inboxFor: ticketValue.from.name };
      });
    },

    async accept(actorValue, id, note) {
      // 外部身份做的卡，内部助理验收只记一句意见，卡停在「等验收」，主人点完成才算数。
      const needsOwner = (ticketValue) => ownerAcceptExternal && actorValue?.type === "assistant" &&
        ticketValue.claimedByType === "external";
      const before = await read(id);
      if (needsOwner(before)) {
        const opinion = typeof note === "string" ? note.trim().slice(0, 2000) : "";
        return mutate(actorValue, id, "review_noted", (ticketValue) => {
          from(ticketValue, actorValue);
          if (!needsOwner(ticketValue)) error("CONFLICT", "Ticket changed concurrently");
          return { detail: opinion || "（助理看过，没写意见）" };
        });
      }
      return mutate(actorValue, id, "accepted", (ticketValue) => {
        from(ticketValue, actorValue);
        if (needsOwner(ticketValue)) error("CONFLICT", "Ticket changed concurrently");
        ticketValue.state = "completed";
        ticketValue.review = "accepted";
        ticketValue.open_ask = null;
        return { notify: true };
      });
    },

    async sendBack(actorValue, id, note) {
      text(note, "note");
      return mutate(actorValue, id, "sent_back", (ticketValue, ts) => {
        from(ticketValue, actorValue);
        ticketValue.review = "sent_back";
        ticketValue.state = "progress";
        ticketValue.open_ask = null;
        ticketValue.progress.push({ ts, by: actorValue.name, text: note });
        return { detail: note };
      });
    },

    async block(actorValue, id, reason, { waitHuman = false } = {}) {
      text(reason, "reason");
      if (typeof waitHuman !== "boolean") error("INVALID", "Invalid waitHuman");
      return mutate(actorValue, id, "blocked", (ticketValue, ts) => {
        owner(ticketValue, actorValue);
        gateLocked(ticketValue, actorValue);
        open_(ticketValue);
        ticketValue.state = waitHuman ? "waiting-human" : "blocked";
        ticketValue.open_ask = waitHuman ? { text: reason, ts } : null;
        return { attention: true, attentionKind: ticketValue.state, reason };
      });
    },

    async answer(actorValue, id, value) {
      text(value, "answer");
      return mutate(actorValue, id, "answered", (ticketValue, ts) => {
        if (ticketValue.state !== "waiting-human") error("CONFLICT", "Not waiting for an answer");
        if (ticketValue.arrange?.state === "proposed") error("CONFLICT", "Arrangement waits for a decision");
        if (!isSender(ticketValue, actorValue) && actorValue.type !== "owner") {
          error("FORBIDDEN", "Not permitted");
        }
        // 接力里「要主人看一眼」的那一站，只有主人能放行，并且就在这一笔里放行，不留到事后用状态推断。
        if (ticketValue.relay?.phase === "gate") {
          if (actorValue.type !== "owner") error("FORBIDDEN", "Owner only");
          return releaseRelayGate(ticketValue, ts, { note: value });
        }
        ticketValue.open_ask = null;
        if (ticketValue.openClaim?.state === "asked") {
          // 首席转问主人的开放卡：主人答了，卡回到「谁有空谁接」，再叫首席按回答去派。
          ticketValue.state = "queued";
          ticketValue.openClaim = {
            ...ticketValue.openClaim, state: "open", reopenedAt: new Date(now()).toISOString(),
            answer: String(value).slice(0, 2000),
          };
          return { detail: value };
        }
        ticketValue.state = "progress";
        return { detail: value };
      });
    },

    async fail(actorValue, id, reason) {
      text(reason, "reason");
      return mutate(actorValue, id, "failed", (ticketValue) => {
        owner(ticketValue, actorValue);
        gateLocked(ticketValue, actorValue);
        open_(ticketValue);
        ticketValue.state = "failed";
        ticketValue.open_ask = null;
        return { attention: true, attentionKind: "failed", reason };
      });
    },

    async markTimeout(actorValue, id) {
      return mutate(actorValue, id, "timeout", (ticketValue) => {
        owner(ticketValue, actorValue);
        gateLocked(ticketValue, actorValue);
        open_(ticketValue);
        ticketValue.state = "waiting-timeout";
        ticketValue.open_ask = null;
      });
    },

    async markUncertain(actorValue, id, note) {
      text(note, "note");
      return mutate(actorValue, id, "uncertain", (ticketValue) => {
        owner(ticketValue, actorValue);
        gateLocked(ticketValue, actorValue);
        open_(ticketValue);
        ticketValue.state = "uncertain";
        ticketValue.open_ask = null;
        return { detail: note };
      });
    },

    async verify(actorValue, id, data) {
      if (!data || !["pass", "fail", "partial"].includes(data.verdict) || typeof data.note !== "string") {
        error("INVALID", "Invalid verification");
      }
      return mutate(actorValue, id, "verified", (ticketValue, ts) => {
        if (!ticketValue.reports.length) error("CONFLICT", "Report required");
        if (ticketValue.claimedBy === actorValue.name) error("FORBIDDEN", "Cannot verify own work");
        if (ticketValue.reports.some((resultValue) => resultValue.by === actorValue.name)) {
          error("FORBIDDEN", "Cannot verify own report");
        }
        ticketValue.verification.push({ ts, by: actorValue.name, verdict: data.verdict, note: data.note });
      });
    },

    // 主人在看板上直接改：挪列、换负责人、改标题说明。只有 type=owner 的人可以用。
    async ownerMove(actorValue, id, column) {
      if (actorValue?.type !== "owner") error("FORBIDDEN", "Not permitted");
      if (!["queued", "progress", "review", "attention", "done"].includes(column)) error("INVALID", "Invalid column");
      return mutate(actorValue, id, "owner_move", (ticketValue, ts) => {
        // 没有负责人的卡被拖到「在做」= 交办信号：请首席安排（有负责人的卡只改状态；拖到别处不触发）。
        if (column === "progress" && arrangeOnDrag && canArrange(ticketValue) && !ticketValue.openClaim &&
          !(ticketValue.schedule?.state === "waiting")) {
          ticketValue.arrange = { state: "wanted", via: "drag", requestedAt: ts, attempts: 0 };
          return { detail: "progress→交给首席安排", arrangeWanted: true };
        }
        // 主人自己挪了一张等首席安排、等你点头的卡：那次安排作废。
        if (["wanted", "proposed"].includes(ticketValue.arrange?.state)) {
          ticketValue.arrange = { ...ticketValue.arrange, state: "declined", decision: "skip", decidedAt: ts };
        }
        // 主人自己动了一张还在等定时的一次性卡：定时作废，免得到点又来抢。
        if (column !== "queued" && ticketValue.schedule?.state === "waiting" && ticketValue.schedule.kind === "once") {
          delete ticketValue.schedule;
        }
        const wasSubmitted = ticketValue.review === "submitted";
        const ensureWorker = () => {
          if (!ticketValue.claimedBy) {
            const pick = ticketValue.to[0];
            ticketValue.claimedBy = pick ?? actorValue.name;
            ticketValue.claimedByType = pick ? null : "owner";
          }
        };
        if (column === "queued") {
          ticketValue.state = "queued";
          ticketValue.claimedBy = null;
          ticketValue.claimedByType = null;
          ticketValue.review = "none";
          ticketValue.open_ask = null;
        } else if (column === "progress") {
          ensureWorker();
          ticketValue.state = "progress";
          ticketValue.open_ask = null;
          if (wasSubmitted) ticketValue.review = "sent_back";
          // 主人把关口上的卡挪到进行中：放行和这次挪列写在同一笔里，不交给事后的状态同步去猜。
          if (ticketValue.relay?.phase === "gate") {
            return {
              detail: column,
              ...releaseRelayGate(ticketValue, ts, { note: "主人把这张卡挪到了进行中，放行" }),
            };
          }
        } else if (column === "review") {
          ensureWorker();
          ticketValue.state = "progress";
          ticketValue.review = "submitted";
          ticketValue.open_ask = null;
        } else if (column === "attention") {
          ensureWorker();
          ticketValue.state = "waiting-human";
          ticketValue.open_ask = { text: "主人标了：这张等你看一下", ts };
        } else {
          ticketValue.state = "completed";
          if (wasSubmitted) ticketValue.review = "accepted";
          ticketValue.open_ask = null;
        }
        if (column !== "queued" && ticketValue.openClaim && ticketValue.openClaim.state !== "taken") {
          ticketValue.openClaim = {
            ...ticketValue.openClaim, state: "taken", takenBy: ticketValue.claimedBy, via: "owner", at: ts,
            takenType: ticketValue.claimedByType ?? "assistant", takenShown: ticketValue.claimedBy,
          };
        }
        return { detail: column };
      });
    },

    async ownerAssign(actorValue, id, toName, toType) {
      if (actorValue?.type !== "owner") error("FORBIDDEN", "Not permitted");
      if (toName !== null && !nameOK(toName)) error("INVALID", "Invalid assignee");
      if (toType !== undefined && toType !== null && !["assistant", "external", "owner"].includes(toType)) {
        error("INVALID", "Invalid assignee type");
      }
      return mutate(actorValue, id, "owner_assign", (ticketValue, ts) => {
        open_(ticketValue);
        if (ticketValue.relay) error("CONFLICT", "Relay ticket: change the route instead");
        // 主人自己直接指了人：等着首席安排或等你点头的那次安排作废，卡回到「待领」再按主人的意思派。
        if (["wanted", "proposed"].includes(ticketValue.arrange?.state)) {
          ticketValue.arrange = { ...ticketValue.arrange, state: "declined", decision: "swap", decidedAt: ts };
          ticketValue.state = "queued";
          ticketValue.open_ask = null;
        }
        // 主人直接指人，也盖过还没到点的定时：定时作废，立刻按主人说的派。
        if (toName !== null && ticketValue.schedule?.state === "waiting" && ticketValue.schedule.kind === "once") {
          delete ticketValue.schedule;
        }
        if (toName === null) {
          ticketValue.to = [];
          ticketValue.claimedBy = null;
          ticketValue.claimedByType = null;
          ticketValue.state = "queued";
          ticketValue.review = "none";
          ticketValue.open_ask = null;
          delete ticketValue.openClaim; // 「先不指定」回到普通卡
        } else {
          if (ticketValue.openClaim && ticketValue.openClaim.state !== "taken") {
            ticketValue.openClaim = {
              ...ticketValue.openClaim, state: "taken", takenBy: toName, via: "owner", at: new Date(now()).toISOString(),
              takenType: toType ?? (toName === actorValue.name ? "owner" : "assistant"), takenShown: toName,
            };
          }
          ticketValue.to = [toName];
          if (ticketValue.state !== "queued") {
            ticketValue.claimedBy = toName;
            ticketValue.claimedByType = toType ?? (toName === actorValue.name ? "owner" : "assistant");
          } else {
            ticketValue.claimedBy = null;
            ticketValue.claimedByType = null;
          }
        }
        return { detail: toName ?? "" };
      });
    },

    async ownerEdit(actorValue, id, fields) {
      if (actorValue?.type !== "owner") error("FORBIDDEN", "Not permitted");
      if (!fields || typeof fields !== "object") error("INVALID", "Invalid fields");
      const clean = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
      if (fields.title !== undefined && !clean(fields.title, 120)) error("INVALID", "Invalid title");
      if (fields.goal !== undefined && !clean(fields.goal, 4000)) error("INVALID", "Invalid goal");
      if (fields.title === undefined && fields.goal === undefined) error("INVALID", "Nothing to change");
      return mutate(actorValue, id, "owner_edit", (ticketValue) => {
        if (fields.title !== undefined) ticketValue.title = fields.title.trim();
        if (fields.goal !== undefined) ticketValue.goal = fields.goal.trim();
        return { detail: Object.keys(fields).filter((k) => ["title", "goal"].includes(k)).join(",") };
      });
    },

    // 主人在看板上「删掉这张」：软删除。单从 tickets/ 搬到 archive/，列表和读取都看不到，
    // 但文件和完整历史都在，要找回把文件搬回 tickets/ 即可。旧格式单只读，不能删。
    async ownerArchive(actorValue, id) {
      if (actorValue?.type !== "owner") error("FORBIDDEN", "Not permitted");
      guardActor(actorValue);
      checkId(id);
      return locked(id, async () => {
        const ticketValue = await readNative(id).catch((errorValue) => {
          if (errorValue.code !== "NOT_FOUND") throw errorValue;
          return null;
        });
        if (!ticketValue) {
          const legacy = (await legacyTickets()).some((item) => item.id === id);
          error(legacy ? "CONFLICT" : "NOT_FOUND", legacy ? "Cannot modify legacy ticket" : "Ticket not found");
        }
        const ts = new Date(now()).toISOString();
        ticketValue.updatedAt = ts;
        ticketValue.history.push({ ts, by: actorValue.name, action: "owner_delete" });
        const valid = validateTicket(ticketValue);
        if (!valid.ok) error("INVALID", `Invalid ticket: ${valid.errors.join(", ")}`);
        await mkdir(join(root, "archive"), { recursive: true });
        const target = join(root, "archive", `${ticketValue.id}.json`),
          tmp = join(root, "archive", `.${ticketValue.id}.${randomBytes(8).toString("hex")}.tmp`);
        await writeFile(tmp, JSON.stringify(ticketValue, null, 2) + "\n", { flag: "wx" });
        await rename(tmp, target);
        await unlink(join(root, "tickets", `${ticketValue.id}.json`));
        if (ticketValue.key !== null && ticketValue.key !== undefined) {
          await unlink(join(root, ".keys", `${hash(ticketValue.from.name + "\0" + ticketValue.key)}.json`))
            .catch((errorValue) => {
              if (errorValue.code !== "ENOENT") throw errorValue;
            });
        }
        await event("owner_delete", ticketValue, actorValue, ts);
        return ticketValue;
      });
    },

    async handoff(actorValue, id, toName) {
      if (!nameOK(toName)) error("INVALID", "Invalid assignee");
      return mutate(actorValue, id, "handoff", (ticketValue) => {
        owner(ticketValue, actorValue);
        open_(ticketValue);
        if (ticketValue.relay) error("CONFLICT", "Relay ticket cannot be handed off");
        if (ticketValue.hop + 1 > maxHop) error("CONFLICT", "Hop limit exceeded");
        ticketValue.hop++;
        ticketValue.state = "queued";
        ticketValue.to = [toName];
        ticketValue.claimedBy = null;
        ticketValue.claimedByType = null;
        ticketValue.review = "none";
        ticketValue.open_ask = null;
      });
    },
  };
  return board;
}
