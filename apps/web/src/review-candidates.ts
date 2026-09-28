import type { Candidate, Shot } from "../../../packages/contracts/index.ts";

export function currentCandidates(shot: Shot): Candidate[] {
  return shot.candidates
    .filter((candidate) => candidate.inputRevision === shot.revision)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function selectedCandidate(shot: Shot, requestedId: string): Candidate | undefined {
  const candidates = currentCandidates(shot);
  return candidates.find((candidate) => candidate.id === requestedId)
    ?? candidates.find((candidate) => candidate.id === shot.adoptedId)
    ?? candidates[0];
}
