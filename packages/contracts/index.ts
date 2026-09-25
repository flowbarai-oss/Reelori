export type Page =
  | "home"
  | "storyboard"
  | "characters"
  | "preview"
  | "progress"
  | "results"
  | "settings";
export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "cancelled"
  | "unknown";
export interface Candidate {
  id: string;
  image: string;
  createdAt: number;
  inputRevision: number;
  mode: "sample" | "provider";
  video?: string;
}
export interface Shot {
  id: string;
  sceneId?: string;
  characterIds?: string[];
  clipStartSeconds?: number;
  sourceSeconds?: number;
  title: string;
  description: string;
  dialogue: string;
  seconds: number;
  frame: string;
  image: string;
  locked: boolean;
  revision: number;
  candidates: Candidate[];
  adoptedId: string | null;
  review: "pending" | "accepted";
}
export interface Job {
  id: string;
  operationId: string;
  shotId: string;
  shotRevision: number;
  referenceRevision: number;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  reservedCents: number;
  settledCents: number;
  stage: number;
}
export interface Snapshot {
  id: string;
  inputRevision: number;
  referenceRevision: number;
  shots: Shot[];
  scenes?: Scene[];
  characters?: Character[];
  createdAt: number;
}
export interface SeriesLink {
  id: string;
  title: string;
  episode: number;
}
export interface Scene {
  id: string;
  name: string;
  location: string;
  notes: string;
}
export interface Character {
  id: string;
  name: string;
  description: string;
  referenceId?: string;
}
export interface Project {
  series?: SeriesLink;
  scenes?: Scene[];
  characters?: Character[];
  subtitleCues?: SubtitleCue[];
  subtitleRevision?: number;
  audioTracks?: AudioTrack[];
  audioRevision?: number;
  provider?: import('../providers/contracts.ts').ProviderLedger;
  id: string;
  title: string;
  story: string;
  sourceName?: string;
  createdAt?: number;
  references?: ReferenceVersion[];
  revision: number;
  inputRevision: number;
  referenceRevision: number;
  budgetCents: number;
  shots: Shot[];
  jobs: Job[];
  preview: Snapshot | null;
  paused: boolean;
  events: { id: number; text: string; at: number }[];
}
export interface AudioTrack {
  id:string;
  name:string;
  audio:string;
  durationMs:number;
  offsetMs:number;
  volume:number;
  kind:'dialogue'|'music'|'effect';
  rights:'owned'|'licensed'|'generated';
  createdAt:number;
}
export interface SubtitleCue {startMs:number;endMs:number;text:string;}
export interface ReferenceVersion {
  id: string;
  name: string;
  image: string;
  rights: "owned" | "licensed" | "generated";
  note: string;
  createdAt: number;
}
export type ShotPatch = Partial<
  Pick<
    Shot,
    "title" | "description" | "dialogue" | "seconds" | "frame" | "locked" | "characterIds"
  >
> & { sceneId?: string | null };
export interface Summary {
  settledCents: number;
  reservedCents: number;
  availableCents: number;
  usableSeconds: number;
}
