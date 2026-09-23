const RELEASE_API = 'https://api.github.com/repos/flowbarai-oss/Reelori/releases/latest';
const RELEASE_PAGE = 'https://github.com/flowbarai-oss/Reelori/releases/tag/';

function versionParts(value: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(dev|preview|rc)(?:\.(\d+))?)?$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]),
    match[4] === 'dev' ? -3 : match[4] === 'preview' ? -2 : match[4] === 'rc' ? -1 : 0,
    Number(match[5] ?? 0)];
}

export function newerVersion(current: string, candidate: string) {
  const left = versionParts(current), right = versionParts(candidate);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index++) {
    if (right[index] > left[index]) return true;
    if (right[index] < left[index]) return false;
  }
  return false;
}

export async function checkForUpdate(current: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Reelori-local-update-check' },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return { current, status: 'unpublished' as const };
  if (!response.ok) return { current, status: 'unavailable' as const };
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 65536) return { current, status: 'unavailable' as const };
  const text = await response.text();
  if (text.length > 65536) return { current, status: 'unavailable' as const };
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { return { current, status: 'unavailable' as const }; }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { current, status: 'unavailable' as const };
  const release = data as Record<string, unknown>;
  const tag = release.tag_name;
  if (release.draft === true || typeof tag !== 'string' || !versionParts(tag))
    return { current, status: 'unavailable' as const };
  const latest = newerVersion(current, tag);
  return {
    current, latest: tag,
    status: latest ? 'available' as const : 'current' as const,
    url: latest ? RELEASE_PAGE + encodeURIComponent(tag) : undefined,
  };
}
