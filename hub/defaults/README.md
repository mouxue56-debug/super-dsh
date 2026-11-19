# defaults/ 通用内容(开源、不含个人信息)


- `house-rules/AGENTS.md`:家规正本，安装到运行根 `AGENTS.md`。内核启动时 `DSH_AGENTS_HOME` 必须指向运行根，家规才进入指令链。
- `manuals/<kebab-id>/SKILL.md`:六本通用手册。内核要求技能名是小写连字符(kebab-case),所以目录名和 name 用英文 id,
  中文名只写在 description 开头和 manifest.json 的 title 里。安装到各助理的 `.agents/skills/`。
- `templates/`:总管、干活、空白三个人设模板,身份段由配置生成；正文槽位包括 `{{speech}} {{manuals}}`。
- `shared/dispatch-rules.md`:派活规则空模板,只在目标里还没有时才种下,永不覆盖。
- `{{owner}}` 等占位符由安装配置填,见 `packages/hub-plugin/ops/install-content.mjs`。
- 个人内容(具体助理人设、业务手册、称呼与口头禅)不进本目录。
