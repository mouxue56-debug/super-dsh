
(function () {
  'use strict';
  var H=window.Hub, h=H.h, conversation='example-conversation';
  H.addStyle('.m-_example-note{padding:16px;border-radius:var(--r-card);background:var(--sage-soft);color:var(--sage)}');
  H.registerCard('example-note', {
    title:'示例便笺',
    render:function(data){return h('section',{class:'m-_example-note'},[
      h('h3',{},data.title),h('p',{},data.text),
      h('button',{class:'ghostbtn',onClick:()=>H.openPanel('example-panel',{text:data.text})},'查看便笺')]);},
    quoteLabel:data=>'便笺：'+data.title
  });
  H.registerMessageAction({id:'example-action',icon:'pin',label:'记到便笺',
    when:msg=>msg.parts.some(p=>p.type==='example-note'),run:msg=>H.toast('已选择 '+msg.id+' · 仅本页演示')});
  H.registerConversation('chief',{id:conversation,title:'模块示例 · 全部接口',messages:[
    {id:'example-hello',from:'chief',time:'刚刚',parts:[{type:'text',md:'**模块演示**：点便笺打开面板；输入 /example 文字。'},{type:'example-note',data:{title:'本地协作',text:'模块只写自己的一个文件。'}}]}
  ]});
  H.registerPanel('example-panel',{title:'示例便笺',icon:'file',group:'扩展',render:function(container,ctx){
    container.append(h('p',{class:'m-_example-note'},ctx.params.text||'本地便笺，无网络调用。'),
      h('button',{class:'primary',onClick:()=>H.postMessage(conversation,{from:'chief',time:'刚刚',parts:[{type:'text',md:'便笺已追加到演示会话。'}]})},'追加一条消息'));
  }});
  H.registerSettingsPage('example-settings',{title:'示例偏好',icon:'settings',group:'模块',order:10,render:function(container){
    container.append(h('p',{},'偏好仅用于当前页面。'),h('button',{class:'ghostbtn',onClick:()=>H.toast('本地偏好演示')},'试一下'));
  }});
  H.registerView('example-view',{title:'便笺',icon:'file',render:function(container){
    container.append(h('h1',{},'示例便笺'),h('p',{class:'m-_example-note'},'可插入形态位于「更多」，四种主形态仍保留。'),
      h('button',{class:'primary',onClick:()=>H.navigate({view:'chat',bot:'chief',conversation:conversation})},'打开演示会话'));
  }});
  H.registerBotTab('example-tab',{title:'模块说明',render:function(container,bot){container.append(h('p',{},bot.name+' 的扩展示例。'));}});
  H.registerComposerTool({id:'example-tool',icon:'file',label:'示例便笺',run:()=>H.openPanel('example-panel')});
  H.registerSlashCommand({name:'example',hint:'追加一条示例便笺 /example 文字',run:function(args,ctx){
    H.postMessage(ctx.conversation,{from:ctx.bot.id,time:'刚刚',parts:[{type:'example-note',data:{title:'快捷便笺',text:args||'一条便笺'}}]});
  }});
  H.registerStatusChip({id:'example-chip',order:10,render:function(container,ctx){if(ctx.conversation===conversation)container.append(h('span',{class:'pill'},'示例模块'));}});
  H.registerBoardCardBadge(function(card){if(card.id==='c7')return h('span',{class:'pill'},'示例徽标');});
  H.registerTaskSection('example-section',{title:'模块附加信息',when:task=>task.id==='task-kanban',render:function(container,task){container.append(h('p',{},task.title+' · 本节来自示例模块。'));}});
  H.on('message',function(event){if(event.conversation===conversation)H.toast('示例会话已更新');});
})();
