// 演示用假模型：OpenAI 兼容 /v1/chat/completions 与 /v1/models，只回显最后一句用户话，不联网、不要钥匙。
// 导出一个请求处理函数，由 demo-stack.mjs 挂在同一个端口上；也可单独运行：node demo-model.mjs 端口
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const INTERNAL = /^\s*(<[a-z][\w-]*[\s>]|Time sampled while preparing|Current runtime context\.|今天 \S+，待办 \d+ 张)/i;

// 把消息内容（字符串或分段数组）取成纯文本。
function textOf(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map(part => part?.text ?? '').join('') : '';
}

// 往响应里写一个 JSON 结果。
function sendJson(res, code, body) {
  res.writeHead(code, {'content-type': 'application/json'});
  res.end(JSON.stringify(body));
}

// 造一个演示模型的请求处理函数：返回 (req, res) => void。
export function createDemoModel() {
  let served = 0;
  return function handle(req, res) {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname.endsWith('/models')) {
      return sendJson(res, 200, {object: 'list', data: [{id: 'echo-1', object: 'model'}]});
    }
    if (!pathname.endsWith('/chat/completions') || req.method !== 'POST') return sendJson(res, 404, {});
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return sendJson(res, 400, {});
      }
      served += 1;
      const users = (body.messages ?? []).filter(m => m.role === 'user' && !INTERNAL.test(textOf(m.content)));
      const last = textOf(users.at(-1)?.content).trim().slice(0, 400);
      const reply = `【演示模型回显·第${users.length}轮】你说：「${last}」`;
      const id = `chatcmpl-demo-${served}`;
      const created = Math.floor(Date.now() / 1000);
      const usage = {prompt_tokens: 20 * users.length, completion_tokens: reply.length,
        total_tokens: 20 * users.length + reply.length};
      const message = {role: 'assistant', content: reply};
      if (!body.stream) {
        return sendJson(res, 200, {id, object: 'chat.completion', created, model: body.model,
          choices: [{index: 0, message, finish_reason: 'stop'}], usage});
      }
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache'});
      const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const chunk = (delta, finish = null) => ({id, object: 'chat.completion.chunk', created, model: body.model,
        choices: [{index: 0, delta, finish_reason: finish}]});
      let closed = false;
      res.on('close', () => {
        closed = true;
      });
      const parts = reply.match(/[\s\S]{1,12}/g) ?? [''];
      for (let i = 0; i < parts.length && !closed; i++) {
        send(chunk(i === 0 ? {role: 'assistant', content: parts[i]} : {content: parts[i]}));
        await new Promise(done => setTimeout(done, 30));
      }
      if (closed) return;
      send(chunk({}, 'stop'));
      send({id, object: 'chat.completion.chunk', created, model: body.model, choices: [], usage});
      res.end('data: [DONE]\n\n');
    });
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]);
  http.createServer(createDemoModel()).listen(port, '127.0.0.1', () => console.log(`demo model on 127.0.0.1:${port}`));
}
