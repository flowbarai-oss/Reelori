export type ProviderState =
  | "reserved"
  | "submitting"
  | "running"
  | "succeeded"
  | "failed"
  | "unknown";
export interface ProviderInput {
  provider?: "flowbar" | "minimax" | "minimax-cn" | "aliyun";
  kind: "image" | "video" | "audio";
  model: string;
  prompt: string;
  seconds: number;
  size: string;
  shotId: string;
  shotRevision: number;
  referenceRevision: number;
  /** Immutable local asset selected by the user for a MiniMax CN H3 video. */
  referenceId?: string;
  referenceImage?: string;
}
export interface ProviderQuote {
  billingNote?: string;
  id: string;
  input: ProviderInput;
  upperMicros: number;
  expiresAt: number;
  pricingVersion: string;
}
export interface ProviderJob {
  recoveryBlocked?: boolean;
  id: string;
  operationId: string;
  quote: ProviderQuote;
  state: ProviderState;
  createdAt: number;
  upstreamId: string | null;
  generation: number;
  leaseUntil: number;
  nextQueryAt: number;
  queries: number;
  reservedMicros: number;
  actualMicros: number | null;
  billingEvidence: string | null;
  resultImage: string | null;
  resultVideo: string | null;
  resultAudio: string | null;
  resultDurationMs: number | null;
  errorCode: string | null;
}
export interface ProviderLedger {
  budgetMicros: number;
  jobs: ProviderJob[];
}
