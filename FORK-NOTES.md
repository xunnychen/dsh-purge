# fork 说明 / Fork notes

生成时间：2026-10-21（Asia/Shanghai）

## 来源

- 代码快照取自本机 `~/Documents/deepseekharness/dsh-purge`，原为一个 **shallow clone**：浅克隆边界是 `e6ce8dd0`，缺父对象 `884acca9`。
- 原始上游：`https://github.com/YuJunZhiXue/dsh-purge`。
- 2026-10-21 复核：该上游仓库在 GitHub 上返回 **404**（不可见 / 已按 README 声明闭源），所以既无法建立 GitHub 的 fork 关系，也无法 `unshallow` 把旧对象补齐。

## 历史层面的处理

- 推送前把浅边界提交 `e6ce8dd0` 重写为无父根提交，重建了 master 的 34 条历史。**本仓库所有 commit SHA 与上游不同**（内容一致、顺序一一对应），tag `v1.1.67`–`v1.1.71` 同样重建。
- `master` 只包含上游 `8df4406` 的原始内容（重写后为 `f007081`）外加本文件，未改动任何源码。

## 分支

| 分支 | 内容 |
| --- | --- |
| `master` | 上游 master 内容 + 本说明 |
| `fix/cwd-suffix-issue-143` | 修 DSH 0.2.1 未注册 `{{cwd}}`（issue #143）：`lib/identity.js` 探测宿主变量表、清 `sections`/`contexts` 里的残留占位符、`cwdSuffix` 开关（含 `identity.cwdSuffix` 别名）、新增 `tests/cwd-suffix.test.mjs` |

## 本机安装

```bash
# 从本 fork 的分支安装（web / desktop 各装一次）
dsh plugin --profile web add https://github.com/xunnychen/dsh-purge/archive/refs/heads/fix/cwd-suffix-issue-143.tar.gz
dsh plugin --profile desktop add https://github.com/xunnychen/dsh-purge/archive/refs/heads/fix/cwd-suffix-issue-143.tar.gz
# 已在仓库目录时
dsh plugin --profile web add .
```

## 许可与再分发

上游 `LICENSE` 为 MIT，同时新增了 `LICENSE-COMMERCIAL.md`，README 声明「七日征集后闭源，新版本只走频道」。本 fork 仅供本机个人调试与评测使用；上游未公开的后续版本请勿经本仓库再分发，二开请遵守上游的署名要求。
