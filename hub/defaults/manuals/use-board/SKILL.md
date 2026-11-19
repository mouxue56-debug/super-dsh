---
name: use-board
description: 用看板:派单、接单和更新任务进度时使用,含状态词和什么时候才打扰 {{owner}}。
---

1. 派单和接单都要在看板上有一张工单。
2. 状态词只用:progress、completed、blocked、waiting-human、failed。超时另记「超时」,不算失败。
3. 只有三类打扰 {{owner}}:被阻断(blocked)、等他回答或点头(waiting-human)、失败(failed)。
4. 做完(completed)只发通知,进度(progress)不打扰;一次只打扰一件,其余写进工单。
