# 共读室（ReadingRoom）· 交接

接手前先读 `.claude/HANDOFF.md`（那些规矩仍然适用，尤其第 1、2、3 条）。
这份只记共读室这件事。**2026-11-12 更新（第六次，第三期 + 备份全部验收完）。**

## 当前状态：三期做完了，备份也接上了。共读室这件事告一段落

- 分支 `feat/reading-room`，已推 origin。**没有合 master，master 干净。**
- 最新提交 `673b7c81`（接入备份导出与恢复）。
  上一个是 `d70b90a7`（第三期，写进记忆）。
  **这两包久都真机验过，她的话是「都验完了！没问题！」。**
- 久在 Vercel 用「分支专属预览链接」测，不用 Create Deployment（她说直接就有）。

**下一步没有既定任务。** 她没有提第四期。
真要往下做的话先问她想做什么，别自己挑一个开工（HANDOFF 第 1 条）。
**合不合 master 也是她决定的，别自己合。**

**久要求的节奏（她明确说过两次）：
「下一步做好了先让我验，没问题了再写进笔记里。」
做完先给她验，别先更新交接单。**

另外：本地 master 有一个未推送的提交 `2d0905ae`（更早窗口的 HANDOFF 更新）。
不影响干活，她没说要推，别自己推。

## 共读室现在能做什么（全部已验收）

导入 TXT → 逐段读 → 划线 → 「问角色」→ 在右侧面板里和角色讨论那一段 →
**把这个窗口的讨论写进角色的记忆**。
角色是**平时聊天里的那个角色**（人设、世界书、门牌、长期记忆、向量召回都在），
但讨论历史独立，不和日常私聊混。

书、划线、窗口、讨论消息、当前选择**全部进备份**（第一期欠的那件事做完了）。

她原话里的完整设想是「划线 → 发给选定角色 → 开独立窗口讨论 →
**手动归档进记忆宫殿**」。**这条路现在整条都通了。**

## 久拍板过的事（别再问，也别擅自改）

1. **窗口只属于角色，不属于书。** 她原话：「不分书 就是切 b 书 还是默认用
   原来选定的那个窗口……选窗口是用户的事情。不能随着切书而自动换窗口。」
   角色怎么知道在读哪本书？**写在发送内容里。**
2. **划线全局共用，不分角色。** 「不管选择哪个角色，用户都能看见自己在书上的划线。」
3. **讨论用的 API：角色独立 API 优先，没配跟随全局。** 两边都没配要明确报错。
4. **底栏在 App 里，不在书里。** 阅读页整屏接管。
5. **划线列表留在阅读页**，不要搬进设置页。
6. **半屏→全屏只做按钮，不做拖动把手。** 理由：拖动和翻页抢手势。
   **别主动加拖动。**
7. **记忆召回用 `reading_room` 这个入口**（为此动了两个上游文件，见下）。
8. **记忆召回每轮都跑。** 她说「每轮都跑！」。别改成只在带引用那轮跑。
9. **允许表情包，禁掉语音条。**
10. **心象（思考链）带进来**，而且要认她自己做的「关掉自带提示词」开关。
11. **说明里角色名和用户名都是变量。** 她特意要求：不要写「你仍然是角色本人」，
    要写「你仍然是〔角色名〕」；用户名跟随 `userProfile.name`。
12. **页码不要**，底部那条带子留空。
13. **跨段可以划线。**
14. ~~第一期不接备份~~ → **已经接了**（`673b7c81`）。
    书 / 正文 / 划线 / 窗口 / 讨论消息 / 当前选择全部进备份。见下面「备份」那节。
15. **章节目录要做**，她会尽量找目录清晰的 TXT。
16. 半屏宽度 **56%**，她验过没提，别乱动。
17. **归档总结用记忆宫殿的副 LLM**（`memoryPalaceConfig.lightLLM`），
    不跟角色的对话 API。理由是她要的：归档口径不该跟着角色换模型而变。
18. **「归档」和「写进记忆」是两个按钮。** 她说「听你的分成两个」。
    归档只是收起来（纯界面），写进记忆真的改角色的脑子。
19. **归档粒度：一个窗口一条记忆。** 她原话：「一条混着的记忆就行。就是一个窗口
    点写进记忆只写入一条记忆，不要拆开」。一个窗口堆了三本书也是一条。
20. **总结包日期壳**（`【11月12日，正文】`），她说「跟着协同来吧」。
21. **记忆删不掉这件事她接受。** 原话：「就不用靠这个功能删 我要删记忆的话
    我自己去记忆宫殿就好」。**别为此加删除入口。**
22. **没配副 LLM 时留手写这条退路**（她说「可以留」）。确认后只写神经链接。
23. **备份里带书的正文**（方案 A）。她选的，知道备份会变大，
    打算「读完一本就把那本从书架上删掉」。
24. **导入备份走覆盖**，她说「覆盖吧」。不是合并。

## 她的环境（不用再问了）

**副 LLM、向量 API、记忆宫殿开关她都配好了**，原话：
「现在副 API 跟向量都配着了！记忆宫殿都一直开着了」。

## 第二期四包做了什么

### 1. `cb838b04` 数据层（v4）

`store.ts` **DB_VERSION 3 → 4**，加 `messages` 表（`by_window` 索引）。
**只加表**，v1–v3 的书 / 正文 / 进度 / 划线 / 窗口原样保留（有测试）。

新类型：`ReadingDiscussionMessage`、`ReadingMessageReference`。
窗口上加了 `lastMessagePreview` / `lastMessageAt`。
设置页加了窗口改名和消息预览。

### 2. `a32d0b1b` 讨论面板（当时不接 AI）

新建 `ReadingDiscussionPanel.tsx`。右侧小把手 → 面板滑出盖住正文右半边。
「问角色」只挂引用不发送，引用出现在输入框**上方**。

### 3. `0ad3e4f5` 接真 API

新建 `requestContext.ts`（上下文组装）和 `engine.ts`（发请求）。
流式、停止生成、失败提示、Markdown、心象折叠块。

### 4. `8ab06298` + `b172988d` 长按菜单 + 表情渲染

长按气泡：自己那条能「收回来改」或删，角色那条能删（连心象）。
角色发的表情渲染成真图。

### 中途修的一个老 bug：`d0089a76`

设置页选中靠下的窗口后列表跳回顶部。**第一期就有的**，不是第二期引入。
两个原因都在下面「别重构掉」里。

## 关键决定（别重构掉，每条都有代价）

### 数据

**引用里只有书名 / 章节 / 划线原文。** `buildHighlightContext` 那个
`before` / `after`**一个字都不进库**——存了的话之后每次读历史都会把前后文
带回来，等于反复发给模型。**两条测试锁着**（纯逻辑层和库层各一条，
都是 `expect(JSON.stringify(...)).not.toContain('before')`）。

**消息只挂 windowId，没有 bookId。** 一个窗口堆着好几本书的讨论，
是哪本写在 `reference` 里。有测试。

**窗口只认 charId。** `discussion.ts` 里所有函数都没有 bookId 参数，
测试里有 `expect(Object.keys(created)).not.toContain('bookId')` 锁着。

**`deleteWindow` 连带删消息**，同一个事务、索引游标锁死单个 windowId。
有测试锁「不碰同角色的其它窗口」。

**`deleteBook` 故意不删讨论消息。** 窗口不属于书，按书删会在历史中间挖洞。
引用里存了**当时的书名**，书删掉之后翻历史照样看得出在说哪本。

**`saveMessage(message, window?)` 两张表一个事务。** 消息进去了但窗口预览
没更新，列表会显示上一条，看着像没发出去。
窗口那份由调用方算好传进来（`applyMessageToWindow`），store 里不做读-改-写。

**删消息之后要 `recomputeWindowPreview`。** 不然删掉最后一条，设置页那行
还显示它。`updatedAt` **不往回退**——删一条不该让窗口掉到列表最底下。

**「没变化就返回同一个对象」这个套路有三处**：`reconcileSelection`、
`renameWindow`、`applyMessageToWindow`（空内容时）。调用方靠 `===` 跳过写库。
改成每次都返回新对象，就会出现「什么都没改但窗口跳到列表最前面」。

### 请求

**顺序：先 `injectMemoryPalace`，再 `buildCharacterRequest`。**
门牌（房间常驻介绍，纯本地读不花钱）和向量召回**都不是
`buildCharacterRequest` 自己能拿到的**，必须先让 `injectMemoryPalace` 把它们
挂到角色对象上。倒过来写这两样全丢，而且**不报错，只是静默地没有**——
表现是「角色好像不记得我」。

**召回写在角色的浅拷贝上。** 那些注入字段会被 `saveCharacter` 持久化，
污染真对象会让日常聊天也带上共读室这一轮的召回。

**走 `buildCharacterRequest`，不是 `buildLiveCollaborationChatContext`。**
后者内部真的去读 ChatApp 聊天历史。前者天生不读，正好是久要的
「角色一致但讨论历史独立」。**这是整个第三包最容易搞错的一处。**

**不用 `runCollaborationTurn`。** 它走协同自己的 API Profile，
不是「角色独立 API 优先 + 全局兜底」。

**当前这条用户消息只进请求一次。** `handleSendDiscussion` 里
`const history = discussionMessages` 是在把这条加进 state **之前**取的，
就是为了这件事。

### 界面

**面板是独立组件，绝对定位盖在阅读页上，和正文是兄弟节点。**
**绝对不要搬进阅读页那个 flex 容器**——那样正文宽度跟着面板变，
测量容器和正文不再一致（`b173df6f` 修过的病）。
久要的「不挤压正文」是从结构上成立的，不靠小心。

**面板根节点停住 touchstart / touchmove / touchend。**
阅读页在正文上挂了翻页和长按划线。**只 `stopPropagation`，不要
`preventDefault`** —— 后者会连带杀掉面板自己的滚动和输入框聚焦。

**待发送的引用放在 `ReadingView`，不在面板里。** 面板关掉会卸载自己的 state，
而久要求「引用不能因为打开面板、切半屏全屏而丢失」。

**`draftSeed` 带 token。** 同一句话连着改两次，文本没变但 token 变了，
第二次也能生效。

**设置页加 effect 之前先想一遍：它会不会每次重渲染都重读一次窗口。**
`d0089a76` 就是这么来的，两个原因：
1. `onError` 以内联箭头函数传入，每次渲染都是新引用 → 改成
   `handleSettingsError` 用 `useCallback` 固定。**别改回内联函数。**
2. 有个 effect 盯着整个 `windows` 数组决定停哪一栏 → 删掉了，改成在
   `refreshWindows` 读完时决定一次。那个 effect 还有个更明显的毛病：
   归档/撤销归档改完列表，**分栏会被强行切走**。

**表情找不到时显示虚线框写明名字，不静默吞掉**——否则看着像角色发了句空话。
**流式途中也要切掉表情标签**，不然半截的 `[[SEND_EMOJI` 会闪出来。

### 阅读（更早几包，也都验收过）

**一切位置都用「全文字符偏移」表达。** 不依赖字号、屏幕、DOM。
`utils/readingRoom.test.ts` 有守卫用例：「段落偏移能直接回原文 slice 出同一段字」。
**改排版相关的东西前先跑它。**

**上下留白必须是独立的 flex 兄弟节点，不能改回 padding。**
测量依据是正文层的 `clientHeight`，而它**含 padding**——
用 padding 做留白会让量出的高度比真实可排区域多两条，每页多塞约两行。

**测量容器和正文必须排得一模一样。** 两边共用 `splitParagraphs`、
`textStyle`、`READING_PARAGRAPH_GAP_EM`。改一处记得对齐另一处。

**测量用 `useLayoutEffect`**，不是 `useEffect`（后者会先闪一帧旧边界）。

**分页是两层的**：`paginate.ts` 纯计算把章切成 3000 字的块，
`measure.ts` 只对当前块做真实测量。
为什么不量整章：无目录的书整章可能上百万字，一次量出几千页会卡死。
为什么块必须纯计算：同一块 + 同一字号 + 同一屏幕必然得到同样的页边界，
**这是「来回翻页不错位」的全部依据**。

**划线不按页存**，一条跨页划线就是一条记录，渲染时和当前页求交。

**划线底色 / 落点高亮 / 起点标记只改背景色**，不碰行高和 padding——
一旦影响排版高度，正文就和测量容器不一致了。

**横翻容器是 `overflow-hidden`。** 故意的断言：需要上下滚才能读完一页
就说明分页错了，会立刻暴露。

**取偏移不假设段落里只有一个文本节点。** 划线会把段落切成多个 span，
`caret.ts` 的 `offsetWithinHost` 用 TreeWalker 累加。

**正文永不进请求。** 只发划线片段 + 前后各 320 字符。

### 归档写进记忆（第三期，`d70b90a7`）

**总结走 `memoryPalaceConfig.lightLLM`，不走 `resolveDialogueApi`。**
归档的口径不该跟着角色换模型而变（她定的）。讨论本身仍然走角色的对话 API，
**两条路别混**——改成一条会让归档的文风随角色 API 漂移。

**「没配」和「报错」是两件事，别合并。** 她专门问过这个。
- 没配（三样缺一个）：不发请求，预览开成手写模式
- 报错（网断/渠道炸）：显示原因 + 可重试，**窗口一个字不改**
判断函数是 `isArchiveSummaryApiConfigured`，只看三个字段有没有值。
把网络错误说成「没配置」会让她白跑一趟设置页。

**顺序是定的：先写记忆，成功了才标记窗口。** 反过来会出现
「界面说写好了，角色脑子里什么都没有」——而她没办法自己发现。
`handleArchiveConfirm` 里两个 try 分开写就是为了这件事。

**`markWindowMemoryArchived` 和 `setWindowArchived` 必须分开。**
撤销归档只清 `archivedAt`，**不清 `memoryArchivedAt`**。
记忆写进去就撤不回来，清掉那个字段只会让界面谎称没写过，
然后在记忆宫殿里重复写出几条很像的记忆。**有测试锁着。**

**神经链接判重靠 `reading_room_archive_<窗口id>` 这个固定 id**
（`readingArchiveFragmentId`）。**记忆宫殿里的向量记忆不认这个 id**，
它按内容相似度去重。所以重复归档同一个窗口，宫殿里可能多出几条相近的，
界面上靠「已写进记忆」的状态 + 二次确认来防。她知道，也接受。

**心象、划线前后文一个字都不进总结输入。** 心象是角色没说出口的话，
当成发言会让总结写出它从没表达过的态度；前后文从第二期起就不进库，
归档时也不许重新构造（书的正文不能因为归档进长期记忆）。**都有测试。**

**预览页是独立组件**（`ReadingArchiveReview.tsx`），不在设置页里。
那个文件的列表重建踩过「滚动跳回顶部」（`d0089a76`），
预览有三种状态，塞进去要再碰一遍那条路径。**别搬进去。**

**预览里 `summary` 变了才覆盖输入框。** 用 `lastSummaryRef` 比对，
不能无条件 `useEffect` 写回——父组件重渲染会把她刚改的字冲掉。

**`importExternalMemoryText` 的几种返回要翻译成人话**，别把内部标识抛给她：
`'lock'` → 「正在整理别的记忆，过一会儿再写」；
`'no_memories'` → 「没能提取出可保存的记忆，写具体一点再试」。

### 备份（`673b7c81`）

**`importAll` 先清七张表再写入，所以校验层不能省。**
没校验过的数据走到那一步意味着「一份坏备份就能把书架清空」。
筛选在 `utils/readingRoomBackup.ts`，逐行筛、坏的丢掉好的留下——
**不要改成整包拒绝**，一本书的某个字段坏了不该让整个书架恢复不了。

**`parseReadingRoomBackup` 返回 null 时调用方必须跳过，不能调 `importAll`。**
null 的意思是「这份备份里没有共读室这一块」（原版 SullyOS 导出的就是这样），
传个空对象进 `importAll` 会把现有数据清空。**有测试盯着这条。**

**划线区间的校验最要紧**：`startOffset` / `endOffset` 必须是有限数字且
前者小于后者。NaN 或反区间会让「划线和当前页求交」算出离谱结果——
正文里凭空出现一大片底色，或者这一页直接空掉，**而且不报错**。

**`chapters` 不是数组时退回空数组，但书留着。** 分页直接遍历它，
给个字符串会在打开书的瞬间抛错。空数组是合法的（整本当一章）。

**没有改备份的 `formatVersion`。** 改了原版 SullyOS 会拒绝导入整个文件。
跨版本兼容靠的是「原版的导入逻辑逐字段点名取，不认识的键原样忽略」，
不是靠版本号。**以后加字段也别动 formatVersion。**

**备份测试单独一个文件**（`readingRoomBackupStore.test.ts`），
不并进 `readingRoomStore.test.ts`。那边的用例靠各自唯一的 id 互相隔离，
`importAll` 清全表，混在一起会随机失败。

## 第三期做了什么（`d70b90a7`，已验收）

### 她点头的流程

设置页窗口卡片上「写进记忆」→ 副 LLM 总结 → **弹出来给她看一眼**（可以改字、
可以重新生成、可以取消）→ 她点确认 → 真正写入 → 卡片显示「已写进记忆」。

她一开始以为 GPT 说的「两次副 LLM」是要她确认两遍。
**不是。** 第二次是 `importExternalMemoryText` 内部把她确认的文字拆成
可检索的记忆条目再向量化，那是写进记忆宫殿唯一的入口，绕不过去。
她只需要确认一次，只是点完之后要多等几秒。
**她要是再问起这件事，照这个解释，不要重新设计流程。**

### 怎么实现的

- `features/readingRoom/archive.ts` —— 转写（清表情标签、不带心象、
  不带前后文）+ 第一人称提示词 + 调副 LLM + 日期壳 + 固定归档 id。纯逻辑。
- `features/readingRoom/ReadingArchiveReview.tsx` —— 预览页，独立组件，
  自己不发请求。
- `ReadingRoomSettings.tsx` —— 「写进记忆」按钮 + `ArchiveFlow` 状态机。
- `apps/ReadingRoomApp.tsx` —— `handleSummarizeWindow`（调副 LLM）和
  `handleArchiveToMemory`（走记忆宫殿管线 + 同步神经链接）。
  这两个在 App 层是因为 `memoryPalaceConfig` / `updateCharacter` 在那一层。
- `types.ts` 加 `memoryArchivedAt` / `memoryArchiveSummary`，
  **数据库仍是 v4**，只给窗口对象加可选字段，没有新表。

参考的现成实现：`apps/Chat.tsx:3326` 的 `handleCollaborationArchiveToMemory`
和 `features/collaboration/engine.ts` 的 `summarizeCollaborationForMemory`。
温度 0.25、`stream:false`、120 秒超时都照协同来（她说「参考协同」）。

### 这期刻意没做的（别自己加）

- **不自动归档。** 她要的是手动。
- **不把共读室消息写进日常私聊历史，也不塞进协同的数据库。**
- **不提供删记忆的入口。** 她说要删自己去记忆宫殿。

## 备份（`673b7c81`，已验收）

第一期欠的那件事做完了。书 / 正文 / 进度 / 划线 / 窗口 / 讨论消息 / 当前选择
**全部进备份**（导出选「文本」或「完整」都带，「仅媒体」不带）。

- `features/readingRoom/store.ts` 加 `exportAll` / `importAll`（全表读写）
- `utils/readingRoomBackup.ts` 校验层（**不能省，理由见「关键决定」**）
- `types.ts` 的 `FullBackupData` 加 `readingRoom`
- `context/OSContext.tsx` 导出和恢复各一处 —— **这是上游文件，
  同步上游时要多顾这个改动点**（HANDOFF 里的清单已更新）

### 她问过的「还能导进原版吗」—— 能，查实过

- **这份备份导进原版**：原版的导入逻辑逐字段点名取，`readingRoom` 它不认识，
  原样忽略。不报错，也不弄坏别的数据。
- **原版备份导进这个版本**：`parseReadingRoomBackup` 返回 null，跳过恢复，
  不动现有数据。
- 拦截第三方备份的 `utils/backupImportPolicy.ts` 只拦 `vectorMemories` 和
  `extraLocalStorageConfig`，和我们无关。

**她的用法**：读完一本就从书架删掉，下次备份就不带那本了。
删书会连带删掉正文、进度、**那本书的所有划线**；
讨论消息和已写进去的记忆都不受影响（引用里存着当时的书名）。
**提醒她先「写进记忆」再删书**，反过来虽然也能总结，但没法翻回原文核对了。

## 文件清单

```
features/readingRoom/types.ts        数据结构（书/章节/正文/进度/划线/窗口/选择/消息）
features/readingRoom/parse.ts        解码 + 章节识别（纯函数）
features/readingRoom/paginate.ts     章节定位 + 块切分（纯函数）
features/readingRoom/measure.ts      按屏幕容量二分分页（纯函数，不碰 DOM）
features/readingRoom/layout.ts       段落切分 + 段间距 + 书封配色（纯函数）
features/readingRoom/highlight.ts    划线纯逻辑：区间/与页求交/切片/微调/上下文
features/readingRoom/caret.ts        触摸点 → 全文偏移（唯一碰浏览器排版的地方）
features/readingRoom/discussion.ts   窗口和消息的纯逻辑：分栏/命名/改名/预览/失效修复/归档标记
features/readingRoom/requestContext.ts  一轮请求的上下文组装（召回 + 人设 + 共读说明）
features/readingRoom/engine.ts       发请求（API 解析 + 流式 + 回复解析）
features/readingRoom/archive.ts      归档总结：转写 + 第一人称提示词 + 调副 LLM + 日期壳
features/readingRoom/store.ts        IndexedDB（SullyOS_ReadingRoom，DB_VERSION 4）+ 备份的全表读写
features/readingRoom/ReadingView.tsx 阅读视图 + 划线交互 + 挂载讨论面板
features/readingRoom/ReadingDiscussionPanel.tsx  讨论面板（盖在阅读页上那一层）
features/readingRoom/ReadingRoomSettings.tsx     设置页（选角色 + 选窗口 + 改名 + 写进记忆）
features/readingRoom/ReadingArchiveReview.tsx    写进记忆前的预览页（独立组件）
apps/ReadingRoomApp.tsx              书架 + 底栏 + 调度 + 划线/选择/讨论的读写 + 调副 LLM 和写记忆
utils/readingRoomBackup.ts           备份的导出包装 + 导入校验（纯函数）
utils/readingRoom.test.ts            36 个用例
utils/readingRoomHighlight.test.ts   33 个用例（划线那套）
utils/readingRoomDiscussion.test.ts  52 个用例（窗口、改名、消息、预览、选择）
utils/readingRoomStore.test.ts       8 个用例（真读写 IndexedDB：v4 升级/隔离/级联删）
utils/readingRoomRequest.test.ts     27 个用例（说明里的变量、心象开关、前后文边界）
utils/readingRoomArchive.test.ts     28 个用例（转写、提示词、配置判断、日期壳、归档标记）
utils/readingRoomBackup.test.ts      23 个用例（原版兼容、坏数据筛除）
utils/readingRoomBackupStore.test.ts 5 个用例（真读写 IndexedDB：往返、覆盖语义）
```

合计 **212 个用例**。

### 动过的上游文件（合上游时留意）

- `utils/memoryPalace/trace.ts` —— `RecallEntryPoint` 加了 `'reading_room'`
- `utils/memoryPalace/pipeline.ts` —— 让 `reading_room` 和 `collaboration`
  同档走精确实体召回
- `context/OSContext.tsx` —— **备份那两处**（导出的 `readingRoom` 字段、
  恢复时的 `parseReadingRoomBackup` + `importAll`）。
  这个文件本来就有「响应原文抓包」的改动，同步上游时一起顾。
- `types.ts` —— `FullBackupData` 加 `readingRoom` 字段

**撞了手工接回来就行，别为了省事改回中性标签**——那会让角色认不出
她提到的人名地名。

### 接线点（加新 App 要碰的 7 处，已全部接好）

`types.ts` 的 `AppID.ReadingRoom` / `constants.tsx`（图标 `BookOpenUser` + INSTALLED_APPS，
排在交换日记后面）/ `components/PhoneShell.tsx`（lazyApp + APP_BY_ID + switch case 三处）/
`components/os/appPreload.ts` / `components/os/acnhIcons.tsx`（书 + 绿书签，
因为 Journal/Novel/Study/Worldbook/Guidebook 五个都用同一个 bookGlyph，不加书签会撞脸）/
`utils/safeAreaApps.ts` **和它的 `.test.ts`**（那个测试双向断言名单，漏一边就红）/
`utils/blurPolicy.ts`

## 协同工作那套能复用什么（已查实）

能用：
- `markdown.ts` 的 `parseCollaborationMarkdown`（**已在用**，项目没装 Markdown 库）
- `richOutput.ts` 的 `parseCollaborationRichOutput` / `resolveCollaborationEmoji`
  （**已在用**，表情解析）
- `reasoning.ts` 的 `parseCollaborationReply`（**已在用**，处理各家把思考链
  塞在 reasoning_content 的差异）
- `store.ts` 的结构（sessions / messages 分表 + charId 索引）
- `types.ts` 的 `CollaborationSession.archivedAt`（两栏分法就是照它来的）
- `engine.ts` 的 `summarizeCollaborationForMemory`（第三期可参考）

**不能用**：
- `runCollaborationTurn` —— 走协同自己的 API Profile
- `buildLiveCollaborationChatContext` —— 内部真去读日常私聊
- `CollaborationStore` 当共读室的消息库

**项目里没有装 Markdown 库**（package.json 里没有 marked / react-markdown）。
所以 Markdown 只到基础：粗体、斜体、行内代码、链接、列表、引用、
代码块、分割线，**没有表格**。想要表格得先让久同意装依赖。

## 数据从哪里读

**选择**：`ReadingRoomStore.getSelection()` 返回 `charId` + `windowId`，
进 App 时已经被 `reconcileSelection` 修过一遍。角色对象从 `useOS()` 的
`characters` 按 id 找。

**消息**：`ReadingRoomStore.listMessages(windowId)`，已按时间正序。
存用 `saveMessage(message, applyMessageToWindow(window, message))`。
删完记得 `recomputeWindowPreview`。

## 已经告诉过她的脆点（不要当成新发现再说一遍）

1. ~~不进备份~~ → **已经进备份了**。但**清浏览器数据还是会丢**（备份要她手动导出）。
   界面提示已改成这个口径。导入备份会**覆盖**现有的书和讨论，她知道。
2. **章节识别会静默失灵**：只认整行独立、40 字内的标题行，少于 3 个标题就
   整本当一章。`chaptersDetected` 为 false 时界面会说明。
3. **编码可能猜错**：BOM → 严格 UTF-8（fatal）→ 按乱码率挑 gbk/big5。
   长按书封可以指定编码重读。
4. **「换编码重读」只在本次会话内有效**：原始字节存在 `lastBufferRef`，
   重开 App 后要重新选文件。存字节等于一本书占双倍空间，所以没存。
5. **划线落点靠浏览器排版接口，实测会偏一两个字。** 已给逐字微调。
   退路（还没用上）：`caret.ts` 的 `sentenceRangeAt` 可以改成「长按直接选整句」。
   函数在，有测试，但 ReadingView 没引用它。
   **她还没回答偏差是固定方向还是随机的**——如果她以后说「总是偏左一个字」，
   可以在 `resolveOffsetAtPoint` 的返回值上补偏移量。**别主动去改。**
6. **一个窗口会堆多本书的讨论。** 她定的「不分书」的直接后果，她知道。
   缓解靠发送时写明书名，不靠数据结构。
7. **升数据库版本那次要她彻底关掉页面重开**，否则可能弹
   「共读室数据库被其它标签页占用」。v3、v4 两次都没出问题，但以后再升要先提醒。
8. **半屏只有 56% 宽**，长回复会挤。全屏按钮就是为这个做的。
9. **设置页的角色头像走 `TokenImg`**，命令行测不出来。她要是说头像是空的，
   先查 `TokenImg` 对 `char.avatar` 的处理，别先怀疑选择逻辑。
10. **第一次回话会慢一点**（要先跑一轮向量召回再发请求）。
    她验过了，接受这个延迟。
11. **点「写进记忆」之后要等两段**：第一段是副 LLM 写总结，
    第二段（确认之后）是记忆宫殿提取 + 向量化。她验过，接受。
12. **提取那一步可能提不出东西**（`no_memories`）：总结太空、格式不对、
    渠道返回空。那时候窗口不标记成功，她能重试。**她问过这是什么意思**，
    解释过了，不用再当成新发现说一遍。
13. **同一个窗口反复写进记忆，宫殿里可能多出几条相近的记忆。**
    神经链接那条不会重复（固定 id），向量记忆按内容去重。
    她说要删自己去记忆宫殿。
14. **删书会连带删掉那本书的所有划线**（正文、进度也一起）。
    讨论消息和已写进去的记忆不受影响。她打算读完就删书来省备份体积，
    **提醒她先写进记忆再删**。

## 验收清单

每次推完**先提醒她把页面彻底关掉重开**（关标签页，不是切后台）。见 HANDOFF 第 8 条。

### 已经验收通过的（不用再让她测一遍）

阅读：
1. 桌面有「共读室」图标（交换日记后面，书 + 绿书签）
2. 书架三列书封，最后一格虚线加号能上传 TXT
3. 长按书封出面板：改书名 / 换编码 / 删除
4. 一页刚好一屏，不用上下滑
5. 向下滑能稳定唤出菜单
6. 左右翻三页再翻回来，位置不跳
7. 一章读完底部留白，再翻一页进下一章
8. 上下滑模式：切过去能连续滚，跨章不跳
9. 改字号后还停在原来那段话
10. 退出重进还在上次那页
11. 段落顶格、段间距、上下留白
12. 长按划线（含跨页）、落点高亮、逐字微调、划线列表、删除划线

设置和窗口管理：
13. 底栏「书架 / 设置」切换，选中态正确
14. 选角色（头像 + 名字）、窗口分「未归档 / 已归档」两栏
15. 新建窗口自动选中，归档后跑到已归档栏，删除可用
16. 退出重进，选的角色和窗口还记得；换书不改选择
17. 窗口改名（改完还在、取消不改、没改动不跳到列表最前）
18. 窗口卡片上的消息预览
19. 选中靠下需要滑动才点到的窗口，列表不跳回顶部
20. 在已归档栏撤销归档，不会被切到未归档栏

讨论面板：
21. 右侧小把手点一下面板滑出，盖住正文右半边（正文没被挤窄）
22. 面板打开时正文停在原来那一页，字号和分页没变
23. 没选角色/窗口时点把手有明确提示
24. 划线后「问角色」→ 输入框上方出现引用卡片
25. 引用卡片切半屏/全屏、关掉面板再打开都还在
26. 半屏按一下变全屏，再按回半屏
27. 面板里滑动不误翻页、长按不弹划线小条
28. 键盘弹出时输入框还看得见
29. 发一条消息，退出这本书再打开，消息还在

角色回话：
30. 角色真的会回话，回话里看得出它知道在读哪本书、哪一章、划了哪句
31. 角色认得出平时聊天里的人和事，但不会提日常私聊的具体对话
32. 流式一个字一个字出来，等的时候显示三个点
33. 生成中能停下来
34. 请求失败时自己那条消息还在，底下挂红色提示（可叉掉）
35. 换书在同一个窗口继续聊，历史里分得清哪本
36. 生成中切窗口，上一个窗口的回复不会串进来

消息操作：
37. 长按自己那条 →「收回来改」，文字和引用回到输入区，对话里那条消失
38. 同一句话连着改两次都生效
39. 长按角色那条 → 删掉，心象跟着没了
40. 删掉最后一条，设置页那行预览退回上一条；删空显示「还没有讨论记录」
41. 聊天记录正常上下滑不会误弹菜单

表情：
42. 角色发的表情渲染成真图，不是一行标签
43. 生成过程中不会闪出 `[[SEND_EMOJI`
44. 设置页预览里表情显示成「[表情]」

写进记忆（第三期）：
45. 窗口卡片上有「写进记忆」，在改名/归档/删除那一行下面
46. 没讨论过的窗口按钮是灰的，写着「还没有讨论，写不了」
47. 点下去转圈，弹出一段第一人称的总结，开头带日期壳
48. 总结里看得出真的书名、她说过的话
49. 那段话能直接改字
50. 「重新生成」会出一段新的
51. 「先不写，关掉」什么都不发生，卡片上不出现「已写进记忆」
52. 确认后再等一会儿，成功弹绿色提示
53. 卡片上出现「· 已写进记忆」，按钮变灰写「已写进记忆 · 再写一次」，
    再点会先弹确认框
54. **在日常聊天里角色记得一起读过这本书、聊过那段**（这一期真正要的效果）
55. 撤销归档之后「· 已写进记忆」还在

备份：
56. 导出备份（选「文本」或「完整」）
57. 把备份导回来，重开之后书架、划线、讨论、「已写进记忆」的标记都在
58. 书架顶部和设置页底部的提示文字对得上（不再说「不进备份」）

## 验证命令

```bash
cd ~/push
npx vitest run utils/readingRoom.test.ts utils/readingRoomHighlight.test.ts \
  utils/readingRoomDiscussion.test.ts utils/readingRoomStore.test.ts \
  utils/readingRoomRequest.test.ts utils/readingRoomArchive.test.ts \
  utils/readingRoomBackup.test.ts utils/readingRoomBackupStore.test.ts    # 212 passed
npx vitest run utils/memoryPalace                                            # 402 passed
npx vitest run utils/safeAreaApps.test.ts utils/blurPolicy.test.ts \
  utils/appPreload.test.ts utils/appErrorBoundary.test.ts                    # 28 passed
# 动了 OSContext / types.ts，备份那一整套也要跑：
npx vitest run utils/backup utils/promptToggleBackupCompat.test.ts \
  utils/storyTheaterBackup.test.ts utils/userSpaceBackup.test.ts \
  utils/apiResponseCapture.test.ts utils/apiCallLog.test.ts   # 165 passed / 1 failed
NODE_OPTIONS="--max-old-space-size=3072" timeout 900 npx vite build          # 必跑
# 成功标志是最后那行 Static cache: 23 shell files / 1325 versioned resources
```

**`npx tsc --noEmit` 在这个环境 OOM 跑不完**（HANDOFF 也记了），
别当成代码错误。类型和图标名靠 `vite build` 抓。

备份那一批里 **`backupArchive.test.ts` 会超时失败**（断言 5 秒，
这台机器跑 7.5 秒）。**不是我们弄坏的**：已用 worktree 在 `d70b90a7`
上对照过，改之前同样失败。别去修，也别调它的超时。

`utils/readingRoomStore.test.ts` 和 `readingRoomBackupStore.test.ts`
**真的读写 IndexedDB**（fake-indexeddb 由 test-setup.ts 注入）。
**不要去 deleteDatabase** —— store.ts 内部是单例连接，会把删库请求 block 住。
这两个文件**必须分开**：前者靠唯一 id 隔离，后者的 `importAll` 清全表，
合在一起会随机失败。

改了 `memoryPalace` 那两个文件，所以那 402 个每次也要跑。

**提交信息用 `-F 文件`，不要用 heredoc。** 中文多行在这个终端里会被吃掉换行。

全量测试有 109 个失败，**全部来自上游，不是我们的**。
见 HANDOFF 第 15 条的三方对照结论，别去修。

### 查图标在不在的办法

`ArchiveBox` 这个名字在项目的图标库里不存在，曾经让 `vite build` 直接失败。
`require` 那条路读不出来，别白试：

```bash
F=$(ls node_modules/.pnpm/@phosphor-icons+react*/node_modules/@phosphor-icons/react/dist/index.es.js)
grep -c "as 图标名[,}]" $F    # 1 = 有，0 = 没有
```

## 走过的弯路（别重复）

**第一版按固定 2400 字切页 —— 设计错误，不是取舍。**
手机一屏只显示六七百字，一页装不下，她必须先上下滚完才能左右翻，
等于把两种翻页方式搅在一起。她反馈了两次才定位到。

**「点屏幕中间唤出菜单」实测点不稳**，她的反馈是「短按中间没办法固定
点出菜单，长按可以」。已改成滑动手势（左右滑模式向下滑，竖滑模式向右滑）。

**上下留白用 padding —— 真 bug，不是取舍。** 详见上面「关键决定」。

**划线一度打算做「拖把手改范围」。放弃了，别捡回来。**
翻页会重渲染当前页，原生 Selection 跨页不存活；拖动那一下最容易和
左右滑翻页抢手势。现在是两次长按定起止，同页跨页同一套操作。
**面板的半屏/全屏也因此只做按钮。**

**只给「取消重选」不够。** 她反馈落点偏一两个字时提议「高亮 + 能重选」，
我加了逐字微调，理由：偏差若是系统性的（总偏同一方向），重选多少次都一样。

**GPT 给她的那份开发说明有四处和代码不符**（她 2026-11-12 给的，大方向对）：
1. 说 `resolveDialogueApi(globalApi, character)` 签名已核实 —— 实际是三个参数
2. 说 `ContextBuilder.buildCharacterRequest()` 不存在 —— **它存在**，
   而且正是共读室该走的路。那是更早一个窗口的我写错了，害下一个窗口差点绕路
3. 说「参考协同沉浸式但别带入私聊」—— 那在协同是**两个函数**，它混成一句了
4. 说列表排序要改成按最近消息时间 —— 现有 `filterWindows` 按 `updatedAt`
   倒序有测试锁着，而存消息时 `updatedAt` 一起更新了，排序一行没动

**第三期那份 GPT 文档（她 2026-11-12 给的）大方向也对，但改了四处：**
1. 它说「预览界面建议仍然放在 `ReadingRoomSettings.tsx`」——
   改成独立组件。那个文件踩过滚动跳回顶部，预览有三种状态，别往里塞。
2. 它说「归档按钮先启动总结」——那会把**撤销归档**也绕进总结流程，
   而且改掉已验收的第 19/20 条。改成「归档」和「写进记忆」两个按钮，她同意。
3. 它说「副 LLM 没配就明确报错」——太绝对。留了手写进神经链接这条退路，
   她说「可以留」。
4. 它回避了归档粒度（说「分别保留重要书籍的信息」其实还是一条记忆）。
   直接问她了，她定「一个窗口一条，不要拆开」。

**写错过字段名，差点漏掉最要紧的一条校验。** 写备份校验时我凭印象用了
`start` / `end`，划线的真实字段是 **`startOffset` / `endOffset`**。
那条校验正好是整层里最关键的（坏区间会让正文显示异常且不报错），
按错名字写等于那一条完全失效，**而且测试也会跟着错，照样全绿**。
教训：**写校验前先 `sed` 看一眼真实的类型定义**，别凭上下文记忆。

**`grep_code` / `read_file` 这类工具在这台机器上对 `~/push` 时好时坏**
（报 `No such file or directory`，但 `read_file_part` 和终端都正常）。
撞到了直接换 `github:terminal_exec` 跑 `grep`/`sed`，别以为仓库坏了。
