import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, Sparkles } from 'lucide-react';
import { Footer } from '../components/Footer';

export function Terms() {
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
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold font-display tracking-tight text-ink">Terms of Service</h1>
            <p className="text-xs text-ink/50 font-mono mt-0.5">Last updated: November 2026</p>
          </div>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-ink/80 border-t border-line pt-8">
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Verdict, you agree to these Terms of Service. If you do not agree to these terms, do not use the tool.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">2. Service Description and Purpose</h2>
            <p>
              Verdict provides automated first-impression evaluations of publicly available websites. The tool utilizes headless browser rendering, the axe-core accessibility engine, and third-party vision language models to evaluate page hierarchy, design contrast, typography, copy readability, and technical accessibility.
            </p>
            <p>
              The outputs provided by Verdict are automated diagnostic opinions intended for testing and guidance. They do not constitute formal legal accessibility compliance certifications or commercial guarantees.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">3. Permitted Use and Acceptable Submissions</h2>
            <p>
              You agree to submit only publicly accessible HTTP or HTTPS web URLs that you own, operate, or have authorization to test. You may not use Verdict to:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-ink/75">
              <li>Probe private, internal, or loopback network addresses (such attempts are blocked automatically).</li>
              <li>Attempt to circumvent usage quotas, rate limits, or automated abuse defenses.</li>
              <li>Submit URLs containing illegal content or intended to conduct denial-of-service attacks.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">4. Free Tier, BYOK, and AI Providers</h2>
            <p>
              Verdict offers a free usage tier with daily audit allowances, subject to server capacity and provider availability.
            </p>
            <p>
              <strong>Default path:</strong> Content and screenshots analyzed via the default free tier are processed by Google Gemini. Under Google's free tier terms, Google may use prompt inputs to improve its models (with separate provisions applicable in the EEA, UK, and Switzerland).
            </p>
            <p>
              <strong>Bring Your Own Key (BYOK):</strong> Users who supply their own API key interact directly with their chosen AI provider (OpenAI, Anthropic, Google Gemini, xAI, or OpenRouter). You are responsible for any API usage fees incurred with your provider. Verdict never stores your API key.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">5. Storage and Data Removal</h2>
            <p>
              Audit results (including URL, screenshots, extracted text, scores, and findings) are persisted to provide shareable report links. There is currently no automated scheduled deletion. You may request permanent deletion of any audit report at any time by contacting us.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">6. Disclaimer of Warranties and Limitation of Liability</h2>
            <p>
              Verdict is provided "as is" and "as available", without warranty of any kind, express or implied. We do not warrant that audits will be uninterrupted, error-free, or meet specific regulatory accessibility standards. In no event shall Verdict be liable for any direct, indirect, incidental, or consequential damages arising from the use of this service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-ink font-display">7. Contact</h2>
            <p>
              For questions regarding these terms, contact us via{' '}
              <a 
                href={contactHref} 
                className="text-signal hover:underline font-medium"
                target={contactEmail ? undefined : "_blank"}
                rel={contactEmail ? undefined : "noopener noreferrer"}
              >
                {contactLabel}
              </a>.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
