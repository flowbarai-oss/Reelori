import { useEffect, useRef, useState } from "react";
import {
  Archive,
  DownloadSimple,
  UploadSimple,
  CheckCircle,
} from "@phosphor-icons/react";
import type { Project } from "../../../packages/contracts/index.ts";
type Record = {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  download: string;
};
type Inspection = {
  title: string;
  shots: number;
  media: number;
  revisions: number;
  bytes: number;
  inFlight: number;
  confirmation: { token: string; expiresAt: number };
};
type WorkspaceRecord={id:string;projects:number;renders:number;assets:number;files:number;bytes:number;createdAt:string;download:string};
type WorkspaceInspection=Omit<WorkspaceRecord,'id'|'download'>&{confirmation:{token:string;expiresAt:number}};
export function BackupPanel({
  project,
  lang,
  request,
  onRestored,
}: {
  project: Project;
  lang: string;
  request: (route: string, body?: unknown) => Promise<any>;
  onRestored: (p: Project) => void;
}) {
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [history, setHistory] = useState<Record[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [archive, setArchive] = useState<unknown>(null);
  const [workspaceHistory,setWorkspaceHistory]=useState<WorkspaceRecord[]>([]);
  const [workspaceInspection,setWorkspaceInspection]=useState<WorkspaceInspection|null>(null);
  const [workspaceArchive,setWorkspaceArchive]=useState<unknown>(null);
  const [workspaceResult,setWorkspaceResult]=useState('');
  const live = useRef(true);
  const epoch = useRef(0);
  useEffect(() => {
    live.current = true;
    request("backups")
      .then((rows) => {
        if (live.current) setHistory(rows);
      })
      .catch((e) => {
        if (live.current) setError(e.message);
      });
    request('workspace-backups').then(rows=>{if(live.current)setWorkspaceHistory(rows);}).catch(e=>{if(live.current)setError(e.message);});
    return () => {
      live.current = false;
      epoch.current++;
    };
  }, [project.id]);
  return (
    <section className="panel backup-panel">
      <h2>
        <Archive size={23} />
        {t("备份与恢复", "Backup & restore")}
      </h2>
      <p className="fine">
        {t(
          "备份包含私人创作内容，请妥善保存。工作区备份包含已合成视频；单项目备份不包含成片。模型密钥与本机连接配置均不在备份内。",
          "Backups contain private creative work. Workspace backups include rendered films; single-project backups do not. Model keys and local connection settings are excluded.",
        )}
      </p>
      <h3>{t('完整工作区','Entire workspace')}</h3>
      <p className="fine">{t('包含全部项目、版本、媒体、成片及已有项目备份；不包含模型密钥、本机连接配置和开发脚本。恢复会创建独立工作区并暂停其中的任务。单次归档上限 256 MiB。','Includes all projects, revisions, media, rendered films and existing project backups. Model keys, local connection settings and development scripts are excluded. Restore creates a separate workspace with jobs paused. Archive limit: 256 MiB.')}</p>
      <button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const result=await request('workspace-backup',{});if(live.current){setWorkspaceHistory(rows=>[result,...rows]);const a=document.createElement('a');a.href=result.download;a.download=`reelori-workspace-${result.id}.workspace`;a.click();}}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}}><DownloadSimple size={18}/>{t('备份整个工作区','Back up entire workspace')}</button>
      {workspaceHistory.length>0&&<div className="backup-history">{workspaceHistory.map(row=><a key={row.id} href={row.download} download><span>{new Date(row.createdAt).toLocaleString(lang==='zh'?'zh-CN':'en-US')} · {row.projects} {t('项目','projects')} · {row.renders} {t('成片','films')}</span><DownloadSimple size={18}/></a>)}</div>}
      <label className="secondary file-button"><UploadSimple size={18}/>{t('检查工作区备份','Inspect workspace backup')}<input type="file" accept=".workspace,application/json" disabled={busy} aria-label={t('选择工作区备份','Choose workspace backup')} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;const serial=++epoch.current;setBusy(true);setError('');setWorkspaceInspection(null);setWorkspaceArchive(null);setWorkspaceResult('');try{if(file.size>256*1024*1024)throw new Error(t('工作区备份超过 256 MiB 上限','Workspace backup exceeds 256 MiB'));const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));const result=await request('workspace-inspect',{archive:data});if(live.current&&serial===epoch.current){setWorkspaceArchive(data);setWorkspaceInspection(result);}}catch(err){if(live.current&&serial===epoch.current)setError((err as Error).message);}finally{if(live.current&&serial===epoch.current)setBusy(false);e.target.value='';}}}/></label>
      {workspaceInspection&&<div className="restore-summary"><h3><CheckCircle size={20}/>{t('工作区备份已通过检查','Workspace backup verified')}</h3><p>{workspaceInspection.projects} {t('项目','projects')} · {workspaceInspection.renders} {t('成片','films')} · {workspaceInspection.assets} {t('素材','assets')}</p><p className="fine">{t('恢复到新目录，当前作品不被覆盖。新工作区中的任务全部暂停；切换目录将在安装/升级流程中接入。','Restores to a new directory without replacing current work. All jobs in the new workspace are paused. Workspace switching will be integrated with installation and updates.')}</p><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const result=await request('workspace-restore',{archive:workspaceArchive,...workspaceInspection.confirmation});if(live.current){setWorkspaceResult(result.path);setWorkspaceInspection(null);setWorkspaceArchive(null);}}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}}>{t('恢复为独立工作区','Restore separate workspace')}</button></div>}
      {workspaceResult&&<p role="status" className="fine">{t('已恢复到：','Restored to:')} {workspaceResult}</p>}
      <hr />
      <h3>{t('当前项目备份','Current project backup')}</h3>
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await request("backup", {
              revision: project.revision,
            });
            if (live.current) setHistory((rows) => [result, ...rows]);
          } catch (e) {
            if (live.current) setError((e as Error).message);
          } finally {
            if (live.current) setBusy(false);
          }
        }}
      >
        <DownloadSimple size={18} />
        {busy
          ? t("正在处理…", "Working…")
          : t("创建项目备份", "Create project backup")}
      </button>
      {history.length > 0 && (
        <div className="backup-history">
          {history.map((row) => (
            <a key={row.id} href={row.download} download>
              <span>
                {new Date(row.createdAt).toLocaleString(
                  lang === "zh" ? "zh-CN" : "en-US",
                )}{" "}
                · v{row.revision}
              </span>
              <DownloadSimple size={18} />
            </a>
          ))}
        </div>
      )}
      <hr />
      <h3>{t("从备份恢复副本", "Restore a project copy")}</h3>
      <label className="secondary file-button">
        <UploadSimple size={18} />
        {t("选择并检查备份", "Choose and inspect backup")}
        <input
          type="file"
          accept=".json,.backup,application/json"
          disabled={busy}
          aria-label={t("选择 Reelori 备份", "Choose Reelori backup")}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const serial = ++epoch.current;
            setBusy(true);
            setError("");
            setInspection(null);
            setArchive(null);
            try {
              if (file.size > 96 * 1024 * 1024)
                throw new Error(
                  t("备份超过 96 MiB 上限", "Backup exceeds the 96 MiB limit"),
                );
              const data = JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(
                  await file.arrayBuffer(),
                ),
              );
              const result = await request("backup-inspect", { archive: data });
              if (live.current && serial === epoch.current) {
                setArchive(data);
                setInspection(result);
              }
            } catch (err) {
              if (live.current && serial === epoch.current)
                setError((err as Error).message);
            } finally {
              if (live.current && serial === epoch.current) setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {inspection && (
        <div className="restore-summary">
          <h3>
            <CheckCircle size={20} />
            {inspection.title}
          </h3>
          <p>
            {inspection.shots} {t("镜头", "shots")} · {inspection.media}{" "}
            {t("媒体素材", "media files")} · {inspection.revisions}{" "}
            {t("历史版本", "revisions")}
          </p>
          <p className="fine">
            {t(
              "恢复为独立项目，不覆盖已有作品。所有任务暂停；在途任务保留预留费用并转为待核对。",
              "Restore as a separate project without overwriting existing work. Jobs remain paused; in-flight jobs retain reservations and require reconciliation.",
            )}
          </p>
          {inspection.inFlight > 0 && (
            <p>
              {t(
                `有 ${inspection.inFlight} 个任务需要核对`,
                `There are ${inspection.inFlight} jobs to reconcile`,
              )}
            </p>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const p = await request("restore", {
                  archive,
                  ...inspection.confirmation,
                });
                if (live.current) {
                  setInspection(null);
                  setArchive(null);
                  onRestored(p);
                }
              } catch (e) {
                if (live.current) setError((e as Error).message);
              } finally {
                if (live.current) setBusy(false);
              }
            }}
          >
            {t("恢复为新项目", "Restore as new project")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </section>
  );
}
