# 共读室（ReadingRoom）· 交接

接手前先读 `.claude/HANDOFF.md`（那些规矩仍然适用，尤其第 1、2、3 条）。
这份只记共读室这件事。**2026-11-12 更新（第三次，消息表 + 改名 + 预览推送后）。**

## 当前状态：数据层已就位，下一步做讨论面板（不接 AI）

- 分支 `feat/reading-room`，已推 origin。**没有合 master，master 干净。**
- 最新提交 `cb838b04`（讨论消息表 v4 + 窗口改名 + 消息预览）——**等久验收。**
- 久在 Vercel 用「分支专属预览链接」测，不用 Create Deployment（她说直接就有）。

**久把第二期拆成三包，是她同意的分法，照这个走，别攒一大包：**

| 包 | 内容 | 状态 |
|---|---|---|
| 1 | 消息表（v4）+ 窗口改名 + 消息预览 | **已推 `cb838b04`，等验收** |
| 2 | 讨论面板滑出 + 半屏/全屏 + 问角色 + 引用卡片，**先不接 AI** | 下一步 |
| 3 | 接真 API + 流式 + 角色上下文 | 没开始 |

第 2 包故意不接 AI：先让她验手感（盖不盖得住正文、正文有没有被挤、
引用在不在、键盘挡不挡输入框），发出去的消息直接显示在面板里就行。
手感不对的话，这时候改比接完 AI 再改便宜得多。

另外：本地 master 有一个未推送的提交 `2d0905ae`（更早窗口的 HANDOFF 更新）。
不影响干活，她没说要推，别自己推。

## 久在这次拍板的三件事（别再问一遍）

1. **半屏→全屏只做按钮，不做拖动把手。** 她原话「那就只做按钮」。
   理由当时跟她讲了：拖动和翻页抢手势，划线那边就是因此放弃拖把手的。
   以后她要是想要拖的手感再加，**现在别主动加**。
2. **记忆召回加了 `reading_room` 这个新入口**，和 `collaboration` 同档
   走精确实体召回。她原话「加一个共读室自己的标签」。
   代价她知道：动了两个上游文件（`memoryPalace/trace.ts` 和 `pipeline.ts`），
   以后合上游可能撞一下，手工接回来就行。
   **不要为了省事改回中性标签**——那会让角色认不出她提到的人名地名。
3. **第二期拆三包，每包她真机验过才往下走。**

## GPT 那份开发说明（久 2026-11-12 给的）哪里不对

她给的那份很详细，大方向对，按它做。但有四处和代码不符，**已查实**：

1. 它说 `resolveDialogueApi(globalApi, character)`「签名已核实」——
   **实际是三个参数**，第三个是可选的 appApi。两个参数调也能跑，不影响功能。
2. 它说 `ContextBuilder.buildCharacterRequest()` 不存在——
   **那是上一个窗口的我写错了，它存在**（`utils/context.ts` 导出，
   BankApp / CallApp / 日记 / 攻略本等二十多处在用）。
   **这正是共读室第 3 包该走的路**：一次装好人设、世界观、世界书、
   用户资料、长期记忆，**而且天生不带日常私聊历史**。
3. 它说「参考协同的沉浸式模式但别带入私聊」——这在协同那边是**两个函数**，
   它混成一句了。带私聊的是 `buildLiveCollaborationChatContext`
   （内部真去读聊天记录），不带的是 `buildCoreContext`。
   **共读室要走后者，前者一行都别碰**，找错函数就会把私聊全搬进来。
4. 它要求「列表排序优先按最近消息时间」——**现有 `filterWindows` 按
   `updatedAt` 倒序，有测试锁着**。存消息时 `updatedAt` 一起更新了，
   所以排序逻辑一行没动。`lastMessageAt` 只拿来显示。

还有一件它没提但是真坑的：**项目里没有 Markdown 库**
（`package.json` 里没有 marked / react-markdown）。协同是自己手写了一个
小解析器（`features/collaboration/markdown.ts`）。第 3 包复用它，
所以 Markdown 只能到基础：粗体、斜体、代码、列表、引用。表格没有。
**装新依赖要久点头，别自己装。**

## 第 1 包（`cb838b04`）做了什么

### 数据库升到 v4

`store.ts` **DB_VERSION 3 → 4**，加一张 `messages` 表（`by_window` 索引），
**旧表一个字没改**，v1–v3 的书 / 正文 / 进度 / 划线 / 窗口原样保留（有测试）。

### 新增的类型

```ts
ReadingDiscussionMessage   // id / windowId / role / content / reference? / createdAt
ReadingMessageReference    // bookId / bookTitle / chapterTitle / highlightId? / quote
```

`ReadingDiscussionWindow` 加了 `lastMessagePreview` 和 `lastMessageAt`。

### 这一包的关键决定（别重构掉）

**引用里只有书名 / 章节 / 划线原文。** `buildHighlightContext` 那个
`before` / `after`**一个字都不进库**——存了的话，之后每次读历史都会把
前后文带回来，等于反复发给模型。有两条测试锁着（纯逻辑层和库层各一条，
都是 `expect(JSON.stringify(...)).not.toContain('before')`）。

**消息只挂 windowId，没有 bookId。** 和窗口那条一样的理由：一个窗口堆着
好几本书的讨论，是哪本写在 `reference` 里。有测试。

**`deleteWindow` 现在连带删消息**，同一个事务、索引游标锁死单个 windowId。
原来那条「等消息表做出来再回来补」的注释已经作废删掉了。
有测试锁「不碰同角色的其它窗口」。

**`deleteBook` 故意不删讨论消息。** 窗口不属于书，按书删会在历史中间挖个洞。
引用里存了**当时的书名**（不是每次去书表查），所以书删掉、改名之后，
翻历史照样看得出在说哪本。有测试。

**`renameWindow` 在名字没真的变时返回同一个对象**（`===` 成立），
调用方靠它跳过写库。不然点开改名弹窗什么都没改就按确定，也会刷新
`updatedAt`，这个窗口就莫名跳到列表最前面。和 `reconcileSelection` 同一个套路。

**`saveMessage(message, window?)` 两张表一个事务。** 消息写进去了但窗口预览
没更新，列表会显示上一条，看着像消息没发出去。
**窗口那一份由调用方算好传进来**（用 `applyMessageToWindow`），
store 里不做读-改-写——跨两个事务的话中间那一下别人改过就会被覆盖。

**预览存摘要不存整条消息**（上限 50 字）。窗口记录每次列表刷新都会全部读出来，
挂上完整聊天内容等于列个窗口就把所有讨论读一遍。

**空内容的消息不覆盖已有预览。** 流式刚开始时内容是空的，不挡这一下的话
列表里会闪出一条空预览。

### 验证命令（**四个**测试文件，别只跑三个）

```bash
cd ~/push
npx vitest run utils/readingRoom.test.ts utils/readingRoomHighlight.test.ts \
  utils/readingRoomDiscussion.test.ts utils/readingRoomStore.test.ts      # 119 passed
npx vitest run utils/memoryPalace                                          # 402 passed
npx vitest run utils/safeAreaApps.test.ts utils/blurPolicy.test.ts \
  utils/appPreload.test.ts utils/appErrorBoundary.test.ts                  # 28 passed
NODE_OPTIONS="--max-old-space-size=3072" timeout 900 npx vite build        # 必跑
# 成功标志是最后那行 Static cache: 23 shell files / 1324 versioned resources
```

`utils/readingRoomStore.test.ts` 是这一包新建的，**真的读写 IndexedDB**
（fake-indexeddb 由 test-setup.ts 注入）。每个用例用各自唯一的 id 隔离，
**不要去 deleteDatabase** —— store.ts 内部是单例连接，会把删库请求 block 住。

改了 `memoryPalace` 那两个文件，所以那 402 个测试这次也要跑。

全量测试有 109 个失败，**全部来自上游，不是我们的**。
见 HANDOFF 第 15 条的三方对照结论，别去修。

## 这两个窗口（2026-11-12）做完了什么

四次推送，每次她真机验过才往下走。**这个节奏要延续：别攒一大包再给她。**
前三次在一个窗口里，第四次（设置页）是另一个窗口。

### 1. `b173df6f` 修排版四件事

久反馈：一页装不满还切半行、每行开头空两格、段间空太多、要上下留白。
四个问题同源于**测量口径和排版不一致**：

- 测量用的 `clientHeight` **含 padding**，而上下留白当时就是 padding，
  于是量出来比真能排字的高度多两条留白，每页多塞约两行。
  改成三层 flex（顶带 / 正文 / 底带），正文层没有纵向 padding。
- `textIndent: 2em` 只对一页**首行**生效，上一页没读完的半句到新页开头
  也被缩两格。去掉它，改段落顶格；`splitParagraphs` 顺带 trim 掉
  TXT 自带的全角空格（U+3000）。
- 原文空行不再照排，统一 `READING_PARAGRAPH_GAP_EM = 0.55`。
- 底带按她要求**留空**（她明确说右下角不放页码不放百分比）。

**测量容器改成按段落建 DOM**（`renderParagraphsInto`），和正文共用
`splitParagraphs` + 段间距。原来塞一整串纯文本去量，两边排法不同，量了也白量。

### 2. `890f5ab2` 跨页划线

GPT 给过她一份方案，大方向对（两次长按定起止、按全文偏移存、不要全量渲染、
不要指望原生 Selection 跨页存活），**采纳了**。我改了四处：

- 不要「先进划线模式」那一步，直接长按就出小条
- 同页内也用两次长按，**不做拖把手**（拖那一下最容易和左右滑抢手势，
  而且同页跨页两套手感更糟）
- 等终点时顶部挂**常驻提示带**（含取消）——她可能翻好几页才找到终点，
  只在文字里写提示不够，必须一直看得见
- 存的 `text` 是**原文**（含换行缩进），显示和发送时才压空白

### 3. `433e65b9` 落点高亮 + 逐字微调

久验出落点偏一两个字，她提议「高亮起点 + 能退出重选」。
**我多做了微调**，理由当时就跟她说了：如果偏差是**系统性**的（总偏同一方向），
重选多少次都一样，只有挪格子才有用。她同意。

- 落点那个字在正文里反白（深橙），小条上同时显示落点字和前后文
- ← → 按钮一次挪一个字符，高亮跟着走
- 已确定的起点在正文里留浅橙标记，翻回那页看得见
- `pendingPoint` 从 `{offset, preview}` 改成**只存 offset**，
  预览和高亮都实时算——否则微调时会出现「高亮走了但文字是旧的」
- 顺带修一处语义：**终点那个字现在会被划进去**（`confirmEnd` 给终点加一）。
  原来她按在哪个字上，那个字反而漏在外面。

**她还没回答的一件事**（我让她测时留意了，她没说）：
偏差是固定方向还是随机的。如果她以后说「总是偏左一个字」，
可以在 `resolveOffsetAtPoint` 的返回值上直接补偏移量，她就不用每次点箭头。
**别主动去改，等她给这个观察结果。**

### 4. `bdc2da18` 底部两键 + 设置页

**她先给了一份 GPT 写的开发说明**（很详细，大方向对），我按它做了，
只在动手前跟她确认了两件事。**那份说明和交接单当时写的有一处冲突，
是她当场拍板的，记住结论**：

- 我原来理解的「底栏在书里」是错的。她原话：
  「底栏那个书架跟设置页的位置 是点进共读室这个应用后 而不是在看书的时候下面那个菜单。」
  所以**阅读页一行没碰**，底栏只挂在书架 / 设置这两页。
- 交接单原来写「窗口挂角色 + 书」。**她改成只挂角色**，原话：
  「不分书 就是切 b 书 还是默认用原来选定的那个窗口……选窗口是用户的事情。
  不能随着切书而自动换窗口。」
  角色怎么知道在读哪本书？**她的答案是写进发送内容里**：
  「用户正在读《a》，她引用了这一段'……'」。**下一步做引用发送时照这个做。**
- 划线列表**留在阅读页原位置**（GPT 那份说明明确要求，她没反对）。
  交接单之前写的「搬进设置页」作废。

新窗口命名她说「按你的来」，就是「讨论 1」「讨论 2」。改名第 1 包已经做了。

#### 新增的文件和表

```
features/readingRoom/discussion.ts            窗口纯逻辑（分栏/命名/归档/失效修复）
features/readingRoom/ReadingRoomSettings.tsx  设置页
utils/readingRoomDiscussion.test.ts           22 个用例，全过
```

`store.ts` **DB_VERSION 2 → 3**，加两张表，旧表一个字没改：
- `windows`（`by_char` 索引）——**没有 bookId**，有测试断言这件事
- `selection`（单行，主键恒为 `READING_SELECTION_ID`）

#### 这一块的关键决定（别重构掉）

**底栏不能挂到阅读页上。** 阅读页整屏接管，多一条带子会挤掉正文行数，
并且让测量容器和正文不再一致（就是 `b173df6f` 修过的那个病）。
`ReadingRoomApp.tsx` 顶部注释写着这件事，别删。

**窗口只认 charId。** `discussion.ts` 里所有函数都没有 bookId 参数，
测试里有一条 `expect(Object.keys(created)).not.toContain('bookId')` 锁着。
加了 bookId，「切书不换窗口」这条交互就跟着没了。

**新窗口编号取「最大编号 + 1」，不是「个数 + 1」。**
删掉「讨论 2」之后再新建，个数 + 1 会算出一个已经存在的「讨论 2」。
已归档的也占编号（它们还在列表里看得见）。有测试。

**`reconcileSelection` 在没变化时返回同一个对象**（`===` 成立），
调用方靠它判断要不要落库。别改成每次都 `{...selection}`。

**当前选择是单行记录，主键在 `saveSelection` 里被强制成固定值。**
多出第二行，「当前选择」就有两个答案了。

### 走的弯路（这一块）

**`ArchiveBox` 这个图标名在项目的图标库里不存在**，第一次 `vite build`
直接失败（`"ArchiveBox" is not exported by @phosphor-icons/react`）。
换成 `Archive` 才过。
**查图标在不在的办法**（`require` 那条路读不出来，别白试）：

```bash
F=$(ls node_modules/.pnpm/@phosphor-icons+react*/node_modules/@phosphor-icons/react/dist/index.es.js)
grep -c "as 图标名[,}]" $F    # 1 = 有，0 = 没有
```

## 下一步：第 2 包 · 讨论面板（**不接 AI**）

### 这一包要做的

1. 阅读页右侧一个**低存在感的小把手**，点一下滑出讨论面板。
   没选角色或窗口时点它要**明确提示去设置页选**，不许静默新建窗口。
2. 面板从右边滑出，**盖在正文右半边**。久强调过：**不要挤压正文**，是覆盖不是压缩。
3. **默认半屏，一个按钮切全屏**，再按回半屏。**不做拖动把手**（她拍板了）。
4. 划线的操作条和划线列表各加一个「问角色」入口。
   **点它不发送**：打开面板、在输入框**上方**出一块引用卡片
   （书名 + 章节 + 划线原文），她在下面写感想，一起发。
5. 发出去的消息和一条占位回复直接显示在面板里，**这一包不调 API**。
   消息照样落库（第 1 包的表已经能用了），退出重进要还在。

### 这一包的脆点（开工前要跟久讲）

- **讨论面板必须是独立组件，不要写进 `ReadingView.tsx`。**
  阅读页的分页测量依赖正文区的真实高度（见 `ReadingView` 顶部注释），
  面板和阅读页并排、盖在上面，正文宽度和测量容器一行都不碰——
  「不许挤压正文」就从结构上成立，不靠小心。
- **面板内部的点击 / 长按 / 滑动都要拦住**，不能冒泡到正文去触发翻页和划线。
- **键盘弹出时输入框会被挡**。项目里有 `--keyboard-inset` 这个 CSS 变量
  （`utils/iosStandalone.ts` 设的），但**没在共读室验过**，
  这条要让久在真机上看。
- 半屏宽度下角色的长回复会显得挤。全屏按钮就是为这个做的。

### 第 2 包做完让她测

1. 阅读页右边有小把手，点一下面板滑出来**盖住**正文右半边（不是把字挤窄）
2. 面板打开时正文停在原来那一页，字号和分页没变
3. 没选角色/窗口时点把手，有明确提示，不是静默发生什么
4. 划线后能点「问角色」，输入框上方出现引用卡片（书名 + 章节 + 划线原文）
5. 引用卡片在半屏/全屏切换之后还在，没丢
6. 半屏按一下变全屏，再按回半屏
7. 在面板里滑动不会误翻页；关掉面板后翻页照常
8. 键盘弹出时输入框还看得见
9. 发一条消息，退出阅读页重新进来，这条还在
10. 换一本书在同一个窗口里继续发，历史里分得清是哪本书

## 第 3 包：接真 API（没开始）

### 已经查实的用法

**API 解析**：`utils/characterApi.ts` 的
`resolveDialogueApi(globalApi, char, appApi?)`——角色独立 API 优先，
没配就跟随全局。角色那份存在 `char.dialogueApi`。**直接用，别自己写优先级。**
**两边都没配时要在界面上说清楚，不能静默失败**（这条当时跟久讲过）。

**角色上下文**：走 `ContextBuilder.buildCharacterRequest(input, messages)`
（`utils/context.ts`）。它一次装好人设、世界观、世界书、用户资料、长期记忆，
**而且不带日常私聊历史**——正好是久要的「还是平时那个角色，但讨论历史独立」。

**记忆召回**：`injectMemoryPalace(char, recentMessages, queryHint, userName,
{ entryPoint: 'reading_room' })`。`reading_room` 这个入口第 1 包已经加好了。

**发请求**：`utils/safeApi.ts` 的 `safeFetchJson(url, options, retries,
timeout, meta, streamHooks)`，流式走 `streamHooks.onDelta`。

**Markdown**：复用 `features/collaboration/markdown.ts`
（`parseCollaborationMarkdown`）。项目里没有 Markdown 库，别装新依赖。

### 发给角色的内容怎么拼

用 `highlight.ts` 的 `buildHighlightContext`（划线 + 前后各 320 字符，
有测试锁「不含全书」），外面套久要的那句话：
「用户正在读《某书》，她引用了这一段'……'」。

**前后文只进这一轮请求**：不存库（第 1 包的类型已经从结构上挡住了），
也不能从历史消息里重新拼回来。历史只带书名 / 章节 / 划线原文 / 当时的感想。

**当前这条用户消息只能进请求一次**，不要同时发一份精简版和一份带前后文的。

### 第 3 包不要碰的东西

- **不要用 `runCollaborationTurn`**：它走协同自己的 API Profile，
  不是久要的「角色独立 API 优先 + 全局兜底」。
- **不要用 `buildLiveCollaborationChatContext`**：它内部真去读日常私聊记录。
- **不要把共读室消息写进日常私聊历史**，也不要读别的共读窗口的历史。
- **不要塞进协同工作的数据库**，两边互不干扰是久要的。

归档写记忆宫殿的完整例子（第三期用）在 `apps/Chat.tsx:3326` 的
`handleCollaborationArchiveToMemory`（走 `importExternalMemoryText`
+ `mergePalaceFragmentsIntoMemories`）。

## 她要的东西（原话意思，不要擅自改需求）

一个叫「共读室」的独立 App：导入本地 TXT 和角色一起逐段读。
划线 → 发给选定角色 → 开独立窗口讨论 → 手动归档进记忆宫殿。
**上下文结构参考协同工作**（`features/collaboration/`）。

### 三期划分（她同意的）

| 期 | 内容 | 状态 |
|---|---|---|
| 一 | 书架 + 阅读器 | **已验收** |
| 二 | 划线 | **已验收** |
| 二 | 底部两键 + 设置页（选对象/选窗口） | **已验收** |
| 二 | 消息表 + 改名 + 预览（第 1 包） | **已推 `cb838b04`，等验收** |
| 二 | 讨论面板，不接 AI（第 2 包） | **下一步** |
| 二 | 接真 API（第 3 包） | 没开始 |
| 三 | 归档进记忆宫殿 | 没开始 |

### 她明确回答过的问题（别再问一遍）

1. **书架全局共用，讨论窗口挂在角色下。**
2. **划线全局共用，不分角色。** 她原话：「不管选择哪个角色
   用户都能看见自己在书上的划线。」已经按这个实现了。
3. **讨论用的 API：角色的独立 API 优先，没配就跟随当前全局。**
4. **第一期不接备份**，三期做完一起接。她接受了「清缓存会丢书」。
5. **章节目录要做**，她会尽量找目录清晰的 TXT。
6. **页码不要**（她说不重要，已去掉）。底部那条带子**留空**。
7. **跨段可以划线**（她要的就是能框一整段对话）。
8. **窗口不分书**。切书继续用原来选的窗口，书名靠发送内容告诉角色。
   **选窗口纯粹是用户的事，代码不要替她换。**
9. **底栏在 App 里，不在书里**。阅读页保持整屏。
10. **划线列表留在阅读页**。不要搬进设置页。
11. **半屏→全屏只做按钮，不做拖动把手**（2026-11-12 第三次新增）。
12. **记忆召回用 `reading_room` 这个新入口**（2026-11-12 第三次新增）。

## 代码长什么样

### 文件清单

```
features/readingRoom/types.ts        数据结构（书/章节/正文/进度/划线/窗口/选择/消息）
features/readingRoom/parse.ts        解码 + 章节识别（纯函数）
features/readingRoom/paginate.ts     章节定位 + 块切分（纯函数）
features/readingRoom/measure.ts      按屏幕容量二分分页（纯函数，不碰 DOM）
features/readingRoom/layout.ts       段落切分 + 段间距 + 书封配色（纯函数）
features/readingRoom/highlight.ts    划线纯逻辑：区间/与页求交/切片/微调/上下文
features/readingRoom/caret.ts        触摸点 → 全文偏移（唯一碰浏览器排版的地方）
features/readingRoom/discussion.ts   窗口和消息的纯逻辑：分栏/命名/改名/预览/失效修复
features/readingRoom/store.ts        IndexedDB（SullyOS_ReadingRoom，DB_VERSION 4）
features/readingRoom/ReadingView.tsx 沉浸式阅读视图 + 划线交互
features/readingRoom/ReadingRoomSettings.tsx  设置页（选角色 + 选窗口 + 改名）
apps/ReadingRoomApp.tsx              书架 + 底栏 + 调度 + 划线和选择的读写
utils/readingRoom.test.ts            36 个用例
utils/readingRoomHighlight.test.ts   33 个用例（划线那套）
utils/readingRoomDiscussion.test.ts  42 个用例（窗口、改名、消息、选择）
utils/readingRoomStore.test.ts       8 个用例（真读写 IndexedDB：v4 升级/隔离/级联删）
```

**第 2 包要新建的**：讨论面板组件（独立文件，**不要写进 `ReadingView.tsx`**）。

### 接线点（加新 App 要碰的 7 处，已全部接好）

`types.ts` 的 `AppID.ReadingRoom` / `constants.tsx`（图标 `BookOpenUser` + INSTALLED_APPS，
排在交换日记后面）/ `components/PhoneShell.tsx`（lazyApp + APP_BY_ID + switch case 三处）/
`components/os/appPreload.ts` / `components/os/acnhIcons.tsx`（书 + 绿书签，
因为 Journal/Novel/Study/Worldbook/Guidebook 五个都用同一个 bookGlyph，不加书签会撞脸）/
`utils/safeAreaApps.ts` **和它的 `.test.ts`**（那个测试双向断言名单，漏一边就红）/
`utils/blurPolicy.ts`

### 关键设计决定（别重构掉）

**一切位置都用「全文字符偏移」表达。** 不依赖字号、屏幕宽度、DOM。
进度、章节、分页、划线全部共用这一套坐标。
`utils/readingRoom.test.ts` 里有一个守卫用例锁这件事：
「段落偏移能直接回原文 slice 出同一段字」。**改排版相关的东西前先跑它。**

**正文和书架分表存。** 列书架不读正文——一本几百万字符的书不该在每次刷新书架时被读出来。

**正文永不进请求。** 这是和协同工作最根本的区别：协同把附件正文整段塞进
system prompt（`files.ts` 上限 30 万字符），一本长篇装不下也不该装。
讨论只发「划线片段 + 前后少量原文」——`highlight.ts` 的 `buildHighlightContext`
已经写好了（前后各 320 字符），**做讨论窗口时直接用，有测试锁着「不含全书」。**

**分页是两层的，这一层很容易被误以为多余：**
1. `paginate.ts` 的 `pageAtOffset(..., READING_BLOCK_SIZE)` 纯计算把章切成 3000 字的「块」
2. `measure.ts` 的 `paginateBlock` 只对当前块做真实测量分页

为什么不直接量整章：「无目录」的书整章可能上百万字，一次量出几千页会卡死页面。
为什么块必须是纯计算：同一块 + 同一字号 + 同一屏幕必然得到同样的页边界，
**这是「来回翻页不错位」的全部依据**。有测试锁着。

**测量用 `useLayoutEffect`，不是 `useEffect`。** 后者会先闪一帧按旧边界排的内容。

**上下留白必须是独立的 flex 兄弟节点，不能改回 padding。**
测量依据是正文层的 `clientHeight`，而 `clientHeight` 含 padding——
用 padding 做留白会让量出的高度比真实可排区域多两条，每页多塞约两行。
这是 2026-11-12 实际踩到并修掉的（`b173df6f`），`ReadingView.tsx`
顶部注释写着这件事，别删。

**测量容器和正文必须排得一模一样。** 两边共用 `splitParagraphs`、
`textStyle`、`READING_PARAGRAPH_GAP_EM`。改一处记得对齐另一处。

**划线底色 / 落点高亮 / 起点标记只改背景色，不碰行高和 padding。**
一旦影响排版高度，正文就和测量容器不一致了（测量容器那边没有划线）。

**划线不按页存，一条跨页划线就是一条记录。** 渲染时用
`highlightSliceOnPage` 和当前页求交。改字号后分页重算，划线照样定位得到。

**取偏移不假设段落里只有一个文本节点。** 划线会把段落切成多个 span，
`caret.ts` 的 `offsetWithinHost` 用 TreeWalker 累加，不管嵌套多深都算得对。

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

**上下留白用 padding —— 这是 2026-11-12 修掉的真 bug，不是取舍。**
`clientHeight` 含 padding，量出来比真能排字的高度多两条留白。
她反馈「还是有只留下一半的字体」时我才定位到。详见上面「关键设计决定」。

**划线一度打算做「拖把手改范围」。放弃了，别捡回来。**
翻页会重渲染当前页，原生 Selection 跨页不存活；而拖动那一下最容易和
左右滑翻页抢手势。现在是两次长按定起止，同页跨页同一套操作。

**只给「取消重选」不够。** 久反馈落点偏一两个字时提议「高亮 + 能重选」，
我加了逐字微调，理由：偏差若是系统性的（总偏同一方向），重选多少次都一样。
她同意了这个加法。

## 已经告诉过她的脆点（不要当成新发现再说一遍）

1. **不进备份**，清浏览器数据或换设备会丢。界面顶部有提示条。
   **划线也不进备份**，同一条理由，三期做完一起接。
2. **章节识别会静默失灵**：只认整行独立、40 字内的标题行，少于 3 个标题就整本当一章。
   `chaptersDetected` 为 false 时界面会说明。
3. **编码可能猜错**：顺序是 BOM → 严格 UTF-8（fatal）→ 按乱码率挑 gbk/big5。
   长按书封可以指定编码重读。
4. **「换编码重读」只在本次会话内有效**：原始字节存在 `lastBufferRef`，
   重开 App 后会让她重新选一次文件。存字节等于一本书占双倍空间，所以没存。
5. **归档需要记忆宫殿的向量 API + 副 LLM 都配好**，缺一个就失败。
   **她还没回答配没配 —— 第三期开工前要问。**
6. **划线落点靠浏览器排版接口，实测会偏一两个字。** 已经给了逐字微调。
   退路（还没用上）：`caret.ts` 的 `sentenceRangeAt` 可以改成「长按直接选整句」，
   不要求她点准。函数在，有测试，但 ReadingView 没引用它。
7. **讨论用的 API 角色和全局都没配时会直接失败。** 做讨论窗口时要在界面上
   说清楚，不能静默。这条当时跟她讲过。
8. **右半边讨论窗口在手机上只有半屏宽**，长回复会显得挤。
   我提过「默认半屏 + 可一键拉成全屏」，**她没回答这一条，做之前问她。**
9. **窗口和当前选择也不进备份**（2026-11-12 新增），同第 1 条，设置页底部写了。
10. **一个窗口会堆多本书的讨论**（2026-11-12 新增）。这是她定的「不分书」的直接后果，
    她知道。缓解靠发送时写明书名，不靠数据结构。
11. **数据库升版本那次要她彻底关掉页面重开**，否则可能弹
    「共读室数据库被其它标签页占用」。v3 那次没出问题，但以后再升版本要先提醒她。
12. **设置页的角色头像走 `TokenImg`，这条路我没在真机验过**（命令行测不出来）。
    她要是说头像是空的，先查 `TokenImg` 对 `char.avatar` 的处理，别先怀疑选择逻辑。

## 讨论窗口开工前要知道的

### 协同工作那套能复用什么（已查实，GPT 给久的建议有几处是错的）

能用：
- `features/collaboration/context.ts` 的 `buildCollaborationContextSnapshot`
  （沉浸式/专注式两档）和 `buildLiveCollaborationChatContext`
- `engine.ts` 的 `runCollaborationTurn` / `summarizeCollaborationForMemory`
- `store.ts` 的结构可以照抄（sessions / messages 分表 + charId 索引）
- `types.ts` 的 `CollaborationSession` 有 `archivedAt`，
  **「未归档 / 已归档」两栏直接照这个字段分**（她要的那个分栏）
- 归档写记忆宫殿的完整例子在 `apps/Chat.tsx:3326` 的
  `handleCollaborationArchiveToMemory`（走 `importExternalMemoryText`
  + `mergePalaceFragmentsIntoMemories`）

**GPT 说错的几处，别照着找**（这几条上面「GPT 那份开发说明哪里不对」有完整版）：
- 它说 TXT 上传/解析/IndexedDB「已经有了」—— 协同那套砍到 30 万字符，共读室不能用
- 它表格里「划线/摘要/询问角色」那几栏本来是空的，它在列待做项不是已有项

### 第 2、3 包具体怎么做，看上面那两节

消息表、`by_window` 索引、`deleteWindow` 连带删消息 —— **第 1 包都做完了**，
不要照这一节下面的旧描述再做一遍。

**选择从哪里读**：`ReadingRoomStore.getSelection()` 返回 `charId` + `windowId`，
进 App 时已经被 `reconcileSelection` 修过一遍了。角色对象自己从
`useOS()` 的 `characters` 里按 id 找。

**消息从哪里读**：`ReadingRoomStore.listMessages(windowId)`，已按时间正序。
存消息用 `saveMessage(message, applyMessageToWindow(window, message))`。

## 验收清单（让她测这些）

每次推完**先提醒她把页面彻底关掉重开**（关标签页，不是切后台）。见 HANDOFF 第 8 条。

### 已经验收通过的（不用再让她测一遍）

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
13. 底栏「书架 / 设置」切换，选中态正确，书架原有功能没受影响
14. 设置页选角色（头像 + 名字）、窗口分「未归档 / 已归档」两栏
15. 新建窗口自动选中，归档后跑到已归档栏，删除可用
16. 退出重进，选的角色和窗口还记得；换书不改选择

### 第 1 包（`cb838b04`）等她验这些

1. 设置页每个窗口卡片上有「改名」，点开能改，改完列表里就是新名字
2. 改名弹窗按取消，名字没变
3. 什么都不改按「改好了」，这个窗口不会跳到列表最前面
4. 退出共读室重进，改过的名字还在
5. 窗口卡片上显示「还没有讨论记录」（现在还没有消息，这是对的）
6. 删窗口会问一句，确认后窗口消失，选中态跟着清掉
7. 书架、阅读、划线、选角色这些老功能一个都没坏

**先提醒她把页面彻底关掉重开**：这次升了数据库版本（v3 → v4），
不彻底重开可能弹「共读室数据库被其它标签页占用」。

### 第 2、3 包的验收清单在上面各自那一节

## 验证命令

```bash
cd ~/push
npx vitest run utils/readingRoom.test.ts utils/readingRoomHighlight.test.ts \
  utils/readingRoomDiscussion.test.ts utils/readingRoomStore.test.ts         # 119 passed
npx vitest run utils/memoryPalace                                            # 402 passed
npx vitest run utils/safeAreaApps.test.ts utils/blurPolicy.test.ts \
  utils/appPreload.test.ts utils/appErrorBoundary.test.ts                    # 28 passed
NODE_OPTIONS="--max-old-space-size=3072" timeout 900 npx vite build          # 必跑
# 成功标志是最后那行 Static cache: 23 shell files / 1324 versioned resources
```

全量测试有 109 个失败，**全部来自上游，不是我们的**。
见 HANDOFF 第 15 条的三方对照结论，别去修。
