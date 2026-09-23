# 贡献指南

本项目是本地优先、单用户定位的开发中项目，当前没有公开仓库、没有对外发布，本文档面向能直接访问这份代码的协作者。

## 环境要求

- Node ≥ 24.12.0（`package.json` 的 `engines` 字段强制要求，见 `README.md` 的 SQLite 实验性提示说明）
- 可用的 FFmpeg（按顺序读取 `REELORI_FFMPEG` 环境变量 → `data/runtime.json` 的 `ffmpeg` 字段 → 系统 PATH）
- 真实模型调用需要对应供应商的 Key 文件（FlowBar/MiniMax/阿里云，见 `README.md`），本地开发/测试不需要

## 本地开发

```bash
npm ci                # 不要用 npm install 覆盖 lockfile，除非确实要改依赖版本
npm run dev            # 前端 127.0.0.1:5178，本地 API 127.0.0.1:4311
```

## 提交前必须跑通的检查（不能跳过任何一项）

```bash
npm run typecheck
npm run build
node --test tests/*.test.ts
git diff --check
```

改动涉及供应商账本/凭据/媒体解码等安全边界代码时，额外做一次密钥扫描：

```bash
git status --short | awk '{print $2}' | while read f; do
  grep -nEi "sk-[a-zA-Z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----" "$f"
done
```

## 硬性规则（违反了不接受合并）

- 不削弱已有测试断言、不加 `--no-verify`、不跳过失败的测试去让 CI 变绿。
- `data/`、`.env`、任何看起来像密钥/Token 的文件不进提交，`.gitignore` 已覆盖大部分，改动前自查一遍 `git status`。
- 不静默截断/丢弃用户数据（对白过长、音频超时长、磁盘写入失败等场景必须显式报错，不能"看起来完整但实际不完整"）。
- 涉及供应商账本（`packages/providers/*.ts`）的改动，如果新增了 `ProviderJob`/`ProviderInput` 的字段，必须同步检查并更新 `packages/providers/validation.ts`——这是一份独立维护的备份完整性校验 schema，历史上漏改过一次导致带新字段的项目无法备份，教训写在 `docs/validation/CLAUDE-P2-TTS-LEDGER-20260922.md` 里。
- npm workspace 结构下改依赖前，确认改的是正确的 `package.json`（根目录 vs `apps/web/`），两者职责不同，不要混着改。

## 测试风格

看 `tests/` 目录下已有文件的写法，尽量用真实数据（真实 ffmpeg 生成的音视频、真实 fetcher fixture）而不是纯 mock 断言；供应商相关代码优先用官方文档给出的测试向量核对（`tests/aliyun-token.test.ts` 是例子），不要凭印象猜协议细节。

## 文档规范

- 每次会话/阶段的验证证据放 `docs/validation/`，文件名带日期后缀，写清楚"真实验证过什么"和"没验证什么"，不要只写结论不写证据。
- 大的功能改动先写一份"小范围实施说明"放 `docs/plans/`，再动代码，参考 `docs/plans/P2-TTS-IMPLEMENTATION-NOTE-20260922.md` 的写法。
