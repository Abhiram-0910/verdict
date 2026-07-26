import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Loader2, Sparkles, AlertCircle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const SAMPLE_REPORT_ID = '437dc08d-e6b5-4c13-8a5e-a1f559c068ce';

// Parse the verdict_usage cookie to see if exhausted
function checkRateLimit(): boolean {
  const match = document.cookie.match(new RegExp('(^| )verdict_usage=([^;]+)'));
  if (match) {
    try {
      const usage = JSON.parse(decodeURIComponent(match[2]));
      if (usage.count >= 5) { // RATE_LIMIT_FREE_AUDITS_PER_DAY is 5 per Task 12 summary, or 3 in code. Let's rely on the backend for exact blocks, but we can assume >= 3 based on code. Wait, the code says max is 3 or process.env. Let's just say >= 3. Wait, even better: we can check if it's >= 5 since the task notes say 5, but default is 3. We'll use 5 to be safe or just 3. Let's use 3 as it's the default.
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function Landing() {
  const navigate = useNavigate();
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Rate limit state
  const [isRateLimited, setIsRateLimited] = useState(false);

  useEffect(() => {
    // We check the cookie client-side to persist the disabled state
    const match = document.cookie.match(new RegExp('(^| )verdict_usage=([^;]+)'));
    if (match) {
      try {
        const usage = JSON.parse(decodeURIComponent(match[2]));
        const maxAudits = parseInt(import.meta.env.VITE_MAX_FREE_AUDITS || '5', 10);
        
        // We also check resetAt to make sure it hasn't expired.
        const now = new Date();
        const resetAt = new Date(usage.resetAt);
        if (now < resetAt && usage.count >= maxAudits) {
          setIsRateLimited(true);
        }
      } catch (e) {
        // ignore
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRateLimited) return;

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

    try {
      const res = await fetch(`${API_URL}/api/audits`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: finalUrl }),
      });

      if (res.status === 429) {
        setIsRateLimited(true);
        setIsSubmitting(false);
        return;
      }

      if (!res.ok) {
        // Try to parse error from backend, otherwise generic network error
        let msg = "Our servers are currently unreachable or experiencing issues. Please try again later.";
        try {
          const errData = await res.json();
          if (errData.error) msg = errData.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }

      const data = await res.json();
      navigate(`/audit/${data.id}`);
      
    } catch (err: any) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 selection:bg-indigo-500/30">
      {/* Navbar with secondary CTA */}
      <nav className="border-b border-slate-900 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="font-bold text-xl text-slate-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            Verdict
          </div>
          <Link 
            to={`/audit/${SAMPLE_REPORT_ID}`}
            className="text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            See a sample report &rarr;
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 pt-20 pb-32 text-center">
        {/* Hero */}
        <h1 className="text-4xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-white to-slate-400 tracking-tight mb-6 leading-tight">
          Get an honest critique of your website in under a minute.
        </h1>
        <p className="text-lg md:text-xl text-slate-400 mb-12 max-w-2xl mx-auto">
          No signup required. Powered by Gemini vision and axe-core to evaluate your visual design, copy, accessibility, and performance.
        </p>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="max-w-xl mx-auto relative group">
          <div className={`absolute -inset-1 bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000 ${isRateLimited ? 'hidden' : ''}`}></div>
          <div className="relative flex items-center bg-slate-900 rounded-2xl border border-slate-800 p-2 shadow-2xl">
            <input
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); }}
              placeholder="example.com"
              disabled={isSubmitting || isRateLimited}
              className="flex-1 bg-transparent px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-50 text-lg"
            />
            <button
              type="submit"
              disabled={isSubmitting || isRateLimited || !url.trim()}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing
                </>
              ) : (
                <>
                  Analyze My Site
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Feedback / Errors */}
        <div className="h-12 mt-4">
          {isRateLimited ? (
            <div className="flex items-center justify-center gap-2 text-amber-400 bg-amber-950/30 w-fit mx-auto px-4 py-2 rounded-lg border border-amber-900/50">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">You've used your free audits for today. Please try again tomorrow.</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center gap-2 text-rose-400 bg-rose-950/30 w-fit mx-auto px-4 py-2 rounded-lg border border-rose-900/50">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
