import { ActionItem } from '../types';
import { TriangleAlert, OctagonAlert, Info } from 'lucide-react';

interface Props {
  item: ActionItem;
  isActive?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
}

export function ActionItemCard({ item, isActive, onMouseEnter, onMouseLeave, onClick }: Props) {
  const getImpactStyles = (impact: string) => {
    switch (impact) {
      case 'high':
        return {
          bg: 'bg-flag-critical/5',
          border: 'border-flag-critical/30',
          text: 'text-flag-critical',
          icon: <OctagonAlert className="w-5 h-5 text-flag-critical" />,
          badge: 'border-flag-critical/30 text-flag-critical font-mono uppercase bg-flag-critical/10',
          badgeText: 'CRITICAL'
        };
      case 'medium':
        return {
          bg: 'bg-flag-warning/5',
          border: 'border-flag-warning/30',
          text: 'text-flag-warning',
          icon: <TriangleAlert className="w-5 h-5 text-flag-warning" />,
          badge: 'border-flag-warning/30 text-flag-warning font-mono uppercase bg-flag-warning/10',
          badgeText: 'WARNING'
        };
      case 'low':
      default:
        return {
          bg: 'bg-paper',
          border: 'border-line',
          text: 'text-ink/70',
          icon: <Info className="w-5 h-5 text-ink/50" />,
          badge: 'border-line text-ink/70 font-mono uppercase bg-paper',
          badgeText: 'INFO'
        };
    }
  };

  const s = getImpactStyles(item.estimatedImpact);

  // When active, override the default border and add a subtle ring
  const activeClass = isActive ? '!border-signal ring-4 ring-signal/10' : 'hover:border-signal/50';

  return (
    <div 
      id={`action-item-${item.id}`}
      className={`flex gap-4 p-5 rounded-xl border-2 ${s.bg} ${s.border} transition-all cursor-pointer ${activeClass}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div className="flex-shrink-0 mt-1">
        <div className="flex items-center justify-center w-8 h-8 rounded border border-line bg-paper">
          <span className="text-sm font-mono font-bold text-ink/50">{item.rank}</span>
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          <h4 className="text-base font-semibold text-ink">{item.title}</h4>
          <span className={`px-2 py-0.5 rounded text-xs font-bold border ${s.badge}`}>
            {s.badgeText}
          </span>
        </div>
        <p className="text-sm text-ink/70 leading-relaxed">{item.description}</p>
      </div>
      <div className="flex-shrink-0 hidden sm:block">
        {s.icon}
      </div>
    </div>
  );
}
