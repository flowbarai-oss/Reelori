# 快速开始 / Quick start

1. 从官方 `flowbarai-oss/Reelori` Release 获取发行包并核对 SHA-256；在正式发行前，请使用源码运行。不要从第三方镜像下载可执行文件。
2. Windows 候选安装包安装后，从桌面“Reelori”快捷方式启动独立窗口；便携候选包可双击 `Start Reelori.cmd`。源码模式请执行 `npm ci`, `npm run build`, `npm start`，再访问 `http://127.0.0.1:5178/`。
3. 打开示例项目、修改镜头、预演、确认并合成短片。此路径不需要模型密钥。Windows 候选安装包和便携包内置 FFmpeg；源码模式需要自行安装支持 H.264 的 FFmpeg，缺失时设置页的“本机运行检查”会提示。
4. 要使用 FlowBarAI 国际站真实生成，在「项目设置 → 模型与费用」输入国际站 API Key 并安全保存，无需 PowerShell 或重启。前往 `https://flowbarai.com/topup` 充值前，确认主站登录的是此 Key 所属账号；在国际站控制台核对余额、订单与实际账单，支付回跳不代表已到账。Reelori 的美元预算只是本机限制，不是账户余额。MiniMax 和阿里云 TTS 仍可用 `powershell -File scripts/credentials.ps1 -Action set -Provider minimax`（或 `aliyun`）配置，修改后重启；密钥状态用 `-Action status` 查看，`-Action remove` 移除。示例创作与合成无需密钥或充值。
5. 每次真实提交前在设置页查看路线、美元预算及单镜报价。任务结果未知时先查询，不要盲目重提。
6. 在设置页创建完整工作区备份并保存到独立目录。程序默认保留作品在 `%LOCALAPPDATA%\Reelori\data`；卸载或替换程序目录不能删除它。
7. 设置页“检查更新”只查询官方公开 Release。当前预览安装器不支持原位升级；先备份工作区、退出程序并卸载旧版，再安装新版。卸载程序保留 `%LOCALAPPDATA%\Reelori\data`。自动安装尚未开放。

Desktop service ports 4312/5179 (source-mode 4311/5178) bind to loopback. The product is single-user and
must not be exposed on a LAN or public host. Importing private material into a
provider job sends the confirmed prompt or dialogue to that provider. The
workspace backup excludes keys and local credential storage.
