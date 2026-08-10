import { ShieldAlert, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  title: string;
  score: number | null;
  status?: 'complete' | 'failed' | 'pending' | null | string;
}

export function ScoreCard({ title, score, status }: Props) {
  return (
    <div className="flex flex-col p-6 rounded-lg bg-paper border border-line shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-ink/80">{title}</h3>
      </div>
      <div className="mt-auto">
        {status === 'failed' ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-mono font-bold text-flag-critical">FAILED</span>
          </div>
        ) : score === null ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-mono font-medium text-ink/40">N/A</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-mono font-medium text-ink">{score}</span>
            <span className="text-ink/50 font-mono font-medium">/ 100</span>
          </div>
        )}
      </div>
    </div>
  );
}
