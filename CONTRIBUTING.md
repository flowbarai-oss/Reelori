# Contributing to Reelori · 幕芽

The official public source lives at [flowbarai-oss/Reelori](https://github.com/flowbarai-oss/Reelori). This is a local-first, single-user community preview. Open an issue to discuss a substantial change before writing it; send code changes through a pull request from a feature branch.

## Local setup

Use Node.js 24.12 or newer, FFmpeg with H.264 support, and Python 3.11 or newer for the complete test suite. FFmpeg is a user-installed development prerequisite; it is not bundled with the Windows package.

```text
npm ci
npm run typecheck
npm run build
npm test
npm run scan:secrets
```

`npm start` launches the local production-style interface after building. `npm run dev` starts the development interface. Both bind to loopback only. Keep a workspace backup before testing a change that modifies project data.

## Pull requests

- Explain the user-visible change and include relevant verification. Keep unrelated refactoring separate.
- Preserve data, revision and budget checks around media generation and exports. Do not replace real media-path tests with mocks merely to make a check pass.
- Never commit API keys, `.env` files, local databases, private scripts, generated user media, or development-only handoff records. Inspect `git status` and run the secret-pattern scan before submitting. The scanner is a first pass, not a guarantee.
- Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md), without opening an issue containing exploit details or credentials.
- The official public repository receives reviewed source snapshots. Do not copy private development history or internal operations documents into it.

欢迎通过 Issue 讨论重要改动，并从功能分支提交 Pull Request。提交前完成类型检查、构建、测试和凭据扫描；不要上传密钥、用户作品或本机数据库。安全问题请按 [安全政策](SECURITY.md) 私下报告。
