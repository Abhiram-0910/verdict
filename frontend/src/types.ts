export interface AuditJob {
  id: string;
  url: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  failureReason: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CaptureResult {
  id: string;
  desktopScreenshotUrl: string;
  mobileScreenshotUrl: string;
  loadTimeMs: number;
  lcp: number | null;
  cls: string | null;
}

export interface AuditScore {
  overall: number | null;
  breakdown: {
    visual: number | null;
    copy: number | null;
    accessibility: number | null;
    performance: number | null;
  };
}

export interface ActionItem {
  id: string;
  rank: number;
  title: string;
  description: string;
  estimatedImpact: 'high' | 'medium' | 'low';
  findingType: string;
  findingId: string;
}

export interface ReportPayload {
  job: AuditJob;
  captureResult: CaptureResult | null;
  auditScore: AuditScore | null;
  actionItems: ActionItem[];
}
