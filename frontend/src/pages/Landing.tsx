import { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles, AlertCircle, Key } from 'lucide-react';
import { BYOKPanel } from '../components/BYOKPanel';
import { HeroDemo } from '../components/HeroDemo';
import { Footer } from '../components/Footer';
import { Countdown } from '../components/Countdown';
import { translateError } from '../lib/errorTranslations';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';
const SAMPLE_REPORT_ID = '437dc08d-e6b5-4c13-8a5e-a1f559c068ce';

export function Landing() {
  const navigate = useNavigate();
  const location = useLocation();
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isColdStarting, setIsColdStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Rate limit & Quota state
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitResetTime, setRateLimitResetTime] = useState<{ date: string; isApproximate: boolean } | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState<{ active: boolean; resetAt: string; detail?: string } | null>(null);

  // BYOK state
  const [isBYOKOpen, setIsBYOKOpen] = useState(location.state?.autoOpenBYOK || false);
  const [byokData, setByokData] = useState({ provider: 'openai', apiKey: '', model: '', isValid: false });

  // Warm-up ping: once per session, fire-and-forget GET {API}/health with mode no-cors
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('verdict_warmed')) {
        sessionStorage.setItem('verdict_warmed', '1');
        fetch(`${API_URL}/health`, { mode: 'no-cors' }).catch(() => {
          // Never throw or block UI
        });
      }
    } catch {
      // Ignore environments where sessionStorage is restricted
    }
  }, []);

  // Check rate limit cookie client-side on mount
  useEffect(() => {
    const match = document.cookie.match(new RegExp('(^| )verdict_usage=([^;]+)'));
    if (match) {
      try {
        const usage = JSON.parse(decodeURIComponent(match[2]));
        const maxAudits = parseInt(import.meta.env.VITE_MAX_FREE_AUDITS || '5', 10);
        
        const now = new Date();
        const resetAt = new Date(usage.resetAt);
        if (now < resetAt && usage.count >= maxAudits) {
          setIsRateLimited(true);
          setIsBYOKOpen(true);
          setRateLimitResetTime({ date: usage.resetAt, isApproximate: true });
        }
      } catch {
        // ignore cookie parse error
      }
    }
    
    // Clear location state to prevent reopening on subsequent navigations
    if (location.state?.autoOpenBYOK) {
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleCountdownComplete = () => {
    setIsRateLimited(false);
    setRateLimitResetTime(null);
    setQuotaExhausted(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((isRateLimited || quotaExhausted?.active) && !(isBYOKOpen && byokData.isValid)) return;

    let finalUrl = url.trim();
    if (!finalUrl) return;

    // Auto-prepend https:// if missing
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`;
      setUrl(finalUrl); // Update input visually
    }

    // Basic structural check
    try {
      new URL(finalUrl);
    } catch {
      setError("Please enter a valid website URL.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setIsColdStarting(false);
    
    const coldStartTimer = setTimeout(() => {
      setIsColdStarting(true);
    }, 4500);

    const body: Record<string, string> = { url: finalUrl };
    if (isBYOKOpen && byokData.isValid) {
      body.byokProvider = byokData.provider;
      body.byokApiKey = byokData.apiKey;
      body.byokModel = byokData.model;
    }

    try {
      const res = await fetch(`${API_URL}/api/audits`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      // 429 Rate Limit Exceeded
      if (res.status === 429) {
        let serverResetAt: string | null = null;
        try {
          const errData = await res.json();
          if (errData.resetAt) serverResetAt = errData.resetAt;
        } catch { /* ignore */ }

        setIsRateLimited(true);
        setIsBYOKOpen(true);
        setIsSubmitting(false);
        clearTimeout(coldStartTimer);
        setIsColdStarting(false);

        if (serverResetAt) {
          setRateLimitResetTime({ date: serverResetAt, isApproximate: false });
        } else {
          // Check cookie fallback
          const cookieMatch = document.cookie.match(new RegExp('(^| )verdict_usage=([^;]+)'));
          if (cookieMatch) {
            try {
              const usage = JSON.parse(decodeURIComponent(cookieMatch[2]));
              if (usage.resetAt) {
                setRateLimitResetTime({ date: usage.resetAt, isApproximate: true });
              }
            } catch { /* ignore */ }
          }
        }
        return;
      }

      // 503 Service Unavailable (Capacity or AI Quota)
      if (res.status === 503) {
        clearTimeout(coldStartTimer);
        setIsColdStarting(false);
        setIsSubmitting(false);

        let errData: { code?: string; resetAt?: string; detail?: string; error?: string } = {};
        try {
          errData = await res.json();
        } catch { /* ignore */ }

        if (errData.code === 'AI_QUOTA_EXHAUSTED' && errData.resetAt) {
          setQuotaExhausted({
            active: true,
            resetAt: errData.resetAt,
            detail: errData.detail || translateError('AI_QUOTA_EXHAUSTED')
          });
          setIsBYOKOpen(true);
          return;
        }

        if (errData.code === 'BUSY') {
          setError(translateError('BUSY'));
          return;
        }

        setError(translateError(errData.code || 'Service Unavailable'));
        return;
      }

      if (!res.ok) {
        clearTimeout(coldStartTimer);
        setIsColdStarting(false);
        setIsSubmitting(false);

        let errData: { error?: string; detail?: string; code?: string } = {};
        try {
          errData = await res.json();
        } catch { /* ignore */ }

        const rawMsg = errData.detail || errData.code || errData.error || "Our servers are currently unreachable or experiencing issues. Please try again later.";
        setError(translateError(rawMsg));
        return;
      }

      const data = await res.json();
      clearTimeout(coldStartTimer);
      setIsColdStarting(false);
      navigate(`/audit/${data.id}`, { 
        state: { byokProvider: isBYOKOpen && byokData.isValid ? byokData.provider : undefined } 
      });
      
    } catch (err: unknown) {
      clearTimeout(coldStartTimer);
      setIsColdStarting(false);
      setIsSubmitting(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(translateError(msg));
    }
  };

  const isBlockedByLimits = (isRateLimited || quotaExhausted?.active) && !(isBYOKOpen && byokData.isValid);
  const submitDisabled = isSubmitting || (!url.trim()) || isBlockedByLimits;

  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-signal/20 flex flex-col">
      {/* Navbar with secondary CTA */}
      <header className="border-b border-line bg-paper/80 backdrop-blur-md sticky top-0 z-50">
        <nav aria-label="Main Navigation" className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="font-bold text-xl text-ink font-display flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-signal" aria-hidden="true" />
            Verdict
          </div>
          <Link 
            to={`/audit/${SAMPLE_REPORT_ID}`}
            className="text-sm font-medium text-signal hover:text-signal/80 transition-colors"
          >
            See a sample report &rarr;
          </Link>
        </nav>
      </header>

      <main className="flex-1 flex flex-col justify-center max-w-6xl mx-auto w-full px-5 py-12 md:py-24">
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-12 lg:gap-24">
          
          <div className="flex-1 text-center md:text-left max-w-2xl">
            {/* Hero */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold font-display tracking-tight mb-6 leading-tight text-ink">
              Get an honest critique of your website.
            </h1>
            <p className="text-lg text-ink/70 mb-10 max-w-lg mx-auto md:mx-0">
              No signup required. Powered by Gemini vision and axe-core to evaluate your visual design, copy, accessibility, and performance.
            </p>

            {/* Input Form */}
            <form onSubmit={handleSubmit} className="max-w-lg mx-auto md:mx-0 relative">
              <label htmlFor="audit-url-input" className="sr-only">
                Website URL to audit
              </label>
              <div className="relative flex items-center bg-white rounded border border-line p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-signal focus-within:ring-offset-1 focus-within:ring-offset-paper transition-all">
                <div className="flex items-center pl-4 select-none" aria-hidden="true">
                  <span className="font-mono text-signal/50 text-base">{'>'}</span>
                  {!url && (
                    <span className="w-1.5 h-4 bg-signal/60 animate-pulse ml-1 absolute translate-x-[12px]" />
                  )}
                </div>
                <input
                  id="audit-url-input"
                  type="text"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(null); }}
                  placeholder="example.com"
                  disabled={isSubmitting || isBlockedByLimits}
                  className="flex-1 bg-transparent px-3 py-3 text-ink placeholder:text-ink/40 outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50 text-base font-mono relative z-10"
                />
                <button
                  type="submit"
                  disabled={submitDisabled}
                  className="flex items-center gap-2 bg-signal hover:bg-signal/90 text-white px-6 py-3 rounded-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed z-10"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                      {isColdStarting ? 'Booting engine...' : 'Analyzing'}
                    </>
                  ) : (
                    <>
                      Analyze
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Cold Start Indicator */}
            {isColdStarting && (
              <div className="max-w-lg mx-auto md:mx-0 mt-3 flex items-center justify-center md:justify-start gap-2 text-ink/60 animate-in fade-in duration-500">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium">Booting the analysis engine — first request after idle can take a moment.</span>
              </div>
            )}

            {/* BYOK Toggle */}
            <div className="max-w-lg mx-auto md:mx-0 mt-4 text-left">
              <button
                type="button"
                onClick={() => setIsBYOKOpen(!isBYOKOpen)}
                className="flex items-center gap-1.5 text-xs font-medium text-ink/60 hover:text-ink transition-colors outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-paper rounded-sm py-1"
              >
                <Key className="w-3.5 h-3.5" aria-hidden="true" />
                {isBYOKOpen ? 'Hide API key settings' : 'Use your own API key'}
              </button>
              
              {isBYOKOpen && (
                <BYOKPanel onChange={setByokData} />
              )}
            </div>

            {/* Feedback / Errors / Countdowns */}
            <div className="min-h-[48px] mt-4">
              {isRateLimited ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-flag-warning bg-flag-warning/10 w-fit mx-auto md:mx-0 px-4 py-2.5 rounded border border-flag-warning/20">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium">You've used your free audits.</span>
                  </div>
                  {rateLimitResetTime ? (
                    <div className="text-sm text-flag-warning/90">
                      <Countdown 
                        targetDate={rateLimitResetTime.date} 
                        isApproximate={rateLimitResetTime.isApproximate}
                        onComplete={handleCountdownComplete}
                        prefix="Try again in"
                      />
                      <span className="ml-1.5 font-sans font-normal">or use your own API key above.</span>
                    </div>
                  ) : (
                    <span className="text-sm font-normal">Try again tomorrow, or use your own API key above.</span>
                  )}
                </div>
              ) : quotaExhausted?.active ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-flag-warning bg-flag-warning/10 w-fit mx-auto md:mx-0 px-4 py-2.5 rounded border border-flag-warning/20">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium">Daily free AI quota reached.</span>
                  </div>
                  <div className="text-sm text-flag-warning/90">
                    <Countdown 
                      targetDate={quotaExhausted.resetAt} 
                      isApproximate={false}
                      onComplete={handleCountdownComplete}
                      prefix="Resets in"
                    />
                    <span className="ml-1.5 font-sans font-normal">or switch to your own key above.</span>
                  </div>
                </div>
              ) : error ? (
                <div className="flex items-center gap-2 text-flag-critical bg-flag-critical/10 w-fit mx-auto md:mx-0 px-4 py-2.5 rounded border border-flag-critical/20">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="text-sm font-medium">{error}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex-1 w-full flex justify-center md:justify-end">
            <HeroDemo />
          </div>
          
        </div>
      </main>

      <Footer />
    </div>
  );
}
