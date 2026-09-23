# 快速开始 / Quick start

1. 从官方 `flowbarai-oss/Reelori` Release 获取发行包并核对 SHA-256；在正式发行前，请使用源码运行。不要从第三方镜像下载可执行文件。
2. Windows 便携候选包解压到程序目录，双击 `Start Reelori.cmd`；首次运行打开本机地址 `http://127.0.0.1:5178/`。源代码运行请执行 `npm ci`, `npm run build`, `npm start`。
3. 打开示例项目、修改镜头、预演、确认并合成短片。此路径不需要模型密钥。FFmpeg 缺失时，设置页的“本机运行检查”会提示；请从官方渠道安装支持 H.264 的 FFmpeg。
4. 要真实生成，先在 Windows PowerShell 运行 `powershell -File scripts/credentials.ps1 -Action set -Provider flowbar`，输入国际站 FlowBarAI Key 后重启工作台。MiniMax 使用 `minimax`，阿里云 TTS 多字段配置使用 `aliyun`。密钥状态可用 `-Action status` 查看，`-Action remove` 移除。
5. 每次真实提交前在设置页查看路线、美元预算及单镜报价。任务结果未知时先查询，不要盲目重提。
6. 在设置页创建完整工作区备份并保存到独立目录。程序默认保留作品在 `%LOCALAPPDATA%\Reelori\data`；卸载或替换程序目录不能删除它。
7. 设置页“检查更新”只查询官方公开 Release。当前需要从官方页面手动下载安装；自动安装尚未开放。

Local service ports 4311/5178 bind to loopback. The product is single-user and
must not be exposed on a LAN or public host. Importing private material into a
provider job sends the confirmed prompt or dialogue to that provider. The
workspace backup excludes keys and local credential storage.
