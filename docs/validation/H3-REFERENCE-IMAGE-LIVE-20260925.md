# MiniMax H3 参考图视频实测（2026-09-25）

## 范围与费用边界

- 用户授权本次真实验证，美元总预算上限为 10 美元。只向中国官方端点提交了 **1 个** 被接受的付费视频任务；全球端点收到 HTTP 401，未获任务号，未重试。
- 输入是仓库自有示例 `public/assets/rain-portrait.png`，1024×1536 PNG，SHA-256 `ddef6b55e7c72cdbf20cf852f29f096d4846fcc6f4fbb2eb8f728529411e1017`。素材来源见 `docs/design/ASSET-PROVENANCE.md`。
- 模型为 `MiniMax-H3`，`768P`、`9:16`、5 秒。根据 [MiniMax 中国站刊例价](https://platform.minimax.cn/docs/guides/pricing-paygo) 0.50 元/秒，**估算**本次 2.50 元人民币；尚未取得供应商实际账单，不把估算写成已扣款。

## 实测结果

- 按 [MiniMax 中国站视频生成协议](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create) 在 `content` 中提交文字与一张 `reference_image`（PNG data URI）。`https://api.minimax.cn/v2/video_generation` 返回 HTTP 200、任务号 `445555864957371`；仅对该任务号查询，最终状态 `succeeded`。
- 已下载文件：`dist/acceptance-reference-h3-cn-20260925.mp4`，1,587,052 字节，SHA-256 `e36ef878f0a293fb480ea18d0a8b22849ab832da2c0f825a8d1c333e08d4c0d3`。这是本机忽略的验收文件，不进入开源仓库。
- FFmpeg 完整解码通过：768×1344、24 fps、约 5.16 秒；视频和音频流均可解码。抽查约第 1、3、4.5 秒，人物发型、米色风衣、相机和雨夜城市环境基本保持，人物转身和取景有连续变化。这里只证明单镜头样本可用，不代表多镜头角色一致性或长期稳定性已经通过。
- 全球官方端点 `https://api.minimax.io/v2/video_generation` 使用同一凭据返回 HTTP 401，无任务号；因此该凭据只能按此次证据用于中国端点，不应自动跨端点回退。401 是否产生账单须以供应商账单为准。

## 产品集成判定

本次付费验证首先证明了 **供应商参考图协议及单镜头效果**。随后在 `0.4.0-preview.9` 源码中加入 MiniMax 中国端点 H3 的单图选择、报价预览、前端与服务端双重授权确认、可信本地素材读取、哈希与尺寸预检、镜头/参考版本冻结和账本留痕。模拟密钥下的本地浏览器检查覆盖中文/英文及 390px 移动端；API 测试验证未确认使用权不能预留付费任务。

产品真实链路第一次提交返回 HTTP 400、没有任务号，账本任务 `f2083d3c-84eb-4aa8-87cf-3fabff3ce47d` 被安全保留为 `unknown`，预留 USD 0.60，未重提。根因是适配器把 `content[].image_url` 错写成字符串；成功的直连请求实际使用 `{ "url": "data:image/png;base64,..." }` 对象。修正后用**另一个镜头**进行一次独立提交，任务 `445573748052273` 成功，结果通过产品后台查询、下载、保存和页面预览。视频本机路径 `dist/browser-h3-data/assets/9f5d1aabd221050ee34aaf26fad45dfae5bb026f72d9e19accc84ae078666a4e.mp4`，1,126,324 字节，SHA-256 `9f5d1aabd221050ee34aaf26fad45dfae5bb026f72d9e19accc84ae078666a4e`；FFmpeg 全量解码通过，768×1344、24 fps、约 5.16 秒。第 1、3、4.5 秒目视检查保留了短发、米色风衣与相机，场景转为暗房。结果仅入库为候选，未自动采纳。

按刊例价，两次成功生成各约 CNY 2.50，合计估算 CNY 5.00；HTTP 400 是否收费未知。真实账单尚未取得，**不得将刊例估算或项目 USD 预留当作实付**。隔离项目当前保留 USD 1.20 待核对预留；没有再提交其他付费任务。单图单镜的产品端到端链路已通过，多参考图、首尾帧、连续多镜身份稳定性仍未验证。
