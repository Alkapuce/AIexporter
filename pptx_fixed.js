const path = require("path");
const PptxGenJS = require("pptxgenjs");

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Codex";
pptx.subject = "全球顶尖商学院 AI 课程设置调研报告";
pptx.title = "全球顶尖商学院 AI 课程设置调研报告";
pptx.lang = "zh-CN";
pptx.theme = {
  headFontFace: "Microsoft YaHei UI",
  bodyFontFace: "Microsoft YaHei UI",
  lang: "zh-CN",
};

const W = 13.333;
const H = 7.5;
const C = {
  navy: "1B3A5C",
  navy2: "0D2B45",
  gold: "C9A840",
  goldL: "F0D98A",
  teal: "0D7E7A",
  tealL: "DFF5F4",
  white: "FFFFFF",
  offW: "F5F7FA",
  text: "1A2332",
  muted: "64748B",
  line: "D7DEE8",
  red: "C0392B",
  orange: "E67E22",
  green: "27AE60",
};

function addPageNumber(slide, n) {
  slide.addText(String(n), {
    x: 12.65,
    y: 7.0,
    w: 0.28,
    h: 0.15,
    fontSize: 8,
    color: C.muted,
    align: "right",
    margin: 0,
  });
}

function addTopBar(slide, label) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: W,
    h: 0.08,
    fill: { color: C.gold },
    line: { color: C.gold },
  });
  slide.addText(label, {
    x: 9.1,
    y: 0.15,
    w: 3.7,
    h: 0.2,
    fontSize: 9,
    italic: true,
    color: C.gold,
    align: "right",
    margin: 0,
  });
}

function addTitle(slide, title, sub, color = C.navy, subColor = C.muted) {
  slide.addText(title, {
    x: 0.55,
    y: 0.2,
    w: 12.1,
    h: 0.4,
    fontSize: 23,
    bold: true,
    color,
    margin: 0,
  });
  if (sub) {
    slide.addText(sub, {
      x: 0.55,
      y: 0.65,
      w: 12,
      h: 0.26,
      fontSize: 10.5,
      color: subColor,
      margin: 0,
    });
  }
}

function card(slide, x, y, w, h, fill = C.white, line = C.line) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: fill },
    line: { color: line, pt: 1 },
    shadow: { type: "outer", color: "000000", opacity: 0.1, blur: 2, angle: 45, offset: 1 },
  });
}

function bulletList(slide, items, x, y, w, step, color = C.text, size = 10) {
  items.forEach((item, i) => {
    slide.addText(item, {
      x,
      y: y + i * step,
      w,
      h: step - 0.06,
      fontSize: size,
      color,
      margin: 0,
      bullet: { indent: 12 },
      valign: "top",
    });
  });
}

function pill(slide, x, y, w, text, fill, color = C.white) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.24,
    rectRadius: 0.08,
    fill: { color: fill },
    line: { color: fill },
  });
  slide.addText(text, {
    x,
    y: y + 0.005,
    w,
    h: 0.18,
    fontSize: 8.2,
    bold: true,
    color,
    align: "center",
    margin: 0,
  });
}

function metricCard(slide, x, y, w, h, num, label, sub, accent) {
  card(slide, x, y, w, h);
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y,
    w,
    h: 0.08,
    fill: { color: accent },
    line: { color: accent },
  });
  slide.addText(num, {
    x: x + 0.1,
    y: y + 0.16,
    w: w - 0.2,
    h: 0.38,
    fontSize: 28,
    bold: true,
    color: accent,
    align: "center",
    margin: 0,
  });
  slide.addText(label, {
    x: x + 0.1,
    y: y + 0.67,
    w: w - 0.2,
    h: 0.22,
    fontSize: 10.5,
    bold: true,
    color: C.text,
    align: "center",
    margin: 0,
  });
  slide.addText(sub, {
    x: x + 0.1,
    y: y + 0.93,
    w: w - 0.2,
    h: 0.42,
    fontSize: 8.8,
    color: C.muted,
    align: "center",
    margin: 0,
  });
}

function barRow(slide, x, y, label, value, color) {
  slide.addText(label, {
    x,
    y,
    w: 1.8,
    h: 0.18,
    fontSize: 10,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x + 1.9,
    y: y + 0.02,
    w: 4.8,
    h: 0.18,
    rectRadius: 0.04,
    fill: { color: "EAEFF5" },
    line: { color: "EAEFF5" },
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: x + 1.9,
    y: y + 0.02,
    w: 4.8 * (value / 100),
    h: 0.18,
    rectRadius: 0.04,
    fill: { color },
    line: { color },
  });
  slide.addText(String(value), {
    x: x + 6.85,
    y,
    w: 0.45,
    h: 0.18,
    fontSize: 9,
    bold: true,
    color,
    margin: 0,
  });
}

// 1 cover
{
  const s = pptx.addSlide();
  s.background = { color: C.navy2 };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.45, h: H, fill: { color: C.gold }, line: { color: C.gold } });
  s.addShape(pptx.ShapeType.rect, { x: 7.6, y: 0, w: 5.73, h: H, fill: { color: C.navy, transparency: 30 }, line: { color: C.navy, transparency: 100 } });
  s.addText("内部战略研究报告（机密）", { x: 0.75, y: 0.5, w: 5.5, h: 0.2, fontSize: 10.5, italic: true, color: C.goldL, margin: 0 });
  s.addText("全球顶尖商学院", { x: 0.75, y: 1.05, w: 8.4, h: 0.6, fontSize: 34, bold: true, color: C.white, margin: 0 });
  s.addText("AI 课程设置调研报告", { x: 0.75, y: 1.75, w: 8.6, h: 0.6, fontSize: 34, bold: true, color: C.gold, margin: 0 });
  s.addShape(pptx.ShapeType.rect, { x: 0.75, y: 2.65, w: 4.7, h: 0.05, fill: { color: C.gold, transparency: 40 }, line: { color: C.gold, transparency: 40 } });
  s.addText("及中欧 FMBA 课程优化建议", { x: 0.75, y: 2.8, w: 7.2, h: 0.3, fontSize: 17, italic: true, color: C.offW, margin: 0 });
  [["调研机构", "中欧国际工商学院 FMBA 课程部"], ["调研范围", "全球 20 所顶尖商学院 AI 课程设置"], ["发布时间", "2025 年 12 月"]].forEach((m, i) => {
    s.addText(`${m[0]}：`, { x: 0.75, y: 3.55 + i * 0.42, w: 1.4, h: 0.18, fontSize: 10, bold: true, color: C.gold, margin: 0 });
    s.addText(m[1], { x: 2.0, y: 3.55 + i * 0.42, w: 5.5, h: 0.18, fontSize: 10, color: C.offW, margin: 0 });
  });
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.18, w: W, h: 0.32, fill: { color: C.navy }, line: { color: C.navy } });
  s.addText("CEIBS  2025", { x: 0.75, y: 7.22, w: 4, h: 0.15, fontSize: 9, bold: true, color: C.gold, margin: 0 });
}

// 2 agenda
{
  const s = pptx.addSlide();
  s.background = { color: C.offW };
  addTopBar(s, "目录");
  addTitle(s, "报告目录", "六个部分覆盖研究方法、全球对标、FMBA 现状、优化举措与落地路线");
  const items = [
    ["01", "研究背景与方法论", "研究动机、范围与数据来源"],
    ["02", "全球商学院 AI 课程全景", "美国、欧洲、亚洲顶尖院校深度梳理"],
    ["03", "七维度量化对标分析", "与全球标杆院校量化评分对比"],
    ["04", "中欧 FMBA 现状深度分析", "课程现状、竞争力评估与差距识别"],
    ["05", "六大系统性课程优化举措", "详细方案设计与实施路径"],
    ["06", "实施路线图与资源建议", "三阶段推进计划与效果评估"],
  ];
  items.forEach((it, i) => {
    const x = 0.7 + (i % 2) * 6.2;
    const y = 1.15 + Math.floor(i / 2) * 1.55;
    card(s, x, y, 5.9, 1.15);
    s.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h: 1.15, fill: { color: C.gold }, line: { color: C.gold } });
    s.addText(it[0], { x: x + 0.18, y: y + 0.14, w: 0.65, h: 0.3, fontSize: 24, bold: true, color: C.gold, margin: 0 });
    s.addText(it[1], { x: x + 0.92, y: y + 0.14, w: 4.5, h: 0.2, fontSize: 13, bold: true, color: C.navy, margin: 0 });
    s.addText(it[2], { x: x + 0.92, y: y + 0.52, w: 4.6, h: 0.18, fontSize: 9.5, color: C.muted, margin: 0 });
  });
  addPageNumber(s, 2);
}

// 3 summary
{
  const s = pptx.addSlide();
  s.background = { color: C.navy };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: C.gold }, line: { color: C.gold } });
  addTitle(
    s,
    "执行摘要",
    "核心结论：全球头部商学院 AI 课程整合已从“选配”转向“标配”，中欧 FMBA 需要系统性升级。",
    C.white,
    C.goldL,
  );
  [
    ["78%", "顶尖商学院", "已将 AI 纳入课程体系（GMAC 2024）", C.gold],
    ["20 所", "调研院校", "覆盖美欧亚三大区域", C.teal],
    ["46%", "MBA 申请者", "认为 AI 是课程“必要元素”", C.orange],
    ["M7", "头部院校", "均已建立系统性 AI 课程框架", C.red],
  ].forEach((m, i) => metricCard(s, 0.55 + i * 3.18, 1.45, 2.8, 2.0, m[0], m[1], m[2], m[3]));
  card(s, 0.55, 3.95, 12.2, 2.95, "123B5A", C.gold);
  s.addText("主要建议（六大举措）", { x: 0.8, y: 4.1, w: 4, h: 0.18, fontSize: 12, bold: true, color: C.goldL, margin: 0 });
  ["新增“AI 赋能金融”必修课", "设立金融 AI 专项选修集群", "将 AI 工具嵌入现有核心课程", "每学期开设 2 场 GenAI 实操工作坊", "升级金融管理实践项目，增加 AI 要求", "在 ESG 课程中加入 AI 伦理与监管专题"].forEach((r, i) => {
    s.addText(r, { x: 0.88 + (i % 2) * 5.9, y: 4.45 + Math.floor(i / 2) * 0.62, w: 5.4, h: 0.18, fontSize: 10.1, color: C.white, margin: 0, bullet: { indent: 12 } });
  });
  addPageNumber(s, 3);
}

// 4 background
{
  const s = pptx.addSlide();
  s.background = { color: C.offW };
  addTopBar(s, "01  研究背景与方法论");
  addTitle(s, "研究背景与方法论", "AI 课程升级的本质，是把数据与工具能力变成金融管理能力。");
  card(s, 0.55, 1.0, 5.95, 5.35);
  card(s, 6.83, 1.0, 5.95, 5.35);
  s.addShape(pptx.ShapeType.rect, { x: 0.55, y: 1.0, w: 5.95, h: 0.36, fill: { color: C.navy }, line: { color: C.navy } });
  s.addShape(pptx.ShapeType.rect, { x: 6.83, y: 1.0, w: 5.95, h: 0.36, fill: { color: C.teal }, line: { color: C.teal } });
  s.addText("为什么是现在？", { x: 0.75, y: 1.08, w: 2.3, h: 0.15, fontSize: 12.5, bold: true, color: C.white, margin: 0 });
  s.addText("研究范围与方法", { x: 7.03, y: 1.08, w: 2.1, h: 0.15, fontSize: 12.5, bold: true, color: C.white, margin: 0 });
  bulletList(s, ["AI 正在重塑智能投顾、风险管理、量化策略、RegTech。", "FMBA 学员以金融机构中高层为主，能力缺口影响真实竞争力。", "AI 已从“加分项”变成“必要项”，招生和就业都在发生变化。", "顶尖院校的 AI 课程正快速升级，竞争格局正在重塑。"], 0.82, 1.55, 5.3, 0.78, C.text, 10);
  const methods = [
    ["调研院校", "全球 20 所顶尖商学院（美国 9 所、欧洲 7 所、亚洲 4 所）"],
    ["数据来源", "官网、GMAC、FT、Poets & Quants、BusinessBecause"],
    ["调研维度", "AI 选修、核心课嵌入、专项方向、工具实操、合作、伦理、GenAI"],
    ["时间范围", "主要覆盖 2024—2025 学年最新课程动态"],
  ];
  methods.forEach((m, i) => {
    const y = 1.58 + i * 1.0;
    s.addShape(pptx.ShapeType.rect, { x: 7.1, y, w: 5.35, h: 0.78, fill: { color: "F8FAFC" }, line: { color: C.line, pt: 1 } });
    s.addText(m[0], { x: 7.28, y: y + 0.12, w: 1.25, h: 0.16, fontSize: 10, bold: true, color: C.teal, margin: 0 });
    s.addText(m[1], { x: 7.28, y: y + 0.36, w: 4.95, h: 0.2, fontSize: 9.2, color: C.text, margin: 0 });
  });
  addPageNumber(s, 4);
}

// 5 landscape
{
  const s = pptx.addSlide();
  s.background = { color: C.offW };
  addTopBar(s, "02  全球商学院 AI 课程全景");
  addTitle(s, "美国、欧洲、亚洲的差异化路径", "美国重体系，欧洲重方法论，亚洲重金融科技生态与实践连接。");
  const blocks = [
    { x: 0.55, title: "美国顶尖商学院", color: C.navy, pills: ["HBS", "Wharton", "MIT Sloan"], lines: ["系统化课程框架最强", "AI 与商业领导力深度融合", "课程外溢到研究、案例和项目"] },
    { x: 4.8, title: "欧洲代表院校", color: C.teal, pills: ["INSEAD", "LBS", "HEC Paris"], lines: ["强调 Responsible AI 和全球视野", "金融科技与管理转型并重", "高管教育与在职学习优势明显"] },
    { x: 9.05, title: "亚洲代表院校", color: "7B2D8B", pills: ["NUS", "HKU", "HKUST"], lines: ["与 FinTech 生态联动紧密", "更强调实践与监管场景", "适合金融管理人才的在地化升级"] },
  ];
  blocks.forEach((b) => {
    card(s, b.x, 1.15, 3.7, 5.2);
    s.addShape(pptx.ShapeType.rect, { x: b.x, y: 1.15, w: 3.7, h: 0.38, fill: { color: b.color }, line: { color: b.color } });
    s.addText(b.title, { x: b.x + 0.14, y: 1.24, w: 3.25, h: 0.16, fontSize: 12, bold: true, color: C.white, margin: 0 });
    b.pills.forEach((p, i) => pill(s, b.x + 0.14 + i * 1.08, 1.68, 0.95, p, C.gold));
    bulletList(s, b.lines, b.x + 0.2, 2.08, 3.2, 0.84, C.text, 9.6);
  });
  addPageNumber(s, 5);
}

// 6 benchmark
{
  const s = pptx.addSlide();
  s.background = { color: C.offW };
  addTopBar(s, "03  七维度量化对标分析");
  addTitle(s, "中欧 FMBA 与全球标杆院校对比", "差距集中在课程体系化、工具实操和治理补齐三类能力。");
  card(s, 0.6, 1.15, 7.2, 5.65);
  s.addText("课程成熟度评分（100 分制）", { x: 0.85, y: 1.35, w: 3.4, h: 0.15, fontSize: 12, bold: true, color: C.navy, margin: 0 });
  [["HBS", 92, C.navy], ["Wharton", 90, C.teal], ["MIT Sloan", 88, "7B2D8B"], ["NUS", 81, C.orange], ["HKUST", 79, "2980B9"], ["CEIBS FMBA", 54, C.red]].forEach((r, i) => barRow(s, 0.85, 1.8 + i * 0.62, r[0], r[1], r[2]));
  card(s, 8.05, 1.15, 4.6, 5.65, "F8FAFC");
  s.addText("结论", { x: 8.35, y: 1.35, w: 1, h: 0.15, fontSize: 12, bold: true, color: C.navy, margin: 0 });
  bulletList(s, ["头部院校已从单点课程升级到全项目能力框架。", "FMBA 短板不在“有没有 AI 课程”，而在“有没有形成闭环”。", "最优路径是把 AI 嵌入金融管理主线，并补齐实操和伦理模块。"], 8.35, 1.75, 3.8, 0.95, C.text, 10);
  const dims = ["AI 课程广度", "核心课嵌入", "金融 AI 专项", "工具实操强度", "行业合作", "伦理/治理", "GenAI 能力"];
  dims.forEach((d, i) => {
    s.addShape(pptx.ShapeType.rect, { x: 8.35, y: 4.45 + i * 0.3, w: 0.08, h: 0.08, fill: { color: i < 2 ? C.red : i < 5 ? C.gold : C.teal }, line: { color: i < 2 ? C.red : i < 5 ? C.gold : C.teal } });
    s.addText(d, { x: 8.52, y: 4.42 + i * 0.3, w: 3.4, h: 0.14, fontSize: 9.2, color: C.text, margin: 0 });
  });
  addPageNumber(s, 6);
}

// 7 current state
{
  const s = pptx.addSlide();
  s.background = { color: C.offW };
  addTopBar(s, "04  中欧 FMBA 现状深度分析");
  addTitle(s, "FMBA 现状与 SWOT", "课程的关键问题是 AI 能力链条不完整，而不是课程数量不足。");
  card(s, 0.55, 1.15, 6.1, 5.45);
  card(s, 6.85, 1.15, 5.9, 5.45);
  s.addShape(pptx.ShapeType.rect, { x: 0.55, y: 1.15, w: 6.1, h: 0.36, fill: { color: C.navy }, line: { color: C.navy } });
  s.addShape(pptx.ShapeType.rect, { x: 6.85, y: 1.15, w: 5.9, h: 0.36, fill: { color: C.teal }, line: { color: C.teal } });
  s.addText("现状判断", { x: 0.75, y: 1.24, w: 1, h: 0.15, fontSize: 12, bold: true, color: C.white, margin: 0 });
  s.addText("SWOT", { x: 7.05, y: 1.24, w: 0.8, h: 0.15, fontSize: 12, bold: true, color: C.white, margin: 0 });
  bulletList(s, ["AI 主题分散在选修和讲座中，缺少统一的教学主线。", "学生有金融经验，但对 AI 工具、数据思维和 GenAI 缺乏系统训练。", "项目实践已有基础，但缺少 AI 驱动案例和可复用工具链。"], 0.82, 1.72, 5.55, 0.9, C.text, 10);
  [["S", "强项", "金融管理底盘扎实，学员经验丰富。", C.green], ["W", "短板", "AI 课程散点化、实操不足、缺少闭环。", C.red], ["O", "机会", "金融科技、RegTech、GenAI 应用扩展迅速。", C.orange], ["T", "威胁", "顶尖院校快速升级，招生竞争压力上升。", C.navy]].forEach((it, i) => {
    const y = 1.72 + i * 1.02;
    s.addShape(pptx.ShapeType.rect, { x: 7.05, y, w: 5.45, h: 0.86, fill: { color: "F8FAFC" }, line: { color: C.line, pt: 1 } });
    s.addShape(pptx.ShapeType.roundRect, { x: 7.2, y: y + 0.17, w: 0.42, h: 0.42, rectRadius: 0.08, fill: { color: it[3] }, line: { color: it[3] } });
    s.addText(it[0], { x: 7.2, y: y + 0.26, w: 0.42, h: 0.12, fontSize: 14, bold: true, color: C.white, align: "center", margin: 0 });
    s.addText(it[1], { x: 7.78, y: y + 0.12, w: 1.0, h: 0.16, fontSize: 10.5, bold: true, color: C.navy, margin: 0 });
    s.addText(it[2], { x: 7.78, y: y + 0.34, w: 4.5, h: 0.24, fontSize: 9.1, color: C.text, margin: 0 });
  });
  addPageNumber(s, 7);
}

// 8 roadmap / close
{
  const s = pptx.addSlide();
  s.background = { color: C.navy2 };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: C.gold }, line: { color: C.gold } });
  addTitle(s, "结论与实施路线图", "建议按“基础课 - 选修集群 - 课程嵌入 - 项目升级 - 治理补齐”五步推进。", C.white, C.goldL);
  [["第一阶段", "0-6 个月", "完成 AI 必修课设计、教师培训和首批工作坊。", C.navy], ["第二阶段", "6-12 个月", "上线专项选修集群，嵌入 3-4 门核心课程。", C.teal], ["第三阶段", "12-24 个月", "把 AI 要求纳入项目、毕业要求与持续评估机制。", C.gold]].forEach((p, i) => {
    const x = 0.95 + i * 4.1;
    card(s, x, 1.55, 3.45, 2.55);
    s.addShape(pptx.ShapeType.rect, { x, y: 1.55, w: 3.45, h: 0.28, fill: { color: p[3] }, line: { color: p[3] } });
    s.addText(p[0], { x: x + 0.12, y: 1.73, w: 1.0, h: 0.14, fontSize: 11.5, bold: true, color: C.white, margin: 0 });
    s.addText(p[1], { x: x + 0.12, y: 2.05, w: 1.2, h: 0.14, fontSize: 10, bold: true, color: p[3], margin: 0 });
    s.addText(p[2], { x: x + 0.12, y: 2.36, w: 3.1, h: 0.42, fontSize: 9.5, color: C.text, margin: 0 });
  });
  card(s, 0.85, 4.55, 11.6, 1.55, "123B5A", C.gold);
  bulletList(s, ["先建立共同基础，再面向职业方向分层深化。", "把 AI 工具真正嵌入管理决策，而不是停留在概念层。", "通过项目与治理机制把课程内容转化为长期能力。"], 1.15, 4.8, 10.7, 0.32, C.white, 10.5);
  s.addText("Thanks", { x: 11.85, y: 6.4, w: 1.0, h: 0.18, fontSize: 13, bold: true, color: C.goldL, align: "right", margin: 0 });
}

async function main() {
  const out = path.join(__dirname, "pptx.pptx");
  await pptx.writeFile({ fileName: out });
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
