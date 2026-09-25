import { DomainError } from "../core/project.ts";
import { MAX_FILM_SECONDS, MAX_FILM_SHOTS } from "../core/film-limits.ts";
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function shareCard(
  snapshot: { project: string; durationSeconds: number; shots: unknown[] },
  options: { includeTitle?: boolean } = {},
) {
  if (
    !Number.isFinite(snapshot.durationSeconds) ||
    snapshot.durationSeconds <= 0 ||
    snapshot.durationSeconds > MAX_FILM_SECONDS ||
    !Array.isArray(snapshot.shots) ||
    snapshot.shots.length < 1 ||
    snapshot.shots.length > MAX_FILM_SHOTS
  )
    throw new DomainError("成片信息无效");
  const title = options.includeTitle
    ? String(snapshot.project).slice(0, 28)
    : "A story worth telling.";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="Reelori film card">
 <defs><linearGradient id="light" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#273625"/><stop offset="1" stop-color="#a9c77b"/></linearGradient><radialGradient id="glow"><stop stop-color="#d1eb9d" stop-opacity=".5"/><stop offset="1" stop-color="#111512" stop-opacity="0"/></radialGradient></defs>
 <rect width="1080" height="1350" fill="#111512"/><circle cx="740" cy="510" r="510" fill="url(#glow)"/>
 <path d="M240 740V410Q240 290 360 290H725Q840 290 840 405V740Z" fill="url(#light)"/><path d="M405 455L405 660L610 558Z" fill="#eff5df"/>
 <path d="M150 805H930" stroke="#68715c"/><text x="90" y="125" fill="#d1eb9d" font-size="42" font-family="sans-serif" letter-spacing="4">REELORI</text>
 <text x="90" y="885" fill="#9eaa91" font-size="22" font-family="sans-serif" letter-spacing="5">MADE IN YOUR CREATIVE SPACE</text>
 <text x="90" y="966" fill="#f3f4e9" font-size="${title.length > 18 ? 36 : 52}" font-family="serif">${escape(title)}</text>
 <text x="90" y="1080" fill="#d1eb9d" font-size="52" font-family="sans-serif">${snapshot.durationSeconds} s</text><text x="320" y="1080" fill="#d1eb9d" font-size="52" font-family="sans-serif">${snapshot.shots.length} shots</text>
 <text x="90" y="1220" fill="#a7ae9e" font-size="26" font-family="sans-serif">幕芽 · AI Short Film Studio</text><text x="90" y="1270" fill="#68715c" font-size="20" font-family="sans-serif">Your story. Your final frame.</text></svg>`;
}
