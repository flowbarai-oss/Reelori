import http from "node:http";
import {
  randomBytes,
  randomUUID,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  inspectBackup,
  restoreBackup,
  MAX_BACKUP_BYTES,
} from "../../packages/storage-local/backup.ts";
import {
  saveBackup,
  listBackups,
} from "../../packages/storage-local/backup-files.ts";
import {saveWorkspaceArchive,listWorkspaceArchives,inspectWorkspaceArchive,restoreWorkspaceArchive,MAX_WORKSPACE_BYTES} from '../../packages/storage-local/workspace-backup.ts';
import { createDelivery } from "../../packages/media/delivery.ts";
import { shareCard } from "../../packages/media/share-card.ts";
import {saveAudio} from '../../packages/media/audio.ts';
import {addAudioTrack,editAudioTrack,removeAudioTrack} from '../../packages/core/audio.ts';
import {
  cachedInspector,
  inspectRuntime,
} from "../../packages/media/diagnostics.ts";
import {
  loadProviderConfig,
  loadProviderKey,
  loadAliyunCredential,
} from "../../packages/providers/config.ts";
import type { ProviderConfig } from "../../packages/providers/config.ts";
import {
  catalogRevision,
  validateRouteCatalog,
  saveRouteCatalog,
} from "../../packages/providers/model-routes.ts";
import type { Adapter } from "../../packages/providers/worker.ts";
import { FlowBarAdapter } from "../../packages/providers/flowbar.ts";
import { MiniMaxAdapter } from "../../packages/providers/minimax.ts";
import { AliyunTtsAdapter } from "../../packages/providers/aliyun-tts.ts";
import { adoptProviderAudio } from "../../packages/providers/ledger.ts";
import {setSubtitles} from '../../packages/core/subtitles.ts';
import {reorderShots,trimShot} from '../../packages/core/timeline.ts';
import { createAliyunTokenManager } from "../../packages/providers/aliyun-token.ts";
import {
  makeQuote,
  reserveProvider,
  setProviderBudget,
  reconcileProvider,
  cancelReservedProvider,
} from "../../packages/providers/ledger.ts";
import {
  runProviderJob,
  nextRecoveryJob,
} from "../../packages/providers/worker.ts";
import type { ProviderQuote } from "../../packages/providers/contracts.ts";
import { saveReference } from "../../packages/media/assets.ts";
import { renderAnimatic, listRenders } from "../../packages/media/render.ts";
import { mkdirSync, writeFileSync, readFileSync, renameSync, createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../../packages/storage-local/store.ts";
import { getDataDir } from "../../packages/core/data-dir.ts";
import { checkForUpdate } from "../../packages/core/updates.ts";
import {
  DomainError,
  updateShot,
  confirmPreview,
  queueSample,
  adopt,
  setBudget,
  pause,
  manifest,
  addReference,
} from "../../packages/core/project.ts";

export function createApi(
  store: Store,
  port = 4311,
  webPort = 5178,
  exportDir = path.join(getDataDir(), "exports"),
  providerOptions?: { config: ProviderConfig; key: string; adapter?: Adapter },
) {
  const assetDir = path.join(path.dirname(exportDir), "assets");
  const checkRuntime = cachedInspector(() => inspectRuntime(store, exportDir));
  const startingConfig = providerOptions?.config ?? loadProviderConfig();
  let providerConfig: ProviderConfig = {
    enabled: startingConfig.enabled,
    routes: startingConfig.routes.map((route) => ({
      ...route,
      provider: route.provider ?? "flowbar",
      enabled: route.enabled !== false,
    })),
  };
  const providerKey = providerOptions?.key ?? loadProviderKey();
  const providerAdapter =
    providerOptions?.adapter ?? new FlowBarAdapter(providerKey);
  const minimaxKey = loadProviderKey("minimax"),
    minimaxAdapter = new MiniMaxAdapter(minimaxKey);
  const minimaxCNAdapter = new MiniMaxAdapter(
    minimaxKey,
    undefined,
    undefined,
    "cn",
  );
  const aliyunCredential = loadAliyunCredential();
  // 配置好即可用：静态 token 或 AK/SK 任一种鉴权路径都算"已配置"，不要求两者都有。
  const aliyunKey = aliyunCredential ? aliyunCredential.appkey : "";
  const aliyunTokenManager =
    aliyunCredential?.accessKeyId && aliyunCredential?.accessKeySecret
      ? createAliyunTokenManager(
          aliyunCredential.accessKeyId,
          aliyunCredential.accessKeySecret,
        )
      : null;
  const aliyunAdapter = new AliyunTtsAdapter(
    aliyunCredential?.token ?? "",
    aliyunCredential?.appkey ?? "",
    undefined,
    aliyunTokenManager ? () => aliyunTokenManager.getToken() : undefined,
  );
  const keyFor = (provider?: string) =>
    provider === "aliyun"
      ? aliyunKey
      : provider?.startsWith("minimax")
        ? minimaxKey
        : providerKey;
  const adapterFor = (provider?: string) =>
    provider === "aliyun"
      ? aliyunAdapter
      : provider === "minimax-cn"
        ? minimaxCNAdapter
        : provider === "minimax"
          ? minimaxAdapter
          : providerAdapter;
  const quotes = new Map<string, { projectId: string; quote: ProviderQuote }>();
  let providerBusy = false;
  let routeEditBusy = false;
  let rendering: string | null = null;
  let transferring = false,
    decoding = false;
  const session = randomBytes(32).toString("hex");
  const hosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `127.0.0.1:${webPort}`,
    `localhost:${webPort}`,
  ]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status: number, data: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    if (
      !hosts.has(req.headers.host ?? "") ||
      (req.headers.origin && !origins.has(req.headers.origin)) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return send(403, { error: "请求来源不受信任" });
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/session" && req.method === "GET") {
      res.setHeader(
        "Set-Cookie",
        `drama_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return send(200, { mode: "local-sample" });
    }
    if (
      !req.headers.cookie
        ?.split(";")
        .some((c) => c.trim() === `drama_session=${session}`)
    )
      return send(401, { error: "本地会话已过期，请刷新页面" });
    if (req.method === "GET" && url.pathname === "/api/update") {
      const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
      try { return send(200, await checkForUpdate(version)); }
      catch { return send(200, { current: version, status: "unavailable" }); }
    }
    const projectId = url.searchParams.get("projectId") ?? "sample";
    if (req.method === "GET" && url.pathname === "/api/provider")
      return send(200, {
        provider: "FlowBar AI",
        configured: providerConfig.enabled,
        configRevision: catalogRevision(providerConfig),
        keyConfigured: !!(providerKey || minimaxKey || aliyunKey),
        credentials: {
          flowbar: !!providerKey,
          minimax: !!minimaxKey,
          aliyun: !!aliyunKey,
        },
        routes: providerConfig.routes.filter(
          (r) => r.enabled !== false && r.expiresAt > Date.now(),
        ),
        catalogRoutes: providerConfig.routes,
        busy: providerBusy,
        protocolValidation: "local-fixtures-only",
      });
    if (req.method === "GET" && url.pathname === "/api/backups") {
      try {
        store.get(projectId);
        return send(200, await listBackups(projectId, exportDir));
      } catch (e) {
        return send(e instanceof DomainError ? e.status : 500, {
          error: "无法读取备份记录",
        });
      }
    }
    if(req.method==='GET'&&url.pathname==='/api/workspace-backups'){
      try{return send(200,await listWorkspaceArchives(path.dirname(exportDir)));}
      catch{return send(500,{error:'无法读取工作区备份记录'});}
    }
    if(req.method==='GET'&&url.pathname==='/api/workspace-download'){
      const id=url.searchParams.get('id')??'';
      if(!/^[a-f0-9-]{36}$/.test(id))return send(400,{error:'工作区备份标识无效'});
      const file=path.join(path.dirname(exportDir),'workspace-backups',id+'.workspace');
      try{const size=statSync(file).size;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Length',size);res.setHeader('Content-Disposition',`attachment; filename="reelori-workspace-${id}.workspace"`);const stream=createReadStream(file);stream.on('error',()=>res.destroy());return stream.pipe(res);}
      catch{return send(404,{error:'工作区备份不存在'});}
    }
    if (req.method === "GET" && url.pathname === "/api/exports") {
      try {
        store.get(projectId);
        return send(200, {
          outputs: await listRenders(exportDir, projectId),
          rendering: rendering === projectId,
        });
      } catch (e) {
        return send(e instanceof DomainError ? e.status : 500, {
          error: "无法读取合成记录",
        });
      }
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/assets/")) {
      const name = url.pathname.slice("/api/assets/".length);
      if (!/^[a-f0-9]{64}\.(png|jpg|mp4|wav)$/.test(name))
        return send(400, { error: "素材标识无效" });
      try {
        const bytes = readFileSync(path.join(assetDir, name));
        res.setHeader(
          "Content-Type",
          name.endsWith('.wav')?'audio/wav':name.endsWith(".mp4")
            ? "video/mp4"
            : name.endsWith(".png")
              ? "image/png"
              : "image/jpeg",
        );
        return res.end(bytes);
      } catch {
        return send(404, { error: "素材不存在" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/projects")
      return send(200, store.list());
    if (req.method === "GET" && url.pathname === "/api/project") {
      try {
        return send(200, store.get(projectId));
      } catch (e) {
        return send(e instanceof DomainError ? e.status : 500, {
          error: (e as Error).message,
        });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/download") {
      const id = url.searchParams.get("id") ?? "";
      const format = url.searchParams.get("format") ?? "json";
      if (
        !/^[a-f0-9-]{36}$/.test(id) ||
        !["json", "mp4", "srt", "vtt", "backup", "zip"].includes(format)
      )
        return send(400, { error: "导出标识无效" });
      try {
        const data = readFileSync(path.join(exportDir, `${id}.${format}`));
        res.setHeader(
          "Content-Type",
          (
            {
              json: "application/json; charset=utf-8",
              mp4: "video/mp4",
              srt: "application/x-subrip; charset=utf-8",
              vtt: "text/vtt; charset=utf-8",
              backup: "application/json; charset=utf-8",
              zip: "application/zip",
            } as Record<string, string>
          )[format],
        );
        res.setHeader(
          "Content-Disposition",
          `${format === "vtt" ? "inline" : "attachment"}; filename="reelori-${id}.${format === "backup" ? "reelori.json" : format}"`,
        );
        return res.end(data);
      } catch {
        return send(404, { error: "导出文件不存在" });
      }
    }
    if (req.method === "GET" && url.pathname === "/api/manifest") {
      try {
        return send(200, manifest(store.get(projectId)));
      } catch (e) {
        return send(409, { error: (e as Error).message });
      }
    }
    if (
      req.method !== "POST" ||
      !req.headers.origin ||
      !origins.has(req.headers.origin)
    )
      return send(403, { error: "写入请求必须来自本地工作台" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return send(415, { error: "需要 JSON 请求" });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (
          size >
          (["/api/backup-inspect", "/api/restore"].includes(url.pathname)
            ? MAX_BACKUP_BYTES + 4096
            : ['/api/workspace-inspect','/api/workspace-restore'].includes(url.pathname) ? MAX_WORKSPACE_BYTES+4096
            : url.pathname === '/api/audio' ? 14*1024*1024+4096 : url.pathname === "/api/reference"
              ? 7 * 1024 * 1024 + 4096
              : 262144)
        )
          throw new DomainError("请求过大", 413);
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (url.pathname === "/api/diagnostics")
        return send(200, await checkRuntime());
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new DomainError("请求格式不正确");
      if (url.pathname === "/api/provider-routes") {
        if (routeEditBusy)
          throw new DomainError("模型配置正在保存，请稍后重试", 409);
        if (
          typeof body.revision !== "string" ||
          body.revision !== catalogRevision(providerConfig)
        )
          throw new DomainError("模型配置已变化，请刷新后再保存", 409);
        const next = validateRouteCatalog(body.routes);
        routeEditBusy = true;
        try {
          await saveRouteCatalog(
            path.join(path.dirname(exportDir), "flowbar.json"),
            next,
          );
          providerConfig = next;
          quotes.clear();
          return send(200, {
            configured: next.enabled,
            keyConfigured: !!(providerKey || minimaxKey || aliyunKey),
            credentials: {
              flowbar: !!providerKey,
              minimax: !!minimaxKey,
              aliyun: !!aliyunKey,
            },
            routes: next.routes.filter(
              (r) => r.enabled !== false && r.expiresAt > Date.now(),
            ),
            catalogRoutes: next.routes,
            configRevision: catalogRevision(next),
          });
        } finally {
          routeEditBusy = false;
        }
      }
      if(url.pathname==='/api/audio-track')return send(200,store.transact(p=>editAudioTrack(p,body.id,{offsetMs:body.offsetMs,volume:body.volume},body.revision),projectId));
      if(url.pathname==='/api/audio-remove')return send(200,store.transact(p=>removeAudioTrack(p,body.id,body.revision),projectId));
      if(url.pathname==='/api/audio'){
        if(providerBusy||transferring||rendering||decoding)throw new DomainError('已有媒体任务，请稍后重试',409);
        if(typeof body.data!=='string'||body.data.length>14*1024*1024||body.data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.data))throw new DomainError('音频编码无效');
        const meta={name:body.name,kind:body.kind,rights:body.rights,offsetMs:body.offsetMs,volume:body.volume};
        addAudioTrack(structuredClone(store.get(projectId)),{...meta,audio:'/api/assets/'+'0'.repeat(64)+'.wav',durationMs:100},body.revision);
        decoding=true;try{const saved=await saveAudio(Buffer.from(body.data,'base64'),assetDir);return send(200,store.transact(p=>addAudioTrack(p,{...meta,...saved},body.revision),projectId));}finally{decoding=false;}
      }
      if (url.pathname === "/api/provider-audio-adopt")
        return send(200, store.transact(p => adoptProviderAudio(p, body.jobId, body.revision), projectId));
      if (url.pathname === "/api/subtitles")
        return send(200, store.transact(p => setSubtitles(p, body.cues, body.revision), projectId));
      if (url.pathname === "/api/provider-budget")
        return send(
          200,
          store.transact(
            (p) => setProviderBudget(p, body.micros, body.revision),
            projectId,
          ),
        );
      if (url.pathname === "/api/provider-cancel")
        return send(
          200,
          store.transact(
            (p) => cancelReservedProvider(p, body.jobId, body.revision),
            projectId,
          ),
        );
      if (url.pathname === "/api/provider-reconcile")
        return send(
          200,
          store.transact(
            (p) =>
              reconcileProvider(
                p,
                body.jobId,
                body.actualMicros,
                body.evidence,
                body.revision,
              ),
            projectId,
          ),
        );
      if (url.pathname === "/api/provider-quote") {
        if (!providerConfig.enabled)
          throw new DomainError("请先在本机配置模型连接与核实价格", 409);
        const route = providerConfig.routes.find(
          (r) =>
            r.id === body.routeId &&
            r.enabled !== false &&
            r.expiresAt > Date.now(),
        );
        if (!route) throw new DomainError("模型报价不可用或已过期", 409);
        if (!keyFor(route.provider))
          throw new DomainError("此通道密钥未配置", 409);
        const p = store.get(projectId);
        if (p.revision !== body.revision)
          throw new DomainError("项目版本已变化", 409);
        const quote = makeQuote(p, body.shotId, route);
        quote.expiresAt = Math.min(quote.expiresAt, route.expiresAt);
        if (quote.input.provider === "minimax-cn")
          minimaxCNAdapter.validate(quote.input);
        else if (quote.input.provider === "minimax")
          minimaxAdapter.validate(quote.input);
        else if (quote.input.provider === "aliyun")
          new AliyunTtsAdapter("", "").validate(quote.input);
        else new FlowBarAdapter("").validate(quote.input);
        for (const [id, q] of quotes)
          if (q.quote.expiresAt < Date.now()) quotes.delete(id);
        if (quotes.size >= 200)
          throw new DomainError("报价过多，请稍后重试", 429);
        quotes.set(quote.id, { projectId, quote });
        return send(200, quote);
      }
      if (url.pathname === "/api/provider-submit") {
        const previous = store
          .get(projectId)
          .provider?.jobs.find((j) => j.operationId === body.operationId);
        const saved = quotes.get(body.quoteId);
        const quote =
          saved?.projectId === projectId
            ? saved.quote
            : previous && previous.quote.id === body.quoteId
              ? previous.quote
              : undefined;
        if (!quote) throw new DomainError("报价失效，请重新查看报价", 409);
        if (!keyFor(quote.input.provider) || !providerConfig.enabled)
          throw new DomainError("模型连接未配置", 409);
        const next = store.transact(
          (p) => reserveProvider(p, quote, body.operationId, body.revision),
          projectId,
        );
        return send(200, next);
      }
      if (url.pathname === "/api/provider-run") {
        if (!providerConfig.enabled)
          throw new DomainError("模型连接未配置", 409);
        if (providerBusy || transferring || rendering || decoding)
          throw new DomainError("已有媒体任务，请稍后核对", 409);
        const job = store
          .get(projectId)
          .provider?.jobs.find((j) => j.id === body.jobId);
        if (!job) throw new DomainError("任务不存在", 404);
        if (!keyFor(job.quote.input.provider))
          throw new DomainError("此通道密钥未配置", 409);
        if (
          job.state === "reserved" &&
          !providerConfig.routes.some(
            (r) =>
              r.model === job.quote.input.model &&
              r.enabled !== false &&
              r.kind === job.quote.input.kind &&
              r.size === job.quote.input.size &&
              r.upperMicros === job.quote.upperMicros &&
              (r.provider ?? "flowbar") ===
                (job.quote.input.provider ?? "flowbar") &&
              r.pricingVersion === job.quote.pricingVersion &&
              r.expiresAt > Date.now(),
          )
        )
          throw new DomainError("价格配置已变化，禁止派单", 409);
        providerBusy = true;
        try {
          await runProviderJob(
            store,
            projectId,
            job.id,
            adapterFor(job.quote.input.provider),
            assetDir,
          );
          return send(200, store.get(projectId));
        } finally {
          providerBusy = false;
        }
      }
      if (
        [
          "/api/backup",
          "/api/backup-inspect",
          "/api/restore",
          "/api/workspace-backup",
          "/api/workspace-inspect",
          "/api/workspace-restore",
          "/api/delivery",
        ].includes(url.pathname)
      ) {
        if (providerBusy || transferring || rendering || decoding)
          throw new DomainError("已有本地媒体或备份任务，请等待完成", 409);
        transferring = true;
        try {
          if (url.pathname === "/api/backup") {
            if (store.get(projectId).revision !== body.revision)
              throw new DomainError("项目已更新，请重新创建备份", 409);
            return send(
              200,
              await saveBackup(store, projectId, assetDir, exportDir),
            );
          }
          if(url.pathname==='/api/workspace-backup')return send(200,await saveWorkspaceArchive(store,path.dirname(exportDir)));
          if (url.pathname === "/api/delivery") {
            store.get(projectId);
            return send(
              200,
              await createDelivery(
                body.snapshotId,
                projectId,
                exportDir,
                assetDir,
              ),
            );
          }
          const signature = (archive: unknown, expiresAt: number) =>
            createHmac("sha256", session)
              .update(JSON.stringify(archive))
              .update(":" + expiresAt)
              .digest("hex");
          if (url.pathname === "/api/backup-inspect") {
            const details = inspectBackup(body.archive),
              expiresAt = Date.now() + 10 * 60 * 1000;
            return send(200, {
              ...details,
              confirmation: {
                expiresAt,
                token: signature(body.archive, expiresAt),
              },
            });
          }
          if(url.pathname==='/api/workspace-inspect'){
            const details=await inspectWorkspaceArchive(body.archive),expiresAt=Date.now()+10*60*1000;
            return send(200,{...details,confirmation:{expiresAt,token:signature(body.archive,expiresAt)}});
          }
          if (
            !Number.isSafeInteger(body.expiresAt) ||
            body.expiresAt < Date.now() ||
            typeof body.token !== "string" ||
            !/^[a-f0-9]{64}$/.test(body.token) ||
            !body.archive ||
            !timingSafeEqual(
              Buffer.from(body.token, "hex"),
              Buffer.from(signature(body.archive, body.expiresAt), "hex"),
            )
          )
            throw new DomainError(
              "备份未检查、内容已改变或检查已过期，请重新检查",
            );
          return send(201,url.pathname==='/api/workspace-restore'
            ? await restoreWorkspaceArchive(body.archive,path.join(path.dirname(exportDir),'restored-workspaces'))
            : await restoreBackup(store, body.archive, assetDir));
        } finally {
          transferring = false;
        }
      }
      if (url.pathname === "/api/projects")
        return send(201, store.create(body));
      if (url.pathname === "/api/render") {
        if (providerBusy || rendering || transferring || decoding)
          throw new DomainError("已有本地合成任务，请等待完成", 409);
        const p = store.get(projectId);
        if (p.revision !== body.revision)
          throw new DomainError("项目已更新，请刷新后重新合成", 409);
        rendering = projectId;
        try {
          return send(
            200,
            await renderAnimatic(p, exportDir, {
              audioMode: body.audioMode,
              volume: body.volume,
            }),
          );
        } finally {
          rendering = null;
        }
      }
      if (url.pathname === "/api/share-card") {
        if (
          typeof body.snapshotId !== "string" ||
          !/^[a-f0-9-]{36}$/.test(body.snapshotId) ||
          typeof body.includeTitle !== "boolean"
        )
          throw new DomainError("分享卡参数无效");
        const snapshot = JSON.parse(
          readFileSync(path.join(exportDir, body.snapshotId + ".json"), "utf8"),
        );
        if (snapshot.projectId !== projectId)
          throw new DomainError("成片不属于当前项目", 404);
        return send(200, {
          svg: shareCard(snapshot, { includeTitle: body.includeTitle }),
          snapshotId: body.snapshotId,
        });
      }
      if (url.pathname === "/api/reference") {
        if (providerBusy || rendering || transferring || decoding)
          throw new DomainError("已有本地媒体任务，请稍后再上传", 409);
        const ref = {
          id: randomUUID(),
          name: body.name,
          rights: body.rights,
          note: body.note,
          createdAt: Date.now(),
          image: "",
        };
        addReference(structuredClone(store.get(projectId)), ref, body.revision);
        decoding = true;
        let asset;
        try {
          asset = await saveReference(body.data, assetDir);
        } finally {
          decoding = false;
        }
        return send(
          200,
          store.transact(
            (p) =>
              addReference(p, { ...ref, image: asset.image }, body.revision),
            projectId,
          ),
        );
      }
      if (url.pathname === "/api/export") {
        const p = store.get(projectId);
        if (body.revision !== p.revision)
          throw new DomainError("项目已更新，请刷新后导出", 409);
        const output = manifest(p);
        mkdirSync(exportDir, { recursive: true });
        const file = path.join(exportDir, `${output.snapshotId}.json`);
        writeFileSync(`${file}.tmp`, JSON.stringify(output, null, 2), "utf8");
        renameSync(`${file}.tmp`, file);
        return send(200, {
          file,
          download: `/api/download?id=${output.snapshotId}`,
        });
      }
      const result = store.transact((p) => {
        switch (url.pathname) {
          case "/api/shot":
            updateShot(p, body.id, body.patch, body.revision);
            break;
          case "/api/shot-order":
            reorderShots(p, body.ids, body.revision);
            break;
          case "/api/shot-trim":
            trimShot(p, body.id, body.start, body.end, body.revision);
            break;
          case "/api/preview":
            confirmPreview(p, body.revision);
            break;
          case "/api/generate":
            queueSample(p, body.ids, body.operationId, body.revision);
            break;
          case "/api/adopt":
            adopt(p, body.shotId, body.candidateId, body.revision);
            break;
          case "/api/budget":
            setBudget(p, body.cents, body.revision);
            break;
          case "/api/pause":
            if (typeof body.value !== "boolean")
              throw new DomainError("状态格式不正确");
            pause(p, body.value);
            break;
          default:
            throw new DomainError("接口不存在", 404);
        }
      }, projectId);
      send(200, result);
    } catch (e) {
      if (e instanceof DomainError) send(e.status, { error: e.message });
      else if (e instanceof SyntaxError) send(400, { error: "JSON 格式错误" });
      else {
        console.error("Local request failed", (e as Error).name);
        send(500, { error: "本地服务处理失败" });
      }
    }
  });
  const recovery = setInterval(async () => {
    if (
      !server.listening ||
      !(providerKey || minimaxKey) ||
      !providerConfig.enabled ||
      providerBusy ||
      rendering ||
      transferring ||
      decoding
    )
      return;
    providerBusy = true;
    try {
      const next = nextRecoveryJob(store);
      if (next) {
        const job = store
          .get(next.projectId)
          .provider!.jobs.find((j) => j.id === next.jobId)!;
        if (keyFor(job.quote.input.provider))
          await runProviderJob(
            store,
            next.projectId,
            next.jobId,
            adapterFor(job.quote.input.provider),
            assetDir,
          );
      }
    } catch {
      console.error("Provider recovery paused until next check");
    } finally {
      providerBusy = false;
    }
  }, 2000);
  recovery.unref();
  server.on("close", () => clearInterval(recovery));
  return server;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(path.join(dataDir, "studio.sqlite"));
  const port = Number(process.env.REELORI_PORT) || 4311;
  const webPort = Number(process.env.REELORI_WEB_PORT) || 5178;
  const server = createApi(store, port, webPort, path.join(dataDir, "exports"));
  const timer = setInterval(() => {
    try {
      store.tick();
    } catch (e) {
      console.error("Sample scheduler error", (e as Error).name);
    }
  }, 400);
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `端口 ${port} 已被占用，本地 API 无法启动。请先结束占用该端口的进程，或设置环境变量 REELORI_PORT 换一个端口后重试。`,
      );
      clearInterval(timer);
      store.close();
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Local sample API http://127.0.0.1:${port}`),
  );
  const stop = () => {
    clearInterval(timer);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
