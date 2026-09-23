# 幕芽 Reelori · AI Short Film Studio

Official source / 官方源码：[flowbarai-oss/Reelori](https://github.com/flowbarai-oss/Reelori).

Reelori is a local-first, single-user short film workspace. It lets you organize
a story into shots, preview timing, generate or import media, review candidates,
edit subtitles and audio, and export a short film with its source manifest.

幕芽 Reelori 是本地优先的单人 AI 短片创作工作台。可整理剧本、编辑分镜、预演节奏、接入自有模型密钥、人工采纳候选，并导出成片、字幕与素材清单。

**Status / 状态：** community preview under preparation. The source build is
available for development; a verified Windows installer and Docker image are
not yet published. Never expose the local service to a network.

## Run from source / 源码运行

Requires Node.js 24.12+ and FFmpeg with H.264 support. FFmpeg is not bundled.
需要 Node.js 24.12+ 和支持 H.264 的 FFmpeg；仓库不附带 FFmpeg。

```text
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:5178/`. The bundled sample workflow needs no model key.
The service and web page bind only to `127.0.0.1`. For development with Vite,
use `npm run dev` instead. Run `npm test` and `npm run typecheck` before a PR.

访问 `http://127.0.0.1:5178/`。内置示例无需模型密钥，真实生成需要你主动配置对应服务商、确认报价和预算。

## Windows preview package / Windows 便携候选包

The maintainers build this with `npm run package:windows` after `npm run build`.
The package includes a pinned Node.js runtime and `SHA256SUMS.txt`; it stores
projects outside the program directory in `%LOCALAPPDATA%\Reelori\data`.
Double-click `Start Reelori.cmd`. Keep that window open while using the app.
Use the workspace backup feature before moving or upgrading a package.

维护者在构建后运行 `npm run package:windows`。候选包内含固定版本的 Node.js 运行时及 SHA-256 清单；作品保存在程序目录之外。正式安装器和自动升级尚未通过发行验收。

## Model keys and privacy / 模型密钥与隐私

On Windows, run `powershell -File scripts/credentials.ps1 -Action set -Provider flowbar`
from the package directory to store a FlowBar international key with Windows
user-scoped encryption. `minimax` and `aliyun` are also supported providers.
The FlowBar route uses `https://api.flowbarai.com/v1`; get a key from
[FlowBarAI international](https://flowbarai.com/). The
[GEN studio](https://gen.flowbarai.com/) is a separate hosted product.

密钥只由本机服务读取，不进入浏览器、项目备份或成片交付包。真实生成会把已确认的镜头提示词或对白发送给所选服务商，并可能产生费用。样例任务不会产生真实模型费用。现有环境变量和外置文件配置供开发迁移使用；请勿把密钥文件放进仓库。

## Current limits / 当前边界

- Text-to-image, text-to-video and TTS routes have been exercised; reference
  images are recorded locally but are **not** sent to model providers.
- Image-to-video, multi-reference, first/last-frame control, remote access,
  hosted accounts and automatic upgrades are not supported.
- Provider reservations are local estimates, not a verified supplier invoice.
- Windows is the currently tested development platform. Docker remains a
  candidate until a clean Linux build and data-persistence test passes.

See [Windows source acceptance](docs/release/ACCEPTANCE-20260924.md),
[quick start](docs/release/QUICKSTART.md), [security policy](SECURITY.md),
[third-party notices](THIRD_PARTY_NOTICES.md) and [contributing](CONTRIBUTING.md).
Code and the three bundled example images are licensed under [MIT](LICENSE).
Bundled third-party components retain their own licenses; see the
[notices](THIRD_PARTY_NOTICES.md).
