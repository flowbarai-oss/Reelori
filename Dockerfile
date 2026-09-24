FROM node:24-bookworm-slim

# 用 Debian 官方仓库的 ffmpeg 包，不打包 Windows 开发机的 imageio-ffmpeg 二进制。
# 用户自行构建与项目发布包含 FFmpeg 的镜像是不同的分发方式。
# 发布镜像前仍须核对实际软件包许可、对应源码和 NOTICE；apt 来源不豁免该检查。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先只拷贝 lockfile 相关文件装依赖，能命中 Docker 层缓存，源码改动不用重装依赖。
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci

COPY . .

ENV NODE_ENV=production
ENV REELORI_FFMPEG=/usr/bin/ffmpeg
# 数据目录必须挂载卷才能持久化；不挂载的话容器重建会丢项目数据。
VOLUME ["/app/data"]

# 后端 API（apps/local-service/server.ts）和 vite dev server 都硬编码监听 127.0.0.1，
# 这是任务书第 10 节明确要求保留的安全边界（回环绑定不能为了方便被关闭），本次没有改。
# 后果：这个镜像只能用 `docker run --network host` 在同一台机器上运行——容器和宿主机
# 共享网络命名空间，容器内的 127.0.0.1 就是宿主机的 127.0.0.1，浏览器直接访问
# http://127.0.0.1:5178 即可，不需要端口映射。这不是"容器化远程访问"方案：真正的
# 远程/多机访问需要先做认证和 HTTPS，这次没做，不能通过改成监听 0.0.0.0 绕过这一点。
# --network host 在 Linux 上原生支持；Windows/Mac 的 Docker Desktop 用的是虚拟化网络，
# host 模式不完全等效，跨平台行为需要用户自己在对应平台验证。
EXPOSE 4311 5178
CMD ["node", "scripts/dev.mjs"]
