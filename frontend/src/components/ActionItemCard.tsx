import { ActionItem } from '../types';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';

interface Props {
  item: ActionItem;
}

export function ActionItemCard({ item }: Props) {
  const getImpactStyles = (impact: string) => {
    switch (impact) {
      case 'high':
        return {
          bg: 'bg-rose-950/40',
          border: 'border-rose-900/50',
          text: 'text-rose-400',
          icon: <AlertTriangle className="w-5 h-5 text-rose-500" />,
          badge: 'bg-rose-900 text-rose-200 border-rose-800'
        };
      case 'medium':
        return {
          bg: 'bg-amber-950/40',
          border: 'border-amber-900/50',
          text: 'text-amber-400',
          icon: <AlertCircle className="w-5 h-5 text-amber-500" />,
          badge: 'bg-amber-900 text-amber-200 border-amber-800'
        };
      case 'low':
      default:
        return {
          bg: 'bg-slate-900/40',
          border: 'border-slate-800',
          text: 'text-slate-400',
          icon: <Info className="w-5 h-5 text-slate-500" />,
          badge: 'bg-slate-800 text-slate-300 border-slate-700'
        };
    }
  };

  const s = getImpactStyles(item.estimatedImpact);

  return (
    <div className={`flex gap-4 p-5 rounded-xl border ${s.bg} ${s.border} transition-all hover:bg-opacity-60`}>
      <div className="flex-shrink-0 mt-1">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-950 border border-slate-800">
          <span className="text-sm font-bold text-slate-400">{item.rank}</span>
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <h4 className="text-base font-semibold text-slate-200">{item.title}</h4>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.badge} capitalize`}>
            {item.estimatedImpact} Impact
          </span>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">{item.description}</p>
      </div>
      <div className="flex-shrink-0 hidden sm:block">
        {s.icon}
      </div>
    </div>
  );
}
