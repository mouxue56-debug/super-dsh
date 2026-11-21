

var PROJECTS = [
  {
    "id": "workspace",
    "name": "协作示例",
    "line": "资料交流与回复草稿，安排待确认"
  },
  {
    "id": "ai",
    "name": "资料整理",
    "line": "摘要、来源与交付清单"
  },
  {
    "id": "video",
    "name": "视觉示例",
    "line": "原创图形与版式比较"
  },
  {
    "id": "dsh",
    "name": "工作台示例",
    "line": "离线功能与交互演示"
  },
  {
    "id": "life",
    "name": "待办示例",
    "line": "待确认事项，只保留本页"
  }
];
var COLS = [
  { id: 'new', name: '新建' },
  { id: 'doing', name: '进行中' },
  { id: 'stuck', name: '卡住' },
  { id: 'fail', name: '失败' },
  { id: 'done', name: '完成' }
];
var BOT_SRC = [
  {
    "id": "chief",
    "role": "chief",
    "owns": [
      "schedule",
      "memory",
      "ledger",
      "permissions",
      "connections"
    ],
    "avatarSrc": "",
    "faces": {
      "normal": "",
      "thinking": "",
      "thinkingAnim": "",
      "done": "",
      "confused": ""
    },
    "color": "#F6CC48",
    "colorInk": "#1c1b22",
    "colorStrong": "#805c00",
    "avatarPath": "M23 62C12 43 20 24 37 24C39 7 60 7 68 22C91 17 105 35 98 54C114 77 97 99 77 95C58 111 33 101 34 88C21 88 17 74 23 62Z",
    "name": "总管",
    "duty": "梳理待办、核对资料、协调转派",
    "status": "online",
    "unread": 2
  },
  {
    "id": "writer",
    "avatarSrc": "",
    "color": "#F49080",
    "colorInk": "#1c1b22",
    "colorStrong": "#9c3028",
    "avatarPath": "M23 46C12 35 15 18 27 16C37 14 43 25 46 30C59 25 71 27 77 32C85 17 101 21 101 34C102 43 98 48 95 51C110 71 99 94 79 97C61 108 37 100 31 90C10 84 10 59 23 46Z",
    "name": "写作助理",
    "duty": "整理来信与回复草稿",
    "status": "online",
    "unread": 1,
    "role": "assistant"
  },
  {
    "id": "content",
    "avatarSrc": "",
    "color": "#78B6F0",
    "colorInk": "#1c1b22",
    "colorStrong": "#225c96",
    "avatarPath": "M20 49C19 26 35 15 51 23C62 7 83 17 82 34C104 34 111 55 98 70C102 91 84 105 65 95C43 109 22 95 28 78C12 75 9 57 20 49Z",
    "name": "整理助理",
    "duty": "整理资料摘要与交付清单",
    "status": "busy",
    "unread": 1,
    "role": "assistant"
  },
  {
    "id": "pm",
    "owns": [
      "board",
      "devices"
    ],
    "avatarSrc": "",
    "color": "#73CFA9",
    "colorInk": "#1c1b22",
    "colorStrong": "#23684e",
    "avatarPath": "M29 24C37 11 55 15 61 22C80 10 98 25 94 43C110 54 108 74 92 81C91 101 70 108 56 96C37 105 17 92 23 75C9 61 14 40 29 38Z",
    "name": "协调助理",
    "duty": "跟进任务、验收与设备样例",
    "status": "online",
    "unread": 0,
    "role": "assistant"
  },
  {
    "id": "art",
    "avatarSrc": "",
    "color": "#F3A3C4",
    "colorInk": "#1c1b22",
    "colorStrong": "#92365e",
    "avatarPath": "M28 43C17 24 37 8 51 22C66 8 86 20 82 36C105 37 111 60 95 72C103 95 76 107 62 91C47 106 23 97 27 79C6 75 7 48 28 43Z",
    "name": "设计助理",
    "duty": "整理图形、配色与版式方案",
    "status": "away",
    "unread": 1,
    "role": "assistant"
  },
  {
    "id": "research",
    "avatarSrc": "",
    "color": "#BCA6F2",
    "colorInk": "#1c1b22",
    "colorStrong": "#624391",
    "avatarPath": "M22 49C14 29 32 14 50 23C66 6 87 16 87 35C109 38 112 62 96 73C99 95 76 105 61 94C42 109 20 94 25 79C8 76 7 55 22 49Z",
    "name": "调研助理",
    "duty": "核对公开资料、比较候选与来源",
    "status": "online",
    "unread": 0,
    "role": "assistant"
  }
];
var STATUS_WORD = { online: '在线', busy: '忙', away: '离开', active:'在线', paused:'已暂停' };
var DRAFT_ORIGINAL = "ご担当者様\n\n資料の確認依頼をありがとうございます。\n土曜日の午後に内容を確認します。開始時刻と参加人数をお知らせください。\n現時点では予定は確定していません。確認後に改めてご案内いたします。\n\nサンプル窓口";
var DRAFT_EXPLANATION = "示例联系人咨询周六下午的资料交流。草稿请对方补充具体时间和人数；安排待确认，尚未发送。";

var DECISION_SRC = [
  {
    "id": "d-draft",
    "kind": "草稿",
    "title": "资料交流回复草稿",
    "bot": "writer",
    "project": "workspace",
    "level": "L3",
    "summary": "请对方补充开始时间和参加人数。尚未发送。",
    "status": "pending",
    "jp": "ご担当者様\n\n資料の確認依頼をありがとうございます。\n土曜日の午後に内容を確認します。開始時刻と参加人数をお知らせください。\n現時点では予定は確定していません。確認後に改めてご案内いたします。\n\nサンプル窓口",
    "zh": "示例联系人咨询周六下午的资料交流。草稿请对方补充具体时间和人数；安排待确认，尚未发送。",
    "checks": [
      {
        "label": "日期",
        "value": "周六下午 · 具体日期待确认"
      },
      {
        "label": "时间",
        "value": "待对方补充"
      },
      {
        "label": "人数",
        "value": "待对方补充"
      }
    ]
  },
  {
    "id": "d-publish",
    "kind": "审批",
    "title": "示例交付清单",
    "bot": "content",
    "project": "ai",
    "level": "L3",
    "summary": "三项交付已备好；一项比例待修，整体等待确认。",
    "status": "pending",
    "action": "确认本页的三项示例交付",
    "params": [
      "文稿 A：19:30，摘要已核对",
      "短片 B：20:00，字幕已核对",
      "图示 C：20:10，版式已核对",
      "封面 D：比例待修，本次不交付",
      "只更新本页状态，不连接外部服务"
    ]
  },
  {
    "id": "d-handoff",
    "kind": "转派",
    "title": "资料回复交给写作助理",
    "bot": "chief",
    "project": "workspace",
    "level": "",
    "summary": "总管已转交资料交流的回复草稿；写作助理负责补齐待确认信息。",
    "status": "pending",
    "from": "chief",
    "to": "writer"
  },
  {
    "id": "d-log",
    "kind": "审批",
    "title": "看板验收回执",
    "bot": "pm",
    "project": "dsh",
    "level": "L3",
    "summary": "本页拖拽已检查，回执待确认。",
    "status": "pending",
    "action": "确认本页看板验收回执",
    "params": [
      "示例文件：工作台/验收说明.md",
      "只更新本页演示记录",
      "仍待人工检查移动端显示"
    ]
  }
];

var CARD_SRC = [
  {
    "id": "c1",
    "col": "new",
    "title": "整理资料回复提纲",
    "bot": "writer",
    "project": "workspace",
    "flag": "L1 本地",
    "time": "今天 09:10",
    "sub": "仅整理本页示例",
    "detail": "整理资料回复提纲。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c2",
    "col": "new",
    "title": "绘制八秒图形动效",
    "bot": "art",
    "project": "video",
    "flag": "L1 本地",
    "time": "今天 08:20",
    "sub": "仅整理本页示例",
    "detail": "绘制八秒图形动效。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c3",
    "col": "new",
    "title": "归类今天的待确认",
    "bot": "chief",
    "project": "life",
    "flag": "L0 读",
    "time": "今天 07:50",
    "sub": "仅整理本页示例",
    "detail": "归类今天的待确认。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c4",
    "col": "doing",
    "title": "资料交流回复草稿",
    "bot": "writer",
    "project": "workspace",
    "flag": "待拍板",
    "time": "今天 10:24",
    "sub": "草稿已备好，等待确认",
    "decision": "d-draft",
    "task": "task-note",
    "detail": "资料交流回复草稿。请先查看确认卡，确认后只更新本页状态。"
  },
  {
    "id": "c5",
    "col": "doing",
    "title": "对齐演示字幕时间轴",
    "bot": "content",
    "project": "ai",
    "flag": "L1 本地",
    "time": "今天 11:20",
    "sub": "仅整理本页示例",
    "detail": "对齐演示字幕时间轴。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c6",
    "col": "doing",
    "title": "原创图形封面三选一",
    "bot": "art",
    "project": "video",
    "flag": "L1 本地",
    "time": "今天 08:55",
    "sub": "仅整理本页示例",
    "task": "task-cover",
    "detail": "原创图形封面三选一。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c7",
    "col": "doing",
    "title": "验收看板拖拽",
    "bot": "pm",
    "project": "dsh",
    "flag": "L1 本地",
    "time": "今天 11:40",
    "sub": "草稿已备好，等待确认",
    "decision": "d-log",
    "task": "task-kanban",
    "detail": "验收看板拖拽。请先查看确认卡，确认后只更新本页状态。"
  },
  {
    "id": "c8",
    "col": "stuck",
    "title": "核对示例交付排期",
    "bot": "content",
    "project": "ai",
    "flag": "待拍板",
    "time": "今天 11:02",
    "sub": "草稿已备好，等待确认",
    "decision": "d-publish",
    "task": "task-news",
    "detail": "核对示例交付排期。请先查看确认卡，确认后只更新本页状态。"
  },
  {
    "id": "c9",
    "col": "stuck",
    "title": "核对一条过期说明",
    "bot": "research",
    "project": "life",
    "flag": "L0 读",
    "time": "今天 09:30",
    "sub": "仅整理本页示例",
    "detail": "核对一条过期说明。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c10",
    "col": "fail",
    "title": "修正演示封面比例",
    "bot": "content",
    "project": "ai",
    "flag": "L3 未发",
    "time": "今天 09:40",
    "sub": "保留失败与待核项",
    "task": "task-bili",
    "detail": "修正演示封面比例。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c11",
    "col": "fail",
    "title": "评估超出授权的请求",
    "bot": "pm",
    "project": "life",
    "flag": "L4 已拒绝",
    "time": "昨天 16:05",
    "sub": "保留失败与待核项",
    "detail": "评估超出授权的请求。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c12",
    "col": "done",
    "title": "核对交流时间空位",
    "bot": "writer",
    "project": "workspace",
    "flag": "L0 读",
    "time": "昨天 18:40",
    "sub": "本页示例已整理",
    "detail": "核对交流时间空位。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c13",
    "col": "done",
    "title": "整理样例交付回执",
    "bot": "content",
    "project": "ai",
    "flag": "L1 本地",
    "time": "今天 10:48",
    "sub": "本页示例已整理",
    "detail": "整理样例交付回执。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c14",
    "col": "done",
    "title": "补齐看板任务书",
    "bot": "pm",
    "project": "dsh",
    "flag": "L1 本地",
    "time": "昨天 21:10",
    "sub": "本页示例已整理",
    "detail": "补齐看板任务书。不连接外部服务；保留来源、未知项与下一步。"
  },
  {
    "id": "c15",
    "col": "done",
    "title": "候选方案比较一页",
    "bot": "research",
    "project": "dsh",
    "flag": "L0 读",
    "time": "昨天 18:12",
    "sub": "本页示例已整理",
    "task": "task-page",
    "detail": "候选方案比较一页。不连接外部服务；保留来源、未知项与下一步。"
  }
];

var DIFF = [
  { t: ' ', s: 'function drop(card, target) {' },
  { t: '-', s: "  shadow = '0 1px 2px #0002';" },
  { t: '-', s: "  transform = 'scale(1.04)';" },
  { t: '+', s: "  shadow = '0 14px 28px #5a3c1e29';" },
  { t: '+', s: "  transform = 'rotate(-1.2deg)';" },
  { t: ' ', s: '  move(card, target);' },
  { t: '+', s: '  card.updatedAt = now();' },
  { t: ' ', s: '}' }
];

var TASKS = [
  {
    "id": "task-kanban",
    "title": "验收看板交互",
    "bot": "pm",
    "project": "dsh",
    "card": "c7",
    "pill": "进行中",
    "who": "协调助理负责本页示例",
    "tokens": "演示估算：输入 500 · 输出 100 · 耗时待核",
    "gate": "d-log",
    "plan": [
      [
        1,
        "核对示例范围与原始资料"
      ],
      [
        1,
        "整理候选及待确认信息"
      ],
      [
        1,
        "检查关联卡片与交付内容"
      ],
      [
        1,
        "复核小屏显示与交互"
      ],
      [
        0,
        "等待人工确认"
      ]
    ],
    "tools": [
      {
        "kind": "读文件",
        "name": "示例资料.md",
        "meta": "8 ms",
        "body": "示例内容已整理；来源与未知项分别保留。仅本页有效。"
      },
      {
        "kind": "跑命令",
        "name": "本页检查记录",
        "meta": "退出码 0 · 40 ms",
        "body": "示例内容已整理；来源与未知项分别保留。仅本页有效。"
      },
      {
        "kind": "改文件",
        "name": "示例版式.css",
        "meta": "+3 −2",
        "diff": true
      }
    ]
  },
  {
    "id": "task-note",
    "title": "整理资料交流回复",
    "bot": "writer",
    "project": "workspace",
    "card": "c4",
    "pill": "等待审批",
    "who": "写作助理负责本页示例",
    "tokens": "演示估算：输入 500 · 输出 100 · 耗时待核",
    "gate": "d-draft",
    "plan": [
      [
        1,
        "核对示例范围与原始资料"
      ],
      [
        1,
        "整理候选及待确认信息"
      ],
      [
        0,
        "检查关联卡片与交付内容"
      ]
    ],
    "tools": [
      {
        "kind": "读文件",
        "name": "示例资料.md",
        "meta": "6 ms",
        "body": "示例内容已整理；来源与未知项分别保留。仅本页有效。"
      }
    ]
  },
  {
    "id": "task-news",
    "title": "核对示例交付清单",
    "bot": "content",
    "project": "ai",
    "card": "c8",
    "pill": "等待审批",
    "who": "整理助理负责本页示例",
    "tokens": "演示估算：输入 500 · 输出 100 · 耗时待核",
    "gate": "d-publish",
    "plan": [
      [
        1,
        "核对示例范围与原始资料"
      ],
      [
        1,
        "整理候选及待确认信息"
      ],
      [
        0,
        "检查关联卡片与交付内容"
      ],
      [
        0,
        "复核小屏显示与交互"
      ]
    ],
    "tools": [
      {
        "kind": "读文件",
        "name": "示例资料.md",
        "meta": "5 ms",
        "body": "示例内容已整理；来源与未知项分别保留。仅本页有效。"
      }
    ]
  },
  {
    "id": "task-cover",
    "title": "比较原创图形版式",
    "bot": "art",
    "project": "video",
    "card": "c6",
    "pill": "进行中",
    "who": "设计助理负责本页示例",
    "tokens": "演示估算：输入 500 · 输出 100 · 耗时待核",
    "plan": [
      [
        1,
        "核对示例范围与原始资料"
      ],
      [
        1,
        "整理候选及待确认信息"
      ],
      [
        0,
        "检查关联卡片与交付内容"
      ],
      [
        0,
        "复核小屏显示与交互"
      ]
    ],
    "tools": [
      {
        "kind": "读文件",
        "name": "示例资料.md",
        "meta": "4 ms",
        "body": "示例内容已整理；来源与未知项分别保留。仅本页有效。"
      }
    ]
  },
  {
    "id": "task-page",
    "title": "整理候选比较一页",
    "bot": "research",
    "project": "dsh",
    "card": "c15",
    "pill": "完成",
    "who": "调研助理负责本页示例",
    "tokens": "演示估算：输入 500 · 输出 100 · 耗时待核",
    "plan": [
      [
        1,
        "核对示例范围与原始资料"
      ],
      [
        1,
        "整理候选及待确认信息"
      ],
      [
        1,
        "检查关联卡片与交付内容"
      ],
      [
        1,
        "复核小屏显示与交互"
      ]
    ],
    "tools": [
      {
        "kind": "读文件",
        "name": "示例资料.md",
        "meta": "3 ms",
        "body": "示例内容已整理；来源与未知项分别保留。仅本页有效。"
      }
    ]
  },
  {
    "id": "task-bili",
    "title": "修正示例封面比例",
    "bot": "content",
    "project": "ai",
    "card": "c10",
    "pill": "失败",
    "who": "整理助理负责本页示例",
    "tokens": "演示估算：输入 500 · 输出 100 · 耗时待核",
    "plan": [
      [
        1,
        "核对示例范围与原始资料"
      ],
      [
        0,
        "整理候选及待确认信息"
      ],
      [
        0,
        "检查关联卡片与交付内容"
      ]
    ],
    "tools": [
      {
        "kind": "跑命令",
        "name": "示例资料.md",
        "meta": "退出码 1",
        "body": "示例内容已整理；来源与未知项分别保留。仅本页有效。"
      }
    ]
  }
];

var FILES = {
  "receipt": {
    "name": "示例交付回执.md",
    "size": "18 KB",
    "body": "示例交付清单\n\n文稿 A：已整理\n短片 B：已核对字幕\n图示 C：已核对版式\n封面 D：比例待修\n\n待人工确认；本页没有外发或上传。"
  }
};

var THREAD_SRC = {
  "chief": [
    {
      "role": "user",
      "time": "10:02",
      "text": "请整理示例资料，列出需要我确认的事项。"
    },
    {
      "role": "bot",
      "time": "10:03",
      "text": "资料回复与示例交付等待确认。你确认后只更新本页状态。"
    },
    {
      "role": "bot",
      "time": "10:03",
      "card": {
        "type": "handoff",
        "id": "d-handoff"
      }
    },
    {
      "role": "bot",
      "time": "10:04",
      "card": {
        "type": "draft",
        "id": "d-draft"
      }
    },
    {
      "role": "bot",
      "time": "10:05",
      "card": {
        "type": "approve",
        "id": "d-publish"
      }
    },
    {
      "role": "bot",
      "time": "10:06",
      "card": {
        "type": "file",
        "file": "receipt"
      }
    }
  ],
  "writer": [
    {
      "role": "user",
      "time": "10:08",
      "text": "请整理示例资料，列出需要我确认的事项。"
    },
    {
      "role": "bot",
      "time": "10:09",
      "text": "交流资料的回复草稿已备好。你确认后只更新本页状态。"
    },
    {
      "role": "bot",
      "time": "10:09",
      "card": {
        "type": "draft",
        "id": "d-draft"
      }
    },
    {
      "role": "bot",
      "time": "10:18",
      "text": "交流资料的回复草稿已备好。仅本页演示，保留待核项。"
    }
  ],
  "content": [
    {
      "role": "bot",
      "time": "09:40",
      "text": "示例交付清单已整理，仍有待核项。你确认后只更新本页状态。"
    },
    {
      "role": "bot",
      "time": "11:02",
      "card": {
        "type": "approve",
        "id": "d-publish"
      }
    },
    {
      "role": "bot",
      "time": "10:50",
      "card": {
        "type": "file",
        "file": "receipt"
      }
    }
  ],
  "pm": [
    {
      "role": "bot",
      "time": "11:36",
      "text": "任务已分阶段，等你核对验收。你确认后只更新本页状态。"
    },
    {
      "role": "bot",
      "time": "11:36",
      "card": {
        "type": "approve",
        "id": "d-log"
      }
    },
    {
      "role": "bot",
      "time": "11:37",
      "text": "任务已分阶段，等你核对验收。仅本页演示，保留待核项。"
    }
  ],
  "art": [
    {
      "role": "bot",
      "time": "08:55",
      "text": "三份原创图形方案，先看版式。你确认后只更新本页状态。"
    }
  ],
  "research": [
    {
      "role": "bot",
      "time": "昨天 18:12",
      "text": "比较整理成一页，来源缺口单列。你确认后只更新本页状态。"
    }
  ]
};

var LINES = {
  "chief": {
    "开心": "资料回复与示例交付等待确认。",
    "思考": "先核对来源，再列下一步。",
    "抱歉": "还有待核项，暂时保留草稿。"
  },
  "writer": {
    "开心": "交流资料的回复草稿已备好。",
    "思考": "先核对来源，再列下一步。",
    "抱歉": "还有待核项，暂时保留草稿。"
  },
  "content": {
    "开心": "示例交付清单已整理，仍有待核项。",
    "思考": "先核对来源，再列下一步。",
    "抱歉": "还有待核项，暂时保留草稿。"
  },
  "pm": {
    "开心": "任务已分阶段，等你核对验收。",
    "思考": "先核对来源，再列下一步。",
    "抱歉": "还有待核项，暂时保留草稿。"
  },
  "art": {
    "开心": "三份原创图形方案，先看版式。",
    "思考": "先核对来源，再列下一步。",
    "抱歉": "还有待核项，暂时保留草稿。"
  },
  "research": {
    "开心": "比较整理成一页，来源缺口单列。",
    "思考": "先核对来源，再列下一步。",
    "抱歉": "还有待核项，暂时保留草稿。"
  }
};


const MODEL_INFO={"示例模型甲":{provider:"示例模型池",context:256,level:['轻量','标准','深入']},"示例模型乙":{provider:"模型乙 · 云端",context:256,level:['标准','深入']},"示例本地模型":{provider:'本地执行手 · 未接 DSH',context:128,level:['标准']}};
const SHORT={
  "chief": "梳理待办、核对资料、协调转派",
  "writer": "整理来信与回复草稿",
  "content": "整理资料摘要与交付清单",
  "pm": "跟进任务、验收与设备样例",
  "art": "整理图形、配色与版式方案",
  "research": "核对公开资料、比较候选与来源"
};
const PREV={
  "chief": "资料回复与示例交付等待确认。",
  "writer": "交流资料的回复草稿已备好。",
  "content": "示例交付清单已整理，仍有待核项。",
  "pm": "任务已分阶段，等你核对验收。",
  "art": "三份原创图形方案，先看版式。",
  "research": "比较整理成一页，来源缺口单列。"
};
const COLORS=Object.fromEntries(BOT_SRC.map(b=>[b.id,b.color]));
const PATHS=Object.fromEntries(BOT_SRC.map(b=>[b.id,b.avatarPath]));
var USAGE_ROWS = [['5 小时窗口','38%',"演示点数 12 / 演示点数 12",'今天 21:30 重置',38,''],['最近 7 天','62%',"演示点数 12 / 演示点数 12",'11 月 16 日 09:00 重置',62,'clay'],['本月费用','22%',"演示点数 12 / 演示点数 12",'12 月 1 日预算重置',22,'pink']];

var STEWARD_SRC = [
  ['board-steward','看板管家','看板进度、提交与他人移动通知','#f6b85d','#85501d','先拖卡，点提交后我再整理变更。',['看看未提交的移动','谁移动了看板','整理卡住的任务']],
  ['ledger-steward','账本管家','token 账本、额度阈值与模型预算','#92d8ed','#306477','7 天窗口已到 62%，到 80% 时再问你要不要换便宜模型。',['看看 token 账本','提醒我额度阈值','要不要换便宜模型']],
  ['memory-steward','记忆管家','我记得什么、待确认、改与忘记','#c5d97c','#526323','记忆先给你看，确认后再改。',['你记得我什么','哪些还等我确认','忘记一条记忆']],
  ['safety-steward','安全管家','权限、加固、备份与回滚','#f6a9ce','#873a66','权限和备份只展示演示状态，真实执行仍等授权。',['看看权限边界','检查加固状态','查看备份与回滚']],
  ['machine-steward','机器管家','几台电脑、本地模型与派工状态','#91b5ed','#385487',"设备甲、设备丙和设备乙的连接状态待核。",['看看几台电脑','本地模型能做什么','查看可派工人']],
  ['schedule-steward','日程管家','定时与例行','#f5cf86','#79501c','演示：例行任务还没有登记到系统。',['看看例行安排','今天哪些到时间了','暂停一条例行']],
  ['connect-steward','连接管家','通道、订阅工具与插件','#a4ded0','#286457','演示：连接清单已整理，尚未连接任何服务。',['看看可用连接','哪些订阅待接入','核对插件权限']]
];
var STEWARD_SHAPES = [
    'M21 58C10 40 26 20 42 24C48 6 72 12 76 29C100 23 112 48 98 64C111 88 89 103 72 94C54 110 29 100 31 85C15 84 11 69 21 58Z',
    'M24 40C20 17 46 10 58 24C78 9 100 27 92 44C113 54 105 82 88 84C82 107 56 107 46 93C24 101 9 77 24 61C13 52 16 44 24 40Z',
    'M20 52C9 31 31 17 46 27C56 7 81 13 84 33C107 30 115 57 99 69C105 91 81 104 65 94C44 110 21 93 28 77C14 75 12 60 20 52Z',
    'M26 40C11 21 38 9 52 24C69 7 94 19 89 40C113 43 110 71 94 80C94 103 67 108 55 94C35 106 15 90 23 72C9 61 13 44 26 40Z',
    'M24 45C12 25 36 12 52 24C69 8 91 19 86 38C110 37 114 64 97 76C100 99 75 106 61 93C43 108 20 95 26 77C8 73 10 53 24 45Z'
  ];

BOT_SRC.forEach(function(b){
  b.brain=b.brain||(b.id==='art'?"示例模型乙":"示例模型甲");
  b.workers=b.workers||"示例模型丙 / Terra、示例执行器乙、示例执行器〔待确认条款〕、示例本地模型";
  b.quickReplies=b.quickReplies||({chief:['整理今天的待办',"核对 资料简报交接",'哪些要我拍板'],writer:["看看交流草稿",'整理待回复咨询','核对接待规则'],content:['核对发布排期','整理平台回执','哪些还等批准'],pm:['查看阶段验收','整理卡住的任务','核对交付证据'],art:['看看封面三稿','核对角色一致性','查看可用订阅工具'],research:['先给一页结论','列出证据缺口','比较两个方向']})[b.id];
});

var SUB_BOT_SRC = [
  [
    "writer-line",
    "writer",
    "回复整理",
    "整理资料回复草稿",
    "回复整理"
  ],
  [
    "writer-sns",
    "writer",
    "文案核对",
    "核对示例文案与原始资料",
    "文案核对"
  ],
  [
    "content-daily",
    "content",
    "资料摘录",
    "整理示例摘要与来源",
    "资料摘录"
  ],
  [
    "art-doubao",
    "art",
    "版式比较",
    "比较原创图形的版式",
    "版式比较"
  ],
  [
    "art-gemini",
    "art",
    "镜头整理",
    "整理示例镜头的意图与连续性",
    "镜头整理"
  ]
];
var FIXED_TASK_SEED_TIMES = ['07:40','10:12','09:25','08:35','07:50'];
var FIXED_TASK_SRC = SUB_BOT_SRC.map(function(row,i){
  var time=FIXED_TASK_SEED_TIMES[i],date=new Date(),parts=time.split(':');date.setHours(Number(parts[0]),Number(parts[1]),0,0);
  return {taskId:row[0],ownerAssistantId:row[1],taskName:row[4],note:row[3],conversation:row[0]+'-013',status:'active',updatedAt:date.getTime(),seedMessage:{time:'今天 '+time,ts:date.getTime(),parts:[{type:'text',md:'任务说明：'+row[3]+'。仅本页演示，尚未执行或外发。'}]}};
});
BOT_SRC.forEach(b=>{b.parent=null;});
var PENDING_INPUT_SRC = [
  {id:'demo-connect-secret',bot:'connect-steward',what:'演示工具的私密凭据',forWhat:'演示工具连接',blocking:'连接演示尚未开始',since:Date.now()-7200000,cardData:{destination:'演示专用位置',provider:'演示服务',masked:'末四位 ••••'}},
  {id:'demo-line-secret',bot:"writer-line",what:'演示通道的私密输入',forWhat:"消息通道 回复草稿预演",blocking:'通道演示待输入',since:Date.now()-86400000,cardData:{destination:'演示专用位置',provider:'演示通道',masked:'末四位 ••••'}},
  {id:'demo-machine-secret',bot:'machine-steward',what:'演示设备的校验输入',forWhat:'设备连接预演',blocking:'演示体检等候',since:Date.now()-1800000,cardData:{destination:'演示专用位置',provider:'演示设备',masked:'末四位 ••••'}}
];

BOT_SRC.forEach(function(b){
  b.outfitId='daily';
  b.outfits=[{id:'daily',name:'日常',kind:'image',avatarSrc:'',license:'原创 SVG 占位',starred:false,color:b.color,accessory:'',emotionMap:{开心:'smile',思考:'think',抱歉:'sorry',惊讶:'surprise',挥手:'wave'}}];
  if(['chief',"writer"].includes(b.id))b.outfits.push({id:'festival',name:'星光',kind:'live2d',avatarSrc:'',license:'原创 SVG 占位',starred:false,color:b.id==='chief'?'#b39af4':'#55cda5',accessory:'star',emotionMap:{开心:'smile',思考:'think',抱歉:'sorry',惊讶:'surprise',挥手:'wave'}});
  LINES[b.id]['惊讶']='发现一处新变化，我先给你看。';
  LINES[b.id]['挥手']='在这里，随时可以接着聊。';
});

var FEATURE_PAGES = [
  {id:'board',title:'看板',source:'board-steward',view:'kanban'},
  {id:'schedule',title:'日程',source:'schedule-steward',panel:'schedule'},
  {id:'memory',title:'记忆',source:'memory-steward',panel:'memory'},
  {id:'ledger',title:'账本',source:'ledger-steward',view:'ledger'},
  {id:'permissions',title:'权限',source:'safety-steward',panel:'permission'},
  {id:'devices',title:'设备',source:'machine-steward',panel:'tools'},
  {id:'connections',title:'连接',source:'connect-steward',panel:'tools'}
];
BOT_SRC.forEach(function(b,i){
  b.homeLabel=({chief:'总调度 · 知识库',writer:'咨询 · 预约'})[b.id]||SHORT[b.id];
  var messages=THREAD_SRC[b.id]||[],time=messages[messages.length-1]?.time||'',match=time.match(/(\d{1,2}):(\d{2})/),date=new Date();
  if(match){date.setHours(Number(match[1]),Number(match[2]),0,0);if(time.includes('昨天'))date.setDate(date.getDate()-1);b.updatedAt=date.getTime();}
  else b.updatedAt=Date.now()-i*60000;
});

var LEGACY_FEATURE_IDS = Object.fromEntries(FEATURE_PAGES.map(p=>[p.source,p.id]));
var FEATURE_ALIASES = {safety:'permissions',connect:'connections'};
var FEATURE_SEEDS = Object.fromEntries(FEATURE_PAGES.map(p=>{
  var row=STEWARD_SRC.find(r=>r[0]===p.source);
  return [p.id,{summary:row[5],phrases:row[6].slice(),history:[{time:'原始样例',question:row[6][0],text:row[5]}]}];
}));
var FIXED_TASK_MEMORY = {
  "writer-line": "整理这个固定任务的示例资料；先核来源与范围，再给草稿。确认前不外发。",
  "writer-sns": "整理这个固定任务的示例资料；先核来源与范围，再给草稿。确认前不外发。",
  "content-daily": "整理这个固定任务的示例资料；先核来源与范围，再给草稿。确认前不外发。",
  "art-doubao": "整理这个固定任务的示例资料；先核来源与范围，再给草稿。确认前不外发。",
  "art-gemini": "整理这个固定任务的示例资料；先核来源与范围，再给草稿。确认前不外发。"
};

var ASSISTANT_COPY = {
  description:'管：职责所列的资料与草稿。不管：未授权的外发、付款和生产变更。',
  phrases:['看看你负责什么','整理一份草稿','哪些需要我确认'],
  newName:'专项助理',newDuty:'整理指定主题的资料与草稿',excluded:'未授权的外发、付款与生产变更',
  createPrompt:'帮我建一个管指定主题的助理'
};
var ASSISTANT_COLORS=['#F6CC48','#F49080','#78B6F0','#73CFA9','#F3A3C4','#BCA6F2','#B6D7A8','#F6B26B','#9CD8DB','#D5ACD6','#C9BDAB','#A9C4EF'];
var ASSISTANT_SHAPES=STEWARD_SHAPES.map((path,i)=>({id:'soft-'+(i+1),name:['云团','软星','团叶','花团','小丘'][i],path})).concat([
 {id:'soft-6',name:'圆豆',path:'M24 44C24 21 45 12 65 17C88 14 105 33 101 55C110 80 91 103 67 100C43 108 18 94 19 72C12 60 14 51 24 44Z'},
 {id:'soft-7',name:'软心',path:'M60 29C43 7 16 22 17 45C10 66 38 96 60 104C82 96 110 66 103 45C104 22 77 7 60 29Z'},
 {id:'soft-8',name:'圆花',path:'M43 22C49 7 70 7 77 23C95 16 109 34 100 50C117 62 109 83 92 85C91 105 70 111 59 97C45 111 24 102 25 84C6 81 3 59 20 49C10 31 25 16 43 22Z'}
]);
var ASSISTANT_PROFILE_DEFAULTS={
  "chief": {
    "avatar": {
      "kind": "shape",
      "shapeId": "soft-1",
      "color": "#F6CC48"
    },
    "description": "管：梳理待办、核对资料、协调转派。超出范围的事项先请用户确认。",
    "quickReplies": [
      "整理示例资料",
      "核对待确认事项",
      "列出下一步"
    ]
  },
  "writer": {
    "avatar": {
      "kind": "shape",
      "shapeId": "soft-1",
      "color": "#F6CC48"
    },
    "description": "管：整理来信与回复草稿。超出范围的事项先请用户确认。",
    "quickReplies": [
      "整理示例资料",
      "核对待确认事项",
      "列出下一步"
    ]
  },
  "content": {
    "avatar": {
      "kind": "shape",
      "shapeId": "soft-1",
      "color": "#F6CC48"
    },
    "description": "管：整理资料摘要与交付清单。超出范围的事项先请用户确认。",
    "quickReplies": [
      "整理示例资料",
      "核对待确认事项",
      "列出下一步"
    ]
  },
  "pm": {
    "avatar": {
      "kind": "shape",
      "shapeId": "soft-1",
      "color": "#F6CC48"
    },
    "description": "管：跟进任务、验收与设备样例。超出范围的事项先请用户确认。",
    "quickReplies": [
      "整理示例资料",
      "核对待确认事项",
      "列出下一步"
    ]
  },
  "art": {
    "avatar": {
      "kind": "shape",
      "shapeId": "soft-1",
      "color": "#F6CC48"
    },
    "description": "管：整理图形、配色与版式方案。超出范围的事项先请用户确认。",
    "quickReplies": [
      "整理示例资料",
      "核对待确认事项",
      "列出下一步"
    ]
  },
  "research": {
    "avatar": {
      "kind": "shape",
      "shapeId": "soft-1",
      "color": "#F6CC48"
    },
    "description": "管：核对公开资料、比较候选与来源。超出范围的事项先请用户确认。",
    "quickReplies": [
      "整理示例资料",
      "核对待确认事项",
      "列出下一步"
    ]
  }
};
BOT_SRC.forEach(b=>Object.assign(b,{initialAssistant:true,enabled:true,profileRevision:0},ASSISTANT_PROFILE_DEFAULTS[b.id]));

FILES.receipt.ownerBot='content';

var DEMO_KIND="generic";
var DEMO_MEDIA={enabled:false};
var DEMO_FIXTURES={
  "core.LEVELS.1": {
    "L0": {
      "label": "只读自动",
      "explain": "只读取资料和状态，自动完成。"
    },
    "L1": {
      "label": "本地写并通知",
      "explain": "在本地写入可回滚内容，完成后通知 用户。"
    },
    "L2": {
      "label": "双工",
      "explain": "低风险先自动回复，同时在后台问 用户。"
    },
    "L3": {
      "label": "强制审批",
      "explain": "停下来等 用户 明确批准，批准后才能执行。"
    },
    "L4": {
      "label": "直接拒绝",
      "explain": "直接拒绝这项动作，不可放权。"
    }
  },
  "core.sample.32": {
    "mode": "chat",
    "fullMode": false,
    "detail": false,
    "collapsed": false,
    "theme": "system",
    "skin": "island",
    "model": "示例模型甲",
    "strength": "标准",
    "permission": "L1 · 本地可回滚",
    "plan": false,
    "context": 86,
    "contextMax": 256,
    "search": "",
    "panelSearch": "",
    "boardView": "columns",
    "voice": false,
    "playing": null,
    "running": false,
    "queue": [],
    "sendMode": "queue",
    "attachments": [],
    "subtitles": true,
    "thoughts": false,
    "actor": true,
    "actorX": 0,
    "actorY": 0,
    "zoom": 1,
    "action": "待命",
    "usageBy": "bot",
    "usageDay": 13,
    "settingsTab": "bot",
    "workflow": "角色母版 · 轻量预览",
    "lora": "v3 · 待选择",
    "jobPaused": false,
    "stageAccepted": {},
    "sessionNames": {
      "chief": "今日协调",
      "writer": "周六交流",
      "content": "晚间发布",
      "pm": "方向 B 验收",
      "art": "封面三稿",
      "research": "竞品一页"
    },
    "archives": [],
    "nextBot": {},
    "scheduleOn": true,
    "paired": false,
    "cua": false
  },
  "core.r22StageAlphaBounds.33": {},
  "core.r22StageBodies.34": {},
  "core.r22StageActionScale.35": {},
  "core.limits.36": {
    "drowsy": 180000,
    "sleep": 300000,
    "idleMin": 6000,
    "idleMax": 10000,
    "chatMin": 8000,
    "chatMax": 14000
  },
  "core.sample.39": {
    "timeout": 1000
  },
  "core.debug.45": {
    "drowsy": 180000,
    "sleep": 300000,
    "idleMin": 6000,
    "idleMax": 10000,
    "chatMin": 8000,
    "chatMax": 14000
  },
  "core.main.46": {
    "chief": "M17 51L14 25 34 36 47 12 62 34 84 20 89 50C105 79 87 108 57 108S9 85 17 51Z",
    "writer": "M20 45 20 14 44 30Q60 24 76 30L100 14 100 47C114 83 93 108 60 108S7 83 20 45Z",
    "content": "M14 40Q14 18 38 18H82Q106 18 106 42V75Q106 97 80 97H52L27 110 31 94Q14 90 14 72Z",
    "pm": "M25 25H95Q107 25 107 39V94Q107 108 93 108H27Q13 108 13 94V39Q13 25 25 25ZM43 14H77V35H43Z",
    "art": "M60 12C29 12 10 34 10 63S32 109 60 109Q77 108 74 94C71 84 80 80 92 80 119 79 114 48 98 30Q83 12 60 12Z",
    "research": "M92 85 111 103Q116 110 107 114L84 94A43 43 0 1 1 92 85ZM84 55A29 29 0 1 0 26 55 29 29 0 1 0 84 55Z"
  },
  "core.bodyBounds.47": {
    "chief": [
      12.5,
      10.5,
      83.97245788574219,
      99
    ],
    "writer": [
      14.490665435791016,
      12.5,
      91.41429901123047,
      97
    ],
    "content": [
      12.5,
      16.5,
      95,
      95
    ],
    "pm": [
      11.5,
      12.5,
      97,
      97
    ],
    "art": [
      8.5,
      10.5,
      104.12718200683594,
      100
    ],
    "research": [
      11.677999496459961,
      16.713777542114258,
      102.60771179199219,
      98.78622436523438
    ]
  },
  "core.sample.52": [
    "最近 30 天",
    "24%",
    "演示点数 12 / 演示点数 12",
    "滚动窗口 · 次日 09:00 更新",
    24,
    ""
  ],
  "core.bot.60": [
    [
      "总管",
      "示例模型甲",
      "86,240"
    ],
    [
      "写作助理",
      "示例模型甲",
      "7,400"
    ],
    [
      "整理助理",
      "示例模型乙",
      "12,840"
    ],
    [
      "协调助理",
      "执行器甲 · 样例记录",
      "55,730"
    ],
    [
      "本地执行手",
      "示例模型 · 未接入",
      "未知"
    ]
  ],
  "core.model.61": [
    [
      "示例模型甲",
      "示例模型池",
      "93,640"
    ],
    [
      "示例模型乙",
      "云端",
      "12,840"
    ],
    [
      "执行器甲",
      "样例回执",
      "55,730"
    ],
    [
      "示例本地模型",
      "未接 DSH",
      "未知"
    ]
  ],
  "core.sample.63": [
    [
      "昨日归档会话",
      "示例模型甲",
      "12,480"
    ]
  ],
  "core.sample.74": [
    [
      "示例模型池",
      "本机套餐可用记录 · 本页未连接"
    ],
    [
      "模型乙 / 执行器甲",
      "CLI 入口预留 · 接入状态待核"
    ],
    [
      "模型丙 / 模型丁",
      "统一入口调研中 · 未连接"
    ],
    [
      "OpenAI 图像",
      "生图默认通路 · 未连接"
    ],
    [
      "示例本地模型",
      "既有服务记录 · 未接 DSH"
    ],
    [
      "ASR / TTS",
      "ASR 隔离试用 · DSH 未接"
    ]
  ],
  "core.sample.77": [
    [
      "quota-watch / cost-meter",
      "用量位置已保留"
    ],
    [
      "官方 CUA bundle",
      "禁用"
    ],
    [
      "图形工具 工作台",
      "候选 · 未安装"
    ],
    [
      "图形 / TTS",
      "仅调研"
    ],
    [
      "梅花棋 / 模型丁生图插件",
      "不采用"
    ]
  ],
  "core.sample.81": [
    "角色母版 · 轻量预览",
    "场景气氛 · 构图核对",
    "图形角色 · LoRA 对比"
  ],
  "core.sample.86": [
    [
      "执行器甲",
      "看板手感验收",
      "完成 · 55,730 token"
    ],
    [
      "示例本地模型",
      "视觉执行手",
      "未接 DSH · 未运行"
    ],
    [
      "整理助理",
      "字幕时间轴",
      "进行中 · 后台任务"
    ],
    [
      "写作助理",
      "交流日文草稿",
      "等人工批准"
    ]
  ],
  "core.sample.89": [
    [
      "receipt",
      "2026-11-13-资料简报-晚间回执.md"
    ],
    [
      "code",
      "看板/拖拽手感.css"
    ],
    [
      "pdf",
      "交付/接待流程.pdf"
    ],
    [
      "office",
      "交付/晚间排期.xlsx"
    ],
    [
      "image",
      "封面/角色对照.svg"
    ]
  ],
  "core.sample.98": {
    "duration": 120
  },
  "core.sample.99": {
    "duration": 120
  },
  "core.sample.100": {
    "duration": 600,
    "easing": "ease-in-out"
  },
  "core.a.101": {
    "duration": 280,
    "easing": "cubic-bezier(.3,1.6,.5,1)"
  },
  "core.sample.102": {
    "duration": 120
  },
  "core.sample.103": {
    "duration": 120
  },
  "core.sample.104": {
    "duration": 120
  },
  "core.sample.128": {
    "block": "nearest",
    "inline": "nearest"
  },
  "core.sample.129": {
    "block": "nearest",
    "inline": "nearest"
  },
  "core.Hub.131": {
    "block": "center",
    "inline": "nearest",
    "behavior": "instant"
  },
  "core.Hub.132": {
    "id": "recent",
    "title": "最近任务摘要",
    "source": "本页演示 · 私有切片",
    "tokens": 900
  },
  "core.Hub.133": {
    "chief": true,
    "writer": true
  },
  "assistants.sample.3": {
    "maxlength": 16
  },
  "views.stage.sample.2": [
    "live2d",
    "vrm"
  ],
  "views.stage.sample.6": {
    "image": "图片",
    "gif": "GIF",
    "live2d": "图形 · 未加载引擎",
    "vrm": "图形 · 未加载引擎"
  },
  "automation.featureDemo.1": {
    "clock": "2026-11-13T12:00:00+09:00",
    "timezone": "JST",
    "offsetHours": 9,
    "checkedAt": "2026-11-13 11:58 JST",
    "targetMachine": 1,
    "deviceChanges": [
      {
        "machine": 4,
        "time": "2026-11-13 11:58 JST",
        "before": "待检查",
        "after": "离线",
        "evidence": "离线样本；服务连接未建立，指标保持未知。"
      },
      {
        "machine": 2,
        "time": "2026-11-13 11:55 JST",
        "before": "队列空闲",
        "after": "2 项等待",
        "evidence": "本地队列样本；未查询进程或模型端点。"
      },
      {
        "machine": 0,
        "time": "2026-11-13 11:50 JST",
        "before": "待整理",
        "after": "服务清单已整理",
        "evidence": "语音桥仍待核；列出服务不代表已连接。"
      }
    ]
  },
  "automation.state.2": {
    "group": "今天",
    "tab": "今天",
    "calendar": false,
    "script": true,
    "model": "示例模型",
    "query": "",
    "taskFilter": "all",
    "runner": true,
    "checked": {},
    "ticketNotes": {},
    "dispatchText": "目标：核对 DSH 看板的状态映射与移动端交互。\n工作目录：/demo/dsh\n读写范围：仅模块演示数据\n验收：列出证据、未知项与下一步\n禁止：外发、部署、删除、付费调用",
    "dispatchModels": [
      "示例模型丙",
      "示例模型丁",
      "示例模型乙",
      "示例模型甲",
      "Sonnet"
    ],
    "dispatchRound": 1,
    "selectedRoute": "",
    "dispatchChecks": {},
    "dispatch": [],
    "decisions": {},
    "nightSeen": {},
    "brief": "晨会",
    "briefSeen": {},
    "treeOpen": {},
    "jobFilter": "全部",
    "modelChecks": 0,
    "flowStep": 1,
    "duplexEnabled": true,
    "template": "客服回复",
    "templateStep": {},
    "templateAdded": {},
    "fileMode": "项目",
    "fileFilter": "全部",
    "fileSeen": {},
    "filePinned": {},
    "dnd": true,
    "dndStart": "22:00",
    "dndEnd": "08:00",
    "notifyRules": {},
    "scheduleForm": null,
    "scheduleSaved": "",
    "terminal": {},
    "queue": [
      {
        "id": "q1",
        "title": "DSH 回执摘要",
        "model": "示例模型",
        "status": "运行中",
        "tokens": 740
      },
      {
        "id": "q2",
        "title": "示例客服中日对稿",
        "model": "示例模型",
        "status": "排队",
        "tokens": 1260
      },
      {
        "id": "q3",
        "title": "资料简报标题归类",
        "model": "示例工作器",
        "status": "排队",
        "tokens": 580
      }
    ]
  },
  "automation.schedules.3": [
    {
      "id": "s1",
      "name": "晨会简报",
      "time": "08:30",
      "repeat": "每天",
      "start": "2026-11-01",
      "days": [
        0,
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "bot": "chief",
      "conversation": "chief-013",
      "paused": false,
      "origin": "主动今日简报",
      "count": "3 条焦点 / 2 件待决策"
    },
    {
      "id": "s2",
      "name": "资料简报四平台交接",
      "time": "19:30",
      "repeat": "工作日",
      "start": "2026-11-01",
      "days": [
        1,
        2,
        3,
        4,
        5
      ],
      "bot": "content",
      "conversation": "content-013",
      "paused": false,
      "origin": "资料简报四平台交接",
      "count": "4 个平台 / 1 个封面待核"
    },
    {
      "id": "s3",
      "name": "知识库晚间整理",
      "time": "20:00",
      "repeat": "每天",
      "start": "2026-11-01",
      "days": [
        0,
        1,
        2,
        3,
        4,
        5,
        6
      ],
      "bot": "research",
      "conversation": "research-013",
      "paused": false,
      "origin": "知识库定时整理",
      "count": "每轮上限 80 件 / 20 分钟"
    },
    {
      "id": "s4",
      "name": "记忆质量抽样巡检",
      "time": "09:15",
      "repeat": "每周",
      "start": "2026-11-01",
      "days": [
        1,
        3,
        5
      ],
      "bot": "research",
      "conversation": "research-013",
      "paused": true,
      "origin": "LanceDB 记忆巡检",
      "count": "范围 3 类／记忆抽样 5 条"
    }
  ],
  "automation.runHistory.4": [
    {
      "id": "demo-run-03",
      "schedule": "s3",
      "time": "11/12 20:00",
      "status": "完成",
      "summary": "整理 26 件，待核 4 件",
      "evidence": "证据：知识整理摘要（演示）；处理量 26 / 80；用时 8 分 12 秒；未投递知识库。",
      "unknowns": "待核 4 件缺原始来源；不晋升为长期知识。"
    },
    {
      "id": "demo-run-02",
      "schedule": "s2",
      "time": "11/12 19:30",
      "status": "待审核",
      "summary": "四平台交接包已汇总",
      "evidence": "证据：四平台交接清单（演示）；媒体通道 / 短讯通道 / 通道 草稿；发布通道封面退回。",
      "unknowns": "公开回执未知，需人工核查，未提交发布。"
    },
    {
      "id": "demo-run-01",
      "schedule": "s1",
      "time": "11/12 08:30",
      "status": "完成",
      "summary": "进行中 2 / 待看 1 / 待办 1",
      "evidence": "证据：晨会简报（演示）；本页模拟总管的晨会投递结果。",
      "unknowns": "无真实消息；数据年龄 1 天。"
    }
  ],
  "automation.jobs.16": [
    {
      "id": "j1",
      "name": "DSH 样张审查",
      "model": "示例模型丙",
      "status": "运行中",
      "progress": 62,
      "elapsed": "2 分 14 秒",
      "children": [
        {
          "id": "j11",
          "name": "交互核验",
          "model": "示例模型丁",
          "status": "运行中",
          "progress": 75,
          "children": [
            {
              "id": "j111",
              "name": "手机宽度边界",
              "model": "示例本地模型",
              "status": "完成",
              "progress": 100,
              "children": []
            }
          ]
        },
        {
          "id": "j12",
          "name": "回执逐字核对",
          "model": "示例模型乙",
          "status": "排队",
          "progress": 0,
          "children": []
        },
        {
          "id": "j13",
          "name": "任务书格式整理",
          "model": "示例模型甲",
          "status": "完成",
          "progress": 100,
          "children": []
        }
      ]
    },
    {
      "id": "j2",
      "name": "资料简报交接包",
      "model": "示例模型甲",
      "status": "排队",
      "progress": 0,
      "elapsed": "尚未开始",
      "children": [
        {
          "id": "j21",
          "name": "四平台素材清点",
          "model": "示例模型甲",
          "status": "排队",
          "progress": 0,
          "children": []
        },
        {
          "id": "j22",
          "name": "标题角度归并",
          "model": "示例模型乙",
          "status": "排队",
          "progress": 0,
          "children": []
        },
        {
          "id": "j23",
          "name": "封面比例核对",
          "model": "示例模型丙",
          "status": "排队",
          "progress": 0,
          "children": []
        }
      ]
    },
    {
      "id": "j3",
      "name": "昨夜任务整理",
      "model": "示例本地模型",
      "status": "完成",
      "progress": 100,
      "elapsed": "4 分 08 秒",
      "children": [
        {
          "id": "j31",
          "name": "读取任务切片",
          "model": "示例本地模型",
          "status": "完成",
          "progress": 100,
          "children": []
        },
        {
          "id": "j32",
          "name": "标出来源年龄",
          "model": "示例本地模型",
          "status": "完成",
          "progress": 100,
          "children": []
        },
        {
          "id": "j33",
          "name": "汇总待拍板事项",
          "model": "示例模型乙",
          "status": "完成",
          "progress": 100,
          "children": []
        }
      ]
    }
  ],
  "automation.machines.17": [
    {
      "id": "设备丙",
      "online": true,
      "cpu": 22,
      "memory": 48,
      "gpu": 32,
      "owner": "语音联调候选",
      "path": "/demo/voice",
      "writer": "执行器甲",
      "services": [
        "assistant-ui :示例端点 · 运行",
        "voice-bridge :示例端点 · 待核",
        "health :示例端点 · 运行"
      ]
    },
    {
      "id": "设备甲",
      "online": true,
      "cpu": 18,
      "memory": 55,
      "gpu": 26,
      "owner": "DSH 源码正本",
      "path": "/demo/dsh",
      "writer": "当前模块执行者",
      "services": [
        "dsh-preview :示例端点 · 运行",
        "opencode :示例端点 · 空闲",
        "ticket-runner :示例端点 · 演示"
      ]
    },
    {
      "id": "设备丁",
      "online": true,
      "cpu": 36,
      "memory": 62,
      "gpu": 71,
      "owner": "本地模型运行正本",
      "path": "/demo/models",
      "writer": "本地执行手",
      "services": [
        "示例模型 :示例端点 · 常驻",
        "示例工作器 :示例端点 · 备用",
        "model-queue :示例端点 · 2 等待"
      ]
    },
    {
      "id": "设备戊",
      "online": true,
      "cpu": 12,
      "memory": 45,
      "gpu": 19,
      "owner": "工作组配置正本",
      "path": "/demo/fleet",
      "writer": "工作组维护者",
      "services": [
        "agent-fleet :示例端点 · 运行",
        "kb-curator :示例端点 · 空闲",
        "receipt-index :示例端点 · 运行"
      ]
    },
    {
      "id": "设备乙",
      "online": false,
      "cpu": null,
      "memory": null,
      "gpu": null,
      "owner": "内容渠道 工作席",
      "path": "/demo/sns-ops",
      "writer": "内容渠道 执行者",
      "services": [
        "内容渠道 harness · 离线",
        "Chrome 工作席 · 未连接",
        "回执导出 · 未连接"
      ]
    }
  ],
  "automation.templates.18": [
    {
      "name": "客服回复",
      "origin": "示例销售与客服规则 / 示例 客服 Wiki",
      "bot": "writer",
      "steps": [
        "分类 → 场景 → 问题",
        "查日文回复与中文辅助",
        "核对渠道权限与对象",
        "起草后交店方审核"
      ],
      "output": "reply-draft.md · 客户日文原文／给 用户 的中文说明",
      "limits": "不代替店方确认价格、预留或接待安排。"
    },
    {
      "name": "资料简报日更",
      "origin": "示例内容看板 / 资料简报四平台交接",
      "bot": "content",
      "steps": [
        "资讯池 15 条 → 人选题",
        "标题角度 10 个 → 深研",
        "人的判断 → 发布包",
        "逐平台草稿与公开回执分开"
      ],
      "output": "platform-handoff.md · 候选／已选／已发布／已退回",
      "limits": "提交未知先只读回查；公开发布另行授权。"
    },
    {
      "name": "视频出片",
      "origin": "用户-video-maker v3/v4",
      "bot": "art",
      "steps": [
        "脚本与时长确认",
        "分批图片人工审核",
        "配音 → 渲染",
        "横竖版交付与验片"
      ],
      "output": "delivery-manifest.md · 分阶段产物与审核状态",
      "limits": "付费生成、发布均单独授权；本页不生成媒体。"
    },
    {
      "name": "周策划",
      "origin": "项目总管「今天」",
      "bot": "chief",
      "steps": [
        "需要你 → 焦点",
        "昨夜 → 状态 → 来源年龄",
        "候选事项与默认建议",
        "人工拍板 → 追加决策回执"
      ],
      "output": "weekly-plan.md · 唯一写者 / 下一步 / 禁止项",
      "limits": "计划、技术完成与 用户 采纳分别记录。"
    }
  ],
  "automation.botTemplates.19": [
    {
      "id": "automation-template-flights",
      "name": "盯机票",
      "duty": "整理演示航线与价格变化，只提醒，不订票。",
      "accent": "research",
      "colorName": "调研紫",
      "icon": "search",
      "brain": "示例模型甲",
      "workers": [
        "模型乙 命令行 · 资料核对"
      ],
      "tools": [
        "航线清单（演示）",
        "价格记录（演示）"
      ]
    },
    {
      "id": "automation-template-bookkeeping",
      "name": "记账",
      "duty": "归类演示账目，标出缺凭证的项目，不付款。",
      "accent": "pm",
      "colorName": "项目薄荷",
      "icon": "file",
      "brain": "示例本地模型",
      "workers": [
        "执行器甲 · 表格核对"
      ],
      "tools": [
        "账目草稿（演示）",
        "分类清单（演示）"
      ]
    },
    {
      "id": "automation-template-papers",
      "name": "读论文",
      "duty": "读演示论文，整理论点、证据与尚未核验的问题。",
      "accent": "research",
      "colorName": "调研紫",
      "icon": "file",
      "brain": "示例模型甲",
      "workers": [
        "模型乙 命令行 · 引文核对"
      ],
      "tools": [
        "论文摘录（演示）",
        "阅读笔记（演示）"
      ]
    },
    {
      "id": "automation-template-anime",
      "name": "追番更新",
      "duty": "整理演示追番清单，按计划提醒更新，不购买订阅。",
      "accent": "art",
      "colorName": "艺术粉",
      "icon": "clock",
      "brain": "示例本地模型",
      "workers": [
        "执行器甲 · 排期整理"
      ],
      "tools": [
        "追番清单（演示）",
        "更新日历（演示）"
      ]
    },
    {
      "id": "automation-template-line",
      "name": "写作 消息通道 回复员",
      "duty": "为写作主号（演示）整理来信与回复草稿，发送前交人确认。",
      "accent": "writer",
      "colorName": "写作珊瑚",
      "icon": "chat",
      "brain": "示例模型甲",
      "workers": [
        "模型乙 命令行 · 中日对稿"
      ],
      "tools": [
        "来信摘要（演示）",
        "回复草稿（演示）"
      ]
    },
    {
      "id": "automation-template-ai-daily",
      "name": "每日 资料简报",
      "duty": "整理演示资讯的来源、日期与选题，输出草稿，不发布。",
      "accent": "content",
      "colorName": "内容蓝",
      "icon": "chat",
      "brain": "示例模型甲",
      "workers": [
        "执行器甲 · 来源清单核对",
        "模型乙 命令行 · 文字整理"
      ],
      "tools": [
        "资讯清单（演示）",
        "简报草稿（演示）"
      ]
    }
  ],
  "automation.sample.20": {
    "taskId": "task-kanban",
    "rounds": [
      {
        "round": 1,
        "workers": [
          {
            "id": "automation-r1-interaction",
            "name": "交互核验工人（临时）",
            "model": "示例模型丁",
            "status": "done",
            "elapsed": "55 秒",
            "tokens": 2800,
            "receipt": "结论：快捷键冲突需捕获处理。\n证据：演示按键记录。\n未知：真实浏览器与手机尚未核验。\n下一步：补改后交第二轮复核。"
          },
          {
            "id": "automation-r1-wording",
            "name": "文字核对工人（临时）",
            "model": "示例模型甲",
            "status": "done",
            "elapsed": "28 秒",
            "tokens": 1800,
            "receipt": "结论：任务书格式齐全，文案需要标明演示。\n证据：演示文案清单。\n未知：未评价布局与触控体验。\n下一步：与交互回执合并待办。"
          }
        ]
      },
      {
        "round": 2,
        "workers": [
          {
            "id": "automation-r2-review",
            "name": "增量复核工人（临时）",
            "model": "示例模型丙",
            "status": "done",
            "elapsed": "42 秒",
            "tokens": 2300,
            "receipt": "结论：模拟按键冲突已消除；不代表用户验收。\n证据：演示复核记录。\n未知：真实手机仍未核验。\n下一步：人工体验白天与晚上两种外观。"
          },
          {
            "id": "automation-r2-receipt",
            "name": "回执核对工人（临时）",
            "model": "示例模型乙",
            "status": "failed",
            "elapsed": "36 秒",
            "tokens": null,
            "receipt": "结论：演示中回执中断，未得出复核结论。\n证据：仅有中断状态，没有完整回执。\n未知：token 未回报，不记为零。\n下一步：协调助理决定是否继续；当前未重试。"
          }
        ]
      }
    ]
  },
  "automation.sample.21": {
    "task": "核对演示交付清单，缺证据时交回老师（本页演示，未真实执行）",
    "teacher": {
      "model": "云端大脑 · 执行器甲",
      "steps": [
        {
          "name": "规划范围与验收清单",
          "tokens": 900,
          "ms": 16000
        },
        {
          "name": "接回失败：时间码缺失，补充核对方法",
          "tokens": 520,
          "ms": 9000
        },
        {
          "name": "复核学生回执，留待人工验收",
          "tokens": 380,
          "ms": 7000
        }
      ]
    },
    "student": {
      "model": "示例本地模型",
      "steps": [
        {
          "name": "按清单整理文件名",
          "tokens": 360,
          "ms": 6000
        },
        {
          "name": "核对时间码失败，停止并交回老师",
          "tokens": 260,
          "ms": 5000
        },
        {
          "name": "按补充方法重核，提交演示证据",
          "tokens": 180,
          "ms": 4000
        }
      ]
    },
    "baseline": {
      "tokens": 6000,
      "ms": 90000
    },
    "saved": {
      "tokens": 3400,
      "ms": 43000
    },
    "handbacks": [
      {
        "step": "核对时间码",
        "reason": "学生的清单缺少时间码，不能证明段落连续。",
        "result": "老师补充逐段核对方法 → 学生重核 → 老师复核；尚未获得人工验收。"
      }
    ]
  },
  "automation.files.27": [
    {
      "id": "f1",
      "name": "DSH 样张验收.md",
      "project": "工作台示例",
      "bot": "pm",
      "size": "4.2 KB",
      "time": "11/13 11:40",
      "status": "待验收",
      "origin": "codex-worker",
      "text": "目标：核对五列状态映射。\n证据：方向 B 样张验收卡；演示验收清单 3 项。\n未知：真实移动端与生产路径尚未核验。\n下一步：人工体验后追加回执。"
    },
    {
      "id": "f2",
      "name": "资料简报四平台交接.md",
      "project": "资料简报",
      "bot": "content",
      "size": "6.8 KB",
      "time": "11/13 10:48",
      "status": "草稿",
      "origin": "资料简报四平台交接",
      "text": "媒体通道：字幕时间轴待看；未上传。\n短讯通道：本地 21 秒版交付示例；未发布。\n发布通道：封面比例退回；不重复提交。\n通道：文案草稿待审核；公开回执未知。"
    },
    {
      "id": "f3",
      "name": "示例客服草稿.md",
      "project": "示例",
      "bot": "writer",
      "size": "2.1 KB",
      "time": "11/13 10:24",
      "status": "待店方审核",
      "origin": "示例 客服 Wiki",
      "text": "场景：周六交流咨询。\n日文：資料確認について、店舗で確認のうえご案内いたします。\n中文：由店方确认后说明交流安排。\n权限：仅草稿，不预留图形、不确认到店时间。"
    },
    {
      "id": "f4",
      "name": "横竖版交付清单.md",
      "project": "视频",
      "bot": "art",
      "size": "3.6 KB",
      "time": "11/12 21:15",
      "status": "待验片",
      "origin": "用户-video-maker v3/v4",
      "text": "横版：1920×1080，演示登记。\n竖版：1080×1920，演示登记。\n配音：待核角色与字幕。\n媒体：未挂载；清单存在不等于成片完成。"
    },
    {
      "id": "f5",
      "name": "今日日报来源.md",
      "project": "个人事务",
      "bot": "chief",
      "size": "1.9 KB",
      "time": "11/13 08:30",
      "status": "示例",
      "origin": "项目总管「今天」",
      "text": "需要你：3 件。\n焦点：完成 DSH 可点样张。\n昨夜：汇总交接草稿，未外发。\n来源年龄：11/12 快照，运行现状未知。"
    },
    {
      "id": "f6",
      "name": "记忆抽样回执.md",
      "project": "工作台示例",
      "bot": "research",
      "size": "2.4 KB",
      "time": "11/12 20:00",
      "status": "待核",
      "origin": "LanceDB 记忆巡检",
      "text": "范围：项目／助理／共享规则。\n记忆抽样：5 条中 4 条有来源。\n问题：1 条缺原话，不晋升长期知识。\n下一步：补证据，当前未连接真实记忆库。"
    }
  ],
  "automation.duplex.28": [
    {
      "id": "du1",
      "time": "11:42",
      "title": "DSH 标题归类",
      "answer": "先答：已按项目归好 3 条标题。",
      "result": "本地整理完成，通知待阅",
      "seen": false
    },
    {
      "id": "du2",
      "time": "10:26",
      "title": "示例客服语料检索",
      "answer": "先答：找到 3 条相近问题，回复仍是草稿。",
      "result": "证据待店方审核",
      "seen": false
    },
    {
      "id": "du3",
      "time": "09:08",
      "title": "资料简报交接摘要",
      "answer": "先答：已标出 发布通道封面问题与下一步。",
      "result": "已读，发布仍待拍板",
      "seen": true
    }
  ],
  "automation.notifications.29": [
    {
      "id": "n1",
      "title": "发布通道封面比例待处理",
      "type": "阻塞",
      "time": "11:02",
      "seen": false,
      "detail": "只保留本页待处理项，未重发。"
    },
    {
      "id": "n2",
      "title": "媒体通道 / 通道 发布包待拍板",
      "type": "待拍板",
      "time": "10:48",
      "seen": false,
      "detail": "提交、公开与本地交付状态分开。"
    },
    {
      "id": "n3",
      "title": "DSH 方向 B 回执可查看",
      "type": "完成",
      "time": "10:30",
      "seen": true,
      "detail": "技术完成为演示，用户 尚未确认。"
    }
  ],
  "automation.sample.30": {
    "workspace": "示例项目",
    "ai": "资料简报",
    "video": "做视频",
    "dsh": "工作台示例",
    "life": "个人事务"
  },
  "automation.decisions.41": [
    [
      "d1",
      "资料简报发布包",
      "默认：保留草稿；发布通道封面退回，媒体通道 / 通道 待批。"
    ],
    [
      "d2",
      "示例交流回复",
      "默认：交店方核时间；日文只做草稿，不预留图形。"
    ],
    [
      "d3",
      "DSH 样张方向 B",
      "默认：先看移动端与回执，再决定是否采用。"
    ]
  ],
  "automation.night.42": [
    [
      "night1",
      "02:14 · DSH 任务书整理",
      "目标 / 读写范围 / 验收 / 禁止项齐全；未调用 CLI。"
    ],
    [
      "night2",
      "03:08 · 四平台素材清点",
      "4 个平台分开记录；发布通道封面问题仍阻塞。"
    ],
    [
      "night3",
      "06:20 · 来源年龄核对",
      "3 条旧快照需回正本核实；未改知识库。"
    ]
  ],
  "automation.sample.43": [
    "空闲：当前无新增执行任务。",
    "待看：历史来源仍需回正本核实。",
    "待办：下次 19:30 查看四平台交接。"
  ],
  "automation.sample.44": [
    "进行中：DSH 验收回执尚待人工查看。",
    "待看：资料简报 发布通道封面阻塞，其他平台仍是草稿。",
    "待办：明日先确认交流接待安排。"
  ],
  "automation.sample.45": [
    "进行中：方向 B 样张验收。",
    "待看：示例日文回复草稿。",
    "待办：资料简报四平台交接。"
  ],
  "automation.sample.46": {
    "name": "",
    "time": "09:00",
    "repeat": "工作日",
    "start": "2026-11-14",
    "days": [
      1,
      3,
      5
    ],
    "bot": "chief"
  },
  "automation.sample.49": [
    "chief",
    "content",
    "writer",
    "pm",
    "art",
    "research"
  ],
  "automation.specs.71": [
    [
      "示例模型丙",
      42,
      2300,
      "交互完整；补来源年龄即可",
      "done"
    ],
    [
      "示例模型丁",
      55,
      2800,
      "发现快捷键冲突；建议捕获处理",
      "done"
    ],
    [
      "示例模型乙",
      36,
      2100,
      "文案与状态口径一致；待人工复核",
      "done"
    ],
    [
      "示例模型甲",
      28,
      1800,
      "任务书格式齐全；未做视觉判断",
      "done"
    ],
    [
      "Sonnet",
      49,
      2500,
      "回执缺少手机证据；尚不能验收",
      "blocked"
    ]
  ],
  "automation.modelNames.72": [
    "示例模型丙",
    "示例模型丁",
    "示例模型乙",
    "示例模型甲",
    "Sonnet"
  ],
  "automation.steps.97": [
    [
      "云端导师 · 拆解目标",
      "示例模型乙 / 示例模型丁 · 输出范围、风险和验收清单。"
    ],
    [
      "本地执行手 · 照任务书执行",
      "示例模型 / 示例模型甲 · 只做可回滚、受限目录内工作。"
    ],
    [
      "结构化回执 · 提交证据",
      "状态、证据、未知项与下一步，四项分别记录。"
    ],
    [
      "云端复核 · 对照目标",
      "进程成功与任务正确分开，缺证据则回到执行手。"
    ],
    [
      "人工验收 · 决定采纳",
      "用户 采纳另记；本页走到末步也只是演示。"
    ]
  ],
  "automation.sample.108": [
    [
      "项目总管「今天」",
      "需要你 / 焦点 / 昨夜 / 状态 / 来源年龄",
      "项目总管「今天」"
    ],
    [
      "示例客服来源线索",
      "写作 · 分类→场景→问题 · 日文回复与中文辅助",
      "示例 客服 Wiki"
    ],
    [
      "资料简报选题状态",
      "候选／已选／已发布／已退回 · 四平台",
      "示例内容看板"
    ]
  ],
  "automation.phrases.119": [
    "看看派工回执",
    "下一轮交给 示例模型甲",
    "恢复五路派工候选"
  ],
  "automation.act.120": [
    "示例模型甲"
  ],
  "automation.act.121": [
    "示例模型丙",
    "示例模型丁",
    "示例模型乙",
    "示例模型甲",
    "Sonnet"
  ],
  "automation.phrases.123": [
    "看看本地模型队列",
    "本轮候选改为 示例工作器",
    "本轮候选改回 示例模型"
  ],
  "cards-a.s.6": {
    "x": 0,
    "y": 0,
    "width": 360,
    "height": 180,
    "rx": 16,
    "fill": "var(--elev-2)"
  },
  "cards-a.s.9": {
    "d": "M280 0 Q210 80 298 180",
    "fill": "none",
    "stroke": "var(--sky)",
    "stroke-width": 22
  },
  "cards-a.s.11": {
    "cx": 48,
    "cy": 146,
    "r": 8,
    "fill": "var(--ink)"
  },
  "cards-a.s.12": {
    "cx": 245,
    "cy": 28,
    "r": 8,
    "fill": "var(--bot-strong)"
  },
  "cards-a.s.13": {
    "x": 15,
    "y": 174,
    "fill": "var(--ink-2)",
    "font-size": 12
  },
  "cards-a.s.14": {
    "x": 252,
    "y": 52,
    "fill": "var(--ink-2)",
    "font-size": 12
  },
  "cards-a.links.16": {
    "restaurant": {
      "target": "cards-a-chief",
      "label": "继续看总管的一日事务 →"
    },
    "reminder": {
      "target": "cards-a-research",
      "label": "回调研助理看商品与出行比较 →"
    }
  },
  "cards-a.products.18": [
    {
      "name": "可替换便签纸板",
      "price": 1680,
      "shop": "示例城市文具示例店",
      "badge": "预算友好",
      "kind": "board",
      "desc": "双面可用 · 45 × 24 cm"
    },
    {
      "name": "圆形桌面收纳盒",
      "price": 4280,
      "shop": "示例文具示例商店",
      "badge": "休息与磨爪",
      "kind": "bowl",
      "desc": "直径 42 cm · 可替换内芯"
    },
    {
      "name": "双层木质文件架",
      "price": 12800,
      "shop": "示例木作示例工房",
      "badge": "空间利用",
      "kind": "tower",
      "desc": "高 90 cm · 需自行组装"
    }
  ],
  "cards-a.flights.21": [
    {
      "id": "FL-DEMO-101",
      "tag": "最佳",
      "start": "09:20",
      "end": "10:45",
      "duration": "1 小时 25 分",
      "price": 14200,
      "desc": "含 1 件随身行李 · 托运另核"
    },
    {
      "id": "FL-DEMO-202",
      "tag": "最快",
      "start": "11:00",
      "end": "12:10",
      "duration": "1 小时 10 分",
      "price": 18600,
      "desc": "含 1 件随身行李 · 变更规则待核"
    },
    {
      "id": "FL-DEMO-303",
      "tag": "晚间",
      "start": "18:30",
      "end": "20:00",
      "duration": "1 小时 30 分",
      "price": 15100,
      "desc": "无托运行李 · 退改规则待核"
    },
    {
      "id": "FL-DEMO-404",
      "tag": "早班",
      "start": "07:10",
      "end": "08:35",
      "duration": "1 小时 25 分",
      "price": 16200,
      "desc": "行李与退改规则待核"
    }
  ],
  "cards-a.sample.28": {
    "title": "示例片区甲河畔酒店（虚构）",
    "area": "示例城市 · 示例片区甲",
    "price": 11800,
    "score": "4.6",
    "desc": "安静双床房 · 步行到地铁约 6 分钟"
  },
  "cards-a.sample.29": {
    "title": "小庭日和食堂（虚构）",
    "area": "示例城市 · 示例片区乙",
    "price": 1800,
    "score": "4.5",
    "desc": "日式定食 · 有素食选项，需与店家核实"
  },
  "cards-a.sample.34": {
    "title": "示例 · 交流前准备",
    "date": "2026-11-14",
    "time": "14:00–14:30",
    "place": "示例城市 · 写作接待区（示意）",
    "person": "交流协作 A（虚构）"
  },
  "cards-a.sample.38": {
    "title": "前往示例 · 交流路线",
    "address": "示例城市市内 · 示意目的地；无真实门牌"
  },
  "cards-a.sample.41": {
    "title": "示例城市 · 明日天气",
    "date": "11 月 14 日 · 模拟预报"
  },
  "cards-a.sample.44": [
    "09:00",
    "12:00",
    "15:00",
    "18:00"
  ],
  "cards-a.shipmentSteps.46": [
    {
      "title": "订单已登记",
      "time": "11/12 10:20",
      "body": "虚构用品订单 · 演示店铺"
    },
    {
      "title": "包裹已揽收",
      "time": "11/12 17:40",
      "body": "示例物流 · 示例城市集配点"
    },
    {
      "title": "运输中",
      "time": "11/13 08:10",
      "body": "已到示例分拨点"
    },
    {
      "title": "派送中",
      "time": "待发生",
      "body": "预计 11/14；非送达承诺"
    },
    {
      "title": "已签收",
      "time": "待发生",
      "body": "等待收货核对"
    }
  ],
  "cards-a.sample.48": {
    "title": "写作耗材 · 演示订单",
    "number": "ORDER-DEMO-001",
    "amount": 3360
  },
  "cards-a.sample.54": {
    "title": "写作耗材 · 包裹进度",
    "number": "SHIP-DEMO-001"
  },
  "cards-a.sample.61": {
    "title": "交流安排 · 邮件草稿",
    "to": "交流协作 A · 邮箱未提供",
    "from": "写作助理 · 发件身份占位",
    "subject": "示例への資料確認について（確認用）",
    "body": "お問い合わせありがとうございます。\n資料確認のご希望を承りました。\n11月14日 14:00 のご案内が可能か、担当者が確認のうえ改めてご連絡いたします。\n資料について気になることがございましたら、お知らせください。\n\n示例（デモ用草稿）"
  },
  "cards-a.sample.62": {
    "title": "消息通道 · 交流回复草稿",
    "to": "交流协作 A（虚构）",
    "from": "示例 · 演示客服",
    "subject": "交流时间待店方确认",
    "body": "お問い合わせありがとうございます。\nご希望のお時間を担当者に確認いたします。\n確定後に改めてご案内いたしますので、少々お待ちください。\n\n中文辅助：已收到意向，待店方核实时间；尚未确认预约。"
  },
  "cards-a.sample.66": {
    "title": "交流协作 A（虚构）",
    "email": "邮箱未提供 · 演示对象标签",
    "stage": "咨询中",
    "language": "日语",
    "owner": "写作助理"
  },
  "cards-a.sample.70": {
    "name": "示例交流前准备",
    "owner": "写作助理",
    "date": "2026-11-14",
    "memo": "整理图形档案与接待区",
    "submitted": false,
    "error": ""
  },
  "cards-a.form.71": {
    "required": true,
    "maxLength": 80
  },
  "cards-a.form.72": [
    "写作助理",
    "总管",
    "用户（演示）"
  ],
  "cards-a.form.73": {
    "maxLength": 240
  },
  "cards-a.sample.75": {
    "title": "资料简报 · 下一期先看什么？",
    "options": [
      "本地模型与 示例模型 体验",
      "示例模型甲 工作流",
      "DSH 卡片改造"
    ],
    "counts": [
      4,
      3,
      2
    ]
  },
  "cards-a.sample.76": {
    "maxLength": 200
  },
  "cards-a.sample.78": {
    "title": "复核 资料简报四平台草稿",
    "text": "确认成片、封面与平台文案；仍需逐平台授权。"
  },
  "cards-a.sample.79": {
    "when": "30 分钟后",
    "custom": "2026-11-14T09:00",
    "set": false,
    "error": ""
  },
  "cards-a.chosen.80": [
    "30 分钟后",
    "2 小时后",
    "明天 09:00",
    "自选时间"
  ],
  "cards-a.preferences.81": {
    "usageProbe": 38,
    "sevenDay": 62,
    "threshold": 80,
    "detailed": false,
    "snapshotAt": "2026-11-17 22:00 JST"
  },
  "cards-a.receipt.82": {
    "title": "派工回执 · 虚构样本",
    "worker": "示例执行器甲（示例）",
    "model": "示例模型丙（示例）",
    "elapsed": "3.2 秒",
    "tokens": 2460,
    "input": 1840,
    "output": 620,
    "summary": "已整理 3 条待办（虚构结果，未执行任务）"
  },
  "cards-a.sample.83": {
    "title": "用量提醒 · 演示快照",
    "threshold": 80
  },
  "cards-a.sample.96": {
    "channel": "消息通道成员 · 演示"
  },
  "cards-a.sample.98": [
    "操作身份",
    "写作测试成员（演示），主账号不碰"
  ],
  "cards-a.permissions.108": [
    "L0 · 只读自动",
    "L1 · 本地写并通知",
    "L2 · 双工：低风险先自动回复、同时后台问 用户",
    "L3 · 强制审批",
    "L4 · 直接拒绝"
  ],
  "cards-a.workers.110": [
    "示例执行器甲（演示）"
  ],
  "cards-a.sample.111": {
    "maxLength": 40,
    "aria-label": "新 bot 名字"
  },
  "cards-a.sample.113": {
    "id": "cards-a-private-bot",
    "title": "私密输入与新 bot",
    "messages": [
      {
        "from": "user",
        "time": "演示",
        "parts": [
          {
            "type": "text",
            "md": "我要一个专门盯机票的 bot，也演示一下私密输入怎么安全放置。"
          }
        ]
      },
      {
        "from": "chief",
        "time": "演示",
        "parts": [
          {
            "type": "text",
            "md": "演示，未真实执行。先看私密输入；请只粘贴演示占位文字，内容不会写入消息。"
          },
          {
            "type": "cards-a-secret-input",
            "data": {
              "bot": "chief",
              "what": "机票比价服务密钥（演示）",
              "forWhat": "机票比价",
              "destination": "机票观察员的私密配置位（演示）",
              "provider": "机票信息服务商（演示）",
              "masked": "末四位 ••••"
            }
          }
        ]
      },
      {
        "from": "chief",
        "time": "演示",
        "parts": [
          {
            "type": "text",
            "md": "演示，未真实执行。这是独立 bot 草案，默认 L0；确认只创建本页角色，之后点「去聊天」。"
          },
          {
            "type": "cards-a-bot-draft",
            "data": {
              "name": "机票观察员（演示）",
              "duty": "比较公开机票信息，整理候选，不购票",
              "brain": "示例模型甲（演示）",
              "tools": [
                "公开信息只读检索（演示）"
              ],
              "workers": [
                "示例执行器甲（演示）"
              ],
              "permission": "L0"
            }
          }
        ]
      },
      {
        "from": "chief",
        "time": "演示",
        "parts": [
          {
            "type": "text",
            "md": "演示，未真实执行。也可以替写作助理创建常驻分 bot，确认后会缩进显示在主 bot 下面。"
          },
          {
            "type": "cards-a-bot-draft",
            "data": {
              "name": "交流整理员（演示）",
              "duty": "整理交流咨询草稿，发送前先问",
              "parent": "writer",
              "brain": "示例本地模型（演示）",
              "tools": [
                "草稿整理（演示）"
              ],
              "workers": [],
              "permission": "L0"
            }
          }
        ]
      }
    ]
  },
  "cards-a.sample.115": {
    "id": "cards-a-wechat",
    "title": "消息通道成员 · 卡片",
    "messages": [
      {
        "from": "user",
        "time": "演示",
        "parts": [
          {
            "type": "text",
            "md": "给我演示来信摘要、待发草稿，以及遇到验证码时怎么接管。"
          }
        ]
      },
      {
        "from": "writer",
        "time": "演示",
        "parts": [
          {
            "type": "text",
            "md": "演示，未真实执行。来信身份与会话均为虚构标签。"
          },
          {
            "type": "cards-a-wechat-digest",
            "data": {
              "sender": "交流访客（演示）",
              "conversation": "写作咨询群（演示）",
              "summary": "想了解交流前需要准备什么。",
              "suggestedReply": "先询问方便的时间，再整理交流说明草稿。"
            }
          }
        ]
      },
      {
        "from": "writer",
        "time": "演示",
        "parts": [
          {
            "type": "text",
            "md": "演示，未真实执行。先看完整草稿，批准后只展示真实键鼠发送流程的演示状态。"
          },
          {
            "type": "cards-a-wechat-draft",
            "data": {
              "bot": "writer",
              "conversation": "交流访客私聊（演示）",
              "draft": "您好，您方便哪天来了解资料呢？我们先确认时间，再和您说明交流前的准备。（演示草稿）"
            }
          }
        ]
      },
      {
        "from": "writer",
        "time": "演示",
        "parts": [
          {
            "type": "text",
            "md": "演示，未真实执行。遇到验证码立即停，交还后仍需复核，不会自动发送。"
          },
          {
            "type": "cards-a-takeover",
            "data": {
              "bot": "writer",
              "app": "消息通道",
              "tier": "red",
              "step": "消息通道发送前出现验证码",
              "reason": "验证码需要你亲自处理；已暂停",
              "screenLabel": "消息通道验证画面 · 离线占位",
              "state": "waiting"
            }
          }
        ]
      }
    ]
  },
  "cards-a.parts.122": {
    "type": "text",
    "md": "本页演示，未真实执行。以下营业时间为虚构样本；L2 低风险先自动回复，同时后台问 用户。"
  },
  "cards-a.parts.123": {
    "type": "cards-a-duplex",
    "data": {
      "bot": "writer",
      "level": "L2",
      "state": "auto-replied",
      "customer": "交流访客（演示）",
      "original": "営業時間を教えてください。",
      "reply": "お問い合わせありがとうございます。営業時間は10:00〜18:00です。資料確認は事前にお問い合わせください。（デモ）",
      "notice": "营业时间已自动回复（演示）；同时给 用户 后台追问，交流仍需确认。"
    }
  },
  "cards-a.draftData.132": {
    "channel": "消息通道 · 交流咨询（演示）"
  },
  "cards-a.messages.133": {
    "from": "writer",
    "time": "本页演示",
    "parts": [
      {
        "type": "text",
        "md": "本页演示，未真实执行。这条判为 L3，停下等批；批准、改稿或拒绝都只记录本页状态。"
      },
      {
        "type": "cards-a-duplex",
        "data": {
          "bot": "writer",
          "level": "L3",
          "state": "held",
          "customer": "另一位交流访客（演示）",
          "original": "資料確認の日程を変更できますか。価格についても相談したいです。",
          "reply": "日程の変更と価格について、担当者が確認いたします。確認後に改めてご案内いたします。",
          "notice": "改期与议价不自动答复；当前未发送，等待批准。"
        }
      }
    ]
  },
  "cards-a.parts.135": {
    "type": "text",
    "md": "本页演示，未真实执行。兼容展示：消息通道、邮件和消息草稿也能分别显示日文正文、中文说明和三条独立核对行。"
  },
  "cards-a.data.136": {
    "channel": "消息通道成员 · 演示",
    "conversation": "交流访客私聊（演示）"
  },
  "cards-a.chiefMessages.137": {
    "id": "cards-a-chief-intro",
    "from": "user",
    "time": "演示",
    "parts": [
      {
        "type": "text",
        "md": "把明天的写作准备和今天待确认的事排清楚，也让我试试几种交互。"
      }
    ]
  },
  "cards-a.researchMessages.138": {
    "id": "cards-a-research-intro",
    "from": "user",
    "time": "演示",
    "parts": [
      {
        "type": "text",
        "md": "给写作选点用品，再看看出差和附近吃住能怎样比较。"
      }
    ]
  },
  "cards-b.shapes.1": {
    "d": "M130 133 Q138 127 145 133 M175 133 Q183 127 190 133 M153 147 L166 147 L160 154 Z M160 154 L160 162 M139 160 L122 157 M180 160 L199 157",
    "fill": "none",
    "stroke": "var(--ink)",
    "stroke-width": 3,
    "stroke-linecap": "round"
  },
  "cards-b.shapes.2": {
    "d": "M77 156 L109 128 L139 142 L171 98 L207 115 L243 81",
    "fill": "none",
    "stroke": "var(--bot-strong)",
    "stroke-width": 5,
    "stroke-linecap": "round"
  },
  "cards-b.shapes.3": {
    "d": "M80 82 H134 M80 94 H115",
    "stroke": "var(--lemon)",
    "stroke-width": 5,
    "stroke-linecap": "round"
  },
  "cards-b.levels.4": {
    "page": "L0",
    "voice": "L0",
    "flow": "L0",
    "table": "L0",
    "chart": "L0",
    "images": "L0",
    "video": "L0",
    "sources": "L0",
    "link": "L0",
    "tree": "L0",
    "knowledge": "L0",
    "code": "L0",
    "diff": "L0",
    "terminal": "L0",
    "alert": "L0",
    "metrics": "L0",
    "checklist": "L1",
    "compare": "L1",
    "progress": "L1",
    "prompt": "L1",
    "dispatch-timeline": "L3",
    "checkup": "L0",
    "call-summary": "L1",
    "usage-alert": "L0",
    "capability-status": "L1",
    "dispatch-receipt": "L0",
    "teacher-student": "L0"
  },
  "cards-b.rows.16": [
    [
      "短讯通道",
      3,
      "待看预览"
    ],
    [
      "发布通道",
      2,
      "草稿"
    ],
    [
      "媒体通道",
      4,
      "待审"
    ],
    [
      "通道",
      1,
      "待审"
    ]
  ],
  "cards-b.sample.20": [
    [
      "柱",
      "bar"
    ],
    [
      "线",
      "line"
    ],
    [
      "环",
      "donut"
    ]
  ],
  "cards-b.options.21": [
    {
      "name": "示例模型甲",
      "good": "文字整理、照手册执行",
      "weak": "关键事实另核对"
    },
    {
      "name": "示例模型乙",
      "good": "观点碰撞、文字草稿",
      "weak": "当前连接未核验"
    },
    {
      "name": "示例模型丙 / Terra",
      "good": "源码实现与边界验证",
      "weak": "订阅额度需独立核验"
    }
  ],
  "cards-b.events.25": [
    {
      "time": "09:00",
      "title": "资讯进入候选池",
      "text": "保留来源和观察日期，未做立场判断。"
    },
    {
      "time": "10:15",
      "title": "人工选定题目",
      "text": "演示操作；真实选题仍需人的判断。"
    },
    {
      "time": "14:30",
      "title": "发布包待审",
      "text": "未获得外发授权，尚未发布。"
    }
  ],
  "cards-b.files.31": [
    {
      "name": "资料简报-demo",
      "children": [
        {
          "name": "brief.md",
          "content": "# 选题包（演示）\n状态：候选\n人工选题并确定立场后，再整理发布包。"
        },
        {
          "name": "assets",
          "children": [
            {
              "name": "cover.svg",
              "content": "SVG 插画占位，未生成真实图片。"
            },
            {
              "name": "shots.md",
              "content": "镜头 1：建立空间\n镜头 2：展示动作\n镜头 3：留下问题"
            }
          ]
        },
        {
          "name": "receipt-demo.json",
          "content": "{\"status\":\"draft\",\"published\":false,\"demo\":true}"
        }
      ]
    }
  ],
  "cards-b.images.32": [
    "示例 · 资料示意",
    "场景 · 空间示意",
    "资料简报 · 信息图示意"
  ],
  "cards-b.images.34": [
    "示例 · 资料示意",
    "场景 · 空间示意",
    "资料简报 · 信息图示意"
  ],
  "cards-b.tools.36": [
    "执行器甲 / OpenAI 图像工具",
    "示例工作台 · 预检草稿"
  ],
  "cards-b.sourceDefaults.38": [
    {
      "title": "资料简报四平台交接",
      "path": "guides/资料简报-四平台发布-调用.md",
      "date": "2026-11-08",
      "text": "每期分别核对成片、文案、账号与授权；平台回执分开记录。",
      "project": "资料简报四平台交接"
    },
    {
      "title": "示例 内容选题池",
      "path": "workspace-b/示例-Content-Board-选题池机制-2026-05-14.md",
      "date": "2026-05-14",
      "text": "资讯池、人工选题与立场、发布包、发布后数据；状态分为候选、已选、已发布、已放弃。",
      "project": "示例 内容选题池"
    }
  ],
  "cards-b.values.44": [
    {
      "label": "官网会话",
      "value": "240",
      "detail": "同一完整演示日，已按官网域名筛选。"
    },
    {
      "label": "已确认咨询",
      "value": "6",
      "detail": "按演示会话去重；消息通道 点击单独统计。"
    },
    {
      "label": "成交",
      "value": "待核",
      "detail": "没有销售证据，不能从访问或点击推算。"
    }
  ],
  "cards-b.dispatchRounds.55": [
    {
      "round": 1,
      "workers": [
        {
          "id": "codex-demo",
          "name": "示例执行器甲",
          "model": "Sol（演示）",
          "status": "样例完成",
          "elapsed": "6.2 秒",
          "tokens": 1240,
          "receipt": "结论：保留发送前审批。\n范围：仅整理草稿。\n建议：先核来源，再核预览。\n验证：未真实执行。"
        },
        {
          "id": "grok-demo",
          "name": "模型乙 命令行",
          "model": "模型乙（演示）",
          "status": "样例完成",
          "elapsed": "7.8 秒",
          "tokens": 1380,
          "receipt": "结论：保留发送前审批。\n范围：仅整理草稿。\n建议：先核预览，再核来源。\n验证：未真实执行。"
        }
      ]
    },
    {
      "round": 2,
      "workers": [
        {
          "id": "local-demo",
          "name": "示例本地模型",
          "model": "示例本地模型（演示）",
          "status": "等待复核",
          "elapsed": "待计时",
          "tokens": null,
          "receipt": "待复核：整合前两路差异，形成可审查的草稿；尚无真实执行回执。"
        }
      ]
    }
  ],
  "cards-b.sample.58": {
    "device": "设备甲（演示）"
  },
  "cards-b.checkupItems.59": [
    {
      "label": "服务",
      "status": "ok",
      "detail": "演示进程响应正常"
    },
    {
      "label": "端口",
      "status": "ok",
      "detail": "演示监听检查通过；不展示实际端口"
    },
    {
      "label": "磁盘",
      "status": "wait",
      "detail": "演示剩余空间偏低；仅提醒，未清理"
    },
    {
      "label": "备份",
      "status": "fail",
      "detail": "最近一份演示备份缺少校验；请核实恢复点"
    },
    {
      "label": "密钥是否在位",
      "status": "ok",
      "detail": "在位"
    },
    {
      "label": "私有网络 连通",
      "status": "ok",
      "detail": "演示连通；未访问设备"
    }
  ],
  "cards-b.phrases.66": [
    "看看 执行器甲 工人的回执",
    "看看本地工人的回执",
    "这份回执证明了什么"
  ],
  "cards-b.messages.70": {
    "from": "user",
    "time": "演示",
    "parts": [
      {
        "type": "text",
        "md": "云端规划、示例本地模型 执行，失败时怎么交回老师？"
      }
    ]
  },
  "cards-b.messages.71": {
    "task": "把草稿来源与检查结果收成可审查的交接",
    "teacher": {
      "model": "云端大脑（演示）",
      "steps": [
        {
          "name": "规划核对顺序与回执字段",
          "tokens": 480,
          "ms": 1000
        },
        {
          "name": "复核交回的来源日期问题",
          "tokens": 770,
          "ms": 2400
        }
      ]
    },
    "student": {
      "model": "示例本地模型（演示）",
      "steps": [
        {
          "name": "整理本页草稿与检查结果",
          "tokens": 900,
          "ms": 2600
        },
        {
          "name": "核对来源日期，失败后交回老师",
          "tokens": 1500,
          "ms": 5200
        }
      ]
    },
    "baseline": {
      "tokens": 4000,
      "ms": 16000,
      "note": "全用云端的演示估算"
    },
    "saved": {
      "tokens": 2750,
      "ms": 4800,
      "note": "云端 token 减少约 69%；非实付费用"
    },
    "handbacks": [
      {
        "step": "核对来源日期",
        "reason": "两个摘录的日期口径不一致，本地不能确认",
        "result": "老师标记来源待核，保留两条原日期；未当作已核验"
      }
    ]
  },
  "cards-b.messages.74": {
    "title": "DSH 候选 · 本地到待验收",
    "source": "协调助理「今天」"
  },
  "cards-b.messages.75": {
    "title": "发布包 · 虚拟目录",
    "source": "资料简报四平台交接"
  },
  "cards-b.messages.79": {
    "from": "user",
    "time": "演示",
    "parts": [
      {
        "type": "text",
        "md": "把草稿整理交给 消息通道 回复员，给我看操作到验证码停下。"
      }
    ]
  },
  "cards-b.messages.82": {
    "parent": "writer",
    "bot": "writer-line",
    "direction": "dispatch",
    "task": "消息通道 草稿",
    "summary": "整理待审回复，不发送。",
    "status": "已分派（演示）"
  },
  "cards-b.messages.83": {
    "bot": "writer",
    "task": "写作主号（演示）· 草稿预检",
    "demoHandoff": true
  },
  "cards-b.messages.85": {
    "parent": "writer",
    "bot": "writer-line",
    "direction": "report",
    "task": "消息通道 草稿",
    "summary": "已整理草稿，等你审阅；未发送。",
    "status": "待审"
  },
  "cards-b.messages.89": {
    "from": "user",
    "time": "演示",
    "parts": [
      {
        "type": "text",
        "md": "今天的 资料简报与示例官网数据，先给我可审查的草稿。"
      }
    ]
  },
  "cards-b.messages.90": {
    "title": "示例 · 演示日官网漏斗",
    "source": "示例 内容渠道 复盘漏斗"
  },
  "cards-b.messages.91": {
    "title": "官网会话 · 完整演示工作周",
    "source": "示例 内容渠道 复盘漏斗"
  },
  "cards-b.messages.92": {
    "title": "咨询率如何计算",
    "source": "示例 内容渠道 复盘漏斗"
  },
  "cards-b.messages.93": {
    "title": "资料简报 · 阅读页草稿",
    "source": "示例 内容选题池 / 主动今日简报"
  },
  "cards-b.messages.94": {
    "title": "四平台 · 草稿交接表",
    "source": "资料简报四平台交接"
  },
  "cards-b.messages.95": {
    "title": "发布前预览清单",
    "source": "内容渠道 发布闸门 / 内容渠道 Harness v2"
  },
  "cards-b.messages.97": {
    "title": "从候选到待审",
    "source": "示例 内容选题池"
  },
  "cards-b.messages.98": {
    "title": "本期交接 · 12 秒声音位置",
    "source": "示例短片配音主控",
    "transcript": "这期先核来源，再确认选题和立场。四个平台分别看最终预览；提交结果未知就回查，不重复提交。"
  },
  "cards-b.messages.99": {
    "title": "资料简报 · 判断稿",
    "source": "示例 内容选题池"
  },
  "cards-b.messages.102": {
    "title": "参考组 · 逐张检查",
    "source": "示例工作台 / 生图与视频生成台账"
  },
  "cards-b.messages.103": {
    "title": "15 秒分镜条 · 播放头演示",
    "source": "示例工作台"
  },
  "cards-b.messages.104": {
    "title": "封面提示词 · 仅工具草稿",
    "source": "示例工作台"
  },
  "cards-b.messages.105": {
    "title": "参考与成片的边界",
    "source": "示例工作台 / 生图与视频生成台账",
    "items": [
      "素材来源可追溯",
      "SVG 占位与真实素材明确区分",
      "角色、空间和承接关系已复核",
      "提交、下载、验片和验收分别登记"
    ]
  },
  "cards-b.messages.106": {
    "title": "这一段的交接",
    "source": "示例工作台",
    "steps": [
      "脚本",
      "素材审核",
      "配音",
      "渲染",
      "待验收"
    ]
  },
  "governance.quota.1": {
    "usageProbe": 38,
    "sevenDay": 62,
    "threshold": 80,
    "detailed": false,
    "snapshotAt": "2026-11-17 22:00 JST"
  },
  "governance.levelDescriptions.2": {
    "L0": "L0 只读自动",
    "L1": "L1 本地写并通知",
    "L2": "L2 双工：低风险先自动回复、同时后台问 用户",
    "L3": "L3 强制审批",
    "L4": "L4 直接拒绝"
  },
  "governance.grants.3": [
    {
      "action": "示例咨询草稿可在工作区内改写",
      "bot": "示例",
      "date": "2026-11-12 09:10",
      "quote": "先把预约说明写成草稿，给我看完再发。",
      "source": "写作助理 · 咨询草稿（演示） · 第 6 轮",
      "scope": "仅草稿文件；不含 消息通道 外发",
      "active": true
    },
    {
      "action": "资料简报四平台文案对稿",
      "bot": "内容",
      "date": "2026-11-12 11:20",
      "quote": "这期四份文案你先对齐，发布等我确认。",
      "source": "整理助理 · 四平台对稿（演示） · 第 3 轮",
      "scope": "仅一期文案；不含提交与公开",
      "active": true
    },
    {
      "action": "DSH 隔离候选的本地验证",
      "bot": "首席",
      "date": "2026-11-12 14:30",
      "quote": "在隔离目录里跑一遍，先别动主线。",
      "source": "总管 · 候选验证（演示） · 第 9 轮",
      "scope": "设备甲测试目录；不含生产配置",
      "active": true
    }
  ],
  "governance.approvals.4": [
    {
      "id": "A-001",
      "bot": "示例",
      "action": "调整示例客服回复草稿",
      "params": "对象：虚构客户的交流咨询\n内容：示例城市交流预约说明\n交付：仅本地草稿",
      "scope": "示例 · 一份草稿，不发送",
      "status": "待批",
      "created": "2026-11-13 09:00",
      "expires": "演示剩余 28 分钟"
    },
    {
      "id": "A-002",
      "bot": "内容",
      "action": "资料简报四平台发布包复核",
      "params": "期号：第七期（演示）\n平台：短讯通道、发布通道、媒体通道、通道\n动作：生成审阅包，不提交",
      "scope": "资料简报 · 四份文案与封面清单",
      "status": "待批",
      "created": "2026-11-13 09:05",
      "expires": "演示剩余 43 分钟"
    },
    {
      "id": "A-003",
      "bot": "首席",
      "action": "DSH 候选恢复演练",
      "params": "备份：11月13日凌晨备份（演示）\n目标：隔离测试区\n不含：生产覆盖与服务重启",
      "scope": "DSH · 一次隔离演练",
      "status": "待批",
      "created": "2026-11-13 09:10",
      "expires": "演示剩余 55 分钟"
    },
    {
      "id": "A-004",
      "bot": "研究",
      "action": "资料摘录格式整理",
      "params": "三份公开资料；只整理标题与来源",
      "scope": "个人事务 · 草稿",
      "status": "已批",
      "created": "2026-11-12 15:00",
      "expires": "已结案"
    },
    {
      "id": "A-005",
      "bot": "内容",
      "action": "视频样片公开发布",
      "params": "虚构的第三条视频样片；尚缺验片",
      "scope": "演示工作区 · 示例频道",
      "status": "已拒",
      "created": "2026-11-12 16:00",
      "expires": "已结案"
    },
    {
      "id": "A-006",
      "bot": "首席",
      "action": "每日摘要时间调整",
      "params": "09:00 → 08:30；仅候选配置",
      "scope": "DSH · 测试调度",
      "status": "超时",
      "created": "2026-11-12 17:00",
      "expires": "已超时，需新申请"
    }
  ],
  "governance.logs.5": [
    {
      "who": "用户（演示）",
      "time": "2026-11-12 17:31",
      "what": "每日摘要时间调整",
      "result": "超时",
      "detail": "每日摘要时间调整未在演示窗口内确认；没有执行"
    },
    {
      "who": "用户（演示）",
      "time": "2026-11-12 16:08",
      "what": "视频样片公开发布",
      "result": "已拒",
      "detail": "视频样片缺少验片与发布授权；没有外发"
    },
    {
      "who": "用户（演示）",
      "time": "2026-11-12 15:04",
      "what": "资料摘录格式整理",
      "result": "已批",
      "detail": "资料整理仅登记假回执；没有修改真实文件"
    }
  ],
  "governance.permissions.6": [
    {
      "id": "read",
      "tool": "读取项目资料",
      "bot": "首席",
      "level": "L0",
      "scope": "工作区内文档",
      "source": "示例提供方 工作席"
    },
    {
      "id": "draft",
      "tool": "编辑回复草稿",
      "bot": "示例",
      "level": "L1",
      "scope": "本地可回滚草稿",
      "source": "示例销售与客服规则"
    },
    {
      "id": "line",
      "tool": "消息通道 发送",
      "bot": "示例",
      "level": "L3",
      "scope": "虚构客户的咨询会话",
      "source": "客服语料质量门"
    },
    {
      "id": "publish",
      "tool": "四平台发布",
      "bot": "内容",
      "level": "L3",
      "scope": "每期逐平台授权",
      "source": "资料简报四平台交接"
    },
    {
      "id": "pay",
      "tool": "未经授权的付费生成",
      "bot": "首席",
      "level": "L4",
      "scope": "直接拒绝，不通过放权绕过",
      "source": "生图与视频生成台账"
    },
    {
      "id": "duplex",
      "tool": "低风险营业时间答复",
      "bot": "示例",
      "level": "L2",
      "scope": "演示咨询：先自动回复，同时后台问 用户",
      "source": "第 8 轮双工口径"
    },
    {
      "id": "unknown",
      "tool": "未登记插件工具",
      "bot": "研究",
      "level": "",
      "scope": "未标级默认 L3",
      "source": "工作台示例交接"
    }
  ],
  "governance.allocations.7": {
    "按 bot": [
      [
        "首席",
        50
      ],
      [
        "示例",
        30
      ],
      [
        "内容",
        20
      ]
    ],
    "按模型": [
      [
        "示例模型甲",
        50
      ],
      [
        "示例模型乙",
        30
      ],
      [
        "示例模型丙/Terra",
        20
      ]
    ],
    "按项目": [
      [
        "工作台示例",
        50
      ],
      [
        "示例项目",
        30
      ],
      [
        "资料简报",
        20
      ]
    ]
  },
  "governance.ledger.8": [
    {
      "id": "TK-DEMO-01",
      "ageHours": 2,
      "bot": "示例",
      "layer": "执行层",
      "model": "示例模型甲",
      "calls": 1,
      "input": 500,
      "output": 100,
      "cache": 200,
      "cost": 0.02,
      "project": "示例草稿",
      "source": "OpenClaw Token 统计方法"
    },
    {
      "id": "TK-DEMO-02",
      "ageHours": 24,
      "bot": "内容",
      "layer": "复核层",
      "model": "示例模型乙",
      "calls": 1,
      "input": 500,
      "output": 100,
      "cache": null,
      "cost": 0.02,
      "project": "资料简报对稿",
      "source": "OpenClaw Token 统计方法"
    },
    {
      "id": "TK-DEMO-03",
      "ageHours": 72,
      "bot": "首席",
      "layer": "代码层",
      "model": "示例模型丁",
      "calls": 1,
      "input": 500,
      "output": 100,
      "cache": 200,
      "cost": 0.02,
      "project": "工作台示例",
      "source": "用量统计流程"
    },
    {
      "id": "TK-DEMO-04",
      "ageHours": 144,
      "bot": "研究",
      "layer": "本地层",
      "model": "示例本地模型",
      "calls": 1,
      "input": 500,
      "output": 100,
      "cache": null,
      "cost": null,
      "project": "个人资料摘录",
      "source": "Agent 工作组控制台"
    }
  ],
  "governance.rounds.9": {
    "工作台示例": [
      {
        "model": "示例模型甲",
        "input": 500,
        "output": 100,
        "cache": 200,
        "speed": 20,
        "peak": 0.02,
        "valley": 0.01
      },
      {
        "model": "示例模型乙",
        "input": 500,
        "output": 100,
        "cache": null,
        "speed": 20,
        "peak": 0.02,
        "valley": 0.01
      },
      {
        "model": "示例模型丁",
        "input": 500,
        "output": 100,
        "cache": 200,
        "speed": 20,
        "peak": 0.02,
        "valley": 0.01
      }
    ],
    "示例草稿": [
      {
        "model": "示例模型甲",
        "input": 500,
        "output": 100,
        "cache": 200,
        "speed": 20,
        "peak": 0.02,
        "valley": 0.01
      },
      {
        "model": "示例模型甲",
        "input": 500,
        "output": 100,
        "cache": 200,
        "speed": 20,
        "peak": 0.02,
        "valley": 0.01
      },
      {
        "model": "示例模型乙",
        "input": 500,
        "output": 100,
        "cache": null,
        "speed": 20,
        "peak": 0.02,
        "valley": 0.01
      }
    ]
  },
  "governance.safety.10": [
    {
      "id": "T-016",
      "title": "前门认证",
      "status": "仅测试分支",
      "evidence": "历史 canary 20/20；主线未上",
      "next": "手机配对与登录名复核",
      "source": "工作台示例交接"
    },
    {
      "id": "T-017",
      "title": "花费代理与动作网关",
      "status": "仅测试分支",
      "evidence": "历史假上游验收；不能推定真实花费已受控",
      "next": "隔离用户、出站闸与授权范围待拍板",
      "source": "工作台示例交接"
    },
    {
      "id": "T-018",
      "title": "发送工具接网关",
      "status": "仅测试分支",
      "evidence": "历史 4 工具 0→1→409；不是端口加固",
      "next": "与「插件失败即停」配套审查后才考虑主线",
      "source": "工作台示例交接"
    },
    {
      "id": "T-019",
      "title": "插件失败即停",
      "status": "仅测试分支",
      "evidence": "历史 canary 19/19；第 2、4 项暂缓",
      "next": "拒绝启动及一次性凭证联动核对",
      "source": "工作台示例交接"
    },
    {
      "id": "PORT",
      "title": "端口暴露收敛",
      "status": "未做",
      "evidence": "演示任务：未执行新的监听核验",
      "next": "示例端点 / 示例端点 / 22 / 示例端点 范围待核",
      "source": "Agent 工作组控制台"
    },
    {
      "id": "XFF",
      "title": "来源地址信任",
      "status": "未做",
      "evidence": "演示任务：可信代理表尚未接入",
      "next": "不凭 通道-Forwarded-For 自动信任",
      "source": "工作台示例交接"
    }
  ],
  "governance.ports.11": [
    {
      "name": "DSH 网页",
      "endpoint": "example.invalid",
      "machine": "设备丙",
      "scope": "历史 loopback 入口，当前未核验",
      "isolated": false
    },
    {
      "name": "候选中间层",
      "endpoint": "example.invalid",
      "machine": "设备甲",
      "scope": "虚构候选端口，私有网络 暴露待核",
      "isolated": false
    },
    {
      "name": "远程运维",
      "endpoint": "示例 私有网络 · :22",
      "machine": "设备戊",
      "scope": "入口假数据，应急通道不自动关闭",
      "isolated": false
    },
    {
      "name": "屏幕共享",
      "endpoint": "示例 私有网络 · :示例端点",
      "machine": "设备乙",
      "scope": "入口假数据，来源信任待核",
      "isolated": false
    }
  ],
  "governance.health.12": [
    {
      "name": "DSH 内核",
      "machine": "设备丙",
      "kind": "内核",
      "result": "未检查",
      "after": "正常"
    },
    {
      "name": "动作中间层",
      "machine": "设备甲",
      "kind": "中间层",
      "result": "未检查",
      "after": "降级"
    },
    {
      "name": "总管",
      "machine": "设备丙",
      "kind": "助理",
      "result": "未检查",
      "after": "正常"
    },
    {
      "name": "写作助理",
      "machine": "设备戊",
      "kind": "助理",
      "result": "未检查",
      "after": "正常"
    },
    {
      "name": "整理助理 · 示例本地模型",
      "machine": "设备丁",
      "kind": "助理",
      "result": "未检查",
      "after": "正常"
    },
    {
      "name": "网页通道",
      "machine": "设备甲",
      "kind": "通道",
      "result": "未检查",
      "after": "正常"
    },
    {
      "name": "手机与 消息通道 通道",
      "machine": "设备乙",
      "kind": "通道",
      "result": "未检查",
      "after": "待配对"
    }
  ],
  "governance.incidents.13": [
    {
      "id": "INC-DEMO-01",
      "title": "插件加载中止",
      "project": "DSH",
      "severity": "高",
      "status": "处理中",
      "detail": "测试分支故意注入异常；启动被拦截",
      "next": "核对恢复后启动日志"
    },
    {
      "id": "INC-DEMO-02",
      "title": "四平台重复提交被拦",
      "project": "资料简报",
      "severity": "中",
      "status": "处理中",
      "detail": "虚构发布包命中相同内容摘要；无第二次外发",
      "next": "复核原回执后结案"
    },
    {
      "id": "INC-DEMO-03",
      "title": "缓存统计缺字段",
      "project": "示例",
      "severity": "低",
      "status": "已结案",
      "detail": "缓存缺失保持未知；未补成零",
      "next": "等提供方字段接入"
    }
  ],
  "governance.backups.14": [
    {
      "id": "B-DEMO-113",
      "date": "2026-11-13 02:17",
      "version": "0.2.2-rc.1",
      "size": "48 MB",
      "content": "sqlite / profile / lock",
      "result": "校验和匹配（演示）"
    },
    {
      "id": "B-DEMO-112",
      "date": "2026-11-12 23:40",
      "version": "0.2.2-rc.1",
      "size": "46 MB",
      "content": "配置快照 / 插件清单",
      "result": "校验和匹配（演示）"
    },
    {
      "id": "B-DEMO-111",
      "date": "2026-11-11 21:15",
      "version": "0.2.1",
      "size": "43 MB",
      "content": "sqlite / profile / lock",
      "result": "待隔离恢复复核（演示）"
    }
  ],
  "governance.rulesData.15": [
    {
      "project": "全局",
      "title": "未经明确授权，不付款、不动生产、不外发、不部署、不删除用户数据",
      "tag": "#by/用户 #on/日期待查",
      "source": "全局工作规则",
      "confirm": "【用户要求】规则摘录",
      "detail": "来源为本任务给定 AGENTS 指令；样张操作不新增任何实际授权。"
    },
    {
      "project": "全局",
      "title": "订阅额度用尽先暂停，额外积分另获授权",
      "tag": "#by/用户 #on/2026-10-28",
      "source": "Token 统计与额度规则",
      "confirm": "【用户要求】规则摘录",
      "detail": "积分余额、赠送余额和订阅窗口是不同口径；未连接窗口只能显示无法核验。"
    },
    {
      "project": "示例",
      "title": "咨询、预约、交流、到店与成交分别记数",
      "tag": "#by/用户 #on/2026-10-15",
      "source": "示例销售与客服规则",
      "confirm": "【用户要求】来源资料摘录",
      "detail": "客服权限按场景区分；真实图形素材与 AI 创意图分开；当前草稿不自动发送。"
    },
    {
      "project": "DSH",
      "title": "四项加固的测试分支验收不等于已上主线",
      "tag": "#by/codex #on/2026-11-13",
      "source": "工作台示例交接",
      "confirm": "【AI整理】【用户未确认】",
      "detail": "历史主线一个没上；今天未连接机器，不把演示三态当线上结果。"
    },
    {
      "project": "视频",
      "title": "生图走 执行器甲／OpenAI；付费视频生成逐次核对授权",
      "tag": "#by/用户 #on/2026-06-12",
      "source": "生图与视频生成台账",
      "confirm": "【用户要求】规则摘录",
      "detail": "生成、下载、验片与公开回执分别记录；模型任务 ID 不代表成片验收。"
    },
    {
      "project": "资料简报",
      "title": "每期逐平台核对素材、文案、查重与发布授权",
      "tag": "#by/codex #on/2026-11-13",
      "source": "资料简报四平台交接",
      "confirm": "【AI整理】【用户未确认】",
      "detail": "短讯通道、发布通道、媒体通道、通道 分别保留状态与回执；样张不会向平台提交。"
    }
  ],
  "governance.botIds.16": {
    "首席": "chief",
    "示例": "writer",
    "内容": "content",
    "研究": "research"
  },
  "governance.sample.22": [
    "全部",
    "首席",
    "示例",
    "内容",
    "研究"
  ],
  "governance.sample.43": [
    "示例创意封面（演示）",
    "示例短片样片（演示）",
    "资料简报横竖版（演示）"
  ],
  "governance.sample.47": [
    "全部",
    "全局",
    "示例",
    "DSH",
    "视频",
    "资料简报"
  ],
  "governance.phrases.51": [
    "看看放权记录的出处",
    "收回示例草稿的演示放权",
    "恢复示例草稿的演示放权"
  ],
  "governance.sample.57": {
    "id": "governance-activity-l1-draft",
    "bot": "writer",
    "title": "演示 · L1 已自动整理客服草稿",
    "detail": "预设的本地可回滚步骤已完成，草稿待审；未发送给客户。",
    "time": "今天 · 稍早（演示）"
  },
  "governance.costSessions.58": [
    {
      "conversation": "writer-013",
      "title": "写作助理 · 咨询草稿",
      "turns": [
        {
          "turn": 1,
          "cost": 0.02
        },
        {
          "turn": 2,
          "cost": 0.02
        },
        {
          "turn": 3,
          "cost": 0.02
        }
      ]
    },
    {
      "conversation": "content-013",
      "title": "整理助理 · 对稿",
      "turns": [
        {
          "turn": 1,
          "cost": 0.02
        },
        {
          "turn": 2,
          "cost": 0.02
        },
        {
          "turn": 3,
          "cost": 0.02
        }
      ]
    },
    {
      "conversation": "chief-013",
      "title": "总管 · 候选验证",
      "turns": [
        {
          "turn": 1,
          "cost": 0.02
        },
        {
          "turn": 2,
          "cost": 0.02
        }
      ]
    },
    {
      "conversation": "research-013",
      "title": "研究助理 · 资料摘录",
      "turns": [
        {
          "turn": 1,
          "cost": 0.02
        },
        {
          "turn": 2,
          "cost": null
        }
      ]
    }
  ],
  "governance.parts.59": [
    {
      "type": "text",
      "md": "本页演示，未真实执行。第一张可批准再收回；第二张可拒绝。L4 卡只能拒绝。所有贴纸可打开统一说明。"
    },
    {
      "type": "governance-delegation",
      "data": {
        "action": "低风险营业时间答复",
        "level": "L2",
        "scope": "演示咨询，只答营业时间，同时后台问 用户",
        "bot": "writer",
        "state": "proposed"
      }
    },
    {
      "type": "governance-delegation",
      "data": {
        "action": "修改预约日期",
        "level": "L3",
        "scope": "演示预约，每次仍须审批",
        "bot": "writer",
        "state": "proposed"
      }
    },
    {
      "type": "governance-delegation",
      "data": {
        "action": "未经授权的付费生成",
        "level": "L4",
        "scope": "演示拦截，不调用服务",
        "bot": "art",
        "state": "proposed"
      }
    },
    {
      "type": "governance-approval",
      "data": {
        "id": "A-001"
      }
    }
  ],
  "interact.commands.1": [
    [
      "compress",
      "压缩",
      "保留目标、待办与来源，生成摘要"
    ],
    [
      "new",
      "新会话",
      "保留当前会话，另开一段"
    ],
    [
      "model",
      "模型",
      "选择下一轮演示模型"
    ],
    [
      "remember",
      "记住",
      "登记待投递的记忆"
    ],
    [
      "task",
      "任务",
      "从文字创建本地看板卡"
    ],
    [
      "schedule",
      "定时",
      "预览定时任务，不注册真实任务"
    ],
    [
      "background",
      "模拟后台回报",
      "安静插入整理助理的演示回报"
    ]
  ],
  "interact.sample.3": [
    "示例提供方",
    "模型乙 订阅",
    "示例本地模型"
  ],
  "interact.sample.4": {
    "id": "interact-r7-demo",
    "title": "继续与通话 · 互动演示",
    "messages": [
      {
        "from": "user",
        "time": "刚刚",
        "status": "read",
        "parts": [
          {
            "type": "text",
            "md": "帮我整理今天的待办。"
          }
        ]
      },
      {
        "from": "chief",
        "time": "刚刚",
        "parts": [
          {
            "type": "text",
            "md": "这轮在整理草稿时中断了。可直接点下方继续、换模型或放弃；输入任意一句话可看消息状态与单条停止。输入栏 + → 语音通话演示，可缩小并跨页返回，挂断后出现通话纪要。演示，未真实执行。"
          },
          {
            "type": "interact-failure",
            "data": {
              "id": "interact-r7-failed-turn",
              "conversation": "interact-r7-demo",
              "bot": "chief",
              "reason": "演示连接超时，已保留目标与草稿，无需从头整理。",
              "prompt": "整理今天的待办",
              "model": "示例提供方",
              "state": "失败"
            }
          }
        ]
      }
    ]
  },
  "interact.imageTools.5": [
    "模型丁",
    "模型丙",
    "执行器甲",
    "图形工具"
  ],
  "interact.parts.9": {
    "type": "text",
    "md": "本页演示，未真实执行。整理助理的后台回报已准备好，你可以继续当前对话。"
  },
  "interact.sample.19": [
    [
      "image",
      "拍照",
      "窗边资料 · 相机示意.jpg"
    ],
    [
      "image",
      "图片",
      "示例窗边光 · 示例.jpg"
    ],
    [
      "file",
      "文件",
      "资料简报四平台交接 · 示例.pdf"
    ],
    [
      "image",
      "截屏",
      "DSH 看板 · 截屏示意.png"
    ]
  ],
  "interact.body.24": {
    "block": "center",
    "inline": "center"
  },
  "interact.sample.39": {
    "class": "m-interact-captionline"
  },
  "memory.projects.1": {
    "common": "跨项目",
    "workspace": "示例项目",
    "ai": "资料简报",
    "dsh": "工作台示例",
    "video": "视频制作"
  },
  "memory.origins.2": {
    "common": "执行器甲 记忆与知识库分工",
    "workspace": "示例 客服 Wiki",
    "ai": "资料简报四平台交接",
    "dsh": "示例提供方 资料接入",
    "video": "示例工作台"
  },
  "memory.names.3": {
    "知识条目来源与用户确认-调用.md": "知识条目来源与确认规则",
    "kb-agent-调用.md": "知识库贡献与只读规则",
    "示例客服Wiki必须是真三级树.md": "客服分类与场景规则",
    "资料简报-四平台发布-调用.md": "资料简报四平台发布交接",
    "示例工作台-视频工具-RunningHub预检工作流.md": "示例工作台预检工作流",
    "02-ARCHITECTURE.md": "知识库路由架构草案",
    "执行器甲全局记忆-Superpowers-知识库分工.md": "全局记忆与知识库分工",
    "HANDOVER.md": "DSH 项目交接",
    "知识状态与证据晋升-调用.md": "知识状态与证据规则",
    "demo-machine-index.md": "设备名称与使用规则"
  },
  "memory.catalog.4": [
    {
      "id": "wiki-sources",
      "project": "common",
      "title": "来源与确认标签",
      "path": "guides/知识条目来源与用户确认-调用.md",
      "date": "2026-10-15",
      "origin": "来源与确认标签",
      "summary": "提出者、用户 确认、事实核验和原始日期分开记录。"
    },
    {
      "id": "wiki-kb",
      "project": "dsh",
      "title": "kb-agent 调用与只读角色",
      "path": "guides/kb-agent-调用.md",
      "date": "2026-11-07",
      "origin": "kb-agent",
      "summary": "bot 只读 boot / search / how；贡献由 record → flush 投递，整理另算。"
    },
    {
      "id": "wiki-writer",
      "project": "workspace",
      "title": "客服分类 → 场景 → 问题",
      "path": "guides/示例客服Wiki必须是真三级树.md",
      "date": "2026-07-13",
      "origin": "示例 客服 Wiki",
      "summary": "保留三级树、中日对照与来源；历史本地验证不等于已部署。"
    },
    {
      "id": "wiki-news",
      "project": "ai",
      "title": "资料简报四平台交接",
      "path": "guides/资料简报-四平台发布-调用.md",
      "date": "2026-11-08",
      "origin": "资料简报四平台交接",
      "summary": "每期单独核对成片、文案、授权和平台回执，不沿用上期发布状态。"
    },
    {
      "id": "wiki-video",
      "project": "video",
      "title": "示例工作台预检",
      "path": "guides/示例工作台-视频工具-RunningHub预检工作流.md",
      "date": "2026-09-28",
      "origin": "示例工作台",
      "summary": "项目 JSON 是源，参考、分段和预检依次审查；付费生成单独授权。"
    },
    {
      "id": "wiki-router",
      "project": "common",
      "title": "sample-wiki 路由架构草案",
      "path": "sample-infrastructure/sample-docs/sample-wiki管理-20260507/02-ARCHITECTURE.md",
      "date": "2026-05-07",
      "origin": "sample-wiki 管理",
      "summary": "一句话先匹配 wiki 再匹配 bot；架构草案，未证明已部署。"
    }
  ],
  "memory.allow.5": {
    "chief": [
      "common",
      "workspace",
      "ai",
      "dsh",
      "video"
    ],
    "writer": [
      "common",
      "workspace"
    ],
    "content": [
      "common",
      "ai"
    ],
    "pm": [
      "common",
      "dsh"
    ],
    "art": [
      "common",
      "video"
    ],
    "research": [
      "common",
      "dsh",
      "ai"
    ]
  },
  "memory.mountSeeds.33": {
    "chief": [
      [
        "shared",
        "共享规则与确认边界",
        "guides/知识条目来源与用户确认-调用.md",
        420
      ],
      [
        "handoff",
        "当前交接：下一步与禁止项",
        "projects/sample/HANDOVER.md",
        960
      ],
      [
        "router",
        "项目 Wiki 入口索引",
        "projects/sample/按需路由.md",
        680
      ]
    ],
    "writer": [
      [
        "rules",
        "客服分类与场景入口",
        "guides/示例客服Wiki必须是真三级树.md",
        780
      ],
      [
        "draft",
        "交流草稿：日期、时间、人数分开核对",
        "projects/demo-writer/交流草稿.md",
        540
      ],
      [
        "shared",
        "来源与确认边界",
        "guides/知识条目来源与用户确认-调用.md",
        420
      ]
    ],
    "content": [
      [
        "handoff",
        "本期四平台交接指针",
        "guides/资料简报-四平台发布-调用.md",
        720
      ],
      [
        "topics",
        "待审选题摘要",
        "projects/notes/选题摘要.md",
        460
      ]
    ],
    "pm": [
      [
        "handoff",
        "源码版本与唯一写者",
        "projects/sample/HANDOVER.md",
        640
      ],
      [
        "rollback",
        "本轮可回滚范围",
        "projects/sample/回滚说明.md",
        520
      ]
    ],
    "art": [
      [
        "masters",
        "角色母版与资产版本索引",
        "projects/design/角色母版索引.md",
        860
      ],
      [
        "review",
        "待审资产与许可摘要",
        "projects/design/资产审阅.md",
        480
      ]
    ],
    "research": [
      [
        "sources",
        "资料观察日期与证据等级",
        "guides/知识状态与证据晋升-调用.md",
        580
      ],
      [
        "questions",
        "本轮待核问题索引",
        "projects/research/待核清单.md",
        660
      ]
    ],
    "board-steward": [
      [
        "pending",
        "未提交的看板移动摘要",
        "projects/sample/看板移动草稿.md",
        340
      ],
      [
        "blocked",
        "卡住的任务与负责人",
        "projects/sample/任务摘要.md",
        420
      ]
    ],
    "ledger-steward": [
      [
        "usage",
        "本轮用量与未知费用口径",
        "projects/sample/用量口径.md",
        460
      ],
      [
        "limits",
        "额度提醒与预算提议",
        "projects/sample/预算提议.md",
        300
      ]
    ],
    "memory-steward": [
      [
        "index",
        "稳定线索与正本指针目录",
        "projects/sample/记忆目录.md",
        620
      ],
      [
        "pending",
        "待确认、冲突与隐私红线摘要",
        "projects/sample/记忆待核.md",
        380
      ]
    ],
    "safety-steward": [
      [
        "levels",
        "L0–L4 与授权边界",
        "projects/sample/权限口径.md",
        520
      ],
      [
        "rollback",
        "备份与回滚证据入口",
        "projects/sample/回滚说明.md",
        360
      ]
    ],
    "machine-steward": [
      [
        "devices",
        "设备正式名称与允许动作",
        "devices/sample-index.md",
        640
      ],
      [
        "workers",
        "本地执行手与交回老师条件",
        "projects/sample/执行手说明.md",
        440
      ]
    ],
    "schedule-steward": [
      [
        "routine",
        "例行任务与暂停状态",
        "projects/sample/例行任务.md",
        380
      ],
      [
        "triggers",
        "Webhook 来源白名单摘要",
        "projects/sample/触发来源.md",
        280
      ]
    ],
    "connect-steward": [
      [
        "tools",
        "工具连接与未接入项",
        "projects/sample/连接摘要.md",
        560
      ],
      [
        "licenses",
        "插件评估与资产许可入口",
        "projects/sample/许可索引.md",
        420
      ]
    ]
  },
  "memory.sample.34": {
    "价格": true,
    "协作": true,
    "凭据": true,
    "客户隐私": true
  },
  "memory.title.44": {
    "maxLength": 120
  },
  "memory.pointer.45": {
    "maxLength": 260
  },
  "memory.sample.47": {
    "lines": [
      "价格具体值、协作资料、凭据、客户隐私不进入记忆正文。",
      "疑似凭据始终拒绝；没有读取真实记忆、客户数据或磁盘。"
    ]
  },
  "memory.sample.48": {
    "lines": [
      "待投递表示还未送出；收到已送达或已同步回执，才算送达。",
      "送达不代表正本整理、实际采用或 用户 确认。"
    ]
  },
  "memory.sample.54": {
    "lines": [
      "先核对来源版本、目标权限与可回滚备份。",
      "只迁移允许的指针，不继承确认标签或回执；敏感正文不迁移。",
      "导入后先审阅待确认项，再决定是否保存；来源和修改记录可用下方按钮查看。"
    ]
  },
  "persona.avatars.1": [
    {
      "name": "圆团",
      "kind": "human",
      "color": "pink",
      "license": "原创 SVG 占位",
      "system": "图形"
    },
    {
      "name": "圆团",
      "kind": "cat",
      "color": "tomato",
      "license": "原创 SVG 占位",
      "system": "图形"
    },
    {
      "name": "简洁助手",
      "kind": "robot",
      "color": "sky",
      "license": "原创 SVG 占位",
      "system": "图形"
    },
    {
      "name": "软星",
      "kind": "fox",
      "color": "lemon",
      "license": "模型许可待核",
      "system": "图形"
    },
    {
      "name": "夜读圆形",
      "kind": "owl",
      "color": "violet",
      "license": "模型许可待核",
      "system": "图形"
    },
    {
      "name": "团叶",
      "kind": "sprite",
      "color": "mint",
      "license": "原创 SVG 占位",
      "system": "图形"
    }
  ],
  "persona.voices.2": [
    {
      "name": "圆团 · 温柔女声",
      "language": "中文",
      "scene": "给 用户 的今日摘要",
      "machine": "设备甲"
    },
    {
      "name": "晴 · 日语柔和",
      "language": "日本語",
      "scene": "示例来店说明草稿",
      "machine": "设备丁"
    },
    {
      "name": "川 · 清晰男声",
      "language": "中文",
      "scene": "资料简报事实口播",
      "machine": "设备丙"
    },
    {
      "name": "澪 · 日语中性",
      "language": "日本語",
      "scene": "资料照顾说明草稿",
      "machine": "设备甲"
    },
    {
      "name": "林 · 叙事旁白",
      "language": "中文",
      "scene": "示例短片分段台词试听",
      "machine": "设备丁"
    },
    {
      "name": "原创占位 · 简洁播报",
      "language": "English",
      "scene": "工具版本摘要",
      "machine": "设备戊"
    }
  ],
  "persona.models.3": [
    "示例模型甲",
    "示例模型乙",
    "示例模型丙",
    "示例模型丁",
    "示例本地模型"
  ],
  "persona.sessions.9": [
    {
      "id": "DEMO-S01",
      "title": "示例咨询草稿",
      "project": "示例项目",
      "body": "资料咨询：先确认来店时间，再说明交流流程。日文草稿待 用户 审阅。",
      "pinned": true,
      "archived": false,
      "time": "今天 09:20"
    },
    {
      "id": "DEMO-S02",
      "title": "资料简报选题",
      "project": "资料简报",
      "body": "短讯通道、发布通道、媒体通道、通道 四平台选题；逐项核对成片、文案、授权与回执。",
      "pinned": false,
      "archived": false,
      "time": "今天 08:40"
    },
    {
      "id": "DEMO-S03",
      "title": "工作台示例记录",
      "project": "工作台示例",
      "body": "工作台模块独立维护，壳只读；检查浅深色与手机显示。",
      "pinned": false,
      "archived": false,
      "time": "昨天 21:10"
    },
    {
      "id": "DEMO-S04",
      "title": "本地语音候选",
      "project": "个人事务",
      "body": "设备甲试听记录；语音识别与合成分开验证，麦克风待现场验收。",
      "pinned": false,
      "archived": true,
      "time": "11月11日 18:10"
    }
  ],
  "persona.projects.10": [
    {
      "name": "示例项目",
      "bot": "写作助理",
      "dir": "/demo/workspace",
      "machine": "设备甲",
      "rule": "对客日文；草稿先人工审核",
      "scope": "workspace-a / 接待与交流",
      "source": "示例 AI 销售表达与客服场景规则",
      "expanded": false
    },
    {
      "name": "资料简报",
      "bot": "整理助理",
      "dir": "/demo/ai-news",
      "machine": "设备乙",
      "rule": "短讯通道 / 发布通道 / 媒体通道 / 通道 逐平台核对",
      "scope": "workspace-b / 当期发布包",
      "source": "资料简报四平台交接",
      "expanded": false
    },
    {
      "name": "工作台示例",
      "bot": "协调助理",
      "dir": "/demo/dsh",
      "machine": "设备丙",
      "rule": "单文件隔离；验证后交付",
      "scope": "workspace-c / DSH 契约",
      "source": "示例提供方 示例短片工作席",
      "expanded": false
    },
    {
      "name": "视频制作",
      "bot": "导演助理",
      "dir": "/demo/video",
      "machine": "设备丁",
      "rule": "参考与台词先审；提交需独立授权",
      "scope": "示例工作台 / 当前项目 JSON",
      "source": "示例工作台",
      "expanded": false
    },
    {
      "name": "个人事务",
      "bot": "总管",
      "dir": "/demo/personal",
      "machine": "设备戊",
      "rule": "只读聚合；不代发消息",
      "scope": "项目总管 / 今天",
      "source": "项目总管「今天」",
      "expanded": false
    }
  ],
  "persona.wizard.11": {
    "step": 0,
    "template": "项目助理",
    "name": "新助理",
    "duty": "整理项目并汇报进度",
    "summary": "先列证据，再说下一步。",
    "tools": [
      "知识库只读"
    ],
    "avatar": "圆团",
    "permission": "只读",
    "error": "",
    "done": false
  },
  "persona.assistantIds.12": [
    "chief",
    "writer",
    "content",
    "pm",
    "art",
    "research"
  ],
  "persona.outfitKind.13": {
    "image": "图片",
    "gif": "GIF",
    "live2d": "图形 · 未加载引擎",
    "vrm": "图形 · 未加载引擎"
  },
  "persona.ids.17": [
    "chief",
    "writer",
    "content",
    "pm",
    "art",
    "research"
  ],
  "persona.duty.18": [
    "统筹项目与待看事项",
    "整理示例咨询草稿",
    "策划 资料简报四平台选题",
    "跟进 DSH 模块交付",
    "整理视觉参考",
    "检索并核对技术资料"
  ],
  "persona.workspace.19": [
    "personal",
    "workspace",
    "ai-news",
    "dsh",
    "assets",
    "research"
  ],
  "persona.sample.33": [
    "图形",
    "图形"
  ],
  "persona.sample.35": [
    "chief",
    "writer",
    "content",
    "pm",
    "art",
    "research"
  ],
  "persona.workers.41": [
    "示例执行器甲",
    "示例执行器乙"
  ],
  "persona.sample.42": {
    "name": "机票哨兵",
    "duty": "整理机票与航班公开线索，比较候选并提醒 用户；不登录、不预订、不付款"
  },
  "persona.p.43": {
    "id": "chief",
    "name": "总管"
  },
  "persona.phrases.44": [
    "选用圆团温柔女声",
    "把语速改为 0.9 倍",
    "改成仅文字输入"
  ],
  "persona.phrases.45": [
    "置顶示例咨询草稿",
    "归档 资料简报选题会话",
    "恢复 资料简报选题会话"
  ],
  "persona.phrases.48": [
    "切换预览到示例项目",
    "切换预览到 资料简报",
    "切换预览到 工作台示例"
  ],
  "persona.act.49": [
    "示例项目",
    "资料简报",
    "工作台示例"
  ],
  "persona.phrases.51": [
    "告诉我 示例手机 主屏幕入口",
    "告诉我 Android 主屏幕入口",
    "关闭本页手势提示"
  ],
  "plugins.S.1": {
    "prompt": "示例城市示例 · 周末交流说明，用温暖、清楚的画面介绍真实接待流程，不暗示保留特定图形。",
    "kind": "image",
    "artTool": "执行器甲 / OpenAI",
    "jobs": [],
    "seq": 0,
    "cuaPaused": true,
    "cuaStep": 0,
    "cuaApp": "Chrome · 资料窗口",
    "groupText": "为 资料简报四平台准备一份选题与封面交接，只做草稿。",
    "members": [
      "content",
      "art"
    ],
    "group": null,
    "biliRound": 1,
    "snsGate": "unknown",
    "snsPaused": false,
    "providerChoice": ""
  },
  "plugins.pluginLabels.23": {
    "deepseek-meihuaqi": "界面美化插件",
    "dsh-doubao-painter": "模型丁客户端生图插件",
    "dsh-doubao-image": "模型丁网页生图插件",
    "dsh-wechat-bridge": "个人消息通道桥接插件",
    "SnowLuma": "个人 协作工具丙 注入插件",
    "dsh-bili-whale": "发布通道自动漫游插件",
    "Whale 示例系列（world / qq / wechat / bili / douyin）": "自动漫游示例系列",
    "dafayu-pixiv-duty": "插画站值守插件",
    "dsh-pixiv-scroll": "插画站自动浏览插件",
    "dsh-game-daily": "游戏日常插件",
    "dsh-bili-subagent": "发布通道任务子代理插件",
    "dsh-bili-interact": "发布通道自动互动插件",
    "indextts2-longform-workbench": "长音频语音工作台"
  },
  "plugins.tools.24": [
    [
      "doubao",
      "模型丁",
      "未连接",
      null,
      "文本整理与人工参考；不接自动化生图",
      "整理助理",
      "人工入口研究"
    ],
    [
      "gemini",
      "模型丙",
      "待接原生模型服务",
      null,
      "长材料阅读、研究草稿",
      "研究助理",
      "官方模型服务研究"
    ],
    [
      "openai",
      "ChatGPT / 执行器甲",
      "模拟已登录",
      38,
      "示例模型丙 / Terra、OpenAI 图像；有限任务交接",
      "总管 · 设计助理",
      "有限任务交接与生成台账"
    ],
    [
      "grok",
      "模型乙",
      "登录态待核",
      24,
      "示例模型乙 研究、交叉复核",
      "研究助理",
      "示例执行器乙 路由"
    ],
    [
      "comfy",
      "图形工具",
      "资料时未监听",
      null,
      "工作流与已有资产浏览；生图不路由到此",
      "设计助理",
      "图形工具 工作台研究"
    ],
    [
      "seedance",
      "示例视频工具 · 视频工具",
      "未连接",
      12,
      "视频包准备、连续性预检、审片交接",
      "设计助理",
      "示例工作台"
    ],
    [
      "wan",
      "视频工具视频",
      "未连接",
      null,
      "仅经 示例视频工具 做视频草稿/成片；逐次付费授权",
      "设计助理",
      "示例视频工具 视频路线"
    ],
    [
      "tts",
      "语音合成",
      "模拟路由已选",
      16,
      "设备甲本地 TTS、逐句配音任务登记",
      "整理助理 · 写作助理",
      "本地 TTS 与 ASR 路由 / 示例短片配音主控"
    ],
    [
      "asr",
      "语音识别",
      "端点待核",
      null,
      "设备丁本地 ASR、中日听写",
      "写作助理",
      "本地 TTS 与 ASR 路由"
    ],
    [
      "opencode",
      "示例模型池",
      "模拟复用本机登录",
      21,
      "示例模型甲 文本整理、按手册执行",
      "协调助理",
      "示例模型池 执行路由"
    ],
    [
      "local",
      "示例本地模型 / 示例工作器",
      "未接新壳",
      null,
      "设备丁 示例模型 视觉理解；示例工作器 控制候选待核",
      "协调助理",
      "扩展点地图 / 应用操控研究"
    ],
    [
      "kb",
      "知识库 · reader",
      "只读演示",
      null,
      "按需检索、来源与证据；不写正本",
      "全部 bot",
      "kb-agent / 示例提供方 资料接入"
    ]
  ],
  "plugins.subscriptionIds.25": [
    "doubao",
    "gemini",
    "openai",
    "grok",
    "comfy",
    "seedance",
    "wan",
    "opencode"
  ],
  "plugins.sample.28": [
    "seedance",
    "wan",
    "openai"
  ],
  "plugins.sample.36": [
    [
      "image",
      "图片 · 执行器甲/OpenAI"
    ],
    [
      "video",
      "视频 · 示例视频工具"
    ]
  ],
  "plugins.sample.39": [
    "执行器甲 / OpenAI"
  ],
  "plugins.sample.40": [
    "示例视频工具 · 视频工具",
    "示例视频工具 · 视频工具视频"
  ],
  "plugins.apps.43": [
    {
      "name": "Chrome · 资料窗口",
      "machine": "设备丙",
      "tier": "绿 · 只看",
      "permission": "L0 · 只读自动；仅公开页",
      "calibrated": "未校准（演示）",
      "allowed": true
    },
    {
      "name": "剪映 · 隔离草稿",
      "machine": "设备甲",
      "tier": "黄 · 每次先问",
      "permission": "L3 · 强制审批；仅沙盒剪辑草稿",
      "calibrated": "未校准（演示）",
      "allowed": true
    },
    {
      "name": "消息通道 · 演示客户端",
      "machine": "设备甲",
      "tier": "红 · 每步批准",
      "permission": "L3 · 强制审批；仅演示草稿，每步批准，未发送",
      "calibrated": "未校准（演示）",
      "allowed": true
    },
    {
      "name": "图形工具 · 资产浏览",
      "machine": "设备丁",
      "tier": "绿 · 只看",
      "permission": "L0 · 只读自动；仅已有资产",
      "calibrated": "未校准（演示）",
      "allowed": true
    },
    {
      "name": "消息通道 · 主账号",
      "machine": "设备乙",
      "tier": "红 · 每步批准",
      "permission": "L4 · 直接拒绝；本页禁区，不接管、不发送",
      "calibrated": "未校准（演示）",
      "allowed": false
    },
    {
      "name": "示例机构与协作目录",
      "machine": "设备戊",
      "tier": "红 · 每步批准",
      "permission": "L4 · 直接拒绝；本页禁区，不读不写",
      "calibrated": "未校准（演示）",
      "allowed": false
    }
  ],
  "plugins.channels.44": [
    [
      "消息通道成员 · 真实键鼠",
      "未接入",
      "写作助理",
      "普通成员参与；只出草稿，发送前先问；主账号不碰",
      "您好，周末交流请先告诉我们大概来店时间，店方会进一步确认。"
    ],
    [
      "消息通道",
      "未连接",
      "写作助理",
      "中日咨询草稿，预约/健康事项交店方",
      "お問い合わせありがとうございます。ご来店のおおよその日時をお知らせください。"
    ],
    [
      "官网客服",
      "模拟连接",
      "写作助理",
      "公开 FAQ；不把 消息通道 点击记成咨询",
      "已整理交流流程，具体资料状态以店方当天确认为准。"
    ],
    [
      "邮件",
      "未连接",
      "总管",
      "只拟稿，不自动发送",
      "已准备项目进度草稿，待人工补齐收件人和确认内容。"
    ],
    [
      "通知通道",
      "未连接",
      "协调助理",
      "仅内部任务状态草稿",
      "本轮证据已整理，连接状态与真实运行仍待核。"
    ],
    [
      "协作通道 / 协作工具甲 / 协作工具乙 / 协作工具丙 官方 bot",
      "未连接",
      "总管",
      "只评估官方 bot，不接个人号注入",
      "官方通道接入方案待审，不会自动绑定。"
    ]
  ],
  "plugins.contextParts.45": [
    {
      "name": "系统",
      "tokens": 4200,
      "content": "角色：总管。范围：离线草稿；不发消息、不付费、不碰生产。",
      "locked": true
    },
    {
      "name": "记忆",
      "tokens": 3800,
      "content": "项目线索：示例、资料简报。记忆仅作指针，动态事实回正本核验。"
    },
    {
      "name": "文件",
      "tokens": 8600,
      "content": "tasks/plugins.md、feature-map.md、prior 清单；只取当前任务相关片段。"
    },
    {
      "name": "对话",
      "tokens": 12600,
      "content": "当前轮任务目标与人工反馈；示例对话，无真实聊天。"
    },
    {
      "name": "工具结果",
      "tokens": 6400,
      "content": "模拟状态检查与草稿回执；无真实调用输出。"
    }
  ],
  "plugins.extensions.46": [
    {
      "name": "知识库 reader MCP",
      "type": "MCP",
      "enabled": true,
      "bots": [
        "chief",
        "research"
      ],
      "scope": "只读来源检索，不写知识正本",
      "from": "kb-agent / 示例提供方 资料接入"
    },
    {
      "name": "本地文件与工作区",
      "type": "MCP",
      "enabled": false,
      "bots": [
        "pm"
      ],
      "scope": "仅当前隔离目录，默认只读",
      "from": "dsh-mcp-client / mcp-resources"
    },
    {
      "name": "浏览器公开页",
      "type": "MCP",
      "enabled": false,
      "bots": [
        "research"
      ],
      "scope": "公开页只读；无 Cookie 导入",
      "from": "Tobs 适配层思路"
    },
    {
      "name": "有限任务交接",
      "type": "skill",
      "enabled": false,
      "bots": [
        "pm"
      ],
      "scope": "有限任务包；验收与写入目录明确",
      "from": "codex-worker"
    },
    {
      "name": "发布通道公开选题学习",
      "type": "skill",
      "enabled": true,
      "bots": [
        "content",
        "research"
      ],
      "scope": "匿名只读选题，412 停止",
      "from": "示例 内容选题池 / bili-scroll"
    },
    {
      "name": "示例工作台预检",
      "type": "skill",
      "enabled": true,
      "bots": [
        "art"
      ],
      "scope": "参考包、连续性、回执；不发起付费生成",
      "from": "示例工作台"
    },
    {
      "name": "内容渠道 Harness v2",
      "type": "skill",
      "enabled": false,
      "bots": [
        "content"
      ],
      "scope": "账号身份、任务包、指纹、防重、逐图预览",
      "from": "内容渠道 Harness v2 / 内容渠道 发布闸门"
    },
    {
      "name": "示例客服知识树",
      "type": "skill",
      "enabled": true,
      "bots": [
        "writer"
      ],
      "scope": "分类 → 场景 → 问题，中日对照草稿",
      "from": "示例 客服 Wiki / 客服语料质量门"
    }
  ],
  "plugins.topics.47": [
    {
      "title": "示例本地模型 能完成哪些视觉理解任务？",
      "angle": "将可访问接口与真实任务正确率分开",
      "source": "发布通道公开检索样例 · example.com/bili/demo-local",
      "status": "candidate",
      "subtitle": "字幕不可用 · 遇 412 已停止"
    },
    {
      "title": "多 bot 工作流里，人工验收放在哪里？",
      "angle": "DS Bot 的阶段回执与人签收",
      "source": "发布通道公开检索样例 · example.com/bili/demo-bots",
      "status": "selected",
      "subtitle": "无字幕，仅标题线索"
    },
    {
      "title": "AI 视频参考包怎样减少角色漂移？",
      "angle": "导演台的角色、动作与连续性检查",
      "source": "发布通道公开检索样例 · example.com/bili/demo-video",
      "status": "candidate",
      "subtitle": "字幕未读取"
    },
    {
      "title": "把工具调用成功当成任务完成的误区",
      "angle": "进程、交付、采用分别出示证据",
      "source": "发布通道公开检索样例 · example.com/bili/demo-proof",
      "status": "rejected",
      "subtitle": "只读摘要草稿"
    }
  ],
  "plugins.providers.48": [
    {
      "name": "示例提供方",
      "endpoint": "https://deepseek.example.com/v1",
      "model": "示例模型甲",
      "status": "未连接",
      "kind": "API · 凭据未读"
    },
    {
      "name": "示例模型池",
      "endpoint": "本机 CLI · 不展示登录文件",
      "model": "示例模型甲",
      "status": "模拟登录复用",
      "kind": "订阅 · 窗口未知"
    },
    {
      "name": "xAI",
      "endpoint": "https://xai.example.com/v1",
      "model": "示例模型乙",
      "status": "登录待核",
      "kind": "CLI / OAuth 方案待核"
    },
    {
      "name": "OpenAI",
      "endpoint": "https://openai.example.com/v1",
      "model": "示例模型丙 / Terra · OpenAI 图像",
      "status": "模拟已登录",
      "kind": "CLI 订阅 / API 分开核验"
    },
    {
      "name": "示例本地模型 / 示例工作器",
      "endpoint": "https://example.invalid/v1",
      "model": "示例模型 视觉理解 / 示例工作器 候选",
      "status": "未接新壳",
      "kind": "设备丁 · 当前健康未知"
    }
  ],
  "plugins.pluginReviews.49": [
    [
      "前台操作与后台回报插件",
      "只学界面与思路",
      "借鉴前台逐步动手与后台回报；不搬默认完全权限和自动放行。"
    ],
    [
      "动漫音色插件",
      "只学界面与思路",
      "借鉴授权素材到试听验收的流程；主包没有开放许可。"
    ],
    [
      "进阶音色训练插件",
      "只学界面与思路",
      "借鉴计划、训练回执与产物验收；训练产物不等于可播放音色。"
    ],
    [
      "陪看辅助插件",
      "只学界面与思路",
      "借鉴绑定、焦点暂停和静音；补丁只支持指定版本的陪看插件，不搬采集引擎。"
    ],
    [
      "视频分镜插件",
      "采用能力",
      "采用可引用分镜与时间码、先估算再放大；不安装原插件。"
    ],
    [
      "小智 图形",
      "采用能力",
      "复用形象、表情与播放口型的能力方向；引擎、资产许可和当前连接仍待核。"
    ],
    [
      "Coopanion",
      "只学界面与思路",
      "借鉴一个 bot 多套装扮联动；独立桌宠，代码与素材许可分开核对。"
    ],
    [
      "Cortico",
      "只学界面与思路",
      "借鉴安静节律、事件合批和闭集表情；独立宿主，不当 DSH 插件安装。"
    ]
  ],
  "plugins.data.52": {
    "sender": "交流咨询成员（演示）",
    "conversation": "写作交流小群（演示）",
    "summary": "成员询问周末交流前需要准备什么；没有读取真实来信。",
    "suggestedReply": "谢谢咨询，请先告诉我们期望来店的时段，具体安排由店方进一步确认。"
  },
  "plugins.data.53": {
    "conversation": "交流咨询私聊（演示）",
    "draft": "谢谢咨询！请先告诉我们期望来店的时段，店方会进一步确认交流安排。此条为待审草稿，尚未发送。"
  },
  "plugins.data.54": {
    "task": "消息通道客户端 · 普通成员草稿预演（未发送）",
    "step": 0,
    "steps": [
      "选择演示会话",
      "整理草稿",
      "遇到验证码即停（演示）",
      "等待人工确认"
    ],
    "screenLabel": "消息通道客户端屏幕占位 · 无真实截图",
    "permission": "L3",
    "app": "消息通道 · 演示客户端",
    "tier": "red",
    "background": {
      "summary": "尚未交给后台"
    }
  },
  "plugins.connectionDemo.56": {
    "checkedAt": "2026-11-13 11:58 JST",
    "account": "身份未核验",
    "history": [
      {
        "time": "2026-11-13 11:58 JST",
        "scope": "账号清单",
        "before": "待整理",
        "after": "已列出接入缺口",
        "evidence": "只整理本页元数据，未读取登录文件。"
      },
      {
        "time": "2026-11-13 11:45 JST",
        "scope": "通道清单",
        "before": "接入待核",
        "after": "保留草稿模式",
        "evidence": "真实连接未验证；无账号绑定或消息外发。"
      }
    ]
  },
  "plugins.samples.57": [
    {
      "id": "plugins-lab-writer",
      "name": "咨询草稿任务",
      "kind": "任务"
    },
    {
      "id": "plugins-lab-line",
      "name": "回复校对任务",
      "kind": "任务"
    }
  ],
  "plugins.samples.58": [
    {
      "id": "plugins-book-content",
      "name": "内容交接任务",
      "kind": "任务"
    },
    {
      "id": "plugins-book-sns",
      "name": "发布排期任务",
      "kind": "任务"
    }
  ],
  "plugins.phrases.63": [
    "看看写作通道状态",
    "写作通道都只出草稿",
    "将写作示例收件标为已读"
  ],
  "plugins.phrases.68": [
    "查看模型提供方",
    "让设计助理选 执行器甲",
    "让研究助理选 模型乙"
  ],
  "plugins.phrases.81": [
    "查看 内容渠道 发布缺口",
    "暂停 内容渠道 草稿队列",
    "模拟查到回执并禁止重发"
  ],
  "plugins.phrases.90": [
    "看看消息通道来信摘要",
    "准备消息通道待发草稿",
    "看看消息通道操作直播"
  ],
  "plugins.sample.95": [
    "plugins-sns"
  ],
  "governance.windows": {
    "5 小时": {
      "used": 12,
      "limit": 20,
      "tokens": 600,
      "calls": 1,
      "balance": 12,
      "gift": 0,
      "bars": [
        0.25,
        0.45,
        0.32,
        0.6,
        0.78
      ],
      "labels": [
        "05h",
        "04h",
        "03h",
        "02h",
        "01h"
      ]
    },
    "7 天": {
      "used": 12,
      "limit": 20,
      "tokens": 600,
      "calls": 1,
      "balance": 12,
      "gift": 0,
      "bars": [
        1.1,
        1.8,
        1.5,
        2.4,
        1.7,
        2,
        1.5
      ],
      "labels": [
        "六",
        "日",
        "一",
        "二",
        "三",
        "四",
        "五"
      ]
    },
    "30 天": {
      "used": 12,
      "limit": 20,
      "tokens": 600,
      "calls": 1,
      "balance": 12,
      "gift": 0,
      "bars": [
        6,
        9,
        8,
        12
      ],
      "labels": [
        "第1段",
        "第2段",
        "第3段",
        "第4段"
      ]
    }
  }
};
var DEMO_TEXT={
  "core.project.2": "workspace",
  "core.system.3": "live2d",
  "core.sample.4": "<path d=\"M-34 -6 Q-22 4 -10 -4\" fill=\"none\" stroke=\"#6b4a30\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.sample.5": "<path d=\"M10 -4 Q22 4 34 -6\" fill=\"none\" stroke=\"#6b4a30\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.sample.6": "<path d=\"M-34 -18 Q-22 -10 -12 -16\" fill=\"none\" stroke=\"#6b4a30\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.sample.7": "<path d=\"M12 -16 Q22 -10 34 -18\" fill=\"none\" stroke=\"#6b4a30\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.sample.8": "<path d=\"M-14 28 Q0 18 14 28\" fill=\"none\" stroke=\"#a56a52\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.mouth.9": "<path d=\"M-10 26 H10\" stroke=\"#a56a52\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.mouth.10": "<path d=\"M-16 24 Q0 36 16 24\" fill=\"none\" stroke=\"#a56a52\" stroke-width=\"2.2\" stroke-linecap=\"round\"/>",
  "core.brows.11": "<path d=\"M-38 -14 Q-24 -24 -12 -14\" fill=\"none\" stroke=\"#6b4a30\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.brows.12": "<path d=\"M12 -12 Q24 -14 36 -10\" fill=\"none\" stroke=\"#6b4a30\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.brows.13": "<path d=\"M-36 -14 Q-24 -22 -12 -14\" fill=\"none\" stroke=\"#6b4a30\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.brows.14": "<path d=\"M12 -14 Q24 -22 36 -14\" fill=\"none\" stroke=\"#6b4a30\" stroke-width=\"2\" stroke-linecap=\"round\"/>",
  "core.sample.15": "<path d=\"M-32 2 Q-22 12 -12 2\" fill=\"none\" stroke=\"#f0d0b8\" stroke-width=\"7\" stroke-linecap=\"round\"/>",
  "core.sample.16": "<path d=\"M-32 2 Q-22 13 -12 2\" fill=\"none\" stroke=\"#5c4030\" stroke-width=\"1.7\" stroke-linecap=\"round\"/>",
  "core.sample.17": "<path d=\"M12 2 Q22 12 32 2\" fill=\"none\" stroke=\"#f0d0b8\" stroke-width=\"7\" stroke-linecap=\"round\"/>",
  "core.sample.18": "<path d=\"M12 2 Q22 13 32 2\" fill=\"none\" stroke=\"#5c4030\" stroke-width=\"1.7\" stroke-linecap=\"round\"/>",
  "core.label.19": "vrm",
  "core.label.20": "圆角图形角色，图形 占位立绘",
  "core.label.21": "圆角图形角色，图形 占位立绘",
  "core.sample.22": "vrm",
  "core.sample.23": "<path d=\"M116 196 L78 268\" stroke=\"#8a6240\" stroke-width=\"16\" stroke-linecap=\"round\"/>",
  "core.sample.24": "<path d=\"M184 196 L222 268\" stroke=\"#8a6240\" stroke-width=\"16\" stroke-linecap=\"round\"/>",
  "core.sample.25": "<path d=\"M242 428 H270\" stroke=\"#8a6240\" stroke-width=\"3\" stroke-linecap=\"round\"/>",
  "core.sample.26": "<path d=\"M112 300 C78 340 76 400 96 438\" fill=\"none\" stroke=\"#f4efe4\" stroke-width=\"18\" stroke-linecap=\"round\"/>",
  "core.sample.27": "<path d=\"M190 300 C230 334 248 392 232 440\" fill=\"none\" stroke=\"#f4efe4\" stroke-width=\"18\" stroke-linecap=\"round\"/>",
  "core.sample.28": "已确认。写作助理继续跟到到店时间。",
  "core.sample.29": "已收回。这单先留在总管。",
  "core.sample.30": " · 10:50</p></div><button type=\"button\" class=\"ghostbtn\" data-act=\"preview\" data-file=\"",
  "core.sample.31": "<p class=\"label\">给 用户</p><div class=\"zh\">",
  "core.sample.37": "^[-\\w./]+\\.webp$",
  "core.sample.38": "",
  "core.key.40": "",
  "core.key.41": ".webp",
  "core.sample.42": "px;bottom:auto!important;transform:none!important;translate:none!important;scale:none!important;zoom:1!important;aspect-ratio:auto!important;object-fit:fill;object-position:50% 50%",
  "core.sample.43": "",
  "core.response.44": "",
  "core.sample.48": "\" stroke-linejoin=\"round\" stroke-linecap=\"round\"><path d=\"",
  "core.sample.49": "\"/><text x=\"60\" y=\"65\" dominant-baseline=\"middle\" text-anchor=\"middle\" font-size=\"76\" fill=\"",
  "core.sample.50": "<svg class=\"r22-line-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">",
  "core.sample.51": "<div class=\"grow\"><div class=\"line\"><strong>",
  "core.sample.53": "<div class=\"trajectory\"><div>11:36 · 执行器甲 交付看板回执<small>执行完成 · 本地可回滚</small></div><div>11:37 · 协调助理复核<small>证据：拖卡可落列 / token 账</small></div><div>下一步 · 等 用户 决定<small>验收回执是否写入项目日志</small></div></div>",
  "core.sample.54": "<span class=\"grow\"></span><span>图形 · 示意</span></div><div class=\"mascot-wrap\">",
  "core.sample.55": "<span><strong>示例 · 交流与接待规则</strong><small>共享知识库 / 客服场景<br>2 个相关片段 · 本地演示</small></span></button><button class=\"source\" data-act=\"profile\">",
  "core.sample.56": "</span><button class=\"switch ",
  "core.sample.57": "\" role=\"switch\" aria-checked=\"",
  "core.sample.58": "<div class=\"toggle-row full-mode-control\"><span class=\"grow\"><strong>完整模式</strong><small>常驻形态切换与电脑端右栏</small></span><button class=\"switch ",
  "core.sample.59": "\" data-act=\"full-mode\" role=\"switch\" aria-checked=\"",
  "core.sample.62": "</div><div class=\"balance-grid\"><div><small>官方账号余额</small><strong>演示点数 12</strong><small>含赠送 演示点数 12 · 演示</small></div><div><small>示例提供方 API 余额</small><strong>演示点数 12</strong><small>赠送 演示点数 12 · 演示</small></div></div><div class=\"surface\"><h3>峰谷与本次会话</h3><div class=\"setting-row\"><span class=\"grow\">示例提供方 <small>谷价时段 · 04:12:30 后切换</small></span><span class=\"pill\">谷</span></div><div class=\"setting-row\"><span class=\"grow\">模型乙 <small>未读取时段数据</small></span><span class=\"pill neutral\">未知</span></div><div class=\"setting-row\"><span class=\"grow\">示例模型池 <small>套餐额度 · 不使用 API 谷价</small></span><span class=\"pill neutral\">套餐</span></div><div class=\"row between\" style=\"margin-top:15px\"><span class=\"muted\">会话估算</span><strong>谷 演示点数 12 / 峰 演示点数 12</strong></div><p class=\"mini-note\">输入 48,620 · 缓存 37,924 · 输出 7,110。费用按 token 与价目估算，不是服务商账单。</p></div><div class=\"segmented\">",
  "core.sample.64": "示例本地模型",
  "core.sample.65": "示例本地模型",
  "core.sample.66": "<br>模型切换不清空当前会话；示例本地模型 仅展示连接位置，未调用执行服务。</p></div><div class=\"setting-row\"><span class=\"grow\">最大输出 token</span><select aria-label=\"最大输出 token\"><option>16,384</option><option>8,192</option><option>32,768</option></select></div><div class=\"setting-row\"><span class=\"grow\">重试策略</span><select aria-label=\"模型重试策略\"><option>最多 2 次 · 指数退避</option><option>关闭自动重试</option></select></div>",
  "core.sample.67": "<label class=\"field\">工作目录<input value=\"/demo/workspace\" aria-label=\"工作目录\"></label><p class=\"mini-note\">目录为演示路径，不读取本机工作文件。</p>",
  "core.sample.68": "<span class=\"pill\">检索完成 · 演示结果</span><div class=\"surface\"><p class=\"eyebrow\">共享知识库 · 2 个片段</p><h3>示例 · 交流与接待规则</h3><p class=\"muted\">来源：客服场景规则 / 交流<br>引用：可到店查看资料；不预留特定图形；接待按当天资料状态和来客人数安排。</p><p class=\"mini-note\">原始日期 11 月 12 日 · 用户确认状态待核。此处为第一版假数据的引用示意。</p></div><div class=\"surface\"><p class=\"eyebrow\">工作区文件</p><h3>晚间条目回执</h3><p class=\"muted\">来源：2026-11-13-资料简报-晚间回执.md<br>短讯通道 21 秒回执到达；发布通道封面比例不符。</p><button class=\"textbutton\" data-act=\"preview\" data-file=\"receipt\">打开交付物 ",
  "core.sample.69": "</button></div><div class=\"surface\"><h3>可读范围</h3><p class=\"muted\">总管：共享规则 + 项目交接。<br>写作助理：仅示例业务范围。<br>私有记忆不进入群聊，不向其他 bot 自动共享。</p></div>",
  "core.sample.70": "writer",
  "core.sample.71": "<div class=\"surface\"><h3>客服渠道</h3><div class=\"setting-row\"><span class=\"grow\">消息通道 · 官方 示例连接<small>未扫码 · 未连接</small></span><span class=\"pill neutral\">准备中</span></div><div class=\"setting-row\"><span class=\"grow\">消息通道<small>来源标识预留 · 未连接</small></span><span class=\"pill neutral\">调研中</span></div><p class=\"muted\" style=\"margin-top:13px\">中日双语 · 客户原文 JA / 用户 说明 ZH<br>先起草，人工批准后才发送。</p><button class=\"textbutton\" data-act=\"settings-services\">渠道与配对 ",
  "core.sample.72": "<div class=\"surface\"><div class=\"row between\"><h3>记忆</h3><span class=\"pill neutral\">按需加载</span></div><div class=\"setting-row\"><span class=\"grow\">私有记忆<small>只供当前助理读取，不进群聊</small></span><strong>12 条</strong></div><div class=\"setting-row\"><span class=\"grow\">共享规则<small>按项目白名单检索</small></span><strong>8 条</strong></div><p class=\"muted\" style=\"margin-top:13px\">容量估算 3.8k / 16k · 24%</p><div class=\"bar\" style=\"--width:24%;margin-top:8px\"><i></i></div><div class=\"actions\"><button class=\"ghostbtn\" data-act=\"sources\">引用来源</button><button class=\"ghostbtn\" data-act=\"settings-bot\">权限与范围</button></div></div><div class=\"surface\"><h3>工具与执行手</h3><p class=\"muted\">模型乙 · 曾加载，调用待核<br>执行器甲 · 无接入回执<br>示例模型池 · 隔离环境试用<br>示例本地模型 · 既有服务，未接 DSH</p></div>",
  "core.sample.73": "</div><p class=\"mini-note\">模型、强度、工作区设置仅影响下一条新会话。当前会话保持原设置。</p></div><div class=\"actions\"><button class=\"primary\" data-act=\"save-bot\">保存助理设置</button></div><div class=\"surface\"><h3>主动消息</h3><label class=\"field\">勿扰时段<select><option>22:00—08:00</option><option>始终勿扰</option></select></label><label class=\"field\">频率<select><option>仅阶段完成后</option><option>每天最多 1 次</option></select></label><label class=\"toggle-row\"><span>发送前人工审查</span><input type=\"checkbox\" checked></label></div>",
  "core.sample.75": "<p class=\"setting-head\">渠道与手机</p><div class=\"surface\"><h3>消息通道 / 消息通道</h3><p class=\"muted\">消息通道官方 示例连接：未安装、未扫码。<br>消息通道：仅调研，未连接。<br>支持能力：文本预留；图片 / 文件 / 流式均待核。</p><button class=\"ghostbtn\" data-act=\"pair\">查看配对</button></div><div class=\"surface\"><h3>远程与移动端</h3><p class=\"muted\">remote-mobile · 既有组件记录<br>本机监听范围：仅回环（演示）<br>认证加固：主线未验证</p><div class=\"actions\"><button class=\"ghostbtn\" data-act=\"pair\">",
  "core.sample.76": "<p class=\"mini-note\">文档记录，非实时检查；样张不会扫描设备或重启服务。</p><p class=\"setting-head\">认证、插件与加固</p><div class=\"health-grid\"><div><h3>主线</h3><p>认证：待复核<br>插件：跳过问题已修<br>加固：未上主线<br>CUA：已装 / 禁用</p><span class=\"pill wait\" style=\"margin-top:12px\">待核验</span></div><div><h3>canary</h3><p>认证：隔离验收<br>插件：隔离测试<br>加固：仅本分支<br>网关：canary 验收</p><span class=\"pill\">隔离记录</span></div></div><div class=\"surface\"><h3>备份与回滚</h3><div class=\"setting-row\"><span class=\"grow\">备份版本</span><strong>demo-v1-B</strong></div><div class=\"setting-row\"><span class=\"grow\">时间</span><strong>11/13 09:00</strong></div><div class=\"setting-row\"><span class=\"grow\">恢复演练</span><span class=\"pill\">隔离恢复通过 · 示例</span></div><p class=\"mini-note\">文档有既往备份与隔离恢复记录；以上版本和时间为界面演示值。</p><button class=\"textbutton\" data-act=\"backup\">查看恢复步骤 ",
  "core.sample.78": "图形工具",
  "core.sample.79": "发布通道只读选题",
  "core.sample.80": "</div><div class=\"surface\"><h3>统一服务入口</h3><p class=\"muted\">模型乙、执行器甲、OpenCode、本地执行手按任务路由。工具连接情况在设置中统一查看。</p><button class=\"textbutton\" data-act=\"settings-services\">查看服务与订阅 ",
  "core.sample.82": "</select></label><label class=\"field\">图形角色 LoRA<select data-change=\"lora\">",
  "core.sample.83": "<br>图形角色形象版本待 用户 选择。</p><div class=\"usage-row\"><div class=\"row between\"><span>示意进度</span><strong>64%</strong></div><div class=\"bar\" style=\"--width:64%\"><i></i></div></div><div class=\"actions\"><button class=\"ghostbtn\" data-act=\"comfy-result\">查看结果卡</button><button class=\"ghostbtn\" data-act=\"demo-stop\">停止预览</button></div></div><p class=\"mini-note\">不启动 图形工具、不调用模型；生图默认仅走 执行器甲 / OpenAI。工作流和队列仅表达候选插件的位置。</p>",
  "core.sample.84": "<div class=\"surface\"><div class=\"row between\"><h3>资料简报 · 晚间条目</h3><span class=\"pill\">",
  "core.sample.85": "</span></div><p class=\"muted\" style=\"margin-top:10px\">每日 19:30 · Asia/Tokyo<br>下次 11 月 13 日 19:30<br>负责人 整理助理 · 同时最多一轮</p>",
  "core.sample.87": "<div class=\"surface\"><h3>任务路由与汇总</h3><p class=\"muted\">总管 → 整理助理 / 调研助理<br>两位都交付后再汇总；当前 1 / 2 已返回。<br>写入范围：本地样张 / 指定任务文件。</p><button class=\"textbutton\" data-act=\"task-mode\">打开阶段验收 ",
  "core.sample.88": "\" style=\"text-align:left;width:100%;padding:0\">",
  "core.sample.90": "class=\"icon\" style=\"display:inline-block;vertical-align:middle;width:16px;height:16px\"",
  "core.sample.91": "</span></button><button class=\"setting-row\" data-pet-sound role=\"switch\" aria-checked=\"",
  "core.sample.92": "图形工具 出图工作台",
  "core.sample.93": "</div><p class=\"label\">ZH · 给 用户</p><div class=\"zh\">",
  "core.sample.94": "</p><div class=\"surface\"><p style=\"font-size:15px;line-height:26px\">",
  "core.sample.95": "</h3><p class=\"muted\">截止 今天 18:00 · 重试 0 / 2<br>证据：",
  "core.sample.96": "<p class=\"muted\">一条消息可以 @ 多位，总管等大家返回后汇总。</p>",
  "core.sample.97": "<button class=\"setting-row\" style=\"width:100%;text-align:left\" data-act=\"mention\" data-name=\"",
  "core.reply.105": "。各自的结果先回到这条会话，全部完成后由总管汇总。",
  "core.sample.106": "<button class=\"decision-shortcut\" data-act=\"decisions\"><strong>待 用户 决定 · ",
  "core.sample.107": "发布通道 · 只读选题",
  "core.sample.108": "<span class=\"pill neutral\">尚未连接</span><div class=\"surface\"><h3>本机 / 局域网 / 私有网络</h3><p class=\"muted\">本机：仅回环，当前演示页面。<br>局域网：未开放；开放会增加访问范围。<br>私有网络：未配置。</p></div><div class=\"surface\"><h3>消息通道官方 示例连接</h3><p class=\"muted\">正式接入前需官方扫码与授权。此页未生成真实二维码。</p><button class=\"ghostbtn\" data-act=\"demo-pair\">模拟配对状态</button></div><p class=\"mini-note\">连接标识只显示脱敏摘要，不展示凭据。</p>",
  "core.sample.109": "<div class=\"surface\"><h3>本机 · Mac</h3><p class=\"muted\">连接待核 · 只读入口预留<br>授权范围：本地可回滚样张</p></div><div class=\"surface\"><h3>本地执行站 · 示例模型</h3><p class=\"muted\">既有服务记录 · 未连接本工作台<br>SSH：未发起 · 跨机同步：未启用</p></div>",
  "core.sample.110": "<div class=\"surface\"><h3>主画面 · 真图形</h3><p class=\"muted\">摄像头未连接，未请求权限。<br>辅助层：角色字幕 / 状态 / 导播提示。<br>直播方案：调研中，未批准实施。</p></div><div class=\"toggle-list\">",
  "core.sample.111": "<h3>图形角色形象 · 版本对照</h3><p class=\"muted\">当前 ",
  "core.sample.112": " · 最终版本待 用户 选择。<br>上方为内联示意图，并非模型产物。</p><button class=\"ghostbtn\" data-act=\"comfy\">返回工作流</button></div>",
  "core.sample.113": "<div class=\"terminal\">/demo/workspace\n$ verify-board --local\n✓ 5 columns / 15 cards\n✓ reversible candidate\n\n未执行真实命令。此处展示任务的工具回执。</div><button class=\"textbutton\" data-act=\"jobs\">查看后台任务 ",
  "core.sample.114": "<p class=\"muted\">引用会附上来源，不复制整条私有上下文。</p><div class=\"surface\"><h3>今日协调 #chief-013</h3><p class=\"muted\">“短讯通道回执到了，发布通道这轮不发。”</p><button class=\"primary\" style=\"margin-top:16px\" data-act=\"insert-reference\">引用到输入框</button></div>",
  "core.sample.115": "<button class=\"setting-row\" style=\"width:100%;text-align:left\" data-act=\"extra-session\" data-index=\"",
  "core.sample.116": "</h3><div class=\"setting-row\"><span class=\"grow\">总 token</span><strong>1,240</strong></div><div class=\"setting-row\"><span class=\"grow\">输入 / 缓存 / 输出</span><strong>980 / 764 / 260</strong></div><div class=\"setting-row\"><span class=\"grow\">推理 token</span><strong>128</strong></div><div class=\"setting-row\"><span class=\"grow\">耗时 / 速度</span><strong>6.2 s / 42 tok/s</strong></div><div class=\"setting-row\"><span class=\"grow\">缓存命中率</span><strong>78%</strong></div><p class=\"mini-note\">本轮估算 谷 演示点数 12 / 峰 演示点数 12 · 样例数据</p></div>",
  "core.sample.117": "\" style=\"max-width:100%;border-radius:12px\">",
  "core.sample.118": "引用 #chief-013：「短讯通道回执到了，发布通道这轮不发。」\n",
  "core.sample.119": "<div class=\"preview-paper\"><p class=\"eyebrow\">接待流程 · 1 / 2 · 示意页</p><h2 style=\"margin:20px 0\">周六来店交流</h2><p class=\"muted\">确认大概来店时间 → 接待说明 → 现场查看资料 → 咨询。<br><br>不预留特定图形，按当天状态安排。</p></div>",
  "core.sample.120": "<div class=\"surface\"><h3>晚间排期.xlsx · 示例工作表</h3><table class=\"token-table\"><tr><th>渠道</th><th>时间</th><th>状态</th></tr><tr><td>媒体通道</td><td>19:30</td><td>待批</td></tr><tr><td>短讯通道</td><td>20:00</td><td>回执已到</td></tr><tr><td>通道</td><td>20:10</td><td>待批</td></tr></table></div>",
  "core.sample.121": "<label class=\"field\">时间<input id=\"schedule-time\" type=\"time\" value=\"19:30\"></label><label class=\"field\">运行规则<select><option>每日 · 同时只跑一轮</option><option>工作日 · 同时只跑一轮</option></select></label><button class=\"primary\" style=\"margin-top:17px\" data-act=\"save-schedule\">保存规则</button>",
  "core.sample.122": "<label class=\"field\">任务名称<input id=\"schedule-name\" placeholder=\"例如：每日项目回顾\"></label><label class=\"field\">时间<input type=\"time\" value=\"18:00\"></label><button class=\"primary\" style=\"margin-top:17px\" data-act=\"save-schedule\">保存本地规则</button>",
  "core.sample.123": "18:00",
  "core.sample.124": "<div class=\"surface\"><h3>11/12 · 第 1 轮</h3><p class=\"muted\">完成：回执整理 1 份。<br>未完成：发布通道封面不符合比例。<br>投递：本页演示会话，未真实发送。</p><button class=\"textbutton\" data-act=\"session-open\" data-id=\"content\">回到整理助理会话 ",
  "core.sample.125": "发布通道 · 只读设置",
  "core.sample.126": "19:30",
  "core.sample.127": "19:30",
  "core.sample.130": ".particle-map line",
  "core.brain.134": "示例模型甲",
  "core.Hub.135": "<strong>演示点数 12</strong>",
  "core.content.136": "<p>示例事项已经整理好了。</p><ul><li><strong>资料回复</strong> · 写作助理已备好草稿，时间和人数待补充。</li><li><strong>示例交付</strong> · 三项已核对，一项比例待修。</li><li><strong>本页确认</strong> · 查看下方卡片后再决定。</li></ul><p>所有流程只更新本页状态。</p>",
  "core.targets.137": ".contextline",
  "core.home.138": ".contextline",
  "assistants.sample.1": "\" stroke=\"#302a39\" stroke-width=\"2.4\"/><path d=\"M37 39q9-12 21-10\" fill=\"none\" stroke=\"#fff\" stroke-width=\"6\" stroke-linecap=\"round\" opacity=\".55\"/><circle cx=\"46\" cy=\"59\" r=\"3.5\" fill=\"#302a39\"/><circle cx=\"73\" cy=\"59\" r=\"3.5\" fill=\"#302a39\"/><path d=\"M54 73q6 5 12 0\" fill=\"none\" stroke=\"#302a39\" stroke-width=\"2.5\" stroke-linecap=\"round\"/></svg>",
  "assistants.sample.2": "这项调整需要总管确认。",
  "assistants.onClick.4": "请先恢复一位总管。",
  "assistants.body.5": "让设计助理画一个",
  "stewards.render.1": "<p class=\"muted\">演示余额 演示点数 12 · 非实时账单</p><button class=\"ghostbtn\" data-hub-conversation=\"",
  "views.chat.sample.1": "</div><div class=\"contextline\"><button data-context-mix aria-label=\"在聊天里查看上下文构成\">",
  "views.chat.sample.2": "writer",
  "views.chat.sample.3": " · JA / ZH · 来源：交流咨询",
  "views.chat.sample.4": "</summary><div class=\"r22-tool-body\"><p>示例 · 交流与接待规则</p><p>共享知识库 · 本轮 2 个相关片段</p><button class=\"textbutton\" data-act=\"sources\">查看引用与来源</button></div></details></div></div><div class=\"chat-tail\" aria-label=\"消息区辅助位\"></div>",
  "views.tasks.sample.1": "</h3><p>下次 今天 19:30 · 整理助理<br>每日跟进 · 同一时间只跑一轮</p></div>",
  "views.tasks.sample.2": "</span><span>截止 今天 18:00</span><span>重试 ",
  "views.tasks.sample.3": " · 估算 演示点数 12</p></div><div class=\"surface\"><div class=\"row between\"><h3>电脑操作 · CUA</h3><span class=\"pill neutral\">",
  "views.stage.renderer.1": "live2d",
  "views.stage.sample.3": "live2d",
  "views.stage.sample.4": "图形",
  "views.stage.sample.5": "图形",
  "views.stage.sample.7": "</p></div><p class=\"mini-note\">形象是占位，可换 GIF 或 图形/图形 模型。当前未加载引擎。音量驱动占位，非音素级；不播放真实音频。</p></div>",
  "views.stage.sample.8": "<div class=\"grow\"><strong>真图形直播与大屏导播</strong><p>",
  "views.stage.sample.9": "live2d",
  "views.board.sample.1": "<line data-from=\"",
  "automation.name.5": "示例客服与销售草稿",
  "automation.match.6": "写作|示例|客服|交流",
  "automation.terms.7": "写作 / 示例 / 客服 / 交流",
  "automation.bot.8": "writer",
  "automation.origin.9": "示例销售与客服规则",
  "automation.name.10": "资料简报与四平台内容",
  "automation.match.11": "速报|四平台|媒体通道|发布通道|标题",
  "automation.terms.12": "速报 / 四平台 / 媒体通道 / 发布通道 / 标题",
  "automation.origin.13": "示例内容看板",
  "automation.origin.14": "用户-video-maker v3/v4",
  "automation.origin.15": "codex-worker",
  "automation.sample.22": "15:00",
  "automation.body.23": "timeline",
  "automation.sample.24": "timeline-list",
  "automation.sample.25": "timeline",
  "automation.sample.26": "这是我们自己的模板墙。选好后从首页「+ → 从模板创建」开始，或跟总管说一句需求。默认 L0 只读，工人和工具仅为候选元数据。",
  "automation.sample.31": "用户-video-maker v3\\/v4",
  "automation.sample.32": "示例工作台",
  "automation.sample.33": "codex-worker",
  "automation.sample.34": "示例内容看板",
  "automation.class.35": "m-automation-switch switch",
  "automation.role.36": "switch",
  "automation.candidate.37": ":00+09:00",
  "automation.sample.38": "polyline",
  "automation.sample.39": "var(--line)",
  "automation.sample.40": "var(--line-w)",
  "automation.sample.47": "知识库定时整理 / 资料简报四平台交接",
  "automation.monday.48": "2026-11-09T00:00:00Z",
  "automation.q.50": "试试：写作视频分镜；同时命中时按优先级",
  "automation.q.51": "整理写作客服草稿",
  "automation.sample.52": "脚本先判关闭 → 总管人工复核队列",
  "automation.sample.53": "无关键词命中 → 总管",
  "automation.sample.54": "总管 · 无规则命中或关闭脚本时，保留原话与来源给总管。",
  "automation.sample.55": "关闭后显示总管复核路径。",
  "automation.sample.56": "资料简报四平台标题交接",
  "automation.sample.57": "写作视频分镜",
  "automation.sample.58": "Agent 工作组控制台",
  "automation.sample.59": "DSH 看板 / codex-worker",
  "automation.sample.60": "codex-worker / 资料简报四平台交接",
  "automation.sample.61": "轮询中 · 已领取 · 负责人：示例模型丙 · 进行中",
  "automation.sample.62": "codex-worker / 可领取销售任务池",
  "automation.sample.63": "资料简报四平台",
  "automation.sample.64": "示例客服草稿",
  "automation.sample.65": "codex-worker",
  "automation.sample.66": "DSH 看板 / codex-worker",
  "automation.sample.67": "codex-worker",
  "automation.sample.68": "codex-worker",
  "automation.sample.69": "演示检查 3/3；待 用户 验收，未改任务完成状态。",
  "automation.sample.70": "codex-worker",
  "automation.sample.73": "OpenCode",
  "automation.sample.74": "codex-worker",
  "automation.sample.75": " · 选择只生成本页候选，不代表 用户 已确认。",
  "automation.sample.76": "codex-worker",
  "automation.sample.77": "Agent 工作组控制台 / codex-worker",
  "automation.sample.78": "最近采样：11/13 11:58 · 不读取真实机器。",
  "automation.sample.79": "源码、模型运行、工作组配置与 内容渠道 工作席分别显示唯一写者。",
  "automation.sample.80": "SSH 仅打开模拟终端；设备乙离线读数为未知。",
  "automation.sample.81": "工作组一周 CPU 假读数：24、32、28、45、36、42、34%",
  "automation.sample.82": "Agent 工作组控制台",
  "automation.sample.83": "Agent 工作组控制台",
  "automation.sample.84": "示例模型 · 常驻",
  "automation.sample.85": "示例模型",
  "automation.sample.86": "选择 示例模型",
  "automation.sample.87": "示例模型",
  "automation.sample.88": "示例模型",
  "automation.sample.89": "示例工作器 · 备选",
  "automation.sample.90": "示例工作器",
  "automation.sample.91": "选择 示例工作器",
  "automation.sample.92": "示例工作器",
  "automation.sample.93": "示例工作器",
  "automation.sample.94": "示例模型 七次吞吐采样：16、18、17、20、18、19、18 tok/s",
  "automation.sample.95": "Agent 工作组控制台",
  "automation.sample.96": "Agent 工作组控制台",
  "automation.sample.98": "Agent 工作组控制台 / codex-worker",
  "automation.time.99": "12:00",
  "automation.sample.100": "Agent 工作组控制台",
  "automation.sample.101": "示例客服 / 示例内容看板 / 用户-video-maker v3/v4 / 项目总管「今天」",
  "automation.sample.102": "触发：阻塞／失败 → 总管待阅箱；演示。",
  "automation.time.103": "12:00",
  "automation.sample.104": "Agent 工作组控制台",
  "automation.sample.105": "Agent 工作组控制台",
  "automation.sample.106": "资料简报四平台交接 / 项目总管「今天」",
  "automation.sample.107": "资料简报四平台交接 / codex-worker / 示例 客服 Wiki",
  "automation.sample.109": "该分类没有命中；试试「写作」「资料简报」「DSH」。",
  "automation.sample.110": "搜 资料简报",
  "automation.sample.111": "资料简报",
  "automation.sample.112": "本页搜索 · 已显示 资料简报的会话、任务、记忆与文件结果。",
  "automation.sample.113": "codex-worker",
  "automation.sample.114": "Agent 工作组控制台",
  "automation.sample.115": "的演示工作目录 · 设备甲 · ",
  "automation.sample.116": "历史事实与当前状态分开；本页无 用户 确认依据。",
  "automation.status.117": "总管",
  "automation.act.118": "已改为总管复核",
  "automation.act.122": "已启用 22:00–08:00 勿扰",
  "automation.act.124": "示例工作器",
  "automation.act.125": "示例模型",
  "automation.type.126": "automation-dispatch-timeline",
  "automation.sample.127": "\n    .m-automation-unit {display:inline-block;white-space:nowrap;overflow-wrap:normal;word-break:normal;}\n    .m-automation-root,.m-automation-panel,.m-automation-brief {\n      font:17px/24px var(--font);color:var(--ink);box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere;\n    }\n    .m-automation-box,.m-automation-row,.m-automation-actions,.m-automation-details,.m-automation-badge {box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere;}\n    .m-automation-card-head>h2,.m-automation-grow>strong,.m-automation-details>summary {min-width:0;overflow-wrap:anywhere;}\n    .m-automation-btn,.m-automation-check,.m-automation-segment {overflow-wrap:anywhere;}\n    .m-automation-timeline,.m-automation-template-wall {box-sizing:border-box;max-width:100%;min-width:0;}\n    .m-automation-storyboard {box-sizing:border-box;max-width:100%;overflow-wrap:anywhere;}\n    .m-automation-storyboard-body {display:grid;gap:10px;min-width:0;}\n    .m-automation-frames {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0;}\n    .m-automation-frame {padding:16px;min-width:0;min-height:100px;border:var(--line-w) solid var(--line);border-radius:var(--r-card);background:var(--bot-soft);color:var(--ink);font:700 15px/23px var(--round);}\n    .m-automation-cell-list {display:grid;gap:10px;min-width:0;}\n    .m-automation-cell[class~=\"ghostbtn\"] {min-width:44px;min-height:44px;max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere;font:700 15px/23px var(--font);}\n    .m-automation-cell[aria-pressed=\"true\"] {background:var(--bot-soft);outline:2px solid var(--bot-strong);outline-offset:1px;}\n    .m-automation-sound-placeholder {padding:10px;background:var(--elev-2);border:var(--line-w) dashed var(--line);border-radius:var(--r-card);color:var(--ink-2);overflow-wrap:anywhere;}\n    .m-automation-timeline-list {display:grid;gap:24px;list-style:none;margin:18px 0 0;padding:0;min-width:0;}\n    .m-automation-round {min-width:0;border-inline-start:4px solid var(--bot);padding-inline-start:12px;}\n    .m-automation-round>h3 {margin-top:0;}\n    .m-automation-worker-metrics {display:block;margin-top:6px;font:500 14px/21px var(--font);color:var(--ink-2);}\n    .m-automation-comparison {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;min-width:0;}\n    .m-automation-template-wall>.m-automation-grid {margin-top:20px;}\n    .m-automation-template .m-automation-badge {background:var(--bot-soft);color:var(--bot-strong);}\n    .m-automation-root {max-width:1120px;margin:auto;padding:0 4px 28px 0;}\n    .m-automation-head {display:flex;align-items:center;gap:16px;margin-bottom:22px;flex-wrap:wrap;}\n    .m-automation-head h1 {display:inline-block;font:700 30px/1.25 var(--round);padding:8px 18px;background:var(--bot);color:var(--bot-ink);border:var(--line-w) solid var(--line);border-radius:var(--r-pill);box-shadow:var(--shadow-hard);margin-bottom:8px;}\n    .m-automation-grow {flex:1 1 220px;min-width:0;}\n    .m-automation-stack {display:grid;gap:20px;min-width:0;}\n    .m-automation-content {margin-top:24px;min-width:0;}\n    .m-automation-grid {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:20px;min-width:0;}\n    .m-automation-box,.m-automation-brief {padding:20px;min-width:0;}\n    .m-automation-card-head {margin:-20px -20px 18px;border-radius:calc(var(--r-card) - var(--line-w)) calc(var(--r-card) - var(--line-w)) 0 0;justify-content:flex-start;color:var(--ink);}\n    .m-automation-card-head:before {content:'';flex:none;width:13px;height:13px;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--m-automation-accent,var(--bot));}\n    .m-automation-grid>.m-automation-box:nth-child(3n+2),.m-automation-stack>.m-automation-box:nth-child(3n+2) {--m-automation-accent:var(--sky);}\n    .m-automation-grid>.m-automation-box:nth-child(3n),.m-automation-stack>.m-automation-box:nth-child(3n) {--m-automation-accent:var(--pink);}\n    .m-automation-box h2,.m-automation-panel>h2 {font:700 20px/27px var(--round);}\n    .m-automation-box h3,.m-automation-panel h3,.m-automation-brief>strong {font:700 18px/25px var(--round);margin:8px 0;}\n    .m-automation-panel>h2 {margin-bottom:16px;color:var(--bot-strong);}\n    .m-automation-brief>strong {display:block;}\n    .m-automation-box .m-automation-box {background:var(--elev-2);}\n    .m-automation-muted {font-size:15px;line-height:22px;color:var(--ink-2);white-space:pre-line;margin:6px 0;}\n    .m-automation-source {max-width:100%;font-size:11px;line-height:18px;white-space:normal;margin:4px 0 16px;transform:rotate(-1deg);}\n    .m-automation-row {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 0;min-height:56px;border-bottom:var(--line-w) dashed var(--sep);}\n    .m-automation-row:last-child {border-bottom:0;}\n    .m-automation-row strong {font:700 16px/23px var(--round);}\n    .m-automation-row[style]>.m-automation-grow>strong {color:var(--bot-strong);border-bottom:3px solid var(--bot);}\n    .m-automation-actions {display:flex;align-items:center;flex-wrap:wrap;gap:10px;min-width:0;max-width:100%;padding:3px 3px 3px 0;}\n    .m-automation-btn,.m-automation-check {min-height:44px;min-width:44px;max-width:100%;white-space:normal;font:700 14px/20px var(--round);transition:background var(--motion-fast) var(--ease),transform var(--motion-fast) var(--ease);}\n    .m-automation-btn:active,.m-automation-check:active {transform:translate(1px,1px);}\n    .m-automation-check {padding:10px 14px;text-align:left;}\n    .m-automation-btn.m-automation-active,.m-automation-check[aria-checked=true] {background:var(--bot);color:var(--bot-ink);box-shadow:var(--shadow-hard);}\n    .m-automation-segments {gap:4px;padding:5px;margin:10px 0;border-radius:var(--r-pill);scrollbar-width:thin;scrollbar-color:var(--bot-strong) var(--elev-2);}\n    .m-automation-segment {font:700 14px/20px var(--round);min-width:44px;min-height:44px;padding:8px 12px;color:var(--ink-2);transition:background var(--motion-fast) var(--ease);}\n    .m-automation-row {box-shadow:none;}\n    .m-automation-switch.m-automation-switch {display:flex;align-items:center;flex:none;min-width:62px;width:62px;height:44px;min-height:44px;padding:5px;}\n    .m-automation-switch.m-automation-switch i {width:24px;height:24px;border:var(--line-w) solid var(--line);}\n    .m-automation-switch.m-automation-switch.m-automation-on i {transform:translateX(24px);}\n    .m-automation-field {gap:8px;min-width:0;margin:14px 0;font-size:15px;line-height:21px;color:var(--ink);}\n    .m-automation-field>span {font-family:var(--round);font-weight:700;}\n    .m-automation-input {display:block;box-sizing:border-box;min-width:0;width:100%;max-width:100%;min-height:48px;font:17px/24px var(--font);}\n    .m-automation-input::placeholder {color:var(--ink-3);opacity:1;}\n    .m-automation-input:focus {outline:3px solid var(--bot-strong);outline-offset:3px;}\n    .m-automation-field textarea.m-automation-input,textarea.m-automation-input {resize:vertical;min-height:154px;}\n    .m-automation-badge {gap:6px;font-size:12px;line-height:18px;white-space:normal;padding:5px 10px;max-width:100%;}\n    .m-automation-dot {display:inline-block;flex:none;width:8px;height:8px;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--bot);}\n    .m-automation-quiet {background:var(--fill);color:var(--ink-2);}\n    .m-automation-quiet .m-automation-dot {background:var(--ink-3);}\n    .m-automation-warn {background:var(--blush);color:var(--blush-ink);}\n    .m-automation-warn .m-automation-dot {background:var(--tomato);}\n    .m-automation-list-card {padding:16px;margin:0 0 18px;border-inline-start:5px solid var(--bot);}\n    .m-automation-list-card:last-child {margin-bottom:4px;}\n    .m-automation-next {display:grid;gap:4px;padding:12px;background:var(--bot-soft);font-size:14px;line-height:21px;box-shadow:none;}\n    .m-automation-next span {color:var(--ink-2);}\n    .m-automation-week {display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;margin-top:14px;}\n    .m-automation-day {display:flex;flex-direction:column;gap:10px;background:var(--elev-2);padding:12px 6px;min-width:0;}\n    .m-automation-day>strong,.m-automation-day>span {font:700 13px/18px var(--round);text-align:center;}\n    .m-automation-today {background:var(--bot-soft);outline:2px solid var(--bot-strong);outline-offset:2px;}\n    .m-automation-event {display:flex;align-items:flex-start;gap:5px;min-width:0;min-height:44px;padding:8px 5px;font:700 12px/18px var(--round);text-align:left;white-space:normal;border-radius:calc(var(--r-card) / 2);}\n    .m-automation-event .m-automation-dot {margin-top:4px;}\n    .m-automation-details {padding:0 14px;margin:10px 0 16px;min-width:0;}\n    .m-automation-details>summary {min-height:44px;padding:14px 0;font:700 15px/22px var(--round);color:var(--bot-strong);cursor:pointer;}\n    .m-automation-details[open]>summary {border-bottom:var(--line-w) solid var(--line);}\n    .m-automation-details>.m-automation-stack {padding:14px 0 18px;}\n    .m-automation-tree {border-left:var(--line-w) solid var(--line);padding-left:14px;margin-left:6px;min-width:0;}\n    .m-automation-pre {white-space:pre-wrap;overflow-wrap:anywhere;font:14px/22px ui-monospace,monospace;background:var(--elev-2);border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2);padding:14px;margin:12px 0;max-width:100%;min-width:0;}\n    .m-automation-rule {padding:0 16px;margin:0 0 16px;border-inline-start:5px solid var(--bot);transition:background var(--motion-fast) var(--ease);}\n    .m-automation-hit {background:var(--bot-soft);}\n    .m-automation-route-result {border:var(--line-w) solid var(--line);border-inline-start:6px solid var(--bot);border-radius:var(--r-card);background:var(--bot-soft);padding:16px;white-space:pre-line;font-size:15px;line-height:23px;}\n    .m-automation-table-scroll {overflow-x:auto;min-width:0;max-width:100%;border-radius:var(--r-card);border:var(--line-w) solid var(--line);box-shadow:var(--shadow-hard);background:var(--elev);scrollbar-width:thin;scrollbar-color:var(--bot-strong) var(--elev-2);}\n    .m-automation-table {width:100%;border-collapse:collapse;min-width:720px;font-size:14px;line-height:21px;text-align:left;}\n    .m-automation-table caption {text-align:left;padding:16px;color:var(--bot-strong);font:700 15px/22px var(--round);background:var(--elev-2);}\n    .m-automation-table th {background:var(--bot-soft);font-family:var(--round);font-weight:700;}\n    .m-automation-table td,.m-automation-table th {padding:14px;vertical-align:top;border-bottom:var(--line-w) solid var(--line);}\n    .m-automation-table td+td,.m-automation-table th+th {border-left:var(--line-w) solid var(--sep);}\n    .m-automation-table td:first-child {min-width:138px;}\n    .m-automation-table tbody tr:nth-child(even):not(.m-automation-hit) {background:var(--fill);}\n    .m-automation-table tr:last-child td {border-bottom:0;}\n    .m-automation-meter-wrap {display:grid;gap:7px;margin:12px 0;min-width:0;}\n    .m-automation-meter-label {display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px;line-height:19px;color:var(--ink-2);}\n    .m-automation-meter-label strong {color:var(--bot-strong);}\n    .m-automation-meter {height:12px;background:var(--elev-2);border:var(--line-w) solid var(--line);border-radius:var(--r-pill);overflow:hidden;}\n    .m-automation-meter>span {display:block;height:100%;background:var(--bot);border-radius:inherit;transition:width var(--motion-panel) var(--ease);}\n    .m-automation-meter-wrap:nth-of-type(3n+2) .m-automation-meter>span {background:var(--sky);}\n    .m-automation-meter-wrap:nth-of-type(3n) .m-automation-meter>span {background:var(--mint);}\n    .m-automation-chart {display:block;width:100%;max-width:360px;height:70px;margin:12px 0;background:var(--bot-soft);border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2);}\n    .m-automation-services {margin:0;padding:0;list-style:none;color:var(--ink-2);font-size:14px;line-height:21px;}\n    .m-automation-services li {padding:10px 0;border-bottom:var(--line-w) dashed var(--sep);}\n    .m-automation-panel {padding:18px;margin-bottom:8px;}\n    .m-automation-panel>.m-automation-box {margin-bottom:20px;background:var(--elev-2);}\n    .m-automation-error {color:var(--danger);font-size:14px;line-height:21px;}\n    @media(max-width:699px) {\n      .m-automation-frames {grid-template-columns:minmax(0,1fr);}\n      .m-automation-comparison {grid-template-columns:minmax(0,1fr);}\n      .m-automation-round {padding-inline-start:8px;}\n      .m-automation-root {padding-bottom:calc(100px + env(safe-area-inset-bottom));}\n      .m-automation-box,.m-automation-brief {padding:16px;}\n      .m-automation-card-head {margin:-16px -16px 16px;padding:12px 14px;}\n      .m-automation-head {gap:10px;margin-bottom:16px;}\n      .m-automation-head>.m-automation-grow {flex-basis:100%;}\n      .m-automation-grid {grid-template-columns:minmax(0,1fr);}\n      .m-automation-segment {padding:8px;font-size:13px;}\n      .m-automation-week {grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}\n      .m-automation-day:last-child {grid-column:1/-1;}\n      .m-automation-day {padding:12px;}\n      .m-automation-event {font-size:13px;line-height:19px;padding:10px 8px;}\n      .m-automation-tree {padding-left:10px;margin-left:2px;}\n      .m-automation-row>.m-automation-actions {max-width:100%;}\n      .m-automation-panel {padding:14px;}\n    }\n    @media(prefers-reduced-motion:reduce) {\n      .m-automation-btn,.m-automation-check,.m-automation-segment,.m-automation-switch i,.m-automation-rule,.m-automation-meter>span {transition:none;}\n      .m-automation-btn:active,.m-automation-check:active {transform:none;}\n    }\n  ",
  "automation.sample.128": "automation-dispatch-timeline",
  "automation.quoteLabel.129": "我们自己的模板墙：盯机票、记账、读论文、追番更新、写作 消息通道 回复员、每日 资料简报（演示，未真实执行）",
  "automation.type.130": "automation-dispatch-timeline",
  "automation.sample.131": "automation-dispatch-timeline",
  "automation.passed.132": ":00+09:00",
  "automation.next.133": "T23:59:59+09:00",
  "automation.render.134": "DSH 看板 / codex-worker",
  "cards-a.class.1": "art-line",
  "cards-a.class.2": "art-line",
  "cards-a.class.3": "art-line",
  "cards-a.class.4": "art-line",
  "cards-a.sample.5": "示例城市市内示意路线；非真实地图",
  "cards-a.stroke.7": "var(--line)",
  "cards-a.stroke.8": "var(--line)",
  "cards-a.sample.10": "stroke-linecap",
  "cards-a.s.15": "交流地点",
  "cards-a.sample.17": "\n    .m-cards-a-card{box-sizing:border-box;width:100%;max-width:680px;min-width:0;margin:12px 0;padding:var(--space-4);color:var(--ink);font-family:var(--font);font-size:var(--text-body);line-height:1.5;overflow-wrap:anywhere}\n    .m-cards-a-node{box-sizing:border-box;min-width:0;overflow-wrap:anywhere}\n    .m-cards-a-header{margin:calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) var(--space-4);padding:var(--space-4);border-radius:calc(var(--r-card) - var(--line-w)) calc(var(--r-card) - var(--line-w)) 0 0}\n    .m-cards-a-header>.m-cards-a-row{width:100%}.m-cards-a-title{margin:0;font:700 var(--hub-card-title-size,20px)/1.35 var(--round);color:var(--ink)}.m-cards-a-eyebrow{margin:0 0 8px;font-size:var(--text-small)}\n    .m-cards-a-row{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}.m-cards-a-grow{flex:1;min-width:0}.m-cards-a-stack{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}\n    .m-cards-a-symbol{display:grid;place-items:center;width:44px;height:44px;flex-shrink:0;border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2);box-shadow:var(--shadow-hard);background:var(--bot);color:var(--bot-ink);transform:rotate(-4deg)}.m-cards-a-symbol>.m-cards-a-icon{width:22px;height:22px}\n    .m-cards-a-chip{max-width:100%;min-height:26px;padding:3px 9px;font-size:var(--text-small);white-space:normal}.m-cards-a-good{background:var(--bot);color:var(--bot-ink)}.m-cards-a-warm{background:var(--pink);color:var(--bot-ink)}\n    .m-cards-a-note{margin:0;color:var(--ink-2);font-size:13px;line-height:1.6}.m-cards-a-source{margin:var(--space-4) 0 0;padding-top:var(--space-3);border-top:var(--line-w) dashed var(--line);font-size:var(--text-small);color:var(--ink-2)}\n    .m-cards-a-tier-note{margin:0;color:var(--ink-2);font-size:11px;line-height:1.6;white-space:nowrap}\n    .m-cards-a-secret-fields.m-cards-a-fields{grid-template-columns:max-content minmax(0,1fr)}.m-cards-a-secret-fields>.m-cards-a-el-dt{white-space:nowrap;min-width:4.5em}\n    .m-cards-a-secret-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-2)}.m-cards-a-secret-actions>.m-cards-a-button{width:100%;white-space:nowrap}.m-cards-a-secret-actions>.m-cards-a-button:first-child{grid-column:1 / -1}\n    .m-cards-a-contact-actions>.m-cards-a-button{white-space:nowrap}\n    .m-cards-a-actions{display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center}.m-cards-a-button{font-family:var(--round);font-weight:700;font-size:14px;min-width:44px;min-height:44px;max-width:100%;white-space:normal;cursor:pointer;transition:transform var(--motion-fast) var(--ease),box-shadow var(--motion-fast) var(--ease)}\n    .m-cards-a-button:hover:not(:disabled){transform:translateY(-1px)}.m-cards-a-button:active:not(:disabled){transform:translateY(1px)}.m-cards-a-button:disabled{opacity:.5;cursor:default;transform:none;box-shadow:none}\n    :is(.m-cards-a-button,.m-cards-a-input,.m-cards-a-el-summary,.m-cards-a-el-button):focus-visible,.m-cards-a-product-track:focus-visible{outline:3px solid var(--bot-strong);outline-offset:3px}.m-cards-a-card .m-cards-a-el-button[aria-pressed=true]{background:var(--bot);color:var(--bot-ink);border-color:var(--line);box-shadow:var(--shadow-hard)}\n    .m-cards-a-details{border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2);padding:0 var(--space-3);background:var(--elev-2)}.m-cards-a-details .m-cards-a-el-summary{min-height:44px;cursor:pointer;display:list-item;align-content:center;color:var(--bot-strong);font-family:var(--round);font-weight:700;font-size:14px;margin-left:18px}.m-cards-a-details[open]{padding-bottom:var(--space-3)}.m-cards-a-details[open] .m-cards-a-el-summary{margin-bottom:var(--space-2)}\n    .m-cards-a-product-track{display:flex;overflow-x:auto;gap:var(--space-3);scroll-snap-type:x mandatory;scroll-padding-inline:1px;padding:1px 5px 12px 1px;max-width:100%;overscroll-behavior-x:contain;scrollbar-width:thin}\n    .m-cards-a-product{flex:0 0 78%;min-width:0;padding:0;scroll-snap-align:start;overflow:hidden}.m-cards-a-product-art{position:relative;background:var(--lemon);border-bottom:var(--line-w) solid var(--line)}.m-cards-a-product:nth-child(3n+2) .m-cards-a-product-art{background:var(--sky)}.m-cards-a-product:nth-child(3n) .m-cards-a-product-art{background:var(--mint)}.m-cards-a-product-art .m-cards-a-chip{position:absolute;top:10px;left:10px;background:var(--elev);color:var(--ink);transform:rotate(-3deg);box-shadow:var(--shadow-hard)}\n    .m-cards-a-illustration{display:block;width:100%;height:164px;color:var(--bot-ink)}.m-cards-a-art-solid{fill:var(--pink);stroke:var(--bot-ink);stroke-width:2}.m-cards-a-art-line{fill:none;stroke:var(--bot-ink);stroke-width:3;stroke-linecap:round}.m-cards-a-product-copy{padding:var(--space-4)}.m-cards-a-product-copy .m-cards-a-el-h4{margin:0 0 8px;font:700 17px/1.4 var(--round)}.m-cards-a-price{font:700 20px/1.4 var(--round);color:var(--bot-strong);font-variant-numeric:tabular-nums}.m-cards-a-product-copy .m-cards-a-button{margin-top:12px;width:100%}\n    .m-cards-a-nav{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);justify-content:space-between}.m-cards-a-dots{display:flex;gap:6px}.m-cards-a-dot{width:10px;height:10px;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--elev-2)}.m-cards-a-dot-on{background:var(--bot)}\n    .m-cards-a-listrow{padding:var(--space-4);margin-bottom:var(--space-3);border-inline-start:5px solid var(--bot)}.m-cards-a-listrow:last-child{margin-bottom:0}.m-cards-a-flight-times{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;margin:12px 0}.m-cards-a-flight-time{font:700 24px/1.3 var(--round);font-variant-numeric:tabular-nums}.m-cards-a-flight-route{font-size:12px;text-align:center;color:var(--ink-2)}.m-cards-a-right{text-align:right}\n    .m-cards-a-hero{padding:var(--space-4);background:var(--bot-soft);border-top:5px solid var(--bot)}.m-cards-a-large{font:700 clamp(24px,5vw,34px)/1.25 var(--round);margin:8px 0;color:var(--ink)}.m-cards-a-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-3)}.m-cards-a-tile{padding:var(--space-3);background:var(--elev-2);min-width:0}.m-cards-a-tile .m-cards-a-el-strong{display:block;margin-top:5px}.m-cards-a-date{display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap}.m-cards-a-datebox{padding:12px 16px;border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2);box-shadow:var(--shadow-hard);background:var(--pink);color:var(--bot-ink);font-family:var(--round);font-weight:700;text-align:center;flex-shrink:0;transform:rotate(-3deg)}.m-cards-a-datebox .m-cards-a-el-strong{display:block;font-size:28px}\n    .m-cards-a-map{display:block;width:100%;height:auto;border:var(--line-w) solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow-hard)}.m-cards-a-hourly{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--space-2)}.m-cards-a-hour{text-align:center;padding:12px 4px;background:var(--elev-2);border-radius:calc(var(--r-card) / 2);font-size:13px}.m-cards-a-hour .m-cards-a-el-strong{display:block;margin:7px 0}.m-cards-a-hour .m-cards-a-icon{width:22px;height:22px;margin:8px auto;color:var(--bot-strong)}.m-cards-a-hour:nth-child(2){border-top:4px solid var(--sky)}.m-cards-a-hour:nth-child(3){border-top:4px solid var(--lemon)}.m-cards-a-hour:nth-child(4){border-top:4px solid var(--mint)}\n    .m-cards-a-timeline{list-style:none;padding:0;margin:4px 0}.m-cards-a-step{position:relative;margin:0 0 0 8px;padding:0 0 22px 26px;border-left:var(--line-w) solid var(--line);font-size:14px}.m-cards-a-step:last-child{padding-bottom:0;border-color:transparent}.m-cards-a-step:before{content:'';position:absolute;left:-7px;top:5px;width:12px;height:12px;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--elev-2)}.m-cards-a-step-done:before{background:var(--bot)}.m-cards-a-step .m-cards-a-el-time{display:block;color:var(--ink-2);font-size:12px;margin-top:3px}\n    .m-cards-a-fields{display:grid;grid-template-columns:66px minmax(0,1fr);gap:0;font-size:14px;margin:0;border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2);overflow:hidden;background:var(--elev)}.m-cards-a-fields .m-cards-a-el-dt,.m-cards-a-fields .m-cards-a-el-dd{padding:10px 8px;border-bottom:var(--line-w) solid var(--line)}.m-cards-a-fields .m-cards-a-el-dt{color:var(--bot-strong);background:var(--bot-soft);font-weight:700}.m-cards-a-fields .m-cards-a-el-dd{margin:0;white-space:pre-wrap;min-width:0}.m-cards-a-fields .m-cards-a-el-dt:nth-last-child(2),.m-cards-a-fields .m-cards-a-el-dd:last-child{border-bottom:0}.m-cards-a-body{white-space:pre-wrap;font-size:15px;line-height:1.65;margin:0;padding:var(--space-3);background:var(--elev);color:var(--ink);border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2)}\n    .m-cards-a-field{display:flex;flex-direction:column;gap:var(--space-2);font-size:13px;color:var(--ink-2);min-width:0;margin:0}.m-cards-a-field>.m-cards-a-el-span{font-family:var(--round);font-weight:700;color:var(--ink)}.m-cards-a-input{display:block;width:100%;min-width:0;max-width:100%;min-height:48px;border-radius:calc(var(--r-card) / 2);padding:12px;font:inherit;font-size:17px}.m-cards-a-card .m-cards-a-el-textarea{resize:vertical;min-height:160px}.m-cards-a-error{font-size:13px;color:var(--danger);font-weight:700;margin:0}\n    .m-cards-a-choice{display:flex;justify-content:flex-start;gap:12px;align-items:center;text-align:left;width:100%;border-radius:calc(var(--r-card) / 2);min-height:56px}.m-cards-a-letter{display:grid;place-items:center;width:32px;height:32px;flex-shrink:0;background:var(--lemon);color:var(--bot-ink);border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 3)}.m-cards-a-choice:nth-of-type(3n+2) .m-cards-a-letter{background:var(--sky)}.m-cards-a-choice:nth-of-type(3n) .m-cards-a-letter{background:var(--mint)}.m-cards-a-progress{height:10px;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);overflow:hidden;background:var(--elev-2);margin:8px 0}.m-cards-a-progress .m-cards-a-el-span{display:block;height:100%;background:var(--bot);border-radius:inherit}.m-cards-a-button>.m-cards-a-icon{width:22px;height:22px;display:inline-block;vertical-align:middle}.m-cards-a-chip>.m-cards-a-icon{width:16px;height:16px}.m-cards-a-star{font-size:25px;padding:6px;flex:1;color:var(--bot-strong)}.m-cards-a-status{padding:12px 14px;background:var(--bot-soft);border-inline-start:5px solid var(--bot);font-size:14px;font-weight:700;color:var(--ink)}.m-cards-a-avatar{display:grid;place-items:center;flex-shrink:0;width:58px;height:58px;border:var(--line-w) solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow-hard);background:var(--pink);color:var(--bot-ink);font:700 24px/1 var(--round);transform:rotate(-4deg)}\n    .m-cards-a-conversation-link{margin-top:var(--space-4);padding-top:var(--space-3);border-top:var(--line-w) dashed var(--line)}.m-cards-a-thumb{width:82px;flex-shrink:0;border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2);background:var(--lemon);overflow:hidden}.m-cards-a-thumb .m-cards-a-illustration{height:82px}\n    .m-cards-a-modes{margin:0;flex-wrap:wrap;overflow:visible;border-radius:var(--r-card)}.m-cards-a-modes>.m-cards-a-el-button{border:0;background:transparent;color:var(--ink);padding:10px 12px;border-radius:var(--r-pill);flex:1 1 100px}.m-cards-a-switch[class~=\"switch\"]{width:46px;min-width:46px;min-height:44px;height:44px;position:relative;flex-shrink:0;padding:0;border:0;background:transparent;box-shadow:none;cursor:pointer}.m-cards-a-switch[class~=\"switch\"]:before{content:'';position:absolute;inset:9px 0;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--elev-2)}.m-cards-a-switch[class~=\"switch\"]>.m-cards-a-el-i{position:absolute;left:4px;top:12px;width:20px;height:20px;border-radius:50%;background:var(--ink);transform:translateX(0)}.m-cards-a-switch[class~=\"switch\"][aria-checked=true]:before{background:var(--bot)}.m-cards-a-switch[class~=\"switch\"][aria-checked=true]>.m-cards-a-el-i{background:var(--bot-ink);transform:translateX(18px)}.m-cards-a-unit{display:flex;align-items:center;gap:10px;min-height:44px;margin:0;padding:0;font-size:13px;font-weight:700;color:var(--ink)}\n    @media(min-width:700px){.m-cards-a-product{flex-basis:65%}}\n    @media(max-width:699px){.m-cards-a-title{font-size:18px}.m-cards-a-flight-time{font-size:20px}.m-cards-a-fields{grid-template-columns:60px minmax(0,1fr)}.m-cards-a-grid{grid-template-columns:1fr;gap:var(--space-2)}.m-cards-a-actions .m-cards-a-button{flex:1}.m-cards-a-card .m-cards-a-nav .m-cards-a-button{flex:none}.m-cards-a-listrow{padding:var(--space-3)}}\n    @media(prefers-reduced-motion:reduce){.m-cards-a-button{transition:none}.m-cards-a-button:hover:not(:disabled),.m-cards-a-button:active:not(:disabled){transform:none}.m-cards-a-product-track{scroll-behavior:auto}}\n  ",
  "cards-a.sample.19": "写作用品候选",
  "cards-a.title.20": "给示例补一组便签板",
  "cards-a.title.22": "示例城市 BBB → 示例城甲 AAA",
  "cards-a.sample.23": "示例航空 · ",
  "cards-a.sample.24": "示例区域 BBB",
  "cards-a.sample.25": "示例站甲 AAA",
  "cards-a.sample.26": "酒店候选",
  "cards-a.sample.27": "餐厅候选",
  "cards-a.date.30": "11 月 14 日 · 12:30",
  "cards-a.sample.31": "交流前，吃顿午饭",
  "cards-a.body.32": "营业时间 11:00–20:00（演示）；过敏原、座位与预约可用性均待核。",
  "cards-a.sample.33": "写作统一工作台 · 日历",
  "cards-a.sample.35": "整理真实资料档案、确认接待空间、核对客户关心的问题。",
  "cards-a.sample.36": "交流预约是否成立仍需店方确认；本卡只展示内部准备安排。",
  "cards-a.sample.37": "写作统一工作台",
  "cards-a.sample.39": "出发点 → 沿街向东 → 路口北行 → 交流地点",
  "cards-a.title.40": "交流到达说明 · 演示",
  "cards-a.class.42": "switch switch",
  "cards-a.role.43": "switch",
  "cards-a.sample.45": "交流出行可备一件外套；这是样本，不是实时气象数据。",
  "cards-a.class.47": "timeline",
  "cards-a.sample.49": "写作耗材 · 演示记录",
  "cards-a.sample.50": "便签板示意",
  "cards-a.sample.51": "可替换便签纸板 × 2",
  "cards-a.sample.52": "示例城市文具示例店",
  "cards-a.sample.53": "创建 11/12 10:20 · 演示配送地：示例城市市内 · 无真实地址",
  "cards-a.sample.55": "写作耗材 · 演示记录",
  "cards-a.time.56": "11/14 09:00（模拟）",
  "cards-a.time.57": "11/14 11:20（模拟）",
  "cards-a.sample.58": "writer",
  "cards-a.sample.59": "写作统一工作台 · 客户协作",
  "cards-a.sample.60": "示例 客服 Wiki · 中日草稿",
  "cards-a.sample.63": "消息通道 消息",
  "cards-a.sample.64": "按钮仅演示审批，不触达邮箱或 消息通道；修改后原批准失效。",
  "cards-a.sample.65": "写作统一工作台 · 客户档案",
  "cards-a.sample.67": "交流意向 · 尚未预约",
  "cards-a.sample.68": "11/12 17:00 · 收到交流意向（演示）",
  "cards-a.sample.69": "写作统一工作台 · 任务与日历",
  "cards-a.sample.74": "示例 内容选题池",
  "cards-a.sample.77": "协调助理「今天」",
  "cards-a.class.84": "timeline",
  "cards-a.sample.85": "消息通道来信摘要",
  "cards-a.sample.86": "写作咨询群（演示）",
  "cards-a.sample.87": "想先了解交流安排（演示）",
  "cards-a.sample.88": "交流访客（演示）",
  "cards-a.sample.89": "低风险营业信息 · 先答，同时后台问 用户",
  "cards-a.sample.90": "同时通知 用户；下方可选交流时段，只会起草补发。",
  "cards-a.sample.91": "要不要顺便给客户可选交流时段？",
  "cards-a.bot.92": "writer",
  "cards-a.channel.93": "消息通道 · 交流咨询（演示）",
  "cards-a.sample.94": "消息通道待发草稿",
  "cards-a.draft.95": "您好，可以先告诉我们您方便的交流时间吗？（演示）",
  "cards-a.sample.97": "消息通道回复草稿",
  "cards-a.sample.99": "批准只改变本页状态；没有操作消息通道，也没有实际发送。",
  "cards-a.bot.100": "writer",
  "cards-a.task.101": "消息通道草稿发送预演",
  "cards-a.screenLabel.102": "消息通道操作窗口 · 离线占位",
  "cards-a.sample.103": "消息通道",
  "cards-a.sample.104": "writer",
  "cards-a.sample.105": "消息通道发送前核对",
  "cards-a.sample.106": "暂停的消息通道画面 · 离线缩略占位",
  "cards-a.sample.107": "消息通道客户端 · 屏幕缩略占位",
  "cards-a.brain.109": "示例模型甲（演示）",
  "cards-a.sample.112": "\n    .m-cards-a-screen{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--space-2);min-height:140px;padding:var(--space-4);background:var(--elev-2);color:var(--ink);border:var(--line-w) dashed var(--line);border-radius:var(--r-card);text-align:center;min-width:0}\n    .m-cards-a-screen>.m-cards-a-icon{width:32px;height:32px;color:var(--bot-strong)}\n    .m-cards-a-swatch[class~=\"ghostbtn\"]{border:var(--line-w) solid var(--line);min-height:44px}\n    .m-cards-a-swatch[aria-pressed=true]{outline:3px solid var(--bot-strong);outline-offset:2px}\n  ",
  "cards-a.sample.114": "writer",
  "cards-a.bot.116": "writer",
  "cards-a.channel.117": "消息通道 · 交流咨询（演示）",
  "cards-a.jaBody.118": "お問い合わせありがとうございます。\n11月16日 10:00、2名様での資料確認をご希望でしょうか。\n日時と人数を担当者が確認した後、改めてご案内いたします。",
  "cards-a.checks.119": "10:00",
  "cards-a.sample.120": "writer",
  "cards-a.from.121": "writer",
  "cards-a.bot.124": "writer",
  "cards-a.question.125": "要不要顺便给客户一个可选交流时段？",
  "cards-a.label.126": "11月16日 10:00",
  "cards-a.checks.127": "10:00",
  "cards-a.label.128": "11月16日 14:00",
  "cards-a.checks.129": "14:00",
  "cards-a.label.130": "11月17日 11:00",
  "cards-a.checks.131": "11:00",
  "cards-a.from.134": "writer",
  "cards-a.researchMessages.139": "**展示方式一览 · 先比较，再决定**\n横滑看便签板和文件架，参考价、来源店铺、收藏与下一张都在卡片里。商品和价格均为虚构。",
  "cards-b.sample.5": "\n    .m-cards-b-card{box-sizing:border-box;width:100%;max-width:680px;min-width:0;margin:14px 0;padding:var(--space-4);color:var(--ink);font-family:var(--font);font-size:15px;line-height:1.5}\n    .m-cards-b-node{box-sizing:border-box;min-width:0;overflow-wrap:anywhere}\n    .m-cards-b-head,.m-cards-b-row,.m-cards-b-foot,.m-cards-b-fullhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}\n    .m-cards-b-head{margin:calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) var(--space-4);padding:var(--space-4);border-radius:calc(var(--r-card) - var(--line-w)) calc(var(--r-card) - var(--line-w)) 0 0;align-items:flex-start}\n    .m-cards-b-title{font:700 var(--hub-card-title-size,18px)/1.4 var(--round);margin:0;flex:1;min-width:0;overflow-wrap:anywhere}\n    .m-cards-b-sticker{flex-shrink:0;max-width:100%;overflow-wrap:anywhere}\n    .m-cards-b-tag{display:inline-block;max-width:100%;white-space:normal;overflow-wrap:anywhere}\n    .m-cards-b-row{margin-block:var(--space-2)}\n    .m-cards-b-foot{border-top:var(--line-w) dashed var(--line);margin-top:var(--space-4);padding-top:var(--space-3);font-size:var(--text-small);justify-content:space-between;color:var(--ink-2)}\n    .m-cards-b-source{overflow-wrap:anywhere}\n    .m-cards-b-muted,.m-cards-b-note{color:var(--ink-2)}\n    .m-cards-b-note{font-size:13px;line-height:1.6;margin:9px 0;overflow-wrap:anywhere}\n    .m-cards-b-unit{display:inline;white-space:nowrap;overflow-wrap:normal;word-break:normal}\n    .m-cards-b-tier-note{font-size:11px;line-height:1.6;margin:8px 0;color:var(--ink-2);white-space:nowrap;overflow-wrap:normal}\n    .m-cards-b-grow{flex:1;min-width:0;overflow-wrap:anywhere}\n    .m-cards-b-button{min-height:44px;min-width:44px;max-width:100%;font-family:var(--round);cursor:pointer;white-space:normal;overflow-wrap:anywhere;transition:transform var(--motion-fast) var(--ease)}\n    .m-cards-b-button .m-cards-b-el-svg{width:22px;height:22px;flex:none}\n    .m-cards-b-button:hover{background:var(--bot-soft);color:var(--ink)}\n    .m-cards-b-button-primary:hover{background:var(--bot);color:var(--bot-ink)}\n    .m-cards-b-button:active{transform:translate(1px,1px)}\n    .m-cards-b-button[aria-pressed=true],.m-cards-b-button[aria-current=step]{background:var(--bot);color:var(--bot-ink);border-color:var(--line);box-shadow:var(--shadow-hard)}\n    .m-cards-b-button:focus-visible,.m-cards-b-summary:focus-visible,.m-cards-b-range:focus-visible,.m-cards-b-file:focus-visible,.m-cards-b-chart-hit:focus-visible,.m-cards-b-flow-node:focus-visible,.m-cards-b-scroll:focus-visible,.m-cards-b-thumb:focus-visible,.m-cards-b-shot:focus-visible{outline:3px solid var(--bot-strong);outline-offset:3px}\n    .m-cards-b-detail{min-width:0;color:var(--ink);padding-bottom:env(safe-area-inset-bottom,0px)}\n    .m-cards-b-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;border-radius:var(--r-card);border:var(--line-w) solid var(--line);background:var(--elev);margin-block:var(--space-3)}\n    .m-cards-b-table{border-collapse:collapse;min-width:440px;width:100%;font-size:13px;text-align:left;color:var(--ink)}\n    .m-cards-b-table .m-cards-b-el-caption{text-align:left;padding:var(--space-3);margin:0;font-family:var(--round);font-weight:700;background:var(--elev)}\n    .m-cards-b-cell{padding:12px;border-bottom:var(--line-w) solid var(--line);white-space:nowrap;text-align:left}\n    .m-cards-b-table .m-cards-b-el-tbody .m-cards-b-el-tr:nth-child(even){background:var(--bot-soft)}\n    .m-cards-b-table .m-cards-b-el-tbody .m-cards-b-el-tr:last-child .m-cards-b-cell{border-bottom:0}\n    .m-cards-b-th{background:var(--bot-soft);padding:0 5px;text-align:left;border-block:var(--line-w) solid var(--line)}\n    .m-cards-b-th .m-cards-b-button{border:0;border-radius:var(--r-pill);background:transparent;color:var(--ink);box-shadow:none;justify-content:flex-start;width:100%}\n    .m-cards-b-th[aria-sort=ascending],.m-cards-b-th[aria-sort=descending]{box-shadow:inset 0 -4px var(--bot)}\n    .m-cards-b-preview{padding:var(--space-4);border-top:6px solid var(--bot)}\n    .m-cards-b-preview .m-cards-b-el-h4{margin:12px 0;font:700 22px/1.25 var(--round)}\n    .m-cards-b-filebar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding-top:12px}\n    .m-cards-b-filebar .m-cards-b-el-svg{width:18px;height:18px;flex:none}\n    .m-cards-b-fullscreen{position:fixed;inset:0;margin:0;width:100%;height:100%;height:100dvh;max-width:none;max-height:none;border:0;padding:0;background:var(--bg);color:var(--ink);font-family:var(--font);overflow:hidden;display:flex;flex-direction:column}\n    .m-cards-b-fullscreen:not([open]){display:none}\n    .m-cards-b-fullscreen::backdrop{background:var(--bg)}\n    .m-cards-b-fullhead{flex:none;padding:calc(12px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 12px max(16px,env(safe-area-inset-left,0px));border-bottom:var(--line-w) solid var(--line);background:var(--bot-soft);font-family:var(--round);font-weight:700;flex-wrap:nowrap}\n    .m-cards-b-fullbody{flex:1;min-height:0;overflow:auto;padding:24px max(18px,env(safe-area-inset-right,0px)) calc(30px + env(safe-area-inset-bottom,0px)) max(18px,env(safe-area-inset-left,0px))}\n    .m-cards-b-page{max-width:900px;margin:0 auto;min-width:0}\n    .m-cards-b-page .m-cards-b-el-h3{font-family:var(--round);font-weight:700}\n    .m-cards-b-hero{padding:clamp(22px,6vw,64px);background:var(--bot-soft);border-top:8px solid var(--bot)}\n    .m-cards-b-hero .m-cards-b-el-h2{font:700 clamp(28px,5vw,48px)/1.15 var(--round);margin:16px 0}\n    .m-cards-b-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 3px 16px 0}\n    .m-cards-b-tile{padding:14px;border-top:6px solid var(--sky);min-width:0;overflow-wrap:anywhere}\n    .m-cards-b-tile:nth-child(3n+2){border-top-color:var(--mint)}\n    .m-cards-b-tile:nth-child(3n){border-top-color:var(--pink)}\n    .m-cards-b-big{display:block;font:700 28px/1.2 var(--round);color:var(--bot-strong);font-variant-numeric:tabular-nums;margin:8px 0}\n    .m-cards-b-range{width:100%;min-width:0;min-height:44px;accent-color:var(--bot-strong);cursor:pointer}\n    .m-cards-b-wave{display:flex;align-items:center;gap:3px;height:48px;width:100%;overflow:hidden;padding-inline:var(--space-2);border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--bot-soft)}\n    .m-cards-b-wavebar{flex:1;min-width:2px;border-radius:var(--r-pill);background:var(--sep)}\n    .m-cards-b-wavebar[data-played=true]{background:var(--bot-strong)}\n    .m-cards-b-details{min-width:0;margin-block:var(--space-2)}\n    .m-cards-b-summary{cursor:pointer;min-height:44px;padding:12px 0;font:700 13px/1.6 var(--round);color:var(--bot-strong);overflow-wrap:anywhere}\n    .m-cards-b-prose{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.7;margin:10px 0}\n    .m-cards-b-list{margin:10px 0;padding-left:22px;color:var(--ink-2);font-size:13px}\n    .m-cards-b-flow,.m-cards-b-chart{width:100%;height:auto;display:block;overflow:visible}\n    .m-cards-b-flow{max-width:320px;margin:0 auto}\n    .m-cards-b-flow .m-cards-b-el-text,.m-cards-b-chart .m-cards-b-el-text{fill:var(--ink);font-family:var(--round);font-size:12px;font-weight:700}\n    /* Display-only layers must not intercept chart, flow, or preview controls. */\n    .m-cards-b-el-text,.m-cards-b-flow .m-cards-b-el-path,.m-cards-b-chart .m-cards-b-el-line,.m-cards-b-chart .m-cards-b-el-polyline,.m-cards-b-picture,.m-cards-b-button .m-cards-b-el-svg,.m-cards-b-file .m-cards-b-el-svg,.m-cards-b-summary .m-cards-b-el-svg,.m-cards-b-window-cursor,.m-cards-b-event:before{pointer-events:none}\n    .m-cards-b-flow-node,.m-cards-b-chart-hit{cursor:pointer}\n    .m-cards-b-chart-hit[aria-pressed=true]{filter:drop-shadow(0 2px 0 var(--ink))}\n    .m-cards-b-flow-node:hover .m-cards-b-el-rect,.m-cards-b-flow-node:focus-visible .m-cards-b-el-rect{stroke:var(--bot-strong);stroke-width:3}\n    .m-cards-b-readout{padding:var(--space-3);border:var(--line-w) solid var(--line);border-radius:var(--r-card);background:var(--bot-soft);color:var(--ink);font-size:13px;min-height:44px;margin-top:var(--space-3)}\n    .m-cards-b-check{display:flex;align-items:center;gap:12px;min-height:54px;padding:10px;margin-block:var(--space-2);cursor:pointer;border:var(--line-w) solid var(--line);border-radius:var(--r-card);background:var(--elev)}\n    .m-cards-b-check .m-cards-b-el-input{width:24px;height:24px;flex:none;accent-color:var(--bot-strong)}\n    .m-cards-b-check[data-done=true]{background:var(--bot-soft)}\n    .m-cards-b-check[data-done=true] .m-cards-b-grow{text-decoration:line-through;color:var(--ink-2)}\n    .m-cards-b-meter{height:14px;overflow:hidden;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--elev-2);margin:12px 0}\n    .m-cards-b-meterfill{height:100%;border-radius:var(--r-pill);background:var(--bot);transition:width var(--motion-panel) var(--ease)}\n    .m-cards-b-compare{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr));margin-right:3px}\n    .m-cards-b-option{min-width:0;padding:var(--space-3);border-top:6px solid var(--sky);overflow-wrap:anywhere}\n    .m-cards-b-option:nth-child(3n+2){border-top-color:var(--lemon)}\n    .m-cards-b-option:nth-child(3n){border-top-color:var(--pink)}\n    .m-cards-b-option[data-selected=true]{background:var(--bot-soft);border-top-color:var(--bot)}\n    .m-cards-b-option .m-cards-b-el-h4{font:700 16px/1.4 var(--round);margin:0 0 8px}\n    .m-cards-b-timeline{list-style:none;padding:0;margin:0}\n    .m-cards-b-event{display:flex;flex-wrap:wrap;gap:12px;border-left:var(--line-w) solid var(--line);padding:0 0 18px 16px;margin-left:8px;position:relative}\n    .m-cards-b-event:before{content:'';position:absolute;left:-7px;top:7px;width:12px;height:12px;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--bot)}\n    .m-cards-b-event:nth-child(3n+2):before{background:var(--sky)}\n    .m-cards-b-event:nth-child(3n):before{background:var(--pink)}\n    .m-cards-b-event:last-child{padding-bottom:0}\n    .m-cards-b-time{font-size:12px;color:var(--ink-2);white-space:nowrap}\n    .m-cards-b-steps{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}\n    .m-cards-b-chart-modes{display:flex;align-self:flex-start;overflow-x:auto;padding:var(--space-1);gap:var(--space-1);border-radius:var(--r-pill);margin:8px 0 16px}\n    .m-cards-b-chart-modes .m-cards-b-button{flex:1;min-width:44px;box-shadow:none}\n    .m-cards-b-code{margin:0;max-width:100%;font:12px/1.8 ui-monospace,SFMono-Regular,Menlo,monospace;padding:12px 0;background:var(--elev-2);color:var(--ink);tab-size:2}\n    .m-cards-b-codeline{display:flex;min-width:max-content;padding:0 12px;white-space:pre}\n    .m-cards-b-lineno{width:34px;flex:none;padding-right:10px;text-align:right;color:var(--ink-2);user-select:none}\n    .m-cards-b-codecontent{padding-right:12px}\n    .m-cards-b-added{background:var(--bot-soft);color:var(--bot-strong)}\n    .m-cards-b-removed{background:var(--blush);color:var(--blush-ink)}\n    .m-cards-b-tree{padding-left:14px;border-left:var(--line-w) solid var(--line);min-width:0}\n    .m-cards-b-file{border-radius:var(--r-pill);text-align:left;font-family:var(--round);font-size:13px;min-height:44px;padding:8px;justify-content:flex-start;max-width:100%;overflow-wrap:anywhere;cursor:pointer}\n    .m-cards-b-file .m-cards-b-el-svg{width:17px;height:17px;flex:none}\n    .m-cards-b-summary .m-cards-b-el-svg{width:17px;height:17px;vertical-align:middle}\n    .m-cards-b-gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-right:3px}\n    .m-cards-b-thumb{display:flex;flex-direction:column;padding:0 0 10px;border-radius:var(--r-card);font-family:var(--round);font-size:12px;overflow:hidden;box-shadow:var(--shadow-hard);cursor:pointer;min-height:44px;min-width:0;gap:8px}\n    .m-cards-b-thumb .m-cards-b-el-span,.m-cards-b-shot .m-cards-b-el-span{padding-inline:4px;overflow-wrap:anywhere}\n    .m-cards-b-picture{width:100%;height:auto;display:block}\n    .m-cards-b-gallerylarge{max-width:880px;margin:0 auto}\n    .m-cards-b-gallerylarge .m-cards-b-picture{max-height:65dvh;border:var(--line-w) solid var(--line);border-radius:var(--r-card)}\n    .m-cards-b-video{position:relative;border:var(--line-w) solid var(--line);border-radius:var(--r-card);overflow:hidden;background:var(--elev-2);aspect-ratio:16/9;box-shadow:var(--shadow-hard)}\n    .m-cards-b-video .m-cards-b-picture{height:100%;object-fit:cover}\n    .m-cards-b-videoctrl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:var(--space-2)}\n    .m-cards-b-filmstrip{display:flex;gap:8px;max-width:100%;overflow-x:auto;padding:12px 3px 12px 0}\n    .m-cards-b-shot{flex:0 0 110px;padding:6px;border-radius:var(--r-card);font-family:var(--round);font-size:12px;cursor:pointer;min-height:44px}\n    .m-cards-b-shot[aria-pressed=true]{background:var(--bot-soft);color:var(--ink);box-shadow:inset 0 -4px var(--bot),var(--shadow-hard)}\n    .m-cards-b-shot .m-cards-b-picture{height:62px}\n    .m-cards-b-select,.m-cards-b-copyarea{font-family:var(--font);font-size:16px;border-radius:var(--r-card);min-height:44px;width:100%;max-width:100%;min-width:0}\n    .m-cards-b-copyarea{resize:vertical;white-space:pre-wrap}\n    .m-cards-b-citation{padding:12px 0;border-bottom:var(--line-w) dashed var(--line);min-width:0}\n    .m-cards-b-path{display:block;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink-2);margin:9px 0}\n    .m-cards-b-alert{padding:var(--space-4);border:var(--line-w) solid var(--line);border-left:6px solid var(--tomato);border-radius:var(--r-card);background:var(--blush);color:var(--ink)}\n    .m-cards-b-alert .m-cards-b-el-strong{font-family:var(--round);font-weight:700}\n    .m-cards-b-alert .m-cards-b-note{color:var(--blush-ink)}\n    .m-cards-b-formula{display:block;overflow-x:auto;font:700 22px/1.8 var(--round);text-align:center;padding:var(--space-4);background:var(--bot-soft);color:var(--ink);border:var(--line-w) solid var(--line);border-radius:var(--r-card);margin:12px 0;white-space:nowrap}\n    .m-cards-b-inlineformula{font-family:var(--round);font-weight:700;padding:2px 5px;background:var(--bot-soft);border-bottom:2px solid var(--bot);white-space:nowrap}\n    @media(max-width:699px){.m-cards-b-table{min-width:0;table-layout:fixed}.m-cards-b-cell{white-space:normal;padding:8px}.m-cards-b-codeline{min-width:0;white-space:pre-wrap}.m-cards-b-codecontent{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}.m-cards-b-formula,.m-cards-b-inlineformula{white-space:normal;overflow-wrap:anywhere}.m-cards-b-formula{font-size:18px}.m-cards-b-filmstrip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.m-cards-b-shot{min-width:0;width:100%}.m-cards-b-compare{grid-template-columns:1fr}.m-cards-b-grid{grid-template-columns:1fr}.m-cards-b-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}.m-cards-b-fullbody{padding-top:14px}}\n\n    .m-cards-b-background-report{box-sizing:border-box;width:100%;max-width:680px;min-width:0;padding:12px;margin:12px 0;color:var(--ink);overflow-wrap:anywhere;border-left:5px solid var(--bot)}\n    .m-cards-b-background-report .m-cards-b-prose{font-size:var(--text-small);margin:6px 0}\n    .m-cards-b-background-report .m-cards-b-note{margin:4px 0}\n    .m-cards-b-body{min-width:0;overflow-wrap:anywhere}\n    .m-cards-b-screen{border:var(--line-w) solid var(--line);border-radius:var(--r-card);background:var(--elev-2);overflow:hidden;margin:var(--space-3) 3px var(--space-3) 0;box-shadow:var(--shadow-hard)}\n    .m-cards-b-window-bar{display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--bot-soft);border-bottom:var(--line-w) solid var(--line);font-size:var(--text-small)}\n    .m-cards-b-window-dot{width:8px;height:8px;border-radius:var(--r-pill);background:var(--bot-strong);flex:none}\n    .m-cards-b-window-content{position:relative;padding:18px;min-height:130px;display:grid;gap:12px;align-content:start}\n    .m-cards-b-window-line{height:9px;width:70%;border-radius:var(--r-pill);background:var(--sep)}\n    .m-cards-b-window-line:nth-child(2){width:45%}\n    .m-cards-b-window-label{font:700 14px/1.6 var(--round);padding-right:28px;overflow-wrap:anywhere}\n    .m-cards-b-window-cursor{position:absolute;right:26px;bottom:18px;width:16px;height:23px;background:var(--bot-strong);clip-path:polygon(0 0,100% 65%,59% 68%,77% 100%,53% 100%,36% 74%,0 100%)}\n    .m-cards-b-screen[data-state=takeover]{border:2px dashed var(--danger)}\n    .m-cards-b-rules{font-size:var(--text-small);line-height:1.8;color:var(--ink);padding:var(--space-2);background:var(--bot-soft);border-radius:var(--r-card);overflow-wrap:anywhere}\n    .m-cards-b-live-steps,.m-cards-b-checkup-list{list-style:none;padding:0;margin:var(--space-3) 0}\n    .m-cards-b-live-step{display:flex;gap:10px;padding:8px 0;color:var(--ink-2);overflow-wrap:anywhere}\n    .m-cards-b-live-step[aria-current=step]{color:var(--bot-strong);font-weight:700}\n    .m-cards-b-step-mark{flex:none;min-width:22px;font-weight:700;color:var(--bot-strong)}\n    .m-cards-b-dispatch-round{padding:var(--space-3);margin:var(--space-3) 3px var(--space-3) 0;border:var(--line-w) solid var(--line);border-radius:var(--r-card);border-left:5px solid var(--bot);min-width:0}\n    .m-cards-b-worker{border-bottom:var(--line-w) dashed var(--line);min-width:0}\n    .m-cards-b-worker .m-cards-b-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n    .m-cards-b-compare-heading{font:700 16px/1.5 var(--round);margin:0 0 var(--space-2);overflow-wrap:anywhere}\n    .m-cards-b-compare-pickers,.m-cards-b-receipt-compare{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-block:var(--space-3);min-width:0}\n    .m-cards-b-compare-column{min-width:0;padding:var(--space-2);background:var(--elev);border:var(--line-w) solid var(--line);border-radius:var(--r-card)}\n    .m-cards-b-diff-line{display:flex;gap:8px;padding:10px 8px;margin:6px 0;border-left:3px solid var(--sep);font-size:var(--text-small);white-space:pre-wrap;overflow-wrap:anywhere}\n    .m-cards-b-diff-line[data-different=true]{background:var(--bot-soft);color:var(--bot-strong);border-left-color:var(--bot-strong)}\n    .m-cards-b-diff-mark{font-weight:700;flex:none}\n    .m-cards-b-checkup-item{display:flex;align-items:center;gap:10px;border-bottom:var(--line-w) dashed var(--line);padding:10px 0;min-width:0;flex-wrap:wrap}\n    .m-cards-b-checkup-item[data-warning=true]{border-left:3px solid var(--danger);padding-left:8px}\n    .m-cards-b-checkup-item .m-cards-b-note{margin:3px 0}\n    .m-cards-b-handoff-mini{width:100%;min-width:0;padding:10px 12px;margin:10px 0;border-left:5px solid var(--bot);color:var(--ink);overflow-wrap:anywhere}\n    .m-cards-b-handoff-line{display:flex;align-items:center;gap:8px;font:700 13px/1.5 var(--round);flex-wrap:wrap}\n    .m-cards-b-handoff-text{font-size:12px;line-height:1.6;margin:3px 0 0;color:var(--ink-2);overflow-wrap:anywhere}\n    @media(max-width:699px){.m-cards-b-receipt-compare,.m-cards-b-compare-pickers{grid-template-columns:1fr}}\n    @media(prefers-reduced-motion:reduce){.m-cards-b-button,.m-cards-b-meterfill{transition:none;transform:none}}\n  ",
  "cards-b.show.6": "资料简报 · 待审演示",
  "cards-b.show.7": "短讯通道、发布通道、媒体通道、通道 分别留存预览证据与回执；某平台未知不等于整期发布成功。",
  "cards-b.show.8": "来自：示例 内容选题池 / 资料简报四平台交接。",
  "cards-b.sample.9": "资料简报 · 本期交接",
  "cards-b.time.10": "00:00 / 00:12",
  "cards-b.sample.11": " / 00:12",
  "cards-b.stroke.12": "var(--line)",
  "cards-b.sample.13": "var(--line-w)",
  "cards-b.sample.14": "inlineformula",
  "cards-b.sample.15": "演示：q = 已确认咨询，s = 官网会话。消息通道 点击不直接计为咨询；分母为 0 时显示「不可计算」。",
  "cards-b.sample.17": "line",
  "cards-b.sample.18": "line",
  "cards-b.sample.19": "polyline",
  "cards-b.tile.22": " · AI建议 / 用户未确认",
  "cards-b.sample.23": " · AI建议 / 用户未确认",
  "cards-b.sample.24": "timeline",
  "cards-b.sample.26": "timeline",
  "cards-b.sample.27": "已完成本页流程演示，不自动标记 用户 已确认。",
  "cards-b.sample.28": "codeline",
  "cards-b.sample.29": "lineno",
  "cards-b.sample.30": "设备甲 · 演示",
  "cards-b.sample.33": "程序绘制的 SVG 占位，不是真图形照片或模型生成资产。",
  "cards-b.text.35": "【示例草稿，未提交】\n用途：资料简报封面；横版 16:9。\n主体：一张清晰的信息卡，留足标题安全区；只表达一个视觉重点。\n约束：参考素材需核来源，真实图形照片与创意插画分开标注；最终文字人工核对。",
  "cards-b.sample.37": "AI建议 · 用户未确认",
  "cards-b.sample.39": "资料简报 · 本期阅读页",
  "cards-b.sample.40": "资料简报 · 本期阅读页",
  "cards-b.path.41": "guides/知识条目来源与用户确认-调用.md",
  "cards-b.sample.42": "把提出者、用户 确认范围、证据日期、事实核验分开显示。",
  "cards-b.sample.43": "规则区分：用户 要求 / 用户 确认 / AI 建议 / 用户 未确认 / 待核。执行、测试或同步成功不等于用户确认。",
  "cards-b.sample.45": "窗口：演示日 00:00–24:00（示例城市）· 不与 内容渠道 曝光混算",
  "cards-b.screen.46": "window-line",
  "cards-b.screen.47": "window-line",
  "cards-b.root.48": "消息通道 草稿的分 bot 回报已留在本页会话中；未发送。",
  "cards-b.child.49": "writer",
  "cards-b.child.50": "writer-line",
  "cards-b.root.51": "writer",
  "cards-b.parent.52": "writer",
  "cards-b.bot.53": "writer-line",
  "cards-b.task.54": "消息通道 草稿",
  "cards-b.sample.56": "dispatch-timeline",
  "cards-b.columns.57": "diff-line",
  "cards-b.sample.60": "设备甲（演示）",
  "cards-b.convert.61": "dispatch-timeline",
  "cards-b.parent.62": "writer",
  "cards-b.render.63": "handoff-line",
  "cards-b.sample.64": "示例执行器甲",
  "cards-b.sample.65": "示例执行器甲",
  "cards-b.worker.67": "示例执行器甲",
  "cards-b.model.68": "示例本地模型",
  "cards-b.reply.69": "dispatch-timeline",
  "cards-b.title.72": "内容与工程 · 协调助理",
  "cards-b.messages.73": "**先看本地候选。** 这套整合是 AI建议 / 用户未确认；卡片中的数据都是演示。",
  "cards-b.sample.76": "writer",
  "cards-b.id.77": "cards-b-writer-r7",
  "cards-b.title.78": "第七轮 · 写作操作与交接",
  "cards-b.messages.80": "writer",
  "cards-b.messages.81": "演示，未真实执行。常驻分 bot 整理草稿；这里只模拟步骤，没有连接真实消息通道或 消息通道。",
  "cards-b.messages.84": "writer",
  "cards-b.messages.86": "dispatch-timeline",
  "cards-b.device.87": "设备甲（演示）",
  "cards-b.title.88": "内容与工程 · 整理助理",
  "cards-b.messages.96": "timeline",
  "cards-b.title.100": "内容与工程 · 设计助理",
  "cards-b.messages.101": "**先看参考与镜头。** 这些是 SVG 占位，不是已生成资产；整合方案为 AI建议 / 用户未确认。",
  "governance.sample.17": "演示点数 12 演示点数 12",
  "governance.sample.18": "switch switch",
  "governance.role.19": "switch",
  "governance.sample.20": "line",
  "governance.sample.21": "示例提供方 工作席 · 分层授权讨论",
  "governance.sample.23": "来源与确认标签 · 示例与四平台草稿流程",
  "governance.sample.24": "下列三条引文全部虚构，是演示来源结构，不是 用户 的真实授权或新增规则。收回会留下原话、范围与时间记录。",
  "governance.sample.25": " · 用户（演示）收回",
  "governance.stroke.26": "var(--line)",
  "governance.sample.27": "var(--line-w)",
  "governance.sample.28": "已模拟换到 示例模型甲",
  "governance.sample.29": "预算已用 演示点数 12 / ",
  "governance.sample.30": "演示点数 12",
  "governance.sample.31": "演示现金余额相对初始 演示点数 12",
  "governance.sample.32": "初始 演示点数 12 · 剩余 65.2%；赠送 演示点数 12 单列，不默认使用",
  "governance.sample.33": "示例模型乙 → 示例模型甲 · 当前 ",
  "governance.sample.34": "；费率未接提供方，本地电费与订阅摊销未知，不记作 演示点数 12。",
  "governance.sample.35": "假时段：峰段 10:30，下一谷段 12:00 · 距离下个低价时段 ",
  "governance.sample.36": "额度提醒 · 执行器甲 订阅暂停规则",
  "governance.sample.37": "示例模型乙 → 示例模型甲；只模拟文字任务路由，不调用模型",
  "governance.sample.38": "示例模型甲",
  "governance.sample.39": "示例模型乙",
  "governance.sample.40": "演示点数 12 · 剩余 ",
  "governance.sample.41": "工作台示例、示例、资料简报；币种 USD，峰谷定价为独立演示假设",
  "governance.sample.42": "Image2 批量工作流 · 视频工具 预检",
  "governance.sample.44": "Agent 工作组控制台 · 工作台示例交接",
  "governance.sample.45": "Agent 工作组控制台 · 服务、机器与最近检测",
  "governance.sample.46": "工作台示例交接 · 内容渠道 防重闸门",
  "governance.sample.48": "粘贴即放置 · workspace-set-deepseek-key",
  "governance.sample.49": "参考命令名：workspace-set-deepseek-key。这里没有项目安装器与目标配置，故仅说明流程，不提供可执行命令。",
  "governance.describe.50": "。示例模型乙 → 示例模型甲。100% 暂停优先，赠送积分不默认续跑；未调用真实模型。",
  "governance.describe.52": "；这不是 用户 的真实授权。",
  "governance.describe.53": "样张中的四项加固仅在测试分支验收；端口收敛与来源地址信任未做。历史 canary 不能推定主线已加固。复核计划",
  "governance.describe.54": "【AI整理】【用户未确认】：DSH 历史 canary 不等于上主线；资料简报逐平台核验建议。仅为给定样张，不新增用户确认。",
  "governance.describe.55": "【用户要求】给定规则摘录 · 2026-10-28：订阅用尽暂停，额外积分另获授权；正数余额不代表订阅剩余。真实额度未连接。",
  "governance.describe.56": "【用户要求】给定 AGENTS 摘录 · 日期待查：未经授权不付款、不碰生产、不外发、不部署、不删除用户数据。这里所有修改仅在本页。",
  "governance.sample.60": "\n    .m-governance-mix-bar { display: flex; height: 24px; overflow: hidden; border: var(--line-w) solid var(--line); border-radius: var(--r-pill); background: var(--elev-2); }\n    .m-governance-mix-part { display: block; flex: 0 0 auto; min-width: 0; height: 100%; }\n    .m-governance-mix-system { background: var(--violet); }\n    .m-governance-mix-memory { background: var(--mint); }\n    .m-governance-mix-files { background: var(--sky); }\n    .m-governance-mix-chat { background: var(--pink); }\n    .m-governance-mix-tools { background: var(--lemon); }\n    .m-governance-mix-choices { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,140px),1fr)); gap: var(--space-2); margin: var(--space-3) 0; border-radius: 12px; }\n    .m-governance-mix-choices > .m-governance-btn { width: 100%; min-width: 0; }\n    .m-governance-mix-top { margin: var(--space-2) 0 var(--space-4); padding-inline-start: 24px; }\n    .m-governance-wrap {\n      max-width: 1100px; min-width: 0; margin: auto; padding: 8px 4px 24px;\n      color: var(--ink); font: var(--text-body)/1.5 var(--font); overflow-wrap: anywhere;\n    }\n    .m-governance-panel { min-width: 0; color: var(--ink); display: grid; gap: var(--space-4); overflow-wrap: anywhere; }\n    .m-governance-wrap, .m-governance-panel, .m-governance-card { box-sizing: border-box; max-width: 100%; overflow-wrap: anywhere; }\n    .m-governance-line > *, .m-governance-section-head > *, .m-governance-actions > * { min-width: 0; max-width: 100%; }\n    .m-governance-field, .m-governance-btn, .m-governance-summary { box-sizing: border-box; }\n    .m-governance-heading, .m-governance-section-head, .m-governance-line, .m-governance-row {\n      display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap;\n    }\n    .m-governance-heading { margin-bottom: var(--space-5); padding: var(--space-2) 0; }\n    .m-governance-stamp { margin: 0 0 var(--space-3) var(--space-1); }\n    .m-governance-h1, .m-governance-h2, .m-governance-h3, .m-governance-title, .m-governance-big {\n      font-family: var(--round); font-weight: 700; color: var(--ink); overflow-wrap: anywhere;\n    }\n    .m-governance-h1 { font-size: clamp(28px, 4vw, 36px); line-height: 1.2; margin: 0 0 var(--space-3); }\n    .m-governance-h1::after {\n      content: ''; display: block; width: 72px; height: 6px; margin-top: var(--space-2);\n      background: linear-gradient(90deg, var(--bot) 0 40%, var(--sky) 40% 70%, var(--pink) 70%);\n      border-radius: var(--r-pill);\n    }\n    .m-governance-h2 { font-size: 21px; line-height: 1.3; margin: 0; }\n    .m-governance-h3, .m-governance-title { font-size: var(--text-body); line-height: 1.4; margin: 0; }\n    .m-governance-title { display: block; }\n    .m-governance-content { display: grid; gap: var(--space-5); margin-top: var(--space-4); min-width: 0; }\n    .m-governance-card { padding: var(--space-4); min-width: 0; }\n    .m-governance-section-head {\n      align-items: flex-start; padding: var(--space-4); margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) var(--space-4);\n      border-radius: calc(var(--r-card) - var(--line-w)) calc(var(--r-card) - var(--line-w)) 0 0;\n    }\n    .m-governance-source {\n      display: inline-block; min-width: 0; max-width: 100%; font-size: var(--text-small); line-height: 1.5;\n      color: var(--ink-2); background: var(--elev); white-space: normal; overflow-wrap: anywhere;\n    }\n    .m-governance-grow { flex: 1; min-width: 0; }\n    .m-governance-note, .m-governance-sub {\n      color: var(--ink-2); font-size: 13px; line-height: 1.6; margin: var(--space-1) 0; overflow-wrap: anywhere;\n    }\n    .m-governance-sub .m-governance-source { margin-top: var(--space-2); }\n    .m-governance-row {\n      min-height: 64px; margin: var(--space-3) 0; padding: var(--space-3);\n      border: var(--line-w) solid var(--line); border-inline-start: 5px solid var(--bot);\n      border-radius: calc(var(--r-card) * .7); background: var(--elev);\n    }\n    .m-governance-item {\n      padding: var(--space-4); margin: var(--space-4) 0; min-width: 0; border-top: 5px solid var(--bot);\n    }\n    .m-governance-item > .m-governance-row:first-child { margin-top: 0; }\n    .m-governance-actions, .m-governance-legend { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; min-width: 0; }\n    .m-governance-actions { margin: var(--space-2) 0; }\n    .m-governance-btn {\n      min-width: 44px; min-height: 44px; max-width: 100%; padding: 10px 15px;\n      font-family: var(--round); font-size: 13px; line-height: 1.5; font-weight: 700;\n      cursor: pointer; white-space: normal; overflow-wrap: anywhere;\n      transition: background var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease);\n    }\n    .m-governance-btn:hover { background: var(--bot-soft); color: var(--ink); }\n    .m-governance-btn:active { transform: translate(1px, 1px); }\n    .m-governance-btn:disabled { opacity: .5; cursor: default; }\n    .m-governance-btn:focus-visible, .m-governance-field:focus-visible,\n    .m-governance-range:focus-visible, .m-governance-switch:focus-visible {\n      outline: 3px solid var(--bot-strong); outline-offset: 3px;\n    }\n    .m-governance-primary, .m-governance-primary:hover, .m-governance-btn.m-governance-active {\n      background: var(--bot); color: var(--bot-ink); border: var(--line-w) solid var(--line); box-shadow: var(--shadow-hard);\n    }\n    .m-governance-tertiary:hover { background: var(--bot-soft); color: var(--bot-strong); }\n    .m-governance-segment {\n      gap: var(--space-1); padding: var(--space-1); flex-wrap: nowrap; overflow-x: auto;\n      margin: var(--space-3) 0; min-width: 0; max-width: 100%; scrollbar-width: thin;\n    }\n    .m-governance-segment .m-governance-btn {\n      flex: 1 0 auto; white-space: nowrap; border: 0; background: transparent; color: var(--ink); box-shadow: none;\n    }\n    .m-governance-segment .m-governance-btn.m-governance-active {\n      background: var(--bot); color: var(--bot-ink); box-shadow: inset 0 0 0 var(--line-w) var(--line);\n    }\n    .m-governance-badge { gap: 6px; padding: 5px 9px; font-size: 12px; line-height: 1.5; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }\n    .m-governance-good { color: var(--ink); background: color-mix(in srgb, var(--mint) 20%, var(--elev)); }\n    .m-governance-warm { color: var(--ink); background: color-mix(in srgb, var(--lemon) 22%, var(--elev)); }\n    .m-governance-bad { color: var(--danger); background: var(--blush); }\n    .m-governance-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; }\n    .m-governance-good .m-governance-dot { background: var(--mint); border: 1px solid var(--line); }\n    .m-governance-warm .m-governance-dot { background: var(--lemon); border: 1px solid var(--line); }\n    .m-governance-notice, .m-governance-editor {\n      background: var(--elev-2); padding: var(--space-3); margin: var(--space-3) 0;\n      font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; min-width: 0;\n    }\n    .m-governance-notice { border-inline-start: 5px solid var(--bot); }\n    .m-governance-quote {\n      margin: var(--space-3) 0; padding: var(--space-3); border: var(--line-w) dashed var(--line);\n      border-radius: calc(var(--r-card) * .6); background: var(--bot-soft); color: var(--ink);\n    }\n    .m-governance-params {\n      font: 13px/1.6 var(--font); white-space: pre-wrap; overflow-wrap: anywhere; margin: var(--space-3) 0;\n      padding: var(--space-3); border: var(--line-w) dashed var(--line); border-radius: calc(var(--r-card) * .6);\n      background: var(--elev-2); color: var(--ink);\n    }\n    .m-governance-label { gap: var(--space-2); margin: var(--space-3) 0; color: var(--ink-2); font-size: 13px; line-height: 1.5; }\n    .m-governance-field {\n      display: block; width: 100%; min-width: 0; min-height: 44px; max-width: 100%; padding: var(--space-3);\n      font: var(--text-body)/1.5 var(--font); color: var(--ink); border: var(--line-w) solid var(--line);\n      border-radius: calc(var(--r-card) * .6); background: var(--elev); resize: vertical;\n    }\n    .m-governance-toggle {\n      width: 100%; min-height: 56px; text-align: start; margin: var(--space-3) 0; padding: var(--space-2) var(--space-3);\n      border: var(--line-w) solid var(--line); border-radius: calc(var(--r-card) * .7); background: var(--elev); box-shadow: none;\n    }\n    .m-governance-switch { flex: none; min-width: 44px; min-height: 44px; cursor: pointer; }\n    .m-governance-range { display: block; width: 100%; min-height: 44px; cursor: pointer; accent-color: var(--bot-strong); }\n    .m-governance-ledger-metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--space-3); margin: var(--space-4) 0; }\n    .m-governance-summary { min-height: 44px; padding: var(--space-3); cursor: pointer; font-weight: 700; }\n    .m-governance-metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-3); margin: var(--space-4) 0; }\n    .m-governance-metric { background: var(--bot-soft); padding: var(--space-3); min-width: 0; border-top: 5px solid var(--bot); }\n    .m-governance-metric:nth-child(2) { border-top-color: var(--sky); }\n    .m-governance-metric:nth-child(3) { border-top-color: var(--pink); }\n    .m-governance-big { font-size: 22px; line-height: 1.3; display: block; font-variant-numeric: tabular-nums; }\n    .m-governance-progress {\n      height: 14px; border: var(--line-w) solid var(--line); border-radius: var(--r-pill);\n      background: var(--elev-2); overflow: hidden; margin: var(--space-3) 0;\n    }\n    .m-governance-progress-fill { display: block; height: 100%; background: var(--bot); border-radius: inherit; }\n    .m-governance-charts { display: grid; grid-template-columns: minmax(0,2fr) minmax(0,1fr); gap: var(--space-3); }\n    .m-governance-chart { margin: 0; padding: var(--space-3); min-width: 0; background: var(--elev); }\n    .m-governance-chart .m-governance-svg { display: block; width: 100%; height: 160px; font-family: var(--round); font-weight: 700; }\n    .m-governance-chart .m-governance-rect { rx: var(--space-1); }\n    .m-governance-countdown { font-variant-numeric: tabular-nums; color: var(--bot-strong); }\n    @media (max-width: 1100px) {\n      .m-governance-ledger-metrics { grid-template-columns: repeat(2,minmax(0,1fr)); }\n    }\n    @media (max-width: 959px) {\n      .m-governance-routing-row { flex-direction: column; align-items: stretch; }\n      .m-governance-routing-row > .m-governance-actions { width: 100%; margin-top: 0; }\n    }\n    @media (max-width: 699px) {\n      .m-governance-wrap { padding-bottom: calc(100px + env(safe-area-inset-bottom)); }\n      .m-governance-row { align-items: flex-start; }\n      .m-governance-row > .m-governance-grow { flex-basis: 100%; }\n      .m-governance-metrics, .m-governance-charts { grid-template-columns: minmax(0,1fr); }\n      .m-governance-panel { padding: 0 4px env(safe-area-inset-bottom); }\n    }\n    @media (prefers-reduced-motion: reduce) {\n      .m-governance-btn, .m-governance-knob { transition: none; }\n      .m-governance-btn:active { transform: none; }\n    }\n  ",
  "interact.sample.2": "用户",
  "interact.tool.6": "执行器甲",
  "interact.sample.7": "02 · 选工具 · 默认 执行器甲 · 四项均未接通",
  "interact.render.8": "执行器甲",
  "interact.task.10": "资料简报日更 · 本页素材归纳",
  "interact.sample.11": "\n    .m-interact-btn{box-sizing:border-box;min-height:44px;min-width:44px;max-width:100%;padding:8px 12px;gap:6px;font-family:var(--round);font-size:13px;font-weight:700;cursor:pointer;overflow-wrap:anywhere;white-space:normal;transition:transform var(--motion-fast) var(--ease),background var(--motion-fast) var(--ease)}\n    .m-interact-btn-secondary:hover{background:var(--bot-soft);color:var(--ink);box-shadow:var(--shadow-hard)}\n    .m-interact-btn[aria-pressed=\"true\"]{background:var(--bot);color:var(--bot-ink);border-color:var(--line);box-shadow:var(--shadow-hard)}\n    .m-interact-btn:active{transform:translate(1px,1px)}\n    .m-interact-btn:focus-visible,.m-interact-quote:focus-visible,.m-interact-input:focus-visible{outline:3px solid var(--bot-strong);outline-offset:3px}\n    .m-interact-target{min-width:44px!important;min-height:44px!important;width:44px!important;height:44px!important;display:inline-flex!important}\n    .m-interact-btn svg{width:22px;height:22px;flex-shrink:0}\n    .m-interact-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;max-width:100%}\n    .m-interact-note{font-size:12px;color:var(--ink-2);line-height:1.6;overflow-wrap:anywhere;margin:4px 0}\n    .m-interact-source{display:block;width:fit-content;max-width:100%;font-size:11px;color:var(--ink-2);line-height:1.6;margin:6px 0;overflow-wrap:anywhere;white-space:normal}\n    .m-interact-label{max-width:100%;width:fit-content;white-space:normal;overflow-wrap:anywhere;flex-shrink:0}\n    .m-interact-heading{flex-wrap:wrap;min-width:0;border:var(--line-w) solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow-hard);margin:3px 3px 4px 0}\n    .m-interact-heading strong,.m-interact-result strong,.m-interact-call>strong,.m-interact-callfull>strong{font-family:var(--round);font-size:var(--hub-card-title-size,17px);line-height:1.5;font-weight:700;min-width:0;overflow-wrap:anywhere}\n    .m-interact-heading:before{content:'';width:10px;height:10px;flex:none;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--sky);box-shadow:14px 0 0 var(--pink),28px 0 0 var(--mint);margin-right:28px}\n    .m-interact-tools{display:flex;flex-wrap:wrap;gap:8px;margin:10px 3px 3px 0;align-items:center;min-width:0}\n    .m-interact-tools .m-interact-btn{font-size:12px;padding:6px 10px}\n    .m-interact-palette{display:none;flex-wrap:wrap;gap:6px;flex-basis:100%}\n    .m-interact-article:hover .m-interact-palette,.m-interact-article:focus-within .m-interact-palette,.m-interact-revealed .m-interact-palette{display:flex}\n    .m-interact-badges{display:flex;flex-wrap:wrap;gap:8px;min-width:0}\n    .m-interact-quote{display:flex;flex-direction:column;align-items:flex-start;gap:5px;width:calc(100% - 3px);min-height:44px;text-align:left;padding:12px 16px;border:var(--line-w) solid var(--line);border-left:6px solid var(--bot);border-radius:var(--r-card);box-shadow:var(--shadow-hard);background:var(--bot-soft);color:var(--ink);font-size:13px;overflow-wrap:anywhere;cursor:pointer;margin:4px 3px 10px 0}\n    .m-interact-quote strong{font-family:var(--round);font-weight:700;color:var(--bot-strong)}\n    .m-interact-quote span{white-space:pre-wrap;max-height:7em;overflow:auto;max-width:100%}\n    .m-interact-dock{min-width:0;padding:3px 4px 9px;display:grid;gap:8px;max-height:min(38vh,300px);overflow:auto}\n    .m-interact-dock[hidden]{display:none}\n    .m-interact-bottom{position:absolute;z-index:7;border-radius:var(--r-pill);min-width:44px;width:44px;height:44px;padding:6px;box-shadow:var(--shadow-hard)}\n    .m-interact-bottom-count{position:absolute;right:-4px;top:-5px;min-width:22px;height:22px;padding:0 4px;border:var(--line-w) solid var(--line);border-radius:var(--r-pill);background:var(--bot);color:var(--bot-ink);font-size:11px;font-weight:700;line-height:19px}\n    .m-interact-draft{font-size:11px;color:var(--ink-2);margin-left:auto}\n    .m-interact-preview,.m-interact-queue,.m-interact-selection,.m-interact-pinbar{padding:10px 12px;background:var(--bot-soft);border:var(--line-w) solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow-hard);min-width:0;margin-right:3px;overflow-wrap:anywhere}\n    .m-interact-preview{display:flex;flex-wrap:wrap;align-items:center;gap:8px}\n    .m-interact-previewtext{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--ink)}\n    .m-interact-popup{border:var(--line-w) solid var(--line);border-radius:var(--r-card);background:var(--glass);backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat));padding:8px 8px 12px;display:grid;gap:6px;max-height:190px;overflow:auto;box-shadow:var(--shadow-hard);margin-right:3px}\n    .m-interact-popup .m-interact-btn{justify-content:flex-start;text-align:left;border-radius:var(--r-card)}\n    .m-interact-selected{outline:3px solid var(--bot-strong);outline-offset:3px;border-radius:var(--r-card)}\n    .m-interact-highlight{background:var(--bot-soft);outline:3px solid var(--bot-strong);border-radius:var(--r-card)}\n    .m-interact-collapsed{max-height:210px;overflow:hidden;mask-image:linear-gradient(var(--ink) 75%,transparent)}\n    .m-interact-thread{flex-basis:calc(100% - 3px);margin:8px 3px 3px 0;padding:12px;border-left:6px solid var(--bot);display:grid;gap:10px;min-width:0}\n    .m-interact-thread p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.65;margin:0}\n    .m-interact-input{box-sizing:border-box;width:100%;min-width:0;min-height:44px;font:inherit;font-size:16px;resize:vertical}\n    .m-interact-input::placeholder{color:var(--ink-2);opacity:1}\n    .m-interact-panel{display:grid;gap:14px;min-width:0;color:var(--ink);overflow-wrap:anywhere;padding-right:4px}\n    .m-interact-panel>*,.m-interact-result>*,.m-interact-stream>*,.m-interact-thread>*{min-width:0;max-width:100%;overflow-wrap:anywhere}\n    .m-interact-result{display:grid;gap:8px;padding:14px;min-width:0;margin:0 3px 3px 0;border-top:5px solid var(--bot)}\n    .m-interact-result .m-interact-btn{justify-content:flex-start;text-align:left}\n    .m-interact-stream{padding:14px 16px;overflow-wrap:anywhere;margin:0 3px 4px 0;border-top:5px solid var(--bot);display:grid;gap:12px}\n    .m-interact-streamtext{white-space:pre-wrap;line-height:1.75;margin:0;color:var(--ink)}\n    .m-interact-live .m-interact-streamtext:after{content:'▍';color:var(--bot-strong);animation:m-interact-blink 1s infinite}\n    .m-interact-files{display:flex;flex-wrap:wrap;gap:8px;min-width:0;padding:3px 3px 5px 0}\n    .m-interact-unread{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--bot-strong);font-family:var(--round);font-size:12px;font-weight:700}\n    .m-interact-unread:before,.m-interact-unread:after{content:'';height:var(--line-w);background:var(--line);flex:1}\n    .m-interact-selectionfloat{padding:8px;margin:8px 3px 4px 0;background:var(--bot-soft);border:var(--line-w) solid var(--line);border-radius:var(--r-card);box-shadow:var(--shadow-hard)}\n    .m-interact-hidden{display:none!important}\n    .m-interact-call{padding:18px;display:grid;gap:16px;text-align:center;color:var(--ink);min-width:0;margin:3px 3px 4px 0;border-top:6px solid var(--bot);background:var(--bot-soft)}\n    .m-interact-callfull{box-sizing:border-box;position:fixed;inset:12px;z-index:300;background:var(--bg);padding:calc(20px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:18px;overflow:auto;min-width:0;border-radius:var(--r-card);border:var(--line-w) solid var(--line);box-shadow:var(--shadow-hard);color:var(--ink);text-align:center}\n    .m-interact-callfull>strong{margin:0}.m-interact-callfull>.m-interact-note:last-child{margin-bottom:auto}\n    .m-interact-callfull>*{box-sizing:border-box;max-width:100%;flex-shrink:0}\n    .m-interact-callavatar{width:116px;height:116px;flex:none;margin-top:auto}\n    .m-interact-callavatar>*{width:100%;height:100%;max-width:100%;object-fit:contain}\n    .m-interact-image-job{box-sizing:border-box;display:grid;gap:12px;min-width:0;max-width:100%;padding:14px;margin:0 3px 4px 0;color:var(--ink);background:var(--elev);overflow-wrap:anywhere}\n    .m-interact-image-job>*{box-sizing:border-box;min-width:0;max-width:100%}\n    .m-interact-image-label{display:grid;gap:8px;font-family:var(--round);font-weight:700}\n    .m-interact-image-prompt{box-sizing:border-box;width:100%;min-height:88px;resize:vertical;color:var(--ink);background:var(--elev)}\n    .m-interact-image-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:6px}\n    .m-interact-image-tools [class~=\"ghostbtn\"]{min-width:0;width:100%}\n    .m-interact-image-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0}\n    .m-interact-image-grid .m-interact-image-tile{box-sizing:border-box;position:relative;display:grid;grid-template-rows:minmax(0,1fr) auto auto;gap:4px;width:100%;min-width:0;min-height:0;aspect-ratio:1/1;padding:8px;border:2px solid var(--line);border-radius:var(--r-card);overflow:hidden;text-align:center;background:var(--fill);color:var(--ink);box-shadow:none}\n    .m-interact-image-grid .m-interact-image-tile[aria-pressed=\"true\"]{border-color:var(--bot-strong);background:var(--bot-soft);color:var(--ink);box-shadow:inset 0 0 0 1px var(--bot-strong)}\n    .m-interact-image-mark{display:grid;place-items:center;min-height:0;width:100%;font-size:32px;line-height:1;color:var(--bot-strong)}\n    .m-interact-image-tile strong,.m-interact-image-caption{min-width:0;font-size:12px;line-height:16px}\n    .m-interact-image-caption{font-size:11px;color:var(--ink-2)}\n    .m-interact-image-selected{position:absolute;top:6px;right:6px;padding:2px 6px;border-radius:var(--r-pill);background:var(--bot);color:var(--bot-ink);font-size:11px;line-height:16px}\n    .m-interact-image-progress progress{display:block;width:100%;height:24px;accent-color:var(--bot-strong)}\n    .m-interact-image-delivery{padding:12px;min-width:0;background:var(--bot-soft);border:var(--line-w) solid var(--line);border-radius:var(--r-card)}\n    .m-interact-mouth{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:24px;color:var(--ink-2);font-size:12px}\n    .m-interact-mouth:before{content:'';width:12px;height:3px;border-radius:var(--r-pill);background:var(--bot-strong)}\n    .m-interact-mouth[data-mouth=\"open\"]:before{height:12px}\n    .m-interact-wave.m-interact-wave-idle i{animation:none;transform:scaleY(.2)}\n    .m-interact-transcript{width:100%;max-width:44ch;max-height:180px;min-height:60px;overflow:auto;overscroll-behavior:contain;text-align:left;padding:10px;background:var(--elev);color:var(--ink);border:var(--line-w) solid var(--line);border-radius:var(--r-card)}\n    .m-interact-captionline{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.6;margin:6px 0}\n    .m-interact-caption{line-height:1.8;font-size:17px;max-width:44ch;overflow-wrap:anywhere}\n    .m-interact-wave{height:48px;display:flex;align-items:center;justify-content:center;gap:5px;color:var(--bot-strong);flex-shrink:0}\n    .m-interact-wave i{width:4px;height:16px;border-radius:var(--r-pill);background:var(--bot);border:var(--line-w) solid var(--line);animation:m-interact-wave 800ms ease-in-out infinite alternate}\n    .m-interact-wave i:nth-child(2n){animation-delay:200ms;height:30px;background:var(--sky)}.m-interact-wave i:nth-child(3n){animation-delay:400ms;height:42px;background:var(--pink)}.m-interact-wave i:nth-child(5n){background:var(--mint)}\n    @keyframes m-interact-wave{to{transform:scaleY(.35)}}@keyframes m-interact-blink{50%{opacity:0}}\n    @media(max-width:699px){.m-interact-callfull{inset:0;border-radius:0;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))}.m-interact-callavatar{width:96px;height:96px}.m-interact-transcript{max-height:140px}.m-interact-caption{font-size:15px;margin:0}.m-interact-dock{max-height:32vh}.m-interact-panel{padding-bottom:calc(20px + env(safe-area-inset-bottom))}.m-interact-tools{gap:6px}.m-interact-btn{font-size:12px}}\n    @media(prefers-reduced-motion:reduce){.m-interact-btn{transition:none}.m-interact-wave i,.m-interact-live .m-interact-streamtext:after{animation:none}}\n  ",
  "interact.body.12": "写作统一工作台 · 对象归档",
  "interact.body.13": "文件预览位置 · 示例城市示例项目本周素材。",
  "interact.body.14": "对象：示例 · 窗边资料 · 归档状态：待选择对象、待确认",
  "interact.source.15": "写作统一工作台 · 对象归档",
  "interact.summary.16": "示例摘要：交流可以约；接待时间与资料状态需店方核对。来源日期：2026-10-15；当前状态待核。",
  "interact.summary.17": "示例素材：窗边图形元素与本周内容交接，未上传。",
  "interact.sample.18": "写作统一工作台 · 聊天归档卡",
  "interact.body.20": "示例 · 交流接待规则",
  "interact.body.21": "示例 · 交流接待规则（示例）",
  "interact.body.22": "资料简报 · 四平台发布交接",
  "interact.body.23": "资料简报 · 四平台发布交接（示例）",
  "interact.status.25": "【AI建议】【用户未确认】",
  "interact.removing.26": "用户",
  "interact.sample.27": "用户",
  "interact.sample.28": "用户",
  "interact.body.29": "当前页回应身份：用户；徽章显示参与者。",
  "interact.author.30": "用户",
  "interact.sample.31": "writer-013",
  "interact.sample.32": "writer",
  "interact.sample.33": "土曜日の午後の資料確認、ありがとうございます。お子様もご一緒にどうぞ。資料のため、静かにお願いいたします。",
  "interact.bot.34": "writer",
  "interact.channel.35": "消息通道 · 示例来访者交流回复（演示）",
  "interact.md.36": "**示例来访者周六交流回复 · 新草稿 · L3 待批**\n\n",
  "interact.from.37": "writer",
  "interact.sample.38": "帮我整理示例今天的交流接待待办。",
  "interact.sample.40": "用户",
  "memory.author.6": "演示导入 / 执行器甲",
  "memory.memories.7": "guides/执行器甲全局记忆-Superpowers-知识库分工.md",
  "memory.memories.8": "用户要求",
  "memory.memories.9": "writer",
  "memory.memories.10": "示例客服知识只记入口",
  "memory.memories.11": "guides/示例客服Wiki必须是真三级树.md",
  "memory.memories.12": "workspace",
  "memory.memories.13": "用户确认",
  "memory.memories.14": "资料简报按一期一包核回执",
  "memory.memories.15": "guides/资料简报-四平台发布-调用.md",
  "memory.memories.16": "用户要求",
  "memory.memories.17": "projects/sample/HANDOVER.md",
  "memory.memories.18": "projects/design/角色母版索引.md",
  "memory.memories.19": "guides/知识状态与证据晋升-调用.md",
  "memory.memories.20": "用户确认",
  "memory.memories.21": "devices/sample-index.md",
  "memory.memories.22": "用户要求",
  "memory.memories.23": "guides/执行器甲全局记忆-Superpowers-知识库分工.md",
  "memory.memories.24": "projects/notes/旧版交接.md",
  "memory.memories.25": "projects/sample/旧路由草案.md",
  "memory.memories.26": "projects/sample/按需路由.md",
  "memory.memories.27": "用户要求",
  "memory.memories.28": "writer",
  "memory.memories.29": "guides/示例客服Wiki必须是真三级树.md",
  "memory.memories.30": "workspace",
  "memory.memories.31": "guides/资料简报-四平台发布-调用.md",
  "memory.memories.32": "guides/kb-agent-调用.md",
  "memory.sample.35": "diff-lines",
  "memory.sample.36": "diff-line m-memory-diff-remove",
  "memory.sample.37": "diff-line m-memory-diff-add",
  "memory.sample.38": "协作",
  "memory.sample.39": "协作住址|孩子姓名|协作成员|配偶姓名",
  "memory.sample.40": "协作隐私",
  "memory.sample.41": "^(runbooks|projects|devices|workspace-a|workspace-c|sample-infrastructure)\\/[\\w\\u3400-\\u9fff /().%·：-]+\\.md$",
  "memory.sample.42": "确认只作用于本页演示，不代表真实 用户 确认或知识库写入。",
  "memory.sample.43": "用户确认",
  "memory.sample.46": "待 用户 确认",
  "memory.sample.49": "资料简报的回执该问谁",
  "memory.routing.50": "资料简报的回执该问谁",
  "memory.sample.51": "用户确认",
  "memory.pointer.52": "guides/知识条目来源与用户确认-调用.md",
  "memory.sample.53": "guides/kb-agent-调用.md",
  "memory.demoAdded.55": "guides/知识条目来源与用户确认-调用.md",
  "memory.demoBefore.56": "projects/sample/HANDOVER.md",
  "memory.sample.57": "\n    .m-memory-root,.m-memory-body,.m-memory-stack{display:flex;flex-direction:column;gap:var(--space-3);min-width:0;max-width:100%;color:var(--ink);overflow-wrap:anywhere}\n    .m-memory-root{font-family:var(--font);font-size:var(--text-body);line-height:1.6}\n    .m-memory-title{min-width:0;max-width:100%;overflow-wrap:anywhere;font-family:var(--round);font-size:18px;font-weight:700;margin:0;color:var(--ink);line-height:1.45}\n    .m-memory-eyebrow{align-self:flex-start;font-size:var(--text-small);letter-spacing:.08em;margin:0}\n    .m-memory-muted{color:var(--ink-2);font-size:13px;line-height:1.6;margin:0}\n    .m-memory-row,.m-memory-actions,.m-memory-tabs{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;min-width:0}\n    .m-memory-card{overflow-wrap:anywhere;padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-3);min-width:0;max-width:100%;box-sizing:border-box}\n    .m-memory-badge{white-space:normal;overflow-wrap:anywhere;max-width:100%;box-sizing:border-box}\n    .m-memory-good{background:var(--bot-soft);color:var(--bot-strong)}\n    .m-memory-warn{background:var(--blush);color:var(--blush-ink)}\n    .m-memory-btn{font-family:var(--round);font-size:13px;font-weight:700;min-height:44px;min-width:44px;max-width:100%;box-sizing:border-box;cursor:pointer;white-space:normal;overflow-wrap:anywhere}\n    .m-memory-tabs .m-memory-btn[aria-current=\"page\"]{background:var(--bot);color:var(--bot-ink);opacity:1}\n    .m-memory-btn:focus-visible,.m-memory-input:focus-visible,.m-memory-summary:focus-visible{outline:3px solid var(--bot-strong);outline-offset:3px}\n    .m-memory-path{display:block;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;font-size:12px;background:var(--elev-2);border:var(--line-w) dashed var(--line);padding:var(--space-2);border-radius:12px;color:var(--ink-2);box-sizing:border-box}\n    .m-memory-field{display:flex;flex-direction:column;gap:var(--space-2);min-width:0;margin:0}\n    .m-memory-label{font-family:var(--round);font-size:13px;font-weight:700;color:var(--ink)}\n    .m-memory-input{box-sizing:border-box;width:100%;max-width:100%;min-width:0;min-height:44px;font-family:var(--font);font-size:16px}\n    .m-memory-feedback{color:var(--danger);font-size:13px;margin:0;overflow-wrap:anywhere}\n    .m-memory-summary{min-height:44px;padding:var(--space-2) 0;box-sizing:border-box;cursor:pointer;color:var(--bot-strong);font-family:var(--round);font-weight:700}\n    .m-memory-empty{padding:var(--space-3);border:var(--line-w) dashed var(--line);border-radius:var(--r-card);background:var(--bot-soft);color:var(--ink-2)}\n    .m-memory-disclosure{min-width:0;max-width:100%;overflow-wrap:anywhere}\n    .m-memory-trace{width:100%;max-width:100%;min-width:0;border-top:var(--line-w) solid var(--line);color:var(--ink);overflow-wrap:anywhere}\n    .m-memory-diff{display:flex;flex-direction:column;gap:var(--space-3);width:100%;max-width:100%;min-width:0;box-sizing:border-box;padding:var(--space-3);color:var(--ink);overflow-wrap:anywhere}\n    .m-memory-diff-head{display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-2);padding:var(--space-3);border-radius:var(--r-card);min-width:0}\n    .m-memory-diff-status{margin:0;color:var(--ink);font-size:var(--text-small);font-weight:700}\n    .m-memory-diff-lines{display:flex;flex-direction:column;gap:var(--space-2);min-width:0;max-width:100%}\n    .m-memory-diff-line{display:flex;align-items:flex-start;gap:var(--space-2);padding:var(--space-2);border:var(--line-w) solid var(--line);border-radius:var(--r-card);min-width:0;max-width:100%;box-sizing:border-box;color:var(--ink)}\n    .m-memory-diff-remove{background:color-mix(in srgb,var(--danger) 18%,var(--elev));border-color:color-mix(in srgb,var(--danger) 60%,var(--line))}\n    .m-memory-diff-add{background:color-mix(in srgb,var(--mint) 18%,var(--elev));border-color:color-mix(in srgb,var(--mint) 60%,var(--line))}\n    .m-memory-diff-sign{flex:0 0 1.2em;font-family:var(--round);font-weight:700;text-align:center}\n    .m-memory-diff-content{min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}\n    .m-memory-diff .m-memory-btn[class~=\"ghostbtn\"]{min-height:44px}\n    .m-memory-diff .m-memory-btn:disabled{cursor:default;opacity:.65}\n    @media(prefers-reduced-motion:reduce){.m-memory-root,.m-memory-card,.m-memory-diff,.m-memory-btn{animation:none;transition:none;scroll-behavior:auto}}\n    .m-memory-chip{font-size:var(--text-small);min-height:44px;padding:var(--space-1) var(--space-3)}\n  ",
  "persona.system.4": "图形",
  "persona.avatar.5": "圆团",
  "persona.wake.6": "你好圆团",
  "persona.dnd.7": "22:00—08:00",
  "persona.activeProject.8": "示例项目",
  "persona.btn.14": "演示点数 12 ",
  "persona.role.15": "switch",
  "persona.class.16": "m-persona-switch switch",
  "persona.sample.20": " · 图形 线框预览",
  "persona.eyes.21": "<path d=\"M62 84 Q70 75 78 84 M102 84 Q110 75 118 84\" fill=\"none\" stroke=\"var(--ink)\" stroke-width=\"4\" stroke-linecap=\"round\"/>",
  "persona.mouth.22": "\" fill=\"none\" stroke=\"var(--ink)\" stroke-width=\"4\" stroke-linecap=\"round\"/>",
  "persona.sample.23": "<g stroke=\"var(--line)\" stroke-width=\"2.5\"><path d=\"M47 180 Q44 127 90 128 Q136 127 133 180Z\" fill=\"",
  "persona.sample.24": "<path d=\"M52 52 Q54 36 70 34\" fill=\"none\" stroke=\"var(--white)\" stroke-width=\"6\" stroke-linecap=\"round\" opacity=\".6\"/>",
  "persona.sample.25": "\" stroke-width=\"13\" stroke-linecap=\"round\"/>",
  "persona.sample.26": "；形象是占位，可换 GIF 或 图形/图形 模型，未加载引擎。",
  "persona.sample.27": "示例模型丙 / Terra · 示例执行器乙 · 示例执行器〔待确认条款〕 · 示例本地模型",
  "persona.sample.28": "演示日 00:00—10:30 · 数值为虚构样张",
  "persona.sample.29": "让总管整理今天",
  "persona.stage.30": "資料確認のご希望日時を教えてください。\n请告诉我希望的交流时间。",
  "persona.stage.31": " · 示例草稿待看",
  "persona.sample.32": "图形 × 小智",
  "persona.sample.34": "。\n设备未连接，图形、图形 引擎未加载。\n口型为音量驱动占位；音素映射未接入，未播放音频。",
  "persona.sample.36": "图形 模型",
  "persona.sample.37": "图形 模型",
  "persona.sample.38": "图形 助理方案",
  "persona.preview.39": "示例咨询草稿已整理。请看一下日文表述。\n尚未对外发送。",
  "persona.brain.40": "示例模型甲",
  "persona.act.46": "示例咨询草稿已在本页示例中置顶；壳的真实会话顺序未改。",
  "persona.act.47": "资料简报选题示例会话已",
  "persona.act.50": "22:00—08:00",
  "persona.sample.52": "在总管聊天里看待办、标记已读或收起摘要。",
  "persona.act.53": "虚构待看：示例交流日文草稿、资料简报四平台预览；焦点：DSH 模块整合。",
  "persona.sample.54": "由设计助理把授权音色从计划、训练、试听交到指定 bot。",
  "persona.md.55": "。我是设计助理，先帮你整理音色方案。素材声明：本人录音（演示）。播放引擎未接通，训练引擎未接入。",
  "persona.root.56": "总管 · 演示日 11 月 13 日 · 全部为虚构样例",
  "persona.root.57": "示例交流日文草稿",
  "persona.root.58": "资料简报四平台预览",
  "persona.sample.59": "在总管聊天顶部查看今日卡。",
  "persona.sample.60": "回到总管",
  "persona.sample.61": "\n    .m-persona-today {max-width:100%;overflow-wrap:anywhere;color:var(--ink)}\n    .m-persona-root {color:var(--ink);min-width:0;max-width:100%;padding:0 4px 16px 0;overflow-wrap:anywhere;font:var(--text-body)/1.4 var(--font)}\n    .m-persona-root * {box-sizing:border-box}\n    .m-persona-root h2,.m-persona-root h3,.m-persona-root button,.m-persona-root strong {font-family:var(--round);font-weight:700}\n    .m-persona-root button {cursor:pointer}\n    .m-persona-heading {display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 22px;flex-wrap:wrap}\n    .m-persona-heading h2 {font-size:26px;line-height:1.25;margin:0;padding:4px 0;background:linear-gradient(transparent 70%,var(--bot-soft) 70%)}\n    .m-persona-status {max-width:100%;white-space:normal}\n    .m-persona-status .m-persona-icon {width:16px;height:16px;flex:none}\n    .m-persona-card {--m-persona-dot:var(--bot);margin:18px 0;padding:var(--space-4);min-width:0;max-width:100%;overflow-wrap:anywhere}\n    .m-persona-card>svg {max-width:100%;height:150px}\n    .m-persona-card:nth-of-type(4n+2) {--m-persona-dot:var(--sky)}\n    .m-persona-card:nth-of-type(4n+3) {--m-persona-dot:var(--pink)}\n    .m-persona-card:nth-of-type(4n+4) {--m-persona-dot:var(--mint)}\n    .m-persona-card>.m-persona-card-head {font-size:18px;line-height:25px;margin:calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) var(--space-4);padding:14px var(--space-4);border-radius:calc(var(--r-card) - var(--line-w)) calc(var(--r-card) - var(--line-w)) 0 0;justify-content:flex-start}\n    .m-persona-card-title {flex:1;min-width:0}\n    .m-persona-card-head>[data-level-sticker] {margin:0;align-self:center}\n    .m-persona-card-head:before {content:'';width:12px;height:12px;flex:none;background:var(--m-persona-dot);border:var(--line-w) solid var(--line);border-radius:50%}\n    .m-persona-note {font-size:13px;line-height:21px;color:var(--ink-2);margin:10px 0;white-space:pre-line}\n    .m-persona-source {max-width:100%;font-size:11px;line-height:18px;color:var(--ink);background:var(--bot-soft);margin:2px 0 10px;transform:rotate(-1deg)}\n    .m-persona-btn {min-height:44px;min-width:44px;max-width:100%;margin:4px 5px 6px 0;white-space:normal;overflow-wrap:anywhere;transition:transform var(--motion-fast) var(--ease)}\n    .m-persona-btn:active,.m-persona-avatar-choice:active,.m-persona-segment:active {transform:translateY(2px)}\n    .m-persona-sub-identity {display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-width:0;max-width:100%}\n    .m-persona-sub-avatar {width:52px;height:52px;flex:none}\n    .m-persona-sub-avatar>svg,.m-persona-sub-avatar>img {width:100%;height:100%;object-fit:contain}\n    .m-persona-actions {display:flex;flex-wrap:wrap;gap:4px;margin-top:10px;min-width:0}\n    .m-persona-control {margin:16px 0;min-width:0}\n    .m-persona-label,.m-persona-field>span {font-size:13px;line-height:20px;color:var(--ink);font-weight:700;display:block;margin-bottom:8px}\n    .m-persona-segments {display:flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:var(--r-card);min-width:0;max-width:100%;margin-top:0}\n    .m-persona-segment {flex:1 1 auto;white-space:normal;overflow-wrap:anywhere;min-width:44px;min-height:44px;font-size:13px;line-height:18px;border-radius:var(--r-pill);padding:8px 12px;color:var(--ink-2);transition:transform var(--motion-fast) var(--ease)}\n    .m-persona-segments>.m-persona-segment {flex:1 0 auto;white-space:nowrap}\n    .m-persona-outfits {max-width:100%;min-width:0}\n    .m-persona-outfits .m-persona-btn>span {min-width:0;overflow-wrap:anywhere}\n    .m-persona-outfits [class~=\"ghostbtn\"][data-outfit-selected=true] {outline:2px solid var(--bot-strong);outline-offset:-4px;background:var(--bot-soft)}\n    .m-persona-outfit-thumb {display:inline-grid;place-items:center;min-width:24px;margin-inline-end:6px;color:var(--bot-strong)}\n    .m-persona-shared-avatar {width:84px;height:90px;flex:none}\n    .m-persona-shared-avatar>svg,.m-persona-shared-avatar>img {width:100%;height:100%;object-fit:contain}\n    .m-persona-field {display:block;margin:16px 0;min-width:0}\n    .m-persona-field input,.m-persona-field textarea {display:block;width:100%;min-width:0;font:17px/24px var(--font);border-radius:calc(var(--r-card) / 2)}\n    .m-persona-field textarea {resize:vertical}\n    .m-persona-field input[type=range] {padding:0;accent-color:var(--bot-strong);background:var(--elev-2);box-shadow:none}\n    .m-persona-list {border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 1.5);background:var(--elev-2);padding:0 12px;margin:12px 0;min-width:0}\n    .m-persona-row {display:flex;align-items:center;gap:12px;justify-content:space-between;min-height:56px;padding:12px 0;border-bottom:1px dashed var(--sep);font-size:13px;line-height:20px;min-width:0}\n    .m-persona-row:last-child {border-bottom:0}\n    .m-persona-grow {flex:1;min-width:0}\n    .m-persona-grow strong {display:block}\n    .m-persona-grow small,.m-persona-voice-row small {display:block;color:var(--ink-2);font-size:11px;line-height:18px;margin-top:3px}\n    .m-persona-value {max-width:58%;min-width:0;justify-content:flex-end;text-align:right;color:var(--ink);white-space:pre-line;font-size:12px;line-height:19px}\n    .m-persona-switch {flex:none}\n    .m-persona-progress {margin:16px 0}\n    .m-persona-track {height:12px;background:var(--elev-2);border:var(--line-w) solid var(--line);border-radius:var(--r-pill);overflow:hidden}\n    .m-persona-track i {display:block;height:100%;border-radius:inherit;background:var(--bot);transition:width var(--motion-panel) var(--ease)}\n    .m-persona-identity {display:flex;gap:16px;align-items:center;margin-bottom:18px;min-width:0}\n    .m-persona-identity>div {min-width:0}\n    .m-persona-identity svg {width:84px;height:90px;flex:none}\n    .m-persona-metrics {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}\n    .m-persona-metrics>div {--m-persona-metric:var(--lemon);border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 1.5);padding:14px 10px;background:var(--elev);box-shadow:var(--shadow-hard);border-top:6px solid var(--m-persona-metric)}\n    .m-persona-metrics>div:nth-child(2) {--m-persona-metric:var(--sky)}\n    .m-persona-metrics>div:nth-child(3) {--m-persona-metric:var(--pink)}\n    .m-persona-metrics>div:nth-child(4) {--m-persona-metric:var(--mint)}\n    .m-persona-metrics strong {display:block;color:var(--ink);font-size:23px;line-height:29px;white-space:nowrap}\n    .m-persona-metrics small {color:var(--ink-2);font-size:11px;line-height:18px}\n    .m-persona-feedback {font-size:13px;line-height:21px;color:var(--bot-strong);margin:10px 0;min-height:20px;font-weight:700}\n    .m-persona-steps {display:flex;gap:4px;list-style:none;padding:0;margin:16px 0 22px}\n    .m-persona-step {flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--ink-2);text-align:center}\n    .m-persona-step>span {width:30px;height:30px;background:var(--elev);border:var(--line-w) solid var(--line);border-radius:50%;display:grid;place-items:center;font:700 13px var(--round)}\n    .m-persona-step[aria-current=step]>span {background:var(--bot);color:var(--bot-ink);box-shadow:var(--shadow-hard)}\n    .m-persona-step[data-done=true]>span {background:var(--bot-soft);color:var(--bot-strong)}\n    .m-persona-step small {font-size:11px;line-height:17px}\n    .m-persona-template {width:100%;display:block;text-align:left;min-height:72px;padding:14px;border-radius:calc(var(--r-card) / 1.5);margin:10px 0}\n    .m-persona-template[aria-pressed=true],.m-persona-avatar-choice[aria-pressed=true],.m-persona-swatch[aria-pressed=true] {background:var(--bot-soft);box-shadow:var(--shadow-hard);outline:2px solid var(--bot-strong);outline-offset:-5px}\n    .m-persona-template small {display:block;font:11px/18px var(--font);color:var(--ink-2);margin-top:5px}\n    .m-persona-avatar-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:14px 0}\n    .m-persona-avatar-choice {overflow-wrap:anywhere;white-space:normal;display:flex;flex-direction:column;align-items:center;border-radius:var(--r-card);padding:12px 8px;min-width:0;transition:transform var(--motion-fast) var(--ease)}\n    .m-persona-avatar-choice svg {width:86px;max-width:100%;height:92px}\n    .m-persona-avatar-choice strong {font-size:14px;line-height:21px}\n    .m-persona-avatar-choice small {font:11px/18px var(--font);color:var(--ink-2);margin-top:5px}\n    .m-persona-stage {border:var(--line-w) solid var(--line);border-radius:var(--r-card);position:relative;background:radial-gradient(circle at 85% 20%,var(--bot-soft),transparent 65%),var(--bg);min-height:300px;overflow:hidden;padding:12px;isolation:isolate}\n    .m-persona-stage[data-background=简洁] {background:var(--bot-soft)}\n    .m-persona-stage[data-background=透明] {background:conic-gradient(var(--fill) 25%,var(--elev) 0 50%,var(--fill) 0 75%,var(--elev) 0);background-size:22px 22px}\n    .m-persona-stage-meta {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;position:relative;z-index:2;font-size:11px;color:var(--ink-2)}\n    .m-persona-actor {height:210px;display:flex;align-items:end;justify-content:center;overflow:hidden;margin:6px 0}\n    .m-persona-actor svg,.m-persona-actor img {height:205px;width:auto;max-width:100%;object-fit:contain;transform-origin:50% 100%;transition:transform var(--motion-panel) var(--ease)}\n    .m-persona-actor[data-persona-emotion=挥手] {animation:m-persona-wave-once .8s ease-in-out 1}\n    .m-persona-stage[data-zoom=近景] .m-persona-actor>svg,.m-persona-stage[data-zoom=近景] .m-persona-actor>img {transform:scale(1.4)}\n    .m-persona-stage[data-zoom=远景] .m-persona-actor>svg,.m-persona-stage[data-zoom=远景] .m-persona-actor>img {transform:scale(.7)}\n    .m-persona-subtitle {position:relative;border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 2);background:var(--elev);color:var(--ink);font-size:13px;line-height:21px;padding:10px;white-space:pre-line;text-align:center}\n    .m-persona-subtitle[data-style=大字] {font-size:20px;line-height:27px}\n    .m-persona-subtitle[data-style=双语] {border-inline-start:5px solid var(--bot);font-size:13px;line-height:22px}\n    .m-persona-bullet {position:absolute;top:64px;right:12px;max-width:calc(100% - 24px);padding:8px 12px;background:var(--bot);color:var(--bot-ink);border:var(--line-w) solid var(--line);box-shadow:var(--shadow-hard);border-radius:var(--r-pill);font-size:11px;line-height:18px;animation:m-persona-bullet 3s var(--ease) both}\n    .m-persona-binding {padding:12px 0;border-bottom:var(--line-w) dashed var(--sep)}\n    .m-persona-float-card {padding:8px;margin:12px 0}\n    .m-persona-floating-zone {position:relative;min-height:340px;background:var(--bot-soft);border-radius:calc(var(--r-card) / 1.5);overflow:hidden;padding:4px 10px}\n    .m-persona-pip {position:absolute;width:110px;border-radius:var(--r-card)}\n    .m-persona-pip[data-corner=左上] {left:8px;top:42px}\n    .m-persona-pip[data-corner=右上] {right:8px;top:42px}\n    .m-persona-pip[data-corner=左下] {left:8px;bottom:8px}\n    .m-persona-pip[data-corner=右下] {right:8px;bottom:8px}\n    .m-persona-drag-handle {display:block;padding:7px;width:100%;min-height:44px;cursor:grab;touch-action:none}\n    .m-persona-drag-handle svg,.m-persona-drag-handle img {display:block;width:92px;max-width:100%;height:96px;object-fit:contain;pointer-events:none}\n    .m-persona-drag-handle small {font-size:11px;line-height:18px;color:var(--ink);display:block;pointer-events:none}\n    .m-persona-voice-row {display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:14px 0;border-bottom:var(--line-w) dashed var(--sep)}\n    .m-persona-voice-row>.m-persona-grow {flex:1 1 100%;font-size:15px;line-height:21px}\n    .m-persona-wave {display:flex;align-items:center;gap:3px;height:30px;min-width:56px;color:var(--ink-3);margin-right:auto}\n    .m-persona-wave i {width:3px;border-radius:var(--r-pill);background:currentColor}\n    .m-persona-wave[data-active=true] {color:var(--bot-strong)}\n    .m-persona-wave[data-active=true] i {animation:m-persona-wave .55s ease-in-out infinite alternate}\n    .m-persona-swatches {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}\n    .m-persona-swatch {display:flex;align-items:center;justify-content:flex-start;gap:8px;min-width:0;min-height:48px;overflow-wrap:anywhere;white-space:normal;border-radius:calc(var(--r-card) / 1.5);padding:8px 10px;font-size:13px}\n    .m-persona-swatch i {display:block;width:22px;height:22px;border-radius:50%;border:var(--line-w) solid var(--line);flex:none}\n    .m-persona-chat-preview {border:var(--line-w) solid var(--line);border-radius:var(--r-card);background:var(--bg);color:var(--ink);padding:14px;margin:14px 0;box-shadow:var(--shadow-hard)}\n    .m-persona-chat-preview[data-theme=深色] {background:color-mix(in srgb,var(--violet) 32%,var(--bot-ink));color:var(--cream)}\n    .m-persona-chat-preview[data-theme=浅色] {background:var(--cream);color:var(--bot-ink)}\n    .m-persona-preview-avatar {height:46px;margin-bottom:10px}\n    .m-persona-preview-avatar svg {width:44px;height:46px}\n    .m-persona-bubble {border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 1.3);padding:14px;background:var(--elev-2);color:var(--ink);font-size:17px;line-height:24px;margin:0;white-space:pre-line}\n    .m-persona-chat-preview[data-theme=深色] .m-persona-bubble {background:color-mix(in srgb,var(--violet) 42%,var(--bot-ink));color:var(--cream);border-color:var(--cream)}\n    .m-persona-chat-preview[data-theme=浅色] .m-persona-bubble {background:var(--white);color:var(--bot-ink);border-color:var(--bot-ink)}\n    .m-persona-chat-preview[data-font=小] .m-persona-bubble {font-size:15px;line-height:21px}\n    .m-persona-chat-preview[data-font=大] .m-persona-bubble {font-size:22px;line-height:30px}\n    .m-persona-chat-preview[data-density=紧凑] .m-persona-bubble {padding:8px 10px}\n    .m-persona-chat-preview[data-density=宽松] .m-persona-bubble {padding:24px 18px}\n    .m-persona-chat-preview>small {display:block;font-size:11px;line-height:18px;margin-top:10px}\n    .m-persona-language-preview {padding:var(--space-4);margin-top:14px;background:var(--bot-soft)}\n    .m-persona-session {margin:16px 0;padding:var(--space-4);min-width:0}\n    .m-persona-session h3 {font:700 17px/24px var(--round);color:var(--bot-strong);margin:0 0 12px}\n    .m-persona-table-wrap {max-width:100%;overflow-x:auto;border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 1.5)}\n    .m-persona-shortcuts {width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;line-height:21px;background:var(--elev)}\n    .m-persona-shortcuts th,.m-persona-shortcuts td {padding:14px 10px;text-align:left;border-bottom:var(--line-w) solid var(--line);overflow-wrap:anywhere;vertical-align:top}\n    .m-persona-shortcuts th {background:var(--bot-soft);font-family:var(--round);font-weight:700}\n    .m-persona-shortcuts th:first-child {width:43%}\n    .m-persona-shortcuts tr:last-child td {border-bottom:0}\n    .m-persona-shortcuts kbd {display:inline-block;max-width:100%;font:700 12px/20px var(--round);background:var(--bot-soft);color:var(--ink);border:var(--line-w) solid var(--line);border-radius:calc(var(--r-card) / 3);padding:3px 7px;box-shadow:var(--shadow-hard)}\n    .m-persona-guide-backdrop {position:relative;border:var(--line-w) solid var(--line);border-radius:var(--r-card);background:radial-gradient(circle at 85% 10%,var(--bot-soft),transparent 60%),var(--elev-2);overflow:hidden;padding:16px 10px;min-height:500px}\n    .m-persona-guide-target {display:flex;flex-direction:column;align-items:center}\n    .m-persona-guide-target svg {width:110px;height:116px}\n    .m-persona-guide-overlay {position:relative;margin:-30px 0 4px;border-radius:var(--r-card);padding:18px}\n    .m-persona-home {max-width:680px;margin:auto;padding:12px 4px calc(110px + env(safe-area-inset-bottom))}\n    .m-persona-created {display:flex;gap:10px;align-items:center;margin:12px 0}\n    .m-persona-created>svg {width:60px;height:65px;flex:none}\n    .m-persona-created>.m-persona-list {flex:1;min-width:0}\n    @keyframes m-persona-wave {to {transform:scaleY(.3)}}\n    @keyframes m-persona-wave-once {25%,75% {transform:rotate(-5deg)} 50% {transform:rotate(5deg)}}\n    @keyframes m-persona-bullet {from {transform:translateX(70%);opacity:0} 15%,100% {transform:translateX(0);opacity:1}}\n    @media (max-width:699px) {\n      .m-persona-heading h2 {font-size:23px}\n      .m-persona-home {padding:8px 4px calc(110px + env(safe-area-inset-bottom))}\n      .m-persona-row {gap:8px;flex-wrap:wrap}\n      .m-persona-value {max-width:100%}\n      .m-persona-row>.m-persona-grow {flex-basis:38%}\n      .m-persona-identity {gap:10px}\n      .m-persona-identity svg {width:64px;height:70px}\n      .m-persona-shared-avatar {width:64px;height:70px}\n      .m-persona-outfits .m-persona-btn {margin-inline-end:0;overflow-wrap:anywhere}\n      .m-persona-guide-overlay {padding:14px}\n    }\n    @media (prefers-reduced-motion:reduce) {\n      .m-persona-btn,.m-persona-avatar-choice,.m-persona-segment,.m-persona-knob,.m-persona-track i,.m-persona-actor svg,.m-persona-actor img {transition:none}\n      .m-persona-wave[data-active=true] i,.m-persona-bullet,.m-persona-actor[data-persona-emotion=挥手] {animation:none}\n    }\n    @media (prefers-reduced-transparency:reduce) {\n      .m-persona-pip,.m-persona-guide-overlay {backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--elev)}\n    }\n",
  "plugins.sample.2": "\n    .m-plugins-root{display:grid;gap:12px;align-content:start;font-family:var(--font);color:var(--ink);font-size:var(--text-body);min-width:0;max-width:100%;line-height:1.55;overflow-wrap:anywhere}\n    .m-plugins-node{box-sizing:border-box;min-width:0;overflow-wrap:anywhere}\n    .m-plugins-heading,.m-plugins-muted,.m-plugins-title{margin:0}\n    .m-plugins-heading,.m-plugins-title{font-family:var(--round);font-weight:700;line-height:1.35}\n    .m-plugins-heading{font-size:22px}\n    .m-plugins-muted,.m-plugins-source{color:var(--ink-2);font-size:var(--text-small)}\n    .m-plugins-tier-note{margin:0;color:var(--ink-2);font-size:11px;line-height:1.55;white-space:nowrap}\n    .m-plugins-source{display:block;margin-top:var(--space-2);font-size:11px;border-top:var(--line-w) dashed var(--line);padding-top:var(--space-2)}\n    .m-plugins-title{font-size:17px;line-height:1.45}\n    .m-plugins-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);min-width:0}\n    .m-plugins-stack{display:grid;gap:var(--space-4);min-width:0}\n    .m-plugins-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4);min-width:0}\n    .m-plugins-card{--m-plugins-pad:20px;display:grid;gap:var(--space-3);align-content:start;padding:var(--m-plugins-pad);min-width:0;max-width:100%}\n    .m-plugins-card>.m-plugins-title{display:block;margin:calc(-1 * var(--m-plugins-pad)) calc(-1 * var(--m-plugins-pad)) 0;padding:var(--space-3) var(--m-plugins-pad);border-radius:calc(var(--r-card) - var(--line-w)) calc(var(--r-card) - var(--line-w)) 0 0;color:var(--ink)}\n    .m-plugins-button{font-family:var(--round);min-height:44px;min-width:44px;max-width:100%;overflow-wrap:anywhere;cursor:pointer;white-space:normal;text-align:center;transition:transform var(--motion-fast) var(--ease),background var(--motion-fast) var(--ease)}\n    .m-plugins-icon{width:17px;height:17px;flex:none}\n    .m-plugins-button:hover{transform:translateY(-1px)}\n    .m-plugins-button.m-plugins-secondary:hover{background:var(--bot-soft)}\n    .m-plugins-button.m-plugins-tertiary:hover{text-decoration:underline}\n    .m-plugins-button:active{transform:translate(1px,1px)}\n    .m-plugins-button:focus-visible,.m-plugins-input:focus-visible{outline:3px solid var(--bot-strong);outline-offset:3px}\n    .m-plugins-badge{max-width:100%;white-space:normal;overflow-wrap:anywhere}\n    .m-plugins-good{font-weight:700}\n    .m-plugins-notice{padding:var(--space-3) var(--space-4);border:var(--line-w) dashed var(--line);border-left:5px solid var(--bot);border-radius:var(--r-card);background:var(--elev-2);color:var(--ink-2);font-size:12px;line-height:1.7}\n    .m-plugins-field{display:grid;gap:var(--space-2);min-width:0;margin-top:0}\n    .m-plugins-label{font-family:var(--round);font-size:12px;color:var(--ink-2);font-weight:700}\n    .m-plugins-input{width:100%;min-width:0;max-width:100%;min-height:44px;font:inherit;font-size:16px;resize:vertical}\n    .m-plugins-input::placeholder{color:var(--ink-3);opacity:1}\n    .m-plugins-panel .m-plugins-grid2{grid-template-columns:minmax(0,1fr)}\n    .m-plugins-empty{padding:var(--space-5) var(--space-4);color:var(--ink-2);background:var(--bot-soft);border:var(--line-w) dashed var(--line);border-radius:var(--r-card);text-align:center;font-size:13px}\n    .m-plugins-preview{min-height:140px;padding:var(--space-4);display:grid;place-content:center;gap:var(--space-2);text-align:center;border:var(--line-w) dashed var(--line);border-radius:var(--r-card);background:var(--bot-soft);color:var(--ink-2)}\n    .m-plugins-preview .m-plugins-icon{width:30px;height:30px;margin:auto;color:var(--bot-strong)}\n    @media(max-width:699px){.m-plugins-grid2{grid-template-columns:minmax(0,1fr)}.m-plugins-card{--m-plugins-pad:var(--space-4)}}\n    @media(prefers-reduced-motion:reduce){.m-plugins-button{transition:none}.m-plugins-button:hover,.m-plugins-button:active{transform:none}}\n  ",
  "plugins.sample.3": "资料有既有代理；监听/TLS 仍需核验，连接路线只走 私有网络",
  "plugins.sample.4": "设备配对、本机或 私有网络；不启用公网直连",
  "plugins.sample.5": "dsh-comfyui-workbench",
  "plugins.sample.6": "候选未装；autoStart/autoDetect 关闭，标签/姿势外联关闭；图像生成仍只走 执行器甲/OpenAI",
  "plugins.sample.7": "仅受控 图形工具 端点；不自动启动",
  "plugins.sample.8": "jingyu-live2d-agent|dsh-live2d-pet|dsh-live-studio|dsh-pet|dsh-seekbuddy|dsh-chatting-pet|dsh-live2d-pet|dsh-live2d-pets",
  "plugins.sample.9": "资料明确设备丙实际没装上；旧 applied 日志不足以证明可用",
  "plugins.sample.10": "DS Bot 隔离试过；不进入 desktop。手机仅源码自建/私有网络，不开 Expo 推送",
  "plugins.sample.11": "用户 选择只学思路；不安装原型/衍生版，不以模型自签收代替人验收",
  "plugins.sample.12": "陪伴设计参考；AAAAGENT 非商业且音视频上云、另起 DSH；SurfCore 依赖 协作工具丙 注入",
  "plugins.sample.13": "deepseek-meihuaqi",
  "plugins.sample.14": "模型丁客户端 / 网页自动化生图",
  "plugins.sample.15": "账号/平台风险；生图只走 执行器甲/OpenAI，不使用自动化生图路线",
  "plugins.sample.16": "个人消息通道 UI 自动化 / NT协作工具丙 注入",
  "plugins.sample.17": "dsh-bili-whale|Whale 示例系列（world / qq / wechat / bili / douyin）|dafayu-pixiv-duty|dsh-pixiv-scroll|dsh-game-daily|dsh-bili-subagent|dsh-bili-subagent|dsh-bili-interact",
  "plugins.sample.18": "图形 × 小智|N.E.K.O 个人助理|主动今日简报|喵伴 ESP-VoCat|本地 TTS 与 ASR 路由|示例短片配音主控|示例 内容选题池|用户-video-maker v3/v4|示例提供方 示例短片工作席|示例工作台|生图与视频生成台账|资料简报四平台交接",
  "plugins.sample.19": "示例销售与客服规则|写作统一工作台|示例 客服 Wiki|客服语料质量门|可领取销售任务池|内容渠道 发布闸门|内容渠道 Harness v2|示例提供方 工作席|示例提供方 资料接入|codex-worker|知识库工具|Token 统计|图形 助理方案",
  "plugins.sample.20": "prior/workspace-sns-agents.md",
  "plugins.sample.21": "kb-agent|知识贡献与整理|来源与确认标签|项目状态与证据晋升|执行器甲 记忆与知识库分工|Hermes 跨实例记忆|LanceDB 记忆巡检|sample-wiki 管理|Agent 工作组控制台|项目总管「今天」|知识库定时整理",
  "plugins.sample.22": "dsh-hmr|dsh-app-boot|dsh-plugin-manager|dsh-client-ui-slots|subagent_oar|subagent-model-selection-settings|tool-subagent|tool-goal|dsh-base|dsh-web-app|dsh-cua|cua-provider-registry|dsh-roster|dsh-ios-shell",
  "plugins.md.26": "让设计助理用",
  "plugins.sample.27": "让设计助理用它",
  "plugins.sample.29": "wan",
  "plugins.sample.30": "示例视频工具 · 视频工具视频",
  "plugins.sample.31": "seedance",
  "plugins.sample.32": "示例视频工具 · 视频工具",
  "plugins.sample.33": "执行器甲 / OpenAI",
  "plugins.sample.34": "设计助理",
  "plugins.sample.35": "提示词 → 选工具 → 模拟排队 → 布局占位 → 人工送审。图片仅 执行器甲/OpenAI；视频可选 示例视频工具·视频工具 / 视频工具，付费提交仍须逐次授权。",
  "plugins.sample.37": "执行器甲 / OpenAI",
  "plugins.sample.38": "示例视频工具 · 视频工具",
  "plugins.sample.41": "示例工作台",
  "plugins.sample.42": "示例工作台",
  "plugins.reviewText.50": "插件评估（来源：第十一轮研究汇总与八项评估；【AI建议】【用户未确认】）\n",
  "plugins.bot.51": "writer",
  "plugins.md.55": "。用真实鼠标键盘操作电脑上的消息通道客户端，作为普通成员参与；不是官方接口。\n",
  "plugins.render.59": "目标：整理一份交流说明草稿。交出方提供演示任务摘要；接收方下一步核对范围并拟稿，尚无执行回执。",
  "plugins.sample.60": "看登录与本月用量，把任务草稿交给设计助理。",
  "plugins.title.61": "写作客服通道",
  "plugins.sample.62": "消息通道、消息通道 与官网只整理草稿，预约交店方确认。",
  "plugins.act.64": "看看写作通道状态",
  "plugins.act.65": "写作通道都只出草稿",
  "plugins.act.66": "已将三条写作示例通道设为只出草稿、关闭自动回复演示。未外发。",
  "plugins.act.67": "已恢复知识库 reader 的本页只读演示，仅总管与研究助理可用；未访问知识库。",
  "plugins.act.69": "让设计助理选 执行器甲",
  "plugins.act.70": "设计助理 → 执行器甲",
  "plugins.act.71": "研究助理 → 模型乙",
  "plugins.act.72": "让设计助理选 执行器甲",
  "plugins.act.73": "设计助理 → 示例模型丙 / Terra",
  "plugins.act.74": "研究助理 → 示例模型乙",
  "plugins.sample.75": "@ 整理助理与设计助理，先登记范围再等待回执。",
  "plugins.act.76": "已登记本页派单草稿给整理助理与设计助理，等待回执。没有启动任何 agent。",
  "plugins.act.77": "已演示字幕返回 412 后停止。没有访问 发布通道，不重试或绕过验证。",
  "plugins.act.78": "已把「示例本地模型 能完成哪些视觉理解任务？」选入本页草稿，来源与字幕仍待核；没有发布。",
  "plugins.id.79": "plugins-sns",
  "plugins.title.80": "内容渠道 运营草稿",
  "plugins.act.82": "查看 内容渠道 发布缺口",
  "plugins.act.83": "暂停 内容渠道 草稿队列",
  "plugins.act.84": "snsPaused",
  "plugins.act.85": "已暂停本页 内容渠道 草稿队列，没有更改平台任务。",
  "plugins.act.86": "snsGate",
  "plugins.title.87": "消息通道成员",
  "plugins.steward.88": "writer",
  "plugins.sample.89": "用真实鼠标键盘操作电脑上的消息通道客户端，作为普通成员参与，不是官方接口。",
  "plugins.parts.91": "看看消息通道来信摘要",
  "plugins.parts.92": "准备消息通道待发草稿",
  "plugins.art.93": "设计助理 · 工作台",
  "plugins.sample.94": "内容渠道 运营能力",
  "plugins.render.96": "找设计助理选工具",
  "plugins.render.97": "示例提供方 工作席 / 工具池",
  "plugins.sample.98": "writer",
  "plugins.title.99": "消息通道成员",
  "plugins.from.100": "writer",
  "plugins.from.101": "writer-line",
  "plugins.md.102": "消息通道 回复员回报：我协助拟了消息通道回复草稿，交回写作助理确认；没有切换真实平台或发送。",
  "plugins.from.103": "writer",
  "governance.securityHeading": "工作台示例交接 · 四项加固",
  "governance.upgradeHeading": "工作台示例交接 · 升级前契约检查",
  "cards-a.neutralDraft.0": "ありがとうございます。担当者が資料確認時間を確認のうえご連絡いたします。",
  "cards-a.neutralDraft.1": "資料確認の候補は"
};

// 中性示例仅用原创图形，任何媒体绑定均为空。
BOT_SRC.forEach(function(b,i){b.avatarSrc="";b.faces={};b.avatar={kind:"shape",shapeId:ASSISTANT_SHAPES[i%ASSISTANT_SHAPES.length].id,color:b.color};b.avatarExplicit=true;var _pk={chief:"dsh",research:"grok",art:"gpt",pm:"claude",content:"qwen",writer:"gemini"}[b.id];if(_pk){b.avatar={kind:"pack",id:_pk};b.avatarExplicit=false;}});

// 演示包含五个聊天话题；系统安排含派工，以及另开会话、分身记录、文件回写来源。两个话题隔天接着聊。
var R43_DEMO_SEGMENTS = [{
  bot: 'chief', session: 'demo-chief-earlier', title: '上次聊的安排',
  startedAt: '2026-11-10T08:00:00Z',
  items: [
    {id: 'r43-demo-user', role: 'user', text: '先把这周要做的事情列出来。'},
    {id: 'r43-demo-answer', role: 'bot', text: '先核对资料，再整理草稿，最后请你看一眼。'}
  ]
}, {
  bot: 'chief', session: 'demo-chief-trip', title: '周末出游',
  startedAt: '2026-11-10T09:00:00Z',
  items: [
    {id: 'r43-trip-user', role: 'user', text: '周末出游安排到公园走走。'},
    {id: 'r43-trip-answer', role: 'bot', text: '早上出门，下午留给休息，行程排松一点。'}
  ]
}, {
  bot: 'chief', session: 'demo-chief-budget', title: '本月预算',
  startedAt: '2026-11-11T08:00:00Z',
  items: [
    {id: 'r43-budget-user', role: 'user', text: '本月预算先整理固定支出。'},
    {id: 'r43-budget-answer', role: 'bot', text: '先列房租、水电和订阅，再看余下的预算。'}
  ]
}, {
  bot: 'chief', session: 'demo-chief-meal', title: '晚餐清单',
  startedAt: '2026-11-11T09:00:00Z',
  items: [
    {id: 'r43-meal-user', role: 'user', text: '晚餐清单里加一个简单的汤。'},
    {id: 'r43-meal-answer', role: 'bot', text: '加番茄蛋汤，购物清单里记上番茄和鸡蛋。'}
  ]
}, {
  bot: 'chief', session: 'demo-chief-earlier', title: '上次聊的安排', resumed: true,
  startedAt: '2026-11-12T08:00:00Z',
  items: [
    {id: 'r43-resume-user', role: 'user', text: '继续上次聊的安排，资料我看过了。'},
    {id: 'r43-resume-answer', role: 'bot', text: '那接下来整理草稿，保留你已经确认的内容。'}
  ]
}, {
  bot: 'chief', session: 'demo-chief-board', purpose: 'board', title: '派工：整理资料',
  startedAt: '2026-11-12T09:00:00Z', state: 'done', unread: 1,
  items: [{id: 'r43-demo-event-answer', role: 'bot', text: '资料已经整理好，下一步等你看一眼。'}]
}, {
  bot: 'chief', session: 'demo-chief-trip', title: '周末出游', resumed: true,
  startedAt: '2026-11-13T07:00:00Z',
  items: [
    {id: 'r43-trip-resume-user', role: 'user', text: '周末出游还是去之前说的公园吧。'},
    {id: 'r43-trip-resume-answer', role: 'bot', text: '好，接着之前的计划，出发时间安排在早上。'}
  ]
}, {
  bot: 'chief', session: 'demo-chief-aside', purpose: 'board', aside: true,
  title: '接力：整理资料 · 第 2 棒 · 独立会话',
  startedAt: '2026-11-13T08:10:00Z', state: 'done',
  items: [{id: 'r43-demo-aside', role: 'bot', text: '这段另开，不和原来的聊天混在一起。'}]
}, {
  bot: 'chief', gap: true
}, {
  bot: 'chief', session: 'demo-chief-clones', purpose: 'board', clones: 3,
  title: '分身记录：整理资料',
  startedAt: '2026-11-13T08:30:00Z', state: 'done',
  items: [{id: 'r43-demo-clones', role: 'bot', text: '三个分身已回来，结果记在这张卡上。'}]
}, {
  bot: 'chief', gap: true
}, {
  bot: 'chief', session: 'demo-chief-file', purpose: 'board', via: 'file',
  title: '派工：回写进度',
  startedAt: '2026-11-13T08:40:00Z', state: 'done',
  items: [{id: 'r43-demo-file', role: 'bot', text: '进度是从任务板文件写回来的。'}]
}];
