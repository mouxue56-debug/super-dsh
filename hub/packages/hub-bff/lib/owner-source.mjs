// 按出处取主人原文：给投知识库用（meeting.mjs 的 pickForKb 的 resolveSource）。
// 只认讨论组消息库里 from 为主人的那一条；别的出处（各助理的规矩页等）一律取不到，原话降级为转述。
import { listGroups, readMessages, OWNER } from './group.mjs';

const SOURCE = /^项目页 (.{1,120}) #(\d{1,9})$/u;

// 去掉项目页标题里的「项目页：」前缀，得到组名。
function groupName(title) {
  return title.replace(/^项目页[：:]\s*/u, '').trim();
}

// 建一个按「项目页 <组名> #<消息号>」取主人原文的函数；取不到返回 undefined。
export function createOwnerSourceResolver({ root }) {
  return (source) => {
    if (typeof root !== 'string' || !root || typeof source !== 'string') return undefined;
    const match = SOURCE.exec(source.trim());
    if (!match) return undefined;
    const name = groupName(match[1]);
    const ref = Number(match[2]);
    let groups;
    try {
      groups = listGroups(root);
    } catch {
      return undefined;
    }
    const hits = groups.filter(g => g.name === name || g.id === name);
    if (hits.length !== 1) return undefined;
    let rows;
    try {
      rows = readMessages(root, hits[0].id);
    } catch {
      return undefined;
    }
    const message = rows.find(m => m.id === ref);
    if (!message || message.from !== OWNER || typeof message.text !== 'string') return undefined;
    return message.text;
  };
}
