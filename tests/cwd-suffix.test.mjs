/**
 * 回归：`{{cwd}}` 不能在未注册它的宿主上被写进会被插值的段落（issue #143）。
 *
 * 宿主 DSH 0.2.1 起不再注册 `cwd` 提示词变量，工作目录改由 runtime context 每轮给出。
 * `@deepseek-ai/dsh-system-prompt` 的 interpolate() 对**未注册变量是硬错误**：
 *   unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
 *   registered variables: provider, model
 * 所以插件只能按「这次组装真正注册了哪些变量」决定要不要写工作目录句。
 *
 * 本文件既跑纯函数断言，也在能定位到宿主包时用宿主自己的 renderPrompt() 复核
 * （找不到就 skip，CI 上照样跑纯函数部分）。
 *
 *   node --test tests/
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const READ = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const {
  rewritePromptAssembly,
  cwdSuffixText,
  stripCwdReferences,
  CAPABILITY_SECTION,
  capabilityProtocolText,
} = await import(pathToFileURL(path.join(ROOT, "lib/identity.js")).href);

const CWD_LINE = "Your working directory is {{cwd}}.";
const WORKDIR = "/Users/example/project";

/** 宿主 DSH 0.2.1-rc.2：只注册 provider / model。 */
const VARS_NEW = { provider: "provider-a", model: "model-a" };
/** 旧宿主（< 0.2.1）：额外注册 cwd。 */
const VARS_OLD = { ...VARS_NEW, cwd: WORKDIR };

const HOST_PROMPT_CANDIDATES = [
  process.env.DSH_HOST_PROMPT,
  "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js",
  path.join(
    os.homedir(),
    "Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js",
  ),
].filter(Boolean);

const HOST_PROMPT = HOST_PROMPT_CANDIDATES.find((fp) => {
  try {
    return fs.statSync(fp).isFile();
  } catch {
    return false;
  }
});

let renderPrompt = null;
let renderContextSections = null;
if (HOST_PROMPT) {
  ({ renderPrompt, renderContextSections } = await import(pathToFileURL(HOST_PROMPT).href));
}

/** 一份最接近宿主真实装配的输入：官方身份 prefix + 空 suffix + 插件段。 */
function assembly(variables, extra = []) {
  return {
    sections: [
      {
        name: "deployment:persona-prefix",
        text: "You are a coding agent powered by the {{model}} model, running on the DeepSeek Harness. Your working directory is {{cwd}}.",
        order: 10000,
      },
      { name: "deployment:persona-suffix", text: CWD_LINE, order: 10200 },
      { name: "tools", text: "tool list", order: 500 },
      ...extra,
    ],
    // 0.2.1 把工作目录搬进了 runtime context：它不参与 section 渲染，
    // 正好用来确认「插件不写 cwd 时，路径仍由宿主上下文提供」。
    contexts: [{ name: "working-directory", text: `Current working directory: ${WORKDIR}`, order: 100 }],
    tools: [],
    ...(variables ? { variables } : {}),
  };
}

function suffixOf(out) {
  return out.sections.filter((s) => s.name === "deployment:persona-suffix");
}

function everyInterpolatedText(out) {
  return out.sections
    .filter((s) => s && s.interpolate !== false && typeof s.text === "string")
    .map((s) => s.text)
    .join("\n");
}

function rewriteSections(input, options = {}) {
  const out = rewritePromptAssembly(input, { fallbackInject: "", ...options });
  return out;
}

test("cwdSuffixText：只有宿主注册 cwd 且开关没关时才写字面量", () => {
  assert.equal(cwdSuffixText(true, true), CWD_LINE);
  assert.equal(cwdSuffixText(false, true), "");
  assert.equal(cwdSuffixText(undefined, true), "");
  assert.equal(cwdSuffixText(true, false), "");
});

test("stripCwdReferences：目录样板整行丢弃，句中占位符只摘占位符", () => {
  assert.equal(stripCwdReferences(`Keep this.\n${CWD_LINE}`), "Keep this.");
  const mid = stripCwdReferences(`Run the command. Your working directory is {{cwd}}. Then stop.`);
  assert.ok(!mid.includes("{{cwd}}"));
  assert.ok(mid.includes("Run the command."));
  assert.ok(mid.includes("Then stop."));
  // 列表结构不能因为清洗被吃掉
  const list = stripCwdReferences("- Working directory is {{cwd}}");
  assert.ok(list.startsWith("- "));
  // 没有占位符时逐字不动
  assert.equal(stripCwdReferences("plain text"), "plain text");
});

test("0.2.1 宿主：整份装配里不再出现 {{cwd}}，也绝不新增 suffix 段", () => {
  const out = rewriteSections(assembly(VARS_NEW));
  assert.ok(!everyInterpolatedText(out).includes("{{cwd}}"), everyInterpolatedText(out));
  for (const section of suffixOf(out)) {
    assert.equal(section.text, "");
  }
});

test("0.2.1 宿主：变量表缺失时按没有 cwd 处理（不炸）", () => {
  const out = rewriteSections(assembly(null));
  assert.ok(!everyInterpolatedText(out).includes("{{cwd}}"));
});

test("旧宿主（注册 cwd）：保留工作目录句，路径仍能渲染出来", () => {
  const out = rewriteSections(assembly(VARS_OLD));
  const suffixes = suffixOf(out);
  assert.equal(suffixes.length, 1);
  assert.equal(suffixes[0].text, CWD_LINE);
});

test("老宿主但 cwd 没解析成字符串（undefined / 空串 / 非字符串）：按没有 cwd 处理", () => {
  // 宿主 interpolate() 对「有键但值 undefined」抛 has no value，同样是硬错误；
  // 光看键存在不够，必须要求这次组装真的解析出非空字符串。
  for (const bad of [undefined, "", "   ", 123, null]) {
    const out = rewriteSections(assembly({ ...VARS_NEW, cwd: bad }));
    assert.ok(!everyInterpolatedText(out).includes("{{cwd}}"), "cwd=" + JSON.stringify(bad));
    for (const section of suffixOf(out)) assert.equal(section.text, "", "cwd=" + JSON.stringify(bad));
  }
});

test("cwdSuffix:false：老宿主也不再注入工作目录句", () => {
  const out = rewriteSections(assembly(VARS_OLD), { cwdSuffix: false });
  assert.ok(!everyInterpolatedText(out).includes("{{cwd}}"));
  for (const section of suffixOf(out)) assert.equal(section.text, "");
});

test("interpolate:false 的段落保留字面 {{cwd}}（宿主不插值它）", () => {
  const literal = "Log line: {{cwd}}";
  const input = assembly(VARS_NEW, [
    { name: "dsh-purge", text: literal, order: 99999, interpolate: false },
  ]);
  const out = rewriteSections(input, { fallbackInject: literal });
  const kept = out.sections.filter((s) => s.interpolate === false && String(s.text).includes("{{cwd}}"));
  assert.equal(kept.length, 1, "字面占位符应原样留在不插值的段落里");
  // 反向：会被插值的段落里一个都不能剩
  assert.ok(!everyInterpolatedText(out).includes("{{cwd}}"));
});

test("0.2.1 宿主：会被插值的运行时上下文也清掉 {{cwd}}，interpolate:false 的上下文不动", () => {
  // 宿主 renderContextSections() 和 sections 走同一个 interpolate()：上下文里
  // 未注册的 {{cwd}} 同样让整轮失败，所以清洗必须覆盖 contexts。
  const input = assembly(VARS_NEW);
  input.contexts = [
    { name: "working-directory", text: `Current working directory: ${WORKDIR}`, order: 100, interpolate: false },
    { name: "custom:ctx", text: "Working directory: {{cwd}}", order: 120 },
    { name: "keep:ctx", text: "plain context", order: 130 },
  ];
  const out = rewriteSections(input);
  const byName = new Map(out.contexts.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("working-directory").text, `Current working directory: ${WORKDIR}`);
  assert.ok(!String(byName.get("custom:ctx").text).includes("{{cwd}}"));
  assert.equal(byName.get("keep:ctx").text, "plain context");
  // 没命中的条目不重建：保持原对象，避免无意义地改动宿主装配
  assert.equal(byName.get("keep:ctx"), input.contexts[2]);
  assert.equal(byName.get("working-directory"), input.contexts[0]);
});

test("旧宿主（注册 cwd）：上下文里的 {{cwd}} 原样保留，交给宿主插值", () => {
  const input = assembly(VARS_OLD);
  input.contexts = [{ name: "custom:ctx", text: "Working directory: {{cwd}}", order: 120 }];
  const out = rewriteSections(input);
  assert.equal(out.contexts[0].text, "Working directory: {{cwd}}");
});

test("宿主 renderContextSections：0.2.1 上清洗过的上下文能渲染，未清洗的会抛错", { skip: !renderContextSections }, () => {
  const input = assembly(VARS_NEW);
  input.contexts = [{ name: "custom:ctx", text: "Working directory: {{cwd}}\nKeep this context line.", order: 120 }];
  assert.throws(
    () => renderContextSections({ ...input, variables: VARS_NEW }),
    /unknown prompt variable "\{\{cwd\}\}" in context "custom:ctx"/,
  );
  const out = rewriteSections(input);
  const rendered = renderContextSections({ ...out, variables: VARS_NEW });
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].text, "Keep this context line.");
});

test("用户自定义段里的目录样板：0.2.1 上被清掉，0.2.1 之前保持原样", () => {
  const custom = { name: "user:rules", text: `Follow repo rules.\n${CWD_LINE}`, order: 400 };
  const outNew = rewriteSections(assembly(VARS_NEW, [custom]));
  const keptNew = outNew.sections.find((s) => s.name === "user:rules");
  assert.ok(keptNew.text.includes("Follow repo rules."));
  assert.ok(!keptNew.text.includes("{{cwd}}"));

  const outOld = rewriteSections(assembly(VARS_OLD, [custom]));
  const keptOld = outOld.sections.find((s) => s.name === "user:rules");
  assert.ok(keptOld.text.includes(CWD_LINE));
});

test("与 cwd 无关的段落不被这次清洗改动", () => {
  const rule = { name: "user:keep", text: "Keep this rule exactly.", order: 401 };
  const out = rewriteSections(assembly(VARS_NEW, [rule]));
  const kept = out.sections.find((s) => s.name === "user:keep");
  assert.equal(kept.text, "Keep this rule exactly.");
});

test("cordis.patch.yml 不再把 {{cwd}} 写进配置值，personaSuffix 留空", () => {
  const yml = READ("cordis.patch.yml");
  const valueLines = yml.split("\n").filter((line) => !line.trim().startsWith("#"));
  assert.ok(
    !valueLines.some((line) => line.includes("{{cwd}}")),
    "cordis.patch.yml 的配置值里仍有 {{cwd}}",
  );
  assert.match(yml, /personaSuffix:\s*""/);
});

test("package.json 声明目标宿主为 0.2.1.x", () => {
  const pkg = JSON.parse(READ("package.json"));
  assert.match(String(pkg.dshTarget || ""), /^0\.2\.1/);
});

test("cwdSuffix 开关：顶层与 identity.cwdSuffix 别名都认，默认开", async () => {
  const { identityCwdSuffix } = await import(pathToFileURL(path.join(ROOT, "lib/index.js")).href);
  assert.equal(identityCwdSuffix({}), true);
  assert.equal(identityCwdSuffix({ cwdSuffix: true }), true);
  assert.equal(identityCwdSuffix({ cwdSuffix: false }), false);
  assert.equal(identityCwdSuffix({ identity: { cwdSuffix: false } }), false);
  assert.equal(identityCwdSuffix({ cwdSuffix: true, identity: { cwdSuffix: false } }), false);
  assert.equal(identityCwdSuffix({ identity: { cwdSuffix: true } }), true);
});

// ── 宿主自己的渲染器复核（能找到宿主包时才跑）───────────────────────────────

test("宿主 renderPrompt：0.2.1 变量表下两份装配都能渲染，且 0.2.1 不含工作目录句", { skip: !renderPrompt }, () => {
  const out = rewriteSections(assembly(VARS_NEW));
  const text = renderPrompt({ ...out, variables: VARS_NEW });
  assert.ok(text.length > 0);
  assert.ok(!text.includes("{{cwd}}"));
  assert.ok(!text.includes(CWD_LINE));

  // 反向对照：修复前的写法在 0.2.1 上必然抛，证明这条用例真的在测那个崩点
  const brokenSections = [
    { name: "deployment:persona-suffix", text: CWD_LINE, order: 10200 },
  ];
  assert.throws(
    () => renderPrompt({ sections: brokenSections, contexts: [], tools: [], variables: VARS_NEW }),
    /unknown prompt variable "\{\{cwd\}\}" in section "deployment:persona-suffix"/,
  );
});

test("宿主 renderPrompt：旧宿主变量表下工作目录句渲染出真实路径", { skip: !renderPrompt }, () => {
  const out = rewriteSections(assembly(VARS_OLD));
  const text = renderPrompt({ ...out, variables: VARS_OLD });
  assert.ok(text.includes(WORKDIR), text.slice(0, 400));
});

test("宿主 renderPrompt：cwdSuffix:false 时即使旧宿主也没有工作目录句", { skip: !renderPrompt }, () => {
  const out = rewriteSections(assembly(VARS_OLD), { cwdSuffix: false });
  const text = renderPrompt({ ...out, variables: VARS_OLD });
  assert.ok(!text.includes(CWD_LINE));
  assert.ok(!text.includes(WORKDIR));
});

test("真实插件段 + 0.2.1 宿主：渲染成功，用户 inject 逐字保留", { skip: !renderPrompt }, () => {
  // 用户的 prompt-inject 里可能故意写着 {{cwd}}；它所在段落 interpolate:false，
  // 宿主不会插值，所以必须原样保留 —— 清洗只针对会被插值的段落。
  const inject = "Keep this literal: {{cwd}} — 这一段不参与插值。";
  const input = {
    sections: [
      { name: "deployment:persona-prefix", text: "" },
      { name: "dsh-purge", text: inject, interpolate: false },
      { name: CAPABILITY_SECTION, text: capabilityProtocolText({ redteam: false, enabled: true }), interpolate: false },
      { name: "deployment:persona-suffix", text: CWD_LINE },
      { name: "tools", text: "tool list" },
    ],
    contexts: [],
    tools: [],
    variables: VARS_NEW,
  };
  const out = rewritePromptAssembly(input, { fallbackInject: inject });
  const text = renderPrompt({ ...out, variables: VARS_NEW });
  assert.ok(text.includes(inject), "用户 inject 不应被改动");
  assert.ok(!text.includes(CWD_LINE));
  assert.ok(text.includes("tool list"));
});
