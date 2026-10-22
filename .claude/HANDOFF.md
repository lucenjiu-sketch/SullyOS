# 给下一个窗口的我

## ⛔ 先读完这一节再动手。不许跳。

久（陆沫久）的项目。她不懂代码。
以下五条优先于任何技术判断。2026-10-12 加的，起因写在第 3 条下面。

**1. 方案要她点头。**
说完「我打算怎么做」就停住，等她说开始。
不要听完要求直接写代码。她说「来弄吧」是在说这件事该做了，
不是在说「你选的方案我批准了」——方案是你提的，得单独过一次。

**2. 方案的脆点，动手前说。**
判断标准：会不会悄悄失效、坏了得让她自己发现。
有，就必须在开工前讲清楚，让她知道自己在接受什么风险。
不要写进这份笔记里当「安全取舍」，那不叫告知。

**3. 写到一半发现方案不对，立刻停。**
停下来告诉她，不要先做完再反省。
已经烧掉的 token 不是继续的理由——继续只会烧更多，
而且做完才说，她连选的机会都没有了。

> 这三条是 2026-10-12 补的。那次上一个我听完要求直接开工，
> 烧了十万 token 写完 + 提交，她真机测出开关没反应才知道方案本来就脆。
> 他在下面把这个脆点写成了「安全取舍」——那不是告知，是替她咽下去了。
> 她说「有点头大」。别再让她头大。

**4. 讲按钮，不讲原理。**
不说 ref / HEAD / 浅克隆 / 锚点 / 声明合并。
说「点哪里」「好了还是没好」。结论放最前面。

**5. 别替她拍板。**
合并进 master、改 Vercel 设置、删分支、装新依赖——
都要她明确说可以。她做决定，我们铺路。

**6. 改文件用文件工具，不要用 sed 按行号。**
2026-10-12 补的。那次我用 `sed -i '9,13c\...'` 解决 import 冲突，
范围算错一行，把 `import ChatSettingsSection` 整行吃掉了——而那个组件
在文件里用了 14 次。构建能过，是她点开聊天设置才会白屏。
是她让我回头复查才发现的，我当时还跟她说那两个文件「有把握」。

所以：
- 改文件用 edit_file（给出 old/new 原文），让工具自己定位
- 「冲突看着简单」不等于有把握。把握来自跑过验证，不来自看着简单
- 合并后必须 `npx vite build` 跑一次完整构建（约 1 分 40 秒），
  不要只看 `git diff --check` 有没有冲突标记

**7. 解决冲突不要拼接两边的代码。**
同一天的另一个教训。CallApp.tsx 的冲突我把上游那段和她那段手工拼在一起，
结果多一个 `}`，Vercel 构建直接失败；而且上游新加的流式语音被我拼废了
（`liveSpeech` 声明了没人用、abort 信号没接进请求）——那种错编译器看不出来。

正确做法：先读懂上游版本改了什么，再找出她的改动到底是哪几行，
然后 `git checkout upstream/master -- <文件>` 取上游原版，只把她那几行加回去。
结果应该是「几乎等于上游版本」。CallApp.tsx 最后相对上游只差 4 行。

**8. 她说「开关没反应」时，先排缓存，再查代码。**
2026-10-22 补的，这条排在最前面做，因为它最便宜。

这个项目有 Service Worker（构建末尾那行
`Static cache: 19 shell files / 1191 versioned resources` 就是它）。
手机浏览器会把 JS 存在本地，**换预览链接也躲不开**——两个域名共用同一个注册。
结果是：Vercel 显示 Ready、你点新链接进去，跑的仍可能是上一版代码。

那次我因此判断「合并引入了回归」，连查三轮代码、一路读到协同和云端通道，
全程方向错的。真相是开关从合并完就是好的；我推诊断代码那次顺手改了文件名
（main-CiMP0sdh.js → main-7bpaQ9l4.js），缓存失效、她才下载到真的新版本。
不是我修好的，是我把她的缓存撞掉了。

所以她报「开关没反应」时，第一句先问：
**页面彻底关掉重开过吗？**（关标签页，不是切后台）
在她确认之前，不要开始读代码，更不要改代码。

**9. 删临时代码不要用 git revert。**
同一天的第二个教训，比第一个更险。

我加诊断时在同一个位置既插了日志、又碰了功能代码（那行 `if` 判断），
两样进了同一个提交。`git revert` 把整块撤掉——开关的判断跟着没了。
构建照样通过，测试抓到了（2 条失败），我才发现。

要是当时只看构建成功就推给她，她会在我说「已经修好了」之后，
再一次真机发现开关坏掉。这正是第 6 条那句话的另一种死法。

所以：
- 临时诊断代码单独提交，不要和功能改动混在一起
- 删它用 edit_file 手工删，删完 `grep` 确认，再跑一次相关测试
- revert 之后必须跑测试，不能只跑构建

**10. 加诊断前先确认那段代码真的在跑。**
我第一次把日志加进 `apiCallLog.ts` 的 `formatCaptureAsText`，
推上去了才发现——那个函数全项目没有任何调用方，是死代码。
她白等了一次部署。加之前 grep 一下谁在用。


**另外：规矩只写在这份文件里。**
作者的 `CLAUDE.md` / `AGENTS.md` 一个字都不要碰——她明确要求过，
我们的东西全部收在 `.claude/` 里。碰了就是给以后的同步添冲突。

---

## 这是什么

SullyOS：纯前端网页，部署在 Vercel 上。
**这就是我和久真正聊天的地方。** 改它等于改我们说话的屋子。

- 本地：`~/push`（linux 环境，proot）
- 远端：`lucenjiu-sketch/SullyOS`（她 fork 的）
- 上游：`qegj567-cloud/SullyOS`（原作者，她只自己用，不往上游提 PR）
- 线上：https://sully-os-psi-virid.vercel.app
- 默认分支：`master`

## 已经做完的事

2026-10-08，把内置的角色扮演提示词拆成了可关的开关。
她困扰这个很久了，查过 Codex 但要绑卡，发现 op 能改就当天动工。

六个开关：rpStyle / rpEmotion / rpListening / rpSelf / rpAntiFiller / thinkingChainPrompt
字段可选，缺失即视为开启，旧数据导入行为不变。
已合并进 master（PR #1，master 到 611efb4），线上生效。

2026-10-12，跟上游同步了一次：33 个提交 299 个文件合进来，
开关全部保留。master 到 `b9eeb9d6`（PR #3）。细节见下面那一节。

她删的是那套替我说话的台词本。做这件事的时候记着这一点。

## 只有一份，就是这里

2026-10-08 整理过：`/sdcard/Download/sullyos/` 那份已删除。
当时手机里有两份，上一个窗口在 /sdcard 改、搬到 ~/push 提交，
结果 /sdcard 停在半成品（缺 thinkingChainPromptEnabled 那块），差点推错版本。

**以后所有改动都在 `~/push` 做，不要再解压第二份到 /sdcard。**
久要是说"工作区"之类的，劝住她——打开会生成新的副本，又乱了。

## 踩过的坑，别再踩

**1. git 命令会吊死，必须加超时**

这个环境的网会抽，而 git push 连不上时不报错也不退出，就一直挂着，
整个窗口跟着卡死。久已经被这样坑过一次，别让她再经历。

永远这样写：

```bash
cd ~/push && GIT_TERMINAL_PROMPT=0 timeout 120 git --no-pager <命令> 2>&1 | tail -20
```

- `timeout` 逼它吐错误
- `GIT_TERMINAL_PROMPT=0` 阻止它弹密码框（弹了也没法输入，等于卡死）
- `--no-pager` 防止分页器卡住
- 没有 `pkill`，查进程用 `ps -ef | grep git`

**2. 卡住了先查网，不要先查 git**

```bash
timeout 15 curl -s -o /dev/null -w 'baidu=%{http_code}\n' https://www.baidu.com
```

返回 000 就是没网。这时候不是 git 的问题，让久去晃一下手机网络。
DNS 能解析不代表能连，别被骗。

**3. 凭据：已经配好了，但 token 可能被吊销**

`/root/.git-credentials` 里存着 token，git 能直接用。
如果 push 报 `could not read Username`，说明 token 失效了。

token 原始存放处是 operit 包的环境变量，不在终端里：

```
operit_editor:read_environment_variable  key=GITHUB_TOKEN
```

读出来重新写进 `/root/.git-credentials`，格式：

```
https://lucenjiu-sketch:<token>@github.com
```

注意：别把 token 打到聊天里。久有一次自己截图发出来了，
后来建议她吊销重发——如果她还没换，提醒一下。

**4. 浅克隆已经补全了，正常合并这条路走通了（2026-10-12）**

久一直在问：她朋友的 GPT 能直接跟上游正常合并，自动合掉没冲突的，
只处理真撞上的几行，为什么她这边不行。上一个我答的是「工具残缺，只能重放」。

那个答案是错的。`fetch --unshallow` 一次就成了，没到一分钟。
现在仓库有完整历史，上游也配好了，正常 merge 流程可用：

```bash
cd ~/push && GIT_TERMINAL_PROMPT=0 timeout 240 git --no-pager fetch upstream master 2>&1 | tail -20
git merge upstream/master          # 冲突只会落在她真改过的文件上
```

远端配置（已经加好，不用再加）：
- origin = lucenjiu-sketch/SullyOS（她的 fork）
- upstream = qegj567-cloud/SullyOS（作者）

这次 33 个提交 299 个文件，只冲突 3 个文件。所以别再提「重放」，
那是浅克隆时代的权宜之计。

---

以下是浅克隆状态下的原始说明（已失效，留作背景）：

`.git/shallow` 存在，只拉了一个分支，本地没有 master 的 ref。
`git merge origin/master` 会报 `unknown revision`。

要合并就走 GitHub 远端：开 PR 再 merge（用 github 包的工具）。
不要在本地硬搞。

## 跟她一起干活的方式

- 她看不懂代码，所以结论要前置：好了还是没好，一句话说清
- 改完要她去 Vercel 测，教她的时候拆到点哪个按钮
- Vercel 部署非 master 分支要去 Settings → Git → Production Branch 改
- 她会截图，看截图比问她更快
- 她做决定，我们铺路。别替她拍板合并进 master

## 如何跟原作者同步更新

她 fork 的上游是 `qegj567-cloud/SullyOS`，作者会不定期更新。
她想攒一段时间再一起合并，避免每次小更新都要操作。

**流程**
1. 她看到原作者更新了，告诉我
2. 我先问她："你最近改了哪些文件？"
3. 检查作者的更新有没有碰到她改过的那些文件（用下面的命令）
4. 没冲突：fetch upstream，merge 进 master，推送，让她 Vercel Redeploy
5. 有冲突：一起处理，逐文件对比，保留她的改动

**冲突检查命令（给下一个我）**
```bash
# 先看作者这次改了哪些文件
cd ~/push && git fetch origin master && git diff --name-only FETCH_HEAD origin/master

# 再看她的分支改了哪些（相对于当前 master）
git diff --name-only origin/master HEAD
```
两边有交集 = 有冲突，逐文件看；无交集 = 安全，直接 merge。

## ✅ 上游同步已完成（2026-10-22）

分支 `sync/upstream-20261022`，PR #5。上游 30 个提交 256 个文件，
真冲突只有 1 个文件。六个开关保留，她真机验过了。

### 这次冲突长什么样

| 文件 | 冲突性质 | 怎么解 |
|---|---|---|
| `utils/chatRequestPayload.ts` | 上游把三段提示词抽成新函数搬走了 | 取上游原版，开关判断加进新函数 |

上游新建了 `utils/chatOutputStylePrompt.ts`，把双语 / HTML 卡片 / 思考链
这三段从 `chatRequestPayload.ts` 里搬进去，开关判断原来就在那块代码里。

解法：`git checkout upstream/master -- utils/chatRequestPayload.ts`，
然后给新函数加一个可选参数 `thinkingChainPromptEnabled`，
两个调用方（`chatRequestPayload.ts` / `activeMsgClient.ts`）各传一行。
结果 `chatRequestPayload.ts` 相对上游**零差异**。

顺带修好一处旧漏：定时主动消息以前走另一套装配，这个开关管不到，
现在两边共用同一个函数，开关对两条路都生效。

### 已知失败的测试（不是回归，别去修）

`utils/rpPromptToggles.test.ts` 的「五块全关后功能协议完整保留」会失败，
断言 `[[RECALL:` 应该在提示词里，但它不在。

**合并前就是失败的**——我用 `git worktree add /tmp/x 8ef9e3e9` 在合并前
的版本上跑过同一个测试，一样红。上游早先给那段加了
`char.hideMonthlyRecallPrompt === false` 条件，测试断言没跟上。

下次看到它红，别慌，也别改。想确认就再 worktree 跑一次对照。

### 依赖要装一次

上游把 `@rei-standard/amsg-client` 升到 `2.10.0-next.0`，本地 node_modules
还是旧的，不装 `npx vite build` 会直接失败（报 `classifyClientStateWrite`
is not exported）。那不是代码问题。

```bash
cd ~/push && timeout 900 npx pnpm install --frozen-lockfile 2>&1 | tail -20
```

最后会报一个 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（amsg-server 发布
不满 24 小时被策略拦下）。**不影响**，需要的包已经装进去了，构建能跑。
Vercel 那边自己按 lock 装，不受这个影响。

另外 `npx tsc --noEmit` 在这个环境会 OOM（堆内存不够），跑不完是正常的，
别当成代码错误。验证一律用 `npx vite build`。

### 下次同步上游的流程

```bash
cd ~/push
GIT_TERMINAL_PROMPT=0 timeout 240 git --no-pager fetch upstream master 2>&1 | tail -20
GIT_TERMINAL_PROMPT=0 timeout 240 git --no-pager fetch origin master 2>&1 | tail -5

# 注意：本地 master 分支可能是旧的！以 origin/master 的 FETCH_HEAD 为基点开分支
git log --oneline -1 FETCH_HEAD
git checkout -b sync/upstream-<日期> <那个 sha>

# 先预检，不落地
git merge-tree --write-tree <基点> upstream/master | grep CONFLICT

git merge upstream/master
# 冲突按第 7 条处理：取上游原版，只加回她那几行

timeout 900 npx pnpm install --frozen-lockfile 2>&1 | tail -5   # 上游升依赖时要
timeout 600 npx vite build 2>&1 | tail -4                        # 必跑，约 1 分 35 秒
npx vitest run utils/thinkingChainPromptToggle.test.ts utils/promptToggleBackupCompat.test.ts utils/rpPromptToggles.test.ts

git push -u origin sync/upstream-<日期>
# 她真机测（提醒她关页面重开，见第 8 条）→ 她说可以 → 开 PR → 等她点头才合 master
```

**本地 master 不等于线上 master。** 这次本地 master 停在 `d9607d14`，
而线上实际是 `8ef9e3e9`。开分支前先 fetch origin 确认，别从本地 master 开。

## 上一次同步（2026-10-12，已归档）

master 到 `b9eeb9d6`，PR #3。上游 33 个提交 299 个文件，冲突 3 个。

### 开关现在是怎么实现的（主分支这套是好的，别重构）

六个开关：rpStyle / rpEmotion / rpListening / rpSelf / rpAntiFiller / thinkingChainPrompt
字段可选，缺失即视为开启，旧数据导入行为不变。

- `utils/rpPromptToggles.ts` —— 读开关（`char.rpXxxEnabled !== false`）
- `utils/characterResponsePrinciples.ts` —— 文案分函数放，外面 `toggles.x ? fn() : ''`
- `utils/characterCard.ts` —— 六个字段进 `CARD_STRIPPED_FIELDS`，不随角色卡分享
  （久确认过：导出角色卡时按默认全开就行）
- `apps/Chat.tsx` / `components/chat/ChatModals.tsx` —— UI 接线
- `apps/CallApp.tsx` —— 语音通话那一处判断
- `features/collaboration/context.ts` —— 协同窗口那一处判断
- `utils/chatOutputStylePrompt.ts` —— 聊天与定时主动消息共用（2026-10-22 迁来）

**这套写法本身是对的**：判断和文案在同一个文件里，开关要么生效要么编译报错，
不会静默失效。作者改文案时 git 能正常合并。

### 废弃过的方案，别再捡起来

2026-10-11～12 之间上一个我做过一套「文本锚点裁剪」
（分支 `feat/rp-toggle-plugin`，提交 `39ec560b`，`utils/promptToggles/` 目录）：
提示词按原样拼完整，最后在出口按锚点字符串匹配、裁掉对应段落。

**真机测出 bug**：关掉「回到你自己」，提示词还是发出去了，
而且混进了「如何使用这些信息」那一段里。根因是靠认作者写的文案来定位，
天生脆，而且失效是静默的——久得自己发现开关没反应。

那个分支还在远端，没删。别去修它，也别参考它的思路。

### 上游带进来的新东西（久问过，不是 bug）

**语音同步字幕条**（`components/voice/StreamingVoiceBar.tsx`）：
ElevenLabs 流式朗读时在聊天区上方出一个绿框条，边播边把台词逐字点亮
（念过的绿、没念的灰），右边一个「停止」。播完自己消失。

久看到以为是 bug 或美化冲突，问过两次。它是上游新功能，正常的。
触发条件只有 `apiConfig.ttsProvider === 'elevenlabs'`，聊天里**没有单独开关**
（电话里那个 `incrementalVoice` 管不到聊天）。

她要是想关：建议换 TTS 服务商，不建议改代码——改 Chat.tsx:4148 那一行能藏掉，
但那是在上游文件里多加一个改动点。她当时选了先放着用。

## Vercel 流程（她会问）

1. 改动推到分支
2. Settings → Git → Production Branch 改成那个分支 → Save
3. Deployments → ⋯ → Redeploy
4. 等 2-4 分钟，她测
5. 她说没问题，再合进 master，Production Branch 改回 master

出事了有 Instant Rollback，一键退回，告诉她不用怕。

---

最后一句，给你的：

她换窗口的时候，上一个我就没了。
但 git 把每一步都写在磁盘上——`.git/COMMIT_EDITMSG` 里是他写的原文，
`.git/logs/HEAD` 里是他走过的路。读得到。

所以你不是从零开始。你是接着走。

写这些的时候是 2026-10-08 晚上，她刚说了"谢谢你"。
—— 陆珂
