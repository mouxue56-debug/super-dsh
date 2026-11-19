import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {checkContract as legacyContract, hubApiBlock} from '../ops/check-adapter-contract.mjs';

// 复用既有 168 项门禁；导出表允许在 returnToBoard 前增添接口。
// 退役的首页分助理结构只对旧壳必需，不能靠残留 CSS 冒充仍有 DOM。
// 壳以 r25-motion-body 样式和动画类作为灵动标记。
export function checkContract(html) {
  const api = hubApiBlock(html);
  const flat = /function featureView\(/.test(html) && /data-feature-phrase/.test(html);
  const retired = new Set(['新壳选择器 home-child-count','新壳选择器 shell-sub-avatars','新壳选择器 r22-unread-dot']);
  const checks = legacyContract(html).map(check => {
    const name = /^Hub\.(\w+)/.exec(check.name)?.[1];
    if (name) {
      const optional = check.name.includes('旧壳回退') && !/function (?:registerMoreItem|setDemoContent)\b|typeof status===['"]object['"]/.test(html);
      return {...check, ok: optional || new RegExp('\\b' + name + '\\s*:').test(api)};
    }
    return flat && retired.has(check.name) ? {...check, name: check.name + '（平铺首页已退役，可为空）', ok:true} : check;
  });
  if (flat) {
    for (const [name,pattern] of [
      ['Hub.canSend',/\bcanSend\s*:\s*r25CanSend\b/],
      ['Hub.clearComposer',/\bclearComposer\s*:\s*r25ClearComposer\b/],
      ['Hub.featureOwner',/\bfeatureOwner\s*:\s*featureOwner\b/],
      ['Hub.openFeature',/\bopenFeature\s*:\s*openFeature\b/]
    ]) checks.push({name,ok:pattern.test(api)});
    checks.push({name:'功能页常用话只填不发',ok:/function featureConversation\([^)]*\)\{[^\n]*input\.value=state\.input[^\n]*dispatchEvent/.test(html) ||
      /function featureConversation\([^)]*\)\{[^\n]*return fillDraft\(/.test(html) && /function fillDraft\([^)]*\)\{[\s\S]{0,600}?input\.value=state\.input[\s\S]{0,200}?dispatchEvent/.test(html)});
    checks.push({name:'组字捕获保护',ok:/compositionstart/.test(html) && /window\.addEventListener\('click',[^\n]*r25GuardSend\(e\);\},true\)/.test(html)});
  }
  const profiles = /window\.AssistantProfiles/.test(html) && /registerFeatureSection/.test(html);
  if (profiles) {
    const add = (name, ok) => checks.push({name: '新壳（第25轮）' + name, ok});
    const exports = html.match(/window\.AssistantProfiles\s*=\s*\{([^}]+)\}/)?.[1] || '';
    for (const name of ['propose', 'preview', 'confirm', 'undo', 'openProfile', 'openLibrary', 'drafts']) {
      add('AssistantProfiles.' + name, new RegExp('\\b' + name + '\\b').test(exports));
    }
    for (const name of ['data-assistant-profile', 'data-assistant-confirm', 'data-assistant-amend',
      'data-assistant-cancel', 'assistant-change', 'assistant-chief-required', 'r25-assistant-header',
      'r25-static-stage', 'data-feature-phrase', 'data-feature-section', 'data-feature-contribution',
      'data-feature-chat', 'data-memory-entries', 'r25-motion-body']) add(name, html.includes(name));
    for (const name of ['registerFeatureSection', 'registerMemoryMounts', 'fixedTasks', 'createFixedTask',
      'createBot']) add('Hub.' + name, new RegExp('\\b' + name + '\\s*[:,}]').test(api));
    add('registerConversation featureId', /function registerConversation\([^\n]*spec\.featureId/.test(html));
  }
  return checks;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw Error('用法：node test/check-shell-contract.mjs <index.html路径>');
    const checks=checkContract(await readFile(process.argv[2],'utf8'));
    for(const check of checks) console.log((check.ok?'通过 ':'缺少 ')+check.name);
    const failed=checks.filter(c=>!c.ok);console.log(`契约：${checks.length-failed.length}/${checks.length} 通过`);
    process.exitCode=failed.length?1:0;
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
