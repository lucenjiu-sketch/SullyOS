/**
 * 共读室的日间 / 夜间配色。
 *
 * ## 为什么是一个 JS 对象，不是 CSS 变量 + Tailwind 任意值
 *
 * 这个项目的 Tailwind 是 **CDN 运行时版**（`index.html` 里引的
 * `vendor/tailwind-3.4.17.js`），不是构建期扫描的 PostCSS 版，而且全仓
 * **没有任何一处**用过 `bg-[var(--x)]` 这种写法。在运行时版里拿任意值
 * 套 CSS 变量能不能解析，是没有先例可循的；赌错了的表现是颜色直接不生效，
 * 而且只在真机上看得出来。
 *
 * 所以这里走最笨也最稳的路：**把两套配色写成普通字符串，按当前主题取**。
 * 好处顺带有两个：
 * - 纯数据，可以单测（见 `readingRoomTheme.test.ts`：两套主题键必须对齐）
 * - 正文颜色本来就得是字符串——它要进 `textStyle` 这个内联 style 对象，
 *   而测量容器那边也用同一份，两边必须拿到同一个值
 *
 * ## 加字段的规矩
 *
 * 两套主题的键**必须一模一样**，有测试锁着。漏一个键的后果是夜间模式下
 * 某块地方拿到 `undefined`，class 字符串里出现字面量 "undefined"——
 * 不报错、不崩，只是那块颜色没了。构建和类型都抓不到（两边都是宽松的
 * 字符串字典），只有真机能看出来，所以靠测试守。
 */

export type ReadingThemeMode = 'day' | 'night';

export interface ReadingTheme {
  /** 阅读页整屏底色。 */
  pageBg: string;
  /** 正文文字颜色。进内联 style，测量容器共用同一个值。 */
  bodyInk: string;
  /** 上下留白带里那行很淡的章节名 / 页脚提示。 */
  bandInk: string;
  /** 弹层（菜单、目录、划线列表、各种小条）的底色。 */
  sheetBg: string;
  /** 弹层里的主文字。 */
  sheetInk: string;
  /** 弹层里的次要说明文字。 */
  sheetMutedInk: string;
  /** 弹层里更淡的提示文字（「选不准就取消重按」这类）。 */
  sheetFaintInk: string;
  /** 次要按钮的底色（微调、取消、目录那些）。 */
  chipBg: string;
  /** 次要按钮上的文字。 */
  chipInk: string;
  /** 主按钮（「从这里划」「问角色」）的底色。 */
  primaryBg: string;
  /** 主按钮上的文字。 */
  primaryInk: string;
  /** 分隔线。 */
  divider: string;
  /** 列表项里更细的分隔线。 */
  dividerSoft: string;
  /** 列表项按下时的底色。 */
  rowActiveBg: string;
  /** 当前所在章节那一行的底色。 */
  rowCurrentBg: string;
  /** 右侧讨论把手的底色。 */
  handleBg: string;
  /** 讨论把手上的图标颜色。 */
  handleInk: string;
  /** 一次性 toast 的底色。 */
  toastBg: string;
  /** toast 上的文字。 */
  toastInk: string;
  /** 「起点已定」那条常驻提示带的底色。 */
  noticeBg: string;
  /** 常驻提示带上的文字。 */
  noticeInk: string;
  /** 常驻提示带上那个图标。 */
  noticeIconInk: string;
  /** 常驻提示带上「取消」按钮的底色。 */
  noticeButtonBg: string;
  /** 常驻提示带上「取消」按钮的文字。 */
  noticeButtonInk: string;
  /** 「完成划线」那个确认按钮的底色。 */
  confirmBg: string;
  /** 「完成划线」按钮上的文字。 */
  confirmInk: string;
  /** 落点那一个字的反白底色。 */
  caretBg: string;
  /** 落点那一个字的文字颜色。 */
  caretInk: string;
  /** 已确定起点那个字的底色（比落点淡）。 */
  anchorBg: string;
  /** 删除类操作的底色。 */
  dangerBg: string;
  /** 删除类操作的文字。 */
  dangerInk: string;
  /** 色点未选中时的描边。 */
  swatchRing: string;
  /** 色点选中时的描边。 */
  swatchRingActive: string;
  /** 讨论面板：角色那条气泡的底色。 */
  bubbleBg: string;
  /** 讨论面板：角色气泡里的文字。 */
  bubbleInk: string;
  /** 讨论面板：角色气泡的细描边。 */
  bubbleRing: string;
  /** 讨论面板：输入框底色。 */
  inputBg: string;
  /** 讨论面板：输入框里的文字。 */
  inputInk: string;
  /** 讨论面板：输入框的描边。 */
  inputRing: string;
  /** 讨论面板：聚焦时的强调描边，也用于长按选中态。 */
  focusRing: string;
  /** 讨论面板：心象折叠块的底色。 */
  reasoningBg: string;
  /** 引用卡片的底色（输入框上方那张）。 */
  quoteBg: string;
  /** 引用卡片的描边。 */
  quoteRing: string;
  /** 引用卡片上的图标。 */
  quoteIconInk: string;
  /** 引用卡片上「关掉」按钮的底色。 */
  quoteCloseBg: string;
  /** 引用卡片上「关掉」按钮的图标。 */
  quoteCloseInk: string;
  /** 气泡里嵌的引用条：用户侧（深底）的边框。 */
  quoteInUserBorder: string;
  /** 气泡里嵌的引用条：角色侧（浅底）的边框。 */
  quoteInCharBorder: string;
  /** 气泡里嵌的引用条：角色侧的底色。 */
  quoteInCharBg: string;
  /** 错误提示条的底色。 */
  errorBg: string;
  /** 错误提示条的描边。 */
  errorRing: string;
  /** 错误提示条的主文字。 */
  errorInk: string;
  /** 错误提示条里更淡的那一行。 */
  errorFaintInk: string;
  /** 等回话时那三个点的颜色。 */
  typingInk: string;
}

/** 日间：保持原来那套暖米色，一个值都没动（久验收过的观感）。 */
const DAY_THEME: ReadingTheme = {
  pageBg: '#f6ecd9',
  bodyInk: '#3a3027',
  bandInk: 'rgba(168, 162, 158, 0.9)',
  sheetBg: '#fbf6ec',
  sheetInk: '#44403c',
  sheetMutedInk: '#78716c',
  sheetFaintInk: '#a8a29e',
  chipBg: 'rgba(231, 229, 228, 0.8)',
  chipInk: '#44403c',
  primaryBg: '#44403c',
  primaryInk: '#fafaf9',
  divider: '#d6d3d1',
  dividerSoft: 'rgba(231, 229, 228, 0.7)',
  rowActiveBg: 'rgba(231, 229, 228, 0.6)',
  rowCurrentBg: 'rgba(231, 229, 228, 0.8)',
  handleBg: 'rgba(68, 64, 60, 0.35)',
  handleInk: '#fafaf9',
  toastBg: 'rgba(41, 37, 36, 0.85)',
  toastInk: '#fafaf9',
  noticeBg: 'rgba(253, 230, 138, 0.95)',
  noticeInk: '#78350f',
  noticeIconInk: '#92400e',
  noticeButtonBg: 'rgba(146, 64, 14, 0.85)',
  noticeButtonInk: '#fffbeb',
  confirmBg: '#b45309',
  confirmInk: '#fffbeb',
  caretBg: '#C2410C',
  caretInk: '#FFF7ED',
  anchorBg: 'rgba(194, 65, 12, 0.3)',
  dangerBg: '#fee2e2',
  dangerInk: '#b91c1c',
  swatchRing: '#d6d3d1',
  swatchRingActive: '#44403c',
  bubbleBg: '#ffffff',
  bubbleInk: '#44403c',
  bubbleRing: '#e7e5e4',
  inputBg: '#ffffff',
  inputInk: '#292524',
  inputRing: '#e7e5e4',
  focusRing: '#fb923c',
  reasoningBg: 'rgba(250, 250, 249, 0.9)',
  quoteBg: '#fffbeb',
  quoteRing: 'rgba(253, 230, 138, 0.8)',
  quoteIconInk: '#d97706',
  quoteCloseBg: 'rgba(253, 230, 138, 0.7)',
  quoteCloseInk: '#92400e',
  quoteInUserBorder: 'rgba(255, 251, 235, 0.5)',
  quoteInCharBorder: 'rgba(251, 191, 36, 0.7)',
  quoteInCharBg: 'rgba(255, 251, 235, 0.7)',
  errorBg: '#fef2f2',
  errorRing: '#fecaca',
  errorInk: '#b91c1c',
  errorFaintInk: 'rgba(239, 68, 68, 0.8)',
  typingInk: '#a8a29e',
};

/**
 * 夜间：深灰底 + 偏暖的浅灰字。
 *
 * 几条刻意的选择：
 * - 底色用 `#171513`（偏暖的近黑）而不是纯黑：纯黑配浅字在手机上眩光更重。
 * - 正文字色 `#cfc6ba` 不是纯白：纯白在暗底上发光，读久了累。
 * - 留白带和提示文字压得更暗，让正文是整屏唯一的亮处。
 */
const NIGHT_THEME: ReadingTheme = {
  pageBg: '#171513',
  bodyInk: '#cfc6ba',
  bandInk: 'rgba(120, 113, 108, 0.85)',
  sheetBg: '#242120',
  sheetInk: '#e7e2da',
  sheetMutedInk: '#a8a29e',
  sheetFaintInk: '#78716c',
  chipBg: 'rgba(87, 83, 78, 0.55)',
  chipInk: '#e7e2da',
  primaryBg: '#57534e',
  primaryInk: '#fafaf9',
  divider: '#44403c',
  dividerSoft: 'rgba(68, 64, 60, 0.7)',
  rowActiveBg: 'rgba(87, 83, 78, 0.45)',
  rowCurrentBg: 'rgba(87, 83, 78, 0.6)',
  handleBg: 'rgba(120, 113, 108, 0.4)',
  handleInk: '#e7e2da',
  toastBg: 'rgba(10, 9, 8, 0.9)',
  toastInk: '#e7e2da',
  noticeBg: 'rgba(120, 53, 15, 0.95)',
  noticeInk: '#fef3c7',
  noticeIconInk: '#fcd34d',
  noticeButtonBg: 'rgba(253, 230, 138, 0.9)',
  noticeButtonInk: '#451a03',
  confirmBg: '#a16207',
  confirmInk: '#fffbeb',
  caretBg: '#EA580C',
  caretInk: '#1c1917',
  anchorBg: 'rgba(234, 88, 12, 0.4)',
  dangerBg: 'rgba(127, 29, 29, 0.55)',
  dangerInk: '#fecaca',
  swatchRing: '#57534e',
  swatchRingActive: '#e7e2da',
  bubbleBg: '#302c2a',
  bubbleInk: '#ddd6cc',
  bubbleRing: '#44403c',
  inputBg: '#302c2a',
  inputInk: '#e7e2da',
  inputRing: '#44403c',
  focusRing: '#d97706',
  reasoningBg: 'rgba(28, 25, 23, 0.8)',
  quoteBg: 'rgba(69, 26, 3, 0.65)',
  quoteRing: 'rgba(146, 64, 14, 0.8)',
  quoteIconInk: '#fcd34d',
  quoteCloseBg: 'rgba(146, 64, 14, 0.6)',
  quoteCloseInk: '#fde68a',
  quoteInUserBorder: 'rgba(255, 251, 235, 0.45)',
  quoteInCharBorder: 'rgba(180, 83, 9, 0.8)',
  quoteInCharBg: 'rgba(69, 26, 3, 0.5)',
  errorBg: 'rgba(69, 10, 10, 0.6)',
  errorRing: 'rgba(153, 27, 27, 0.8)',
  errorInk: '#fca5a5',
  errorFaintInk: 'rgba(252, 165, 165, 0.75)',
  typingInk: '#78716c',
};

export const READING_THEMES: Record<ReadingThemeMode, ReadingTheme> = {
  day: DAY_THEME,
  night: NIGHT_THEME,
};

/**
 * 取一套主题。
 *
 * 不认识的值（localStorage 被人手改过、或者以后删掉了某个模式）
 * 一律退回日间——看错颜色比整页空白好。
 */
export const resolveReadingTheme = (mode: string | null | undefined): ReadingTheme => (
  mode === 'night' ? NIGHT_THEME : DAY_THEME
);

/** 把存的值归一成合法模式，给 state 初始化用。 */
export const resolveReadingThemeMode = (mode: string | null | undefined): ReadingThemeMode => (
  mode === 'night' ? 'night' : 'day'
);
