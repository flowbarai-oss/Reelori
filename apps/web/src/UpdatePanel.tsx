import { useState } from 'react';
import { ArrowSquareOut, ArrowClockwise } from '@phosphor-icons/react';

type UpdateState = {
  current: string;
  latest?: string;
  status: 'current' | 'available' | 'unpublished' | 'unavailable';
  url?: string;
  installable?: boolean;
};

export function UpdatePanel({ lang }: { lang: string }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;

  async function post(action: 'prepare' | 'install') {
    const response = await fetch(`/api/update/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const result = await response.json();
    if (!response.ok) {
      if (result?.code === 'update_prepare_failed')
        throw new Error(t('官方更新下载或校验未完成，请稍后重试。', 'Official update download or verification did not complete. Try again later.'));
      if (result?.code === 'update_install_failed')
        throw new Error(t('已下载的更新未能安全启动，请重新检查更新。', 'The prepared update could not start safely. Check for updates again.'));
      if (result?.code === 'update_not_ready')
        throw new Error(t('当前安装包尚未启用在线安装。', 'Online installation is not enabled for this build.'));
      if (result?.code === 'update_busy')
        throw new Error(t('更新正在准备中，请稍候。', 'An update is already being prepared.'));
      if (result?.code === 'update_work_active')
        throw new Error(t('请先完成正在运行的生成或合成任务。', 'Finish active generation or rendering before installing.'));
      throw new Error(result?.error || t('更新暂不可用', 'Update unavailable'));
    }
    return result;
  }

  async function check() {
    setChecking(true);
    setError('');
    setPrepared(null);
    try {
      const response = await fetch('/api/update');
      if (!response.ok) throw new Error('Update check failed');
      setState(await response.json());
    } catch { setState({ current: '—', status: 'unavailable' }); }
    finally { setChecking(false); }
  }

  async function prepare() {
    setPreparing(true);
    setError('');
    try {
      const result = await post('prepare');
      setPrepared(result.version);
    } catch (cause) { setError((cause as Error).message); }
    finally { setPreparing(false); }
  }

  async function install() {
    if (!window.confirm(t('安装更新会关闭当前工作台。请先保存正在编辑的内容。',
      'Installing the update will close this workspace. Save any edits first.'))) return;
    setInstalling(true);
    setError('');
    try { await post('install'); }
    catch (cause) { setError((cause as Error).message); setInstalling(false); }
  }

  return <section className="panel update-panel">
    <h2><ArrowClockwise size={22} /> {t('版本与更新', 'Version and updates')}</h2>
    <p>{t('仅在你点击时向 FlowbarAI 官方 GitHub 仓库查询新版本，不发送作品或密钥。',
      'Checks the official FlowbarAI GitHub release only when you click. Projects and keys are not sent.')}</p>
    <button className="secondary" disabled={checking || preparing || installing} onClick={check}>
      {checking ? t('正在检查…', 'Checking…') : t('检查更新', 'Check for updates')}
    </button>
    <div aria-live="polite">
      {state && <p>{t('当前版本', 'Current version')}: {state.current} · {
        state.status === 'available' ? t(`发现新版本 ${state.latest}`, `New version ${state.latest} available`) :
        state.status === 'current' ? t('已是最新公开版', 'Up to date with the latest public release') :
        state.status === 'unpublished' ? t('公开更新通道尚未发布', 'Public update channel is not published yet') :
        t('暂时无法检查，请稍后重试', 'Update check unavailable; try again later')
      }</p>}
      {state?.status === 'available' && state.installable && !prepared &&
        <button className="primary" disabled={preparing || installing} onClick={prepare}>
          {preparing ? t('正在下载并验证…', 'Downloading and verifying…') : t('下载并验证更新', 'Download and verify update')}
        </button>}
      {prepared && <p>{t(`版本 ${prepared} 已完成签名和摘要校验。`, `Version ${prepared} passed signature and checksum verification.`)}</p>}
      {prepared && <button className="primary" disabled={installing} onClick={install}>
        {installing ? t('正在关闭并升级…', 'Closing and updating…') : t('安装并重启', 'Install and restart')}
      </button>}
      {state?.status === 'available' && state.url &&
        <a className="secondary" href={state.url} target="_blank" rel="noopener noreferrer">
          {t('查看官方更新与下载', 'View official update and download')} <ArrowSquareOut size={16} />
        </a>}
      {error && <p role="alert">{error}</p>}
    </div>
    <small>{state?.installable
      ? t('仅安装官方发布且通过 SHA-256、生产签名校验，并附有对应源码包的版本。启动失败时会尝试切回旧版。',
          'Only official releases with a matching SHA-256, production signature and corresponding-source asset can install. Startup failure triggers rollback.')
      : t('当前安装包尚未启用自动安装。可在官方发布页查看版本；正式签名与源码材料通过验收后才会开放在线安装。',
          'Automatic installation is not enabled for this build. View releases on GitHub; online installation opens after signing and source review.')}</small>
  </section>;
}
