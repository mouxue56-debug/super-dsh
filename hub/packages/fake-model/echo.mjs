#!/usr/bin/env node
// r16 假模型端点：OpenAI 兼容 /v1/chat/completions，只回显最后一条用户消息，分几段流式返回。
// 只听 127.0.0.1，不联系任何真实提供方，不记录 key。写法参照 guardrails/t018/fake-llm.mjs（我们自己的加固分支）。
// 用法: node echo.mjs PORT LOGFILE
import http from 'node:http'; import fs from 'node:fs';
const port = +process.argv[2] || 3296, log = process.argv[3];
const text = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : '';
let n = 0, toolRequests = 0;
http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => raw += c); req.on('end', async () => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/__stats') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ requests: n, toolRequests })); }
    if (p.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ object: 'list', data: [{ id: 'echo-1', object: 'model' }] })); }
    if (!p.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{}'); }
    n++; let b; try { b = JSON.parse(raw); } catch { res.writeHead(400); return res.end('{}'); }
    if(b.tools?.length)toolRequests++;
    // DSH 会在用户输入前后追加运行环境、时间等内部 user 消息；回显时跳过这些内部片段（以 < 标签、Time sampled、Current runtime context 开头）。
    // 收口：开工切片（「今天 …，待办 N 张」开头）也是插件注入的内部消息，不当成用户最后一句。
    const INTERNAL = /^\s*(<[a-z][\w-]*[\s>]|Time sampled while preparing|Current runtime context\.|今天 \S+，待办 \d+ 张)/i;
    const isInternal = (t) => INTERNAL.test(t);
    const users = (b.messages || []).filter((m) => m.role === 'user' && !isInternal(text(m.content)));
    const last = text(users.at(-1)?.content).trim();
    const command = last.replace(/^【[^】\n]{1,80}派来的活 · 工单[^\n]*\n/, '');
    const lastUserIndex = (b.messages || []).findLastIndex(m => m.role === 'user' && !isInternal(text(m.content)));
    const results = (b.messages || []).slice(lastUserIndex + 1).filter(m => m.role === 'tool');
    let calls = [];
    if (!results.length) {
      const one = /^TOOL\s+(\w+)\s+([\s\S]+)$/.exec(command);
      try {
        if (one) calls = [{name:one[1],args:JSON.parse(one[2])}];
        else if (command.startsWith('TOOLS ')) calls = JSON.parse(command.slice(6));
      } catch { calls = []; }
    }
    if (command.startsWith('TOOLSEQ ')) { try { const sequence=JSON.parse(command.slice(8)); calls=results.length<sequence.length?[sequence[results.length]]:[]; } catch { calls=[]; } }
    calls = calls.map((c,i) => ({id:'call-r24-'+n+'-'+i,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}));
    const slow = /慢|slow/i.test(last);
    const reply = results.length ? '【假模型工具回执】'+results.map(m=>text(m.content)).join('\n') : `【假模型回显·第${users.length}轮】你说：「${last.slice(0, 400)}」` + (slow ? ' ……（慢速模式，用来测试取消）'.repeat(20) : '');
    if (log) fs.appendFileSync(log, JSON.stringify({ ts: new Date().toISOString(), n, stream: !!b.stream, model: b.model, userTurns: users.length, lastLen: last.length, tools:(b.tools??[]).map(t=>t.function?.name), toolCalls:calls.map(c=>c.function.name), heads: (b.messages || []).filter((m) => m.role === 'user').map((m) => text(m.content).slice(0, 24)) }) + '\n');
    const id = 'chatcmpl-r16-' + n, model = b.model, created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 20 * users.length, completion_tokens: reply.length, total_tokens: 20 * users.length + reply.length };
    if (!b.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: calls.length ? null : reply, ...(calls.length ? {tool_calls:calls} : {}) }, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage })); }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    if (calls.length) {
      send({id,object:'chat.completion.chunk',created,model,choices:[{index:0,delta:{role:'assistant',tool_calls:calls.map((c,i)=>({index:i,...c}))},finish_reason:null}]});
      send({id,object:'chat.completion.chunk',created,model,choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});
      return res.end('data: [DONE]\n\n');
    }
    const parts = reply.match(/[\s\S]{1,12}/g) || [''];
    let closed = false; res.on('close', () => { closed = true; });
    for (let i = 0; i < parts.length && !closed; i++) {
      send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: i === 0 ? { role: 'assistant', content: parts[i] } : { content: parts[i] }, finish_reason: null }] });
      await new Promise((r) => setTimeout(r, slow ? 400 : 40));
    }
    if (closed) return;
    send({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    send({ id, object: 'chat.completion.chunk', created, model, choices: [], usage });
    res.end('data: [DONE]\n\n');
  });
}).listen(port, '127.0.0.1', () => console.log('fake echo model on 127.0.0.1:' + port));
process.on('SIGTERM', () => process.exit(0));
