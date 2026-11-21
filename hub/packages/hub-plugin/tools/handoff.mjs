// 看板交接：助理把一件事派给外部身份（Codex、Grok、Claude Code 等在电脑上用命令行读写看板的 agent），
// 以及回答外部身份卡住时问的问题。外部身份名单来自安装配置的 board.externals，没配就不注册这两个工具。
// 走现有的插件工具权限：要在权限表 plugin_tools 里点名 handoff，级别 L3（主人本次确认后执行）。
// 正文会交给外部 agent，按对外发送先问主人；密钥、令牌值不放进任务书。
// 注意：本文件不能 import ./index.mjs。
import {createHash} from 'node:crypto';
import {buildHandoffInput, oneLine, scanSecrets} from '../../hub-bff/lib/handoff.mjs';

export const levels = Object.freeze({
  board_handoff: 'L3',
  board_answer: 'L3',
});

// 名册里这位能不能派单：启用、没暂停、没被单独关掉派单。
const canSend = row => !!row && row.status === 'active' && row.paused !== true && row.can_dispatch !== false;

// 看板错误翻成助理能转述的话。
function say(error) {
  const m = String(error?.message ?? '');
  if (error?.code === 'FORBIDDEN') return '这张工单不归你处理（不是你派的）';
  if (error?.code === 'NOT_FOUND') return '看板上没有这张工单';
  if (error?.code === 'CONFLICT') return '工单当前状态不允许这样做：' + m;
  if (error?.code === 'INVALID') return '内容不合格：' + m;
  return '看板暂时用不了：' + m;
}

export function register(ctx, deps) {
  const {board} = deps;
  const externals = deps.hubConfig?.board?.externals ?? [];
  if (!externals.length) return;
  const str = maxLength => ({type: 'string', maxLength});
  const actor = call => ({name: call.bot, type: 'assistant'});

  ctx.tools.register({
    name: 'board_handoff',
    material: false,
    description: '把一件事派给外部成员（在电脑上用命令行领单的 agent）：' + externals.join('、') + '。'
      + '写清目标、完成标准、交回方式；对方看不到你的对话，要自包含。对方交回或卡住时你会被叫醒去验收或回答。'
      + '主人点头后写卡并当场拉起已配置的接单器。正文不要写密钥、令牌、口令。'
      + '不要因为不归你管或活复杂就主动外派。',
    approvalCard: args => ({
      action: '交给外部成员', preview: `${args.to} · ${args.title || args.goal}`,
      why: '任务书会交给这位外部成员，点头后启动已配置的接单器。已发送内容和费用无法撤回。',
      targets: [args.to], targetCount: 1,
    }),
    parameters: {
      type: 'object',
      properties: {
        to: {type: 'string', enum: [...externals], maxLength: 64},
        title: str(80),
        goal: str(4000),
        done: str(1000),
        return_way: str(300),
        key: str(128),
      },
      required: ['to', 'goal', 'done'],
      additionalProperties: false,
    },
    async execute(args, _exec, call) {
      const me = deps.roster.find(b => b.id === call.bot);
      if (!canSend(me)) throw Error('你现在不能派单（名册里停用、暂停或关掉了派单）');
      if (!externals.includes(args.to)) throw Error(`「${oneLine(args.to, 20)}」不在外部成员名单里，名单：${externals.join('、')}`);
      if (deps.roster.some(b => b.id === args.to || b.name === args.to)) throw Error('这个名字是名册里的助理，不是外部成员');
      if (!Number.isSafeInteger(call.turn) || call.turn < 1) throw Error('无法核实当前轮次，不能派单');
      for (const [label, text] of [['标题', args.title], ['目标', args.goal], ['完成标准', args.done],
        ['交回方式', args.return_way], ['key', args.key]]) {
        const why = scanSecrets(text);
        if (why) throw Error(`${label}里${why}，不能写进派给外部成员的单。把密钥、令牌留在本机，不要写进去`);
      }
      const readExternal = call.readExternal || deps.state(call.sessionId).readExternal;
      let input;
      try {
        input = buildHandoffInput({
          from: me.id, to: args.to, title: args.title, goal: args.goal, done: args.done,
          returnWay: args.return_way, sessionId: call.sessionId, readExternal: readExternal === true,
          key: args.key ?? 'hand-' + createHash('sha256').update([call.sessionId, args.to, args.goal, args.done]
            .join('\0')).digest('hex').slice(0, 40),
        });
      } catch (error) {
        throw Error(say(error));
      }
      const release = deps.state(call.sessionId).reserveSend(call.turn, deps.hubConfig.board.maxSendPerTurn);
      let result;
      try {
        result = await board.createWithMeta(actor(call), input);
      } catch (error) {
        release();
        throw Error(say(error));
      }
      if (result.deduped) release();
      const t = result.ticket;
      return result.deduped
        ? `这件事已经派给 ${args.to} 了（同一个 key），工单 ${t.id}，现在是 ${t.state}`
        : `已派给外部成员 ${args.to}，工单 ${t.id}。它用命令行领单、做完交回，或卡住问人；那时你会被叫醒验收或回答。`
          + '不要重复催它，也不要重复派';
    },
  });

  ctx.tools.register({
    name: 'board_answer',
    material: false,
    description: '回答你派出去的单上外部成员卡住时问的问题（工单要处于「等人回答」）。'
      + '要主人拿主意的先问主人，再把主人的答案转给它。回答会被外部成员读到：不要写密钥、令牌。',
    approvalCard: args => ({
      action: '回答外部成员', preview: `${args.id} · ${args.text}`,
      why: '这段回答会写进指定工单，外部成员能读到。已读取的内容无法撤回。',
      targets: [args.id], targetCount: 1,
    }),
    parameters: {
      type: 'object',
      properties: {id: str(64), text: str(2000)},
      required: ['id', 'text'],
      additionalProperties: false,
    },
    async execute(args, _exec, call) {
      const text = args.text.trim();
      if (!text) throw Error('要写清回答');
      const why = scanSecrets(text);
      if (why) throw Error(`回答里${why}，不能写给外部成员`);
      try {
        const ticket = await board.get(args.id);
        if (ticket.from?.name !== call.bot) throw Object.assign(Error('not sender'), {code: 'FORBIDDEN'});
        await board.answer(actor(call), args.id, text);
      } catch (error) {
        throw Error(say(error));
      }
      return `工单 ${args.id} 已回答，外部成员下次看板上会看到`;
    },
  });
}
