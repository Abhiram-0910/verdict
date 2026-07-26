import { ShieldAlert, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Props {
  title: string;
  score: number | null;
}

export function ScoreCard({ title, score }: Props) {
  const getScoreColor = (s: number | null) => {
    if (s === null) return 'text-slate-400 bg-slate-800 border-slate-700';
    if (s >= 90) return 'text-emerald-400 bg-emerald-950 border-emerald-900';
    if (s >= 70) return 'text-amber-400 bg-amber-950 border-amber-900';
    return 'text-rose-400 bg-rose-950 border-rose-900';
  };

  const getIcon = (s: number | null) => {
    if (s === null) return <ShieldAlert className="w-6 h-6 opacity-50" />;
    if (s >= 90) return <CheckCircle2 className="w-6 h-6" />;
    return <AlertCircle className="w-6 h-6" />;
  };

  const colorClass = getScoreColor(score);

  return (
    <div className="flex flex-col p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl transition-all hover:border-slate-700 hover:shadow-2xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-slate-200">{title}</h3>
        <div className={`p-2 rounded-full border ${colorClass}`}>
          {getIcon(score)}
        </div>
      </div>
      <div className="mt-auto">
        {score === null ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-500">N/A</span>
            <span className="text-sm font-medium text-slate-600">missing</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className={`text-4xl font-bold ${colorClass.split(' ')[0]}`}>{score}</span>
            <span className="text-slate-400 font-medium">/ 100</span>
          </div>
        )}
      </div>
    </div>
  );
}
