// 假的 Cua Driver MCP 服务端（只用于测试）：stdio、逐行 JSON-RPC，只有 run_steps 一个工具。
// 不碰屏幕、不读剪贴板、不开应用；窗口文字来自环境变量 CUA_FAKE_STATE 指向的 JSON 文件（应用名 → 文字）。
import fs from 'node:fs';
import readline from 'node:readline';

const log = process.env.CUA_FAKE_LOG;
const stateFile = process.env.CUA_FAKE_STATE;
const send = msg => process.stdout.write(JSON.stringify({jsonrpc: '2.0', ...msg}) + '\n');
const rl = readline.createInterface({input: process.stdin});

rl.on('line', line => {
  const req = JSON.parse(line);
  if (req.method === 'initialize') {
    send({id: req.id, result: {protocolVersion: '2024-11-05', capabilities: {tools: {}},
      serverInfo: {name: 'fake-cua', version: '0'}}});
  } else if (req.method === 'tools/list') {
    send({id: req.id, result: {tools: [{name: 'run_steps', description: 'fake', inputSchema: {type: 'object'}}]}});
  } else if (req.method === 'tools/call') {
    const {name, arguments: args} = req.params;
    if (log) {
      fs.appendFileSync(log, JSON.stringify({name, args}) + '\n');
    }
    if (name !== 'run_steps') {
      send({id: req.id, result: {isError: true, content: [{type: 'text', text: 'unknown tool'}]}});
      return;
    }
    const boom = (args.steps ?? []).some(s => JSON.stringify(s).includes('BOOM'));
    if (boom) {
      send({id: req.id, result: {isError: true, content: [{type: 'text', text: 'step 1 failed: BOOM'}]}});
      return;
    }
    const state = stateFile ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    const text = args.observe ? `steps ok\n${state[args.app] ?? ''}` : 'steps ok';
    send({id: req.id, result: {content: [{type: 'text', text}]}});
  }
});
