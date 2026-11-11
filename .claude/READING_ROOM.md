# 共读室（ReadingRoom）· 交接

接手前先读 `.claude/HANDOFF.md`（那六条规矩仍然适用，尤其第 1、2、3 条）。
这份只记共读室这件事。**2026-11-11 写的。**

## 当前状态：分支上，等久验第三轮

- 分支 `feat/reading-room`，已推 origin。**没有合 master，master 干净。**
- 最新提交 `a84fb353`（按屏幕容量分页 + 新手势）——**久还没验这一版。**
- 久在 Vercel 用「分支专属预览链接」测，不用 Create Deployment（她说直接就有）。

**接手第一件事：问她第三轮验得怎么样，别重新设计。**

工作区就停在这个分支上，所以你读到的这份笔记已经是最新的。

另外：本地 master 有一个未推送的提交 `2d0905ae`（上一个窗口的 HANDOFF 更新）。
不影响干活，她没说要推，别自己推。

## 她要的东西（原话意思，不要擅自改需求）

一个叫「共读室」的独立 App：导入本地 TXT 和角色一起逐段读。
划线 → 发给选定角色 → 开独立窗口讨论 → 手动归档进记忆宫殿。
**上下文结构参考协同工作**（`features/collaboration/`）。

### 三期划分（她同意的）

| 期 | 内容 | 状态 |
|---|---|---|
| 一 | 书架 + 阅读器 | 代码写完，第三轮待验 |
| 二 | 划线 + 讨论窗口 | 没开始 |
| 三 | 归档进记忆宫殿 | 没开始 |

### 她明确回答过的问题（别再问一遍）

1. **书架全局共用，讨论窗口挂在角色下。**
2. **讨论用的 API：角色的独立 API 优先，没配就跟随当前全局。**
   现成函数：`utils/characterApi.ts` 的 `resolveDialogueApi(globalApi, char)`。
   角色那份存在 `char.dialogueApi`（`DialogueApiConfig`）。**第二期直接用，别自己写。**
3. **第一期不接备份**，三期做完一起接。她接受了「清缓存会丢书」。
4. **章节目录要做**，她会尽量找目录清晰的 TXT。
5. **页码不要**（她说不重要，已去掉）。

## 第一期做了什么

### 文件清单

```
features/readingRoom/types.ts        数据结构（书/章节/正文/进度）
features/readingRoom/parse.ts        解码 + 章节识别（纯函数）
features/readingRoom/paginate.ts     章节定位 + 块切分（纯函数）
features/readingRoom/measure.ts      按屏幕容量二分分页（纯函数，不碰 DOM）
features/readingRoom/layout.ts       段落切分 + 书封配色（纯函数）
features/readingRoom/store.ts        IndexedDB（SullyOS_ReadingRoom）
features/readingRoom/ReadingView.tsx 沉浸式阅读视图
apps/ReadingRoomApp.tsx              书架 + 调度
utils/readingRoom.test.ts            33 个用例，全过
```

### 接线点（加新 App 要碰的 7 处，已全部接好）

`types.ts` 的 `AppID.ReadingRoom` / `constants.tsx`（图标 `BookOpenUser` + INSTALLED_APPS，
排在交换日记后面）/ `components/PhoneShell.tsx`（lazyApp + APP_BY_ID + switch case 三处）/
`components/os/appPreload.ts` / `components/os/acnhIcons.tsx`（书 + 绿书签，
因为 Journal/Novel/Study/Worldbook/Guidebook 五个都用同一个 bookGlyph，不加书签会撞脸）/
`utils/safeAreaApps.ts` **和它的 `.test.ts`**（那个测试双向断言名单，漏一边就红）/
`utils/blurPolicy.ts`

### 关键设计决定（别重构掉）

**一切位置都用「全文字符偏移」表达。** 不依赖字号、屏幕宽度、DOM。
进度、章节、分页、第二期的划线全部共用这一套坐标。
`utils/readingRoom.test.ts` 里有一个守卫用例锁这件事：
「段落偏移能直接回原文 slice 出同一段字」。**第二期做划线前先跑它。**

**正文和书架分表存。** 列书架不读正文——一本几百万字符的书不该在每次刷新书架时被读出来。

**正文永不进请求。** 这是和协同工作最根本的区别：协同把附件正文整段塞进
system prompt（`files.ts` 上限 30 万字符），一本长篇装不下也不该装。
第二期只发「划线片段 + 前后少量原文」。

**分页是两层的，这一层很容易被误以为多余：**
1. `paginate.ts` 的 `pageAtOffset(..., READING_BLOCK_SIZE)` 纯计算把章切成 3000 字的「块」
2. `measure.ts` 的 `paginateBlock` 只对当前块做真实测量分页

为什么不直接量整章：「无目录」的书整章可能上百万字，一次量出几千页会卡死页面。
为什么块必须是纯计算：同一块 + 同一字号 + 同一屏幕必然得到同样的页边界，
**这是「来回翻页不错位」的全部依据**。有测试锁着。

**测量用 `useLayoutEffect`，不是 `useEffect`。** 后者会先闪一帧按旧边界排的内容。

**横翻容器是 `overflow-hidden`。** 这是故意的断言：需要上下滚才能读完一页，
就说明分页算错了，会立刻暴露而不是静默将错就错。

### 走过的弯路（别重复）

**第一版按固定 2400 字切页 —— 这是设计错误，不是取舍。**
手机一屏只显示六七百字，一页装不下，久必须先上下滚完才能左右翻，
等于把两种翻页方式搅在一起。她反馈了两次我才定位到。
`measure.ts` 顶部的注释写着这件事，别删。

**「点屏幕中间唤出菜单」实测点不稳**，久的反馈是「短按中间没办法固定点出菜单，
长按可以」。已改成滑动手势，参考 CoRead：
- 左右滑模式：左右滑翻页，**向下滑**唤菜单
- 上下滑模式：上下滚动阅读，**向右滑**唤菜单

## 已经告诉过她的脆点（不要当成新发现再说一遍）

1. **不进备份**，清浏览器数据或换设备会丢。界面顶部有提示条。
2. **章节识别会静默失灵**：只认整行独立、40 字内的标题行，少于 3 个标题就整本当一章。
   `chaptersDetected` 为 false 时界面会说明。
3. **编码可能猜错**：顺序是 BOM → 严格 UTF-8（fatal）→ 按乱码率挑 gbk/big5。
   长按书封可以指定编码重读。
4. **「换编码重读」只在本次会话内有效**：原始字节存在 `lastBufferRef`，
   重开 App 后会让她重新选一次文件。存字节等于一本书占双倍空间，所以没存。
5. **归档需要记忆宫殿的向量 API + 副 LLM 都配好**，缺一个就失败。
   **她还没回答配没配 —— 第三期开工前要问。**
6. **第二期的脆点，已提前说过**：滑动翻页会和「长按选字划线」抢同一个手势。
   现在靠时间和位移区分，做划线时可能要调。

## 第二期开工前要知道的

### 协同工作那套能复用什么（已查实，GPT 给久的建议有几处是错的）

能用：
- `features/collaboration/context.ts` 的 `buildCollaborationContextSnapshot`
  （沉浸式/专注式两档）和 `buildLiveCollaborationChatContext`
- `engine.ts` 的 `runCollaborationTurn` / `summarizeCollaborationForMemory`
- `store.ts` 的结构可以照抄（sessions / messages 分表 + charId 索引）
- 归档写记忆宫殿的完整例子在 `apps/Chat.tsx:3326` 的
  `handleCollaborationArchiveToMemory`（走 `importExternalMemoryText`
  + `mergePalaceFragmentsIntoMemories`）

**GPT 说错的几处，别照着找**：
- 它说 `ContextBuilder.buildCharacterRequest()` —— **这个函数不存在**
- 它说 TXT 上传/解析/IndexedDB「已经有了」—— 协同那套砍到 30 万字符，共读室不能用
- 它表格里「划线/摘要/询问角色」那几栏本来是空的，它在列待做项不是已有项

### 建议的做法

划线和讨论各自单独建表（挂在共读室数据库里，升 DB_VERSION 加 store），
划线记 `bookId + start + end + 原文 + 颜色`。讨论会话挂 `bookId + charId`。
**不要塞进协同工作的数据库**，两边互不干扰是久要的。

## 验收清单（让她测这些）

每次推完**先提醒她把页面彻底关掉重开**（关标签页，不是切后台）。见 HANDOFF 第 8 条。

1. 桌面有「共读室」图标（交换日记后面，书 + 绿书签）
2. 书架三列书封，最后一格虚线加号能上传 TXT
3. 长按书封出面板：改书名 / 换编码 / 删除
4. **一页是不是刚好一屏**（有没有哪页读到底还剩半句、必须上下滑）← 第三轮重点
5. 向下滑能稳定唤出菜单
6. 左右翻三页再翻回来，位置不跳
7. 一章读完底部留白，再翻一页进下一章
8. 上下滑模式：切过去能连续滚，跨章不跳
9. 改字号后还停在原来那段话
10. 退出重进还在上次那页

## 验证命令

```bash
cd ~/push
npx vitest run utils/readingRoom.test.ts                                   # 33 passed
npx vitest run utils/safeAreaApps.test.ts utils/blurPolicy.test.ts \
  utils/appPreload.test.ts utils/appErrorBoundary.test.ts                  # 接线回归
NODE_OPTIONS="--max-old-space-size=3072" timeout 900 npx vite build        # 必跑
# 成功标志是最后那行 Static cache: 23 shell files / 1324 versioned resources
```

全量测试有 109 个失败，**全部来自上游，不是我们的**。
见 HANDOFF 第 15 条的三方对照结论，别去修。
