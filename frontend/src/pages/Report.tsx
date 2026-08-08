import { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { translateError } from '../lib/errorTranslations';
import { ReportPayload } from '../types';
import { ScoreCard } from '../components/ScoreCard';
import { ActionItemCard } from '../components/ActionItemCard';
import { Loader2, AlertCircle, Key } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  xai: 'xAI'
};

export function Report() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const byokProvider = location.state?.byokProvider;

  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    const fetchReport = async () => {
      try {
        const res = await fetch(`${API_URL}/api/audits/${id}`);
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'Report not found' : 'Failed to fetch report');
        }
        const json: ReportPayload = await res.json();
        
        if (isMounted.current) {
          setData(json);
          
          // Explicit stop condition: Do not schedule another poll if complete or failed
          if (json.job.status === 'complete' || json.job.status === 'failed') {
            return;
          }
          
          // Poll again after 3 seconds
          timeoutId = setTimeout(fetchReport, 3000);
        }
      } catch (err: any) {
        if (isMounted.current) {
          setError(err.message);
        }
      }
    };

    fetchReport();

    return () => {
      isMounted.current = false;
      clearTimeout(timeoutId);
    };
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-200 mb-2">Error Loading Report</h2>
          <p className="text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.job.status === 'pending' || data.job.status === 'running') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-6" />
        <h2 className="text-2xl font-bold text-slate-200 mb-2">Analyzing Design</h2>
        <p className="text-slate-400 max-w-sm text-center">
          Waking up browser and running AI critiques. This usually takes about 15 seconds on cold start...
        </p>
      </div>
    );
  }

  if (data.job.status === 'failed') {
    const isRateLimit = data.job.failureReason === 'AI_RATE_LIMIT';
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-rose-900/50 rounded-2xl p-8 shadow-2xl">
          <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
          <h2 className="text-xl font-bold text-slate-200 mb-2">Audit Failed</h2>
          <p className="text-slate-400 bg-slate-950 p-4 rounded-lg text-sm mb-4">
            {translateError(data.job.failureReason)}
          </p>
          {isRateLimit && (
            <button
              onClick={() => navigate('/', { state: { autoOpenBYOK: true } })}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              <Key className="w-4 h-4" />
              Use your own API key
            </button>
          )}
        </div>
      </div>
    );
  }

  const { auditScore, actionItems, captureResult } = data;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header Section */}
        <header className="border-b border-slate-800 pb-8 pt-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-slate-100 tracking-tight mb-2 flex items-center gap-3">
              Audit Report
            </h1>
            <p className="text-slate-400 font-mono text-sm">{data.job.url}</p>
          </div>
          {byokProvider && (
            <div className="flex items-center gap-1.5 bg-indigo-950/40 border border-indigo-900/50 text-indigo-300 px-3 py-1.5 rounded-full text-xs font-medium shrink-0">
              <Key className="w-3.5 h-3.5" />
              Audited with your {PROVIDER_DISPLAY_NAMES[byokProvider] || byokProvider} key
            </div>
          )}
        </header>

        {/* Overall Score & Breakdown */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Overall */}
          <div className="flex flex-col items-center justify-center p-8 bg-gradient-to-br from-indigo-900/40 to-slate-900 rounded-3xl border border-indigo-500/20 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent"></div>
            <h2 className="text-xl font-medium text-slate-300 mb-6 relative z-10">Overall Score</h2>
            {auditScore?.overall === null ? (
              <div className="text-4xl font-bold text-slate-500 relative z-10">N/A</div>
            ) : (
              <div className="flex items-baseline gap-2 relative z-10">
                <span className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400 drop-shadow-sm">
                  {auditScore?.overall}
                </span>
                <span className="text-2xl text-slate-500 font-bold">/ 100</span>
              </div>
            )}
          </div>

          {/* Breakdown Cards */}
          <div className="grid grid-cols-2 gap-4">
            <ScoreCard title="Visual" score={auditScore?.breakdown?.visual ?? null} />
            <ScoreCard title="Copy" score={auditScore?.breakdown?.copy ?? null} />
            <ScoreCard title="Access" score={auditScore?.breakdown?.accessibility ?? null} />
            <ScoreCard title="Perf" score={auditScore?.breakdown?.performance ?? null} />
          </div>
        </section>

        {/* Desktop Screenshot */}
        {captureResult?.desktopScreenshotUrl && (
          <section className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-100">Captured View</h2>
            <div className="rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-900">
              <img 
                src={captureResult.desktopScreenshotUrl} 
                alt="Desktop Capture" 
                className="w-full h-auto object-cover opacity-90 hover:opacity-100 transition-opacity"
              />
            </div>
          </section>
        )}

        {/* Ranked Action Items */}
        <section className="space-y-6 pb-20">
          <h2 className="text-2xl font-bold text-slate-100">Prioritized Action Items</h2>
          
          {/* Agent Failure Warnings */}
          {(data.job.visualStatus === 'failed' || data.job.copyStatus === 'failed') && (
            <div className="p-6 bg-amber-950/20 border border-amber-900/50 rounded-2xl text-amber-200/90 space-y-4">
              <div className="flex items-center gap-3 font-semibold text-amber-500">
                <AlertCircle className="w-5 h-5" />
                Partial Results
              </div>
              <p className="text-sm">
                Some of our AI agents failed to complete their analysis: {translateError(data.job.failureReason)}
              </p>
              {data.job.failureReason === 'AI_RATE_LIMIT' && (
                <button
                  onClick={() => navigate('/', { state: { autoOpenBYOK: true } })}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors mt-2"
                >
                  <Key className="w-4 h-4" />
                  Use your own API key to try again
                </button>
              )}
            </div>
          )}

          {actionItems.length === 0 ? (
            <div className="p-8 text-center bg-slate-900/50 rounded-2xl border border-slate-800 text-slate-400">
              {data.job.visualStatus === 'complete' && data.job.copyStatus === 'complete' 
                ? "No significant issues found. Great job!" 
                : data.job.visualStatus === null && data.job.copyStatus === null
                  ? "No issues recorded in this legacy report."
                  : "No issues were found by the agents that completed."}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {actionItems.map(item => (
                <ActionItemCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
