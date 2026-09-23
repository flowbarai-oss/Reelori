import { useState } from 'react';
import { ArrowSquareOut, ArrowClockwise } from '@phosphor-icons/react';

type UpdateState = {
  current: string;
  latest?: string;
  status: 'current' | 'available' | 'unpublished' | 'unavailable';
  url?: string;
};

export function UpdatePanel({ lang }: { lang: string }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  async function check() {
    setChecking(true);
    try {
      const response = await fetch('/api/update');
      if (!response.ok) throw new Error('update check failed');
      setState(await response.json());
    } catch { setState({ current: '—', status: 'unavailable' }); }
    finally { setChecking(false); }
  }
  return <section className="panel update-panel">
    <h2><ArrowClockwise size={22} /> {t('版本与更新', 'Version and updates')}</h2>
    <p>{t('仅在你点击时向 FlowbarAI 官方 GitHub 仓库查询新版本，不发送作品或密钥。',
      'Checks the official FlowbarAI GitHub release only when you click. Projects and keys are not sent.')}</p>
    <button className="secondary" disabled={checking} onClick={check}>
      {checking ? t('正在检查…', 'Checking…') : t('检查更新', 'Check for updates')}
    </button>
    <div aria-live="polite">
      {state && <p>{t('当前版本', 'Current version')}: {state.current} · {
        state.status === 'available' ? t(`发现新版本 ${state.latest}`, `New version ${state.latest} available`) :
        state.status === 'current' ? t('已是最新公开版', 'Up to date with the latest public release') :
        state.status === 'unpublished' ? t('公开更新通道尚未发布', 'Public update channel is not published yet') :
        t('暂时无法检查，请稍后重试', 'Update check unavailable; try again later')
      }</p>}
      {state?.status === 'available' && state.url &&
        <a className="secondary" href={state.url} target="_blank" rel="noopener noreferrer">
          {t('查看官方更新与下载', 'View official update and download')} <ArrowSquareOut size={16} />
        </a>}
    </div>
    <small>{t('当前版本需从官方发布页下载安装。自动安装与回退通过验收后才会开放。升级前请保留工作区备份。',
      'Install from the official release page for now. Automatic installation will be enabled only after rollback validation. Keep a workspace backup before upgrading.')}</small>
  </section>;
}
