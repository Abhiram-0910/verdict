import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, FileQuestion } from 'lucide-react';
import { Footer } from '../components/Footer';

export function NotFound() {
  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-signal/20 flex flex-col">
      <header className="border-b border-line bg-paper/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to="/" className="font-bold text-xl text-ink font-display flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-signal" />
            Verdict
          </Link>
          <Link 
            to="/" 
            className="text-sm font-medium text-ink/70 hover:text-ink flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to audit
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-paper border border-line rounded p-8 shadow-sm">
          <div className="w-12 h-12 rounded bg-signal/10 border border-signal/20 flex items-center justify-center text-signal mx-auto mb-4">
            <FileQuestion className="w-6 h-6" />
          </div>
          <span className="font-mono text-xs uppercase tracking-wider text-signal font-semibold">Error 404</span>
          <h1 className="text-2xl font-bold font-display text-ink mt-1 mb-2">Page Not Found</h1>
          <p className="text-sm text-ink/70 mb-6">
            The requested page or audit report could not be found. Check the URL or return to the landing page.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 bg-signal hover:bg-signal/90 text-white px-5 py-2.5 rounded font-medium text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to audit
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
