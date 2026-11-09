import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { translateError } from '../lib/errorTranslations';
import { ReportPayload } from '../types';
import { ScoreCard } from '../components/ScoreCard';
import { ActionItemCard } from '../components/ActionItemCard';
import { Oscilloscope } from '../components/Oscilloscope';
import { Footer } from '../components/Footer';
import { Loader2, AlertCircle, Key, RefreshCw, Clock, Sparkles } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';
const MAX_POLL_DURATION_MS = 4 * 60 * 1000; // 4 minutes

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
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const isMounted = useRef(true);
  const startTime = useRef(Date.now());
  const pollCount = useRef(0);
  const consecutiveTransientErrors = useRef(0);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set noindex on /audit/* routes
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = 'noindex, nofollow';

    return () => {
      if (created && meta && meta.parentNode) {
        meta.parentNode.removeChild(meta);
      } else if (meta) {
        meta.content = 'index, follow';
      }
    };
  }, []);

  // Polling routine
  const fetchReport = useCallback(async () => {
    if (!isMounted.current) return;

    // Check if 4 minutes have elapsed
    if (Date.now() - startTime.current > MAX_POLL_DURATION_MS) {
      if (isMounted.current) {
        setIsTimedOut(true);
      }
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/audits/${id}`);

      // Tolerate 502/503 during backend restarts quietly up to ~6 times
      if (res.status === 502 || res.status === 503) {
        consecutiveTransientErrors.current += 1;
        if (consecutiveTransientErrors.current <= 6) {
          // Retry quietly after 3s
          if (isMounted.current) {
            timeoutId.current = setTimeout(fetchReport, 3000);
          }
          return;
        }
        throw new Error('Backend server is temporarily unavailable after multiple restart attempts. Please retry.');
      }

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Report not found');
        }
        throw new Error('Failed to fetch report');
      }

      // Successful response
      consecutiveTransientErrors.current = 0;
      pollCount.current += 1;
      const json: ReportPayload = await res.json();
      
      if (isMounted.current) {
        setData(json);
        
        // Stop condition: complete or failed
        if (json.job.status === 'complete' || json.job.status === 'failed') {
          return;
        }
        
        // Back off: 2.5s base, increasing with poll count up to 8s
        const backoffDelay = Math.min(8000, 2500 + pollCount.current * 500);
        timeoutId.current = setTimeout(fetchReport, backoffDelay);
      }
    } catch (err: unknown) {
      if (!isMounted.current) return;

      // Also tolerate transient fetch network errors (e.g. server restart drop) up to 6 times
      if (consecutiveTransientErrors.current < 6 && !(err instanceof Error && err.message === 'Report not found')) {
        consecutiveTransientErrors.current += 1;
        timeoutId.current = setTimeout(fetchReport, 3000);
        return;
      }

      const msg = err instanceof Error ? err.message : 'An error occurred while loading the report';
      setError(msg);
    }
  }, [id]);

  // Start polling and elapsed timer on mount
  useEffect(() => {
    isMounted.current = true;
    startTime.current = Date.now();
    pollCount.current = 0;
    consecutiveTransientErrors.current = 0;
    setIsTimedOut(false);
    setError(null);

    fetchReport();

    // Elapsed timer ticker
    const timerInterval = setInterval(() => {
      if (!isMounted.current) return;
      setElapsedSeconds(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    return () => {
      isMounted.current = false;
      if (timeoutId.current) clearTimeout(timeoutId.current);
      clearInterval(timerInterval);
    };
  }, [fetchReport]);

  const handleRetry = () => {
    startTime.current = Date.now();
    pollCount.current = 0;
    consecutiveTransientErrors.current = 0;
    setIsTimedOut(false);
    setError(null);
    setElapsedSeconds(0);
    fetchReport();
  };

  // Error State
  if (error) {
    return (
      <div className="min-h-screen bg-paper flex flex-col selection:bg-signal/20">
        <header className="border-b border-line bg-paper/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
            <Link to="/" className="font-bold text-xl text-ink font-display flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-signal" aria-hidden="true" />
              Verdict
            </Link>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-paper border border-flag-critical/30 rounded p-8 text-center shadow-sm">
            <AlertCircle className="w-12 h-12 text-flag-critical mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-xl font-bold text-ink mb-2">Error Loading Report</h1>
            <p className="text-ink/70 text-sm mb-6">{error}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 bg-signal hover:bg-signal/90 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Retry
              </button>
              <Link
                to="/"
                className="flex items-center gap-2 bg-paper border border-line text-ink hover:bg-line/20 px-4 py-2 rounded text-sm font-medium transition-colors"
              >
                Home
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // 4-Minute Timeout State
  if (isTimedOut) {
    return (
      <div className="min-h-screen bg-paper flex flex-col selection:bg-signal/20">
        <header className="border-b border-line bg-paper/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
            <Link to="/" className="font-bold text-xl text-ink font-display flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-signal" aria-hidden="true" />
              Verdict
            </Link>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-paper border border-line rounded p-8 text-center shadow-sm">
            <Clock className="w-12 h-12 text-flag-warning mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-xl font-bold text-ink mb-2">Analysis Timed Out</h1>
            <p className="text-ink/70 text-sm mb-6 leading-relaxed">
              The analysis took longer than 4 minutes to complete. The target website might be slow to load, or the analysis service is experiencing high load.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 bg-signal hover:bg-signal/90 text-white px-5 py-2.5 rounded text-sm font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Retry Analysis
              </button>
              <Link
                to="/"
                className="flex items-center gap-2 bg-paper border border-line text-ink hover:bg-line/20 px-4 py-2.5 rounded text-sm font-medium transition-colors"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Loading State (pending / running)
  if (!data || data.job.status === 'pending' || data.job.status === 'running') {
    const isRunning = data?.job?.status === 'running';
    const isColdStarting = elapsedSeconds >= 5;

    return (
      <div className="min-h-screen bg-paper flex flex-col selection:bg-signal/20">
        <header className="border-b border-line bg-paper/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
            <Link to="/" className="font-bold text-xl text-ink font-display flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-signal" aria-hidden="true" />
              Verdict
            </Link>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto w-full">
          {/* Clinical Oscilloscope Waveform Animation */}
          <Oscilloscope className="mb-6 shadow-sm" />

          {/* Honest Stage Indicator */}
          <div className="flex items-center gap-2 mb-2">
            <Loader2 className="w-5 h-5 text-signal animate-spin shrink-0" aria-hidden="true" />
            <h1 className="text-xl font-bold font-display text-ink">
              {isRunning ? 'Analyzing Website' : 'Audit Queued'}
            </h1>
          </div>

          {/* Honest Duration Copy */}
          <p className="text-sm text-ink/70 mb-4 max-w-sm">
            Analysis usually takes 20&ndash;60 seconds.
          </p>

          {/* Live Elapsed Timer */}
          <div className="inline-flex items-center gap-1.5 font-mono text-xs text-signal bg-signal/10 px-3 py-1.5 rounded border border-signal/20 mb-4">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Elapsed: {elapsedSeconds}s</span>
          </div>

          {/* Cold Start Indicator */}
          {isColdStarting && (
            <div className="p-3 bg-paper border border-line rounded text-xs text-ink/60 max-w-sm animate-in fade-in duration-500">
              Booting the analysis engine — first request after idle can take a moment.
            </div>
          )}
        </main>

        <Footer />
      </div>
    );
  }

  // Hard Job Failure State
  if (data.job.status === 'failed') {
    const isRateLimit = data.job.failureReason === 'AI_RATE_LIMIT';
    return (
      <div className="min-h-screen bg-paper flex flex-col selection:bg-signal/20">
        <header className="border-b border-line bg-paper/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
            <Link to="/" className="font-bold text-xl text-ink font-display flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-signal" aria-hidden="true" />
              Verdict
            </Link>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-paper border border-flag-critical/30 rounded p-8 shadow-sm text-center">
            <AlertCircle className="w-12 h-12 text-flag-critical mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-xl font-bold text-ink mb-2">Audit Failed</h1>
            <p className="text-ink/80 bg-flag-critical/5 p-4 rounded text-sm border border-flag-critical/10 mb-6 text-left">
              {translateError(data.job.failureReason)}
            </p>
            {isRateLimit ? (
              <button
                onClick={() => navigate('/', { state: { autoOpenBYOK: true } })}
                className="w-full flex items-center justify-center gap-2 bg-signal hover:bg-signal/90 text-white px-4 py-2.5 rounded font-medium text-sm transition-colors"
              >
                <Key className="w-4 h-4" aria-hidden="true" />
                Use your own API key
              </button>
            ) : (
              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-2 bg-signal hover:bg-signal/90 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  Retry
                </button>
                <Link
                  to="/"
                  className="flex items-center gap-2 bg-paper border border-line text-ink hover:bg-line/20 px-4 py-2 rounded text-sm font-medium transition-colors"
                >
                  Home
                </Link>
              </div>
            )}
          </div>
        </main>

        <Footer />
      </div>
    );
  }

  // Complete Report Display
  const { auditScore, actionItems, captureResult } = data;

  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-signal/20 flex flex-col">
      <header className="border-b border-line bg-paper/80 backdrop-blur-md sticky top-0 z-50">
        <nav aria-label="Main Navigation" className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to="/" className="font-bold text-xl text-ink font-display flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-signal" aria-hidden="true" />
            Verdict
          </Link>
          <Link
            to="/"
            className="text-sm font-medium text-signal hover:text-signal/80 transition-colors"
          >
            Run another audit &rarr;
          </Link>
        </nav>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full p-4 md:p-8 space-y-12">
        {/* Header Section */}
        <div className="border-b border-line pb-8 pt-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-ink tracking-tight mb-2 font-display">
              Audit Report
            </h1>
            <p className="text-ink/60 font-mono text-sm break-all">{data.job.url}</p>
          </div>
          {byokProvider && (
            <div className="flex items-center gap-1.5 bg-signal/5 border border-signal/20 text-signal px-3 py-1.5 rounded-full text-xs font-medium shrink-0 self-start">
              <Key className="w-3.5 h-3.5" aria-hidden="true" />
              Audited with your {PROVIDER_DISPLAY_NAMES[byokProvider] || byokProvider} key
            </div>
          )}
        </div>

        {/* Overall Score & Breakdown */}
        <section aria-label="Audit Scores" className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Overall */}
          <div className="flex flex-col items-center justify-center p-8 bg-paper rounded border border-line shadow-sm relative overflow-hidden">
            <h2 className="text-xl font-medium text-ink/70 mb-6 relative z-10 font-display">Overall Score</h2>
            {auditScore?.overall === null ? (
              <div className="text-4xl font-bold text-ink/70 relative z-10 font-mono">N/A</div>
            ) : (
              <div className="flex items-baseline gap-2 relative z-10">
                <span className="text-7xl font-mono font-bold text-signal">
                  {auditScore?.overall}
                </span>
                <span className="text-2xl text-ink/70 font-mono font-bold">/ 100</span>
              </div>
            )}
          </div>

          {/* Breakdown Cards */}
          <div className="grid grid-cols-2 gap-4">
            <ScoreCard title="Visual" score={auditScore?.breakdown?.visual ?? null} status={data.job.visualStatus} />
            <ScoreCard title="Copy" score={auditScore?.breakdown?.copy ?? null} status={data.job.copyStatus} />
            <ScoreCard title="Access" score={auditScore?.breakdown?.accessibility ?? null} />
            <ScoreCard title="Perf" score={auditScore?.breakdown?.performance ?? null} />
          </div>
        </section>

        {/* Desktop Screenshot with Interactive Overlays */}
        {captureResult?.desktopScreenshotUrl && (
          <section aria-label="Captured Website View" className="space-y-6">
            <h2 className="text-2xl font-bold text-ink font-display">Captured View</h2>
            <div className="rounded overflow-hidden border border-line shadow-sm bg-paper relative">
              <img 
                src={captureResult.desktopScreenshotUrl} 
                alt={`Desktop capture of ${data.job.url}`} 
                className="w-full h-auto object-cover opacity-90 transition-opacity relative z-0"
              />
              {actionItems
                .filter(item => item.findingType === 'visual')
                .map(item => {
                  const finding = data.visualFindings?.find(f => f.id === item.findingId);
                  if (!finding || !finding.screenshotRegion) return null;
                  
                  const r = finding.screenshotRegion;
                  const isActive = activeFindingId === item.id;
                  
                  let colorClass = 'border-line bg-line/10';
                  if (item.estimatedImpact === 'high') colorClass = 'border-flag-critical bg-flag-critical/10';
                  else if (item.estimatedImpact === 'medium') colorClass = 'border-flag-warning bg-flag-warning/10';
                  
                  if (isActive) {
                    if (item.estimatedImpact === 'high') colorClass = 'border-flag-critical bg-flag-critical/20 ring-4 ring-flag-critical/10';
                    else if (item.estimatedImpact === 'medium') colorClass = 'border-flag-warning bg-flag-warning/20 ring-4 ring-flag-warning/10';
                    else colorClass = 'border-ink/50 bg-ink/10 ring-4 ring-ink/5';
                  }

                  return (
                    <div
                      key={`overlay-${item.id}`}
                      aria-hidden="true"
                      className={`absolute border-2 transition-all cursor-pointer ${colorClass} ${isActive ? 'z-10' : 'z-0 hover:z-10'}`}
                      style={{
                        left: `${r.x * 100}%`,
                        top: `${r.y * 100}%`,
                        width: `${r.width * 100}%`,
                        height: `${r.height * 100}%`
                      }}
                      onMouseEnter={() => setActiveFindingId(item.id)}
                      onMouseLeave={() => setActiveFindingId(null)}
                      onClick={() => {
                        document.getElementById(`action-item-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    />
                  );
                })}
            </div>
          </section>
        )}

        {/* Ranked Action Items */}
        <section aria-label="Action Items" className="space-y-6 pb-12">
          <h2 className="text-2xl font-bold text-ink font-display">Prioritized Action Items</h2>
          
          {/* Agent Failure Warnings */}
          {(data.job.visualStatus === 'failed' || data.job.copyStatus === 'failed') && (
            <div className="p-6 bg-flag-warning/5 border border-flag-warning/30 rounded text-ink space-y-4">
              <div className="flex items-center gap-3 font-semibold text-flag-warning">
                <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                Partial Results
              </div>
              <p className="text-sm">
                Some of our AI agents failed to complete their analysis: {translateError(data.job.failureReason)}
              </p>
              {data.job.failureReason === 'AI_RATE_LIMIT' && (
                <button
                  onClick={() => navigate('/', { state: { autoOpenBYOK: true } })}
                  className="inline-flex items-center gap-2 bg-signal hover:bg-signal/90 text-white px-4 py-2 rounded font-medium text-sm transition-colors mt-2"
                >
                  <Key className="w-4 h-4" aria-hidden="true" />
                  Use your own API key to try again
                </button>
              )}
            </div>
          )}

          {actionItems.length === 0 ? (
            <div className="p-8 text-center bg-paper rounded border border-line text-ink/70">
              {data.job.visualStatus === 'complete' && data.job.copyStatus === 'complete' 
                ? "No significant issues found. Great job!" 
                : data.job.visualStatus === null && data.job.copyStatus === null
                  ? "No issues recorded in this legacy report."
                  : "No issues were found by the agents that completed."}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {actionItems.map(item => (
                <ActionItemCard 
                  key={item.id} 
                  item={item} 
                  isActive={activeFindingId === item.id}
                  onMouseEnter={() => setActiveFindingId(item.id)}
                  onMouseLeave={() => setActiveFindingId(null)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
