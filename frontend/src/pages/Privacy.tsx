import { Link } from 'react-router-dom';
import { ArrowLeft, Shield, Sparkles } from 'lucide-react';
import { Footer } from '../components/Footer';

export function Privacy() {
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL;
  const contactHref = contactEmail ? `mailto:${contactEmail}` : 'https://github.com/Abhiram-0910/verdict/issues';
  const contactLabel = contactEmail || 'GitHub Issues';

  return (
    <div className="min-h-screen bg-paper text-ink selection:bg-signal/20 flex flex-col">
      <header className="border-b border-line bg-paper/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-5 h-16 flex items-center justify-between">
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

      <main className="flex-1 max-w-4xl mx-auto w-full px-5 py-12 md:py-16">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded bg-signal/10 border border-signal/20 flex items-center justify-center text-signal">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold font-display tracking-tight text-ink">Privacy Policy</h1>
            <p className="text-xs text-ink/50 font-mono mt-0.5">Last updated: November 2026</p>
          </div>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-ink/80 border-t border-line pt-8">
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">1. Overview</h2>
            <p>
              Verdict is a diagnostic utility that evaluates public websites on visual presentation, copy clarity, accessibility, and baseline performance. No accounts and no payments are required to use Verdict.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">2. What Data Is Collected and Stored</h2>
            <p>When you submit a URL for analysis, Verdict captures and stores the following information:</p>
            <ul className="list-disc pl-5 space-y-1.5 text-ink/75">
              <li><strong>Audited URL:</strong> The web address submitted for inspection.</li>
              <li><strong>Screenshots:</strong> Rendered page captures taken by an automated browser.</li>
              <li><strong>Extracted page text:</strong> Visible text content from the rendered DOM for copy analysis.</li>
              <li><strong>Audit metrics & scores:</strong> Diagnostic scores for visual design, copy, accessibility, and performance.</li>
              <li><strong>Findings:</strong> Prioritized action items and technical issues identified by automated scanners and AI models.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">3. Cookies and Rate Limiting</h2>
            <p>
              Verdict does not use cookies for tracking, advertising, or behavioral profiling. The application sets only the following functional cookies for rate limiting and abuse prevention:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-ink/75">
              <li>
                <code className="font-mono text-xs bg-line/50 px-1 py-0.5 rounded text-ink font-semibold">verdict_usage</code>:
                <span> </span>
                <strong>Purpose:</strong> Stores the anonymous free-tier audit count and 24-hour reset timestamp on your device to enforce the daily rate limit (5 free audits per 24 hours).
                <span> </span>
                <strong>Lifetime:</strong> 30 days.
              </li>
              <li>
                <code className="font-mono text-xs bg-line/50 px-1 py-0.5 rounded text-ink font-semibold">verdict_byok_usage</code>:
                <span> </span>
                <strong>Purpose:</strong> Stores the Bring-Your-Own-Key (BYOK) audit count and 24-hour reset timestamp on your device to enforce the abuse prevention rate limit (default 20 audits per 24 hours).
                <span> </span>
                <strong>Lifetime:</strong> 30 days.
              </li>
            </ul>
            <p>
              Client IP addresses are evaluated transiently in server memory to prevent abuse, enforce rate limits, and protect backend queue capacity. IP addresses are never written to disk or stored in our persistent database.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">4. AI Providers and Third-Party Data Transmission</h2>
            <p>
              Verdict uses large language models with computer vision capabilities to perform critiques:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-ink/75">
              <li>
                <strong>Default path (Free tier):</strong> Page screenshots and extracted text are transmitted to Google's Gemini API under the free tier. Under Google's Terms of Service for free tier services, Google may use submitted data to train and improve its products and machine learning algorithms. Different terms and protections apply to users residing in the European Economic Area (EEA), the United Kingdom, and Switzerland.
              </li>
              <li>
                <strong>Bring Your Own Key (BYOK) path:</strong> When you provide your own API key (for OpenAI, Anthropic, Google Gemini, xAI, or OpenRouter), requests are sent directly to that provider under your personal account terms. <strong>Your API key is processed strictly in temporary server memory and is never stored on disk or in any database.</strong>
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">5. Data Retention and Deletion</h2>
            <p>
              Audit reports remain accessible via their unique URL identifier so you can share results. There is currently no automatic scheduled deletion.
            </p>
            <p>
              <strong>Deletion on request:</strong> If you are a website owner or user and wish to have an audit report, screenshots, or associated data removed from our database, deletion requests should be sent to the contact address below.
              {!contactEmail && (
                <span className="block mt-1 text-ink/75">
                  Do not include the audited URL or personal details in a public issue; ask for a private contact channel.
                </span>
              )}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">6. Contact</h2>
            <p>
              For privacy inquiries, general questions, or data deletion requests, requests should be sent to{' '}
              <a 
                href={contactHref} 
                className="text-signal hover:underline font-medium"
                target={contactEmail ? undefined : "_blank"}
                rel={contactEmail ? undefined : "noopener noreferrer"}
              >
                {contactLabel}
              </a>.
              {!contactEmail && (
                <span className="block mt-2 text-ink/75">
                  Do not include the audited URL or personal details in a public issue; ask for a private contact channel.
                </span>
              )}
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
