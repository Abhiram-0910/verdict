import { Link } from 'react-router-dom';

export function Footer() {
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL;
  const contactHref = contactEmail ? `mailto:${contactEmail}` : 'https://github.com/Abhiram-0910/verdict/issues';
  const contactLabel = contactEmail || 'Contact & Support';

  return (
    <footer className="border-t border-line bg-paper py-8 px-5 mt-auto">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink/60">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink font-display">Verdict</span>
          <span>&mdash;</span>
          <span>Automated website first-impression diagnostics</span>
        </div>

        <nav aria-label="Footer" className="flex items-center gap-6">
          <Link 
            to="/privacy" 
            className="hover:text-ink transition-colors underline-offset-4 hover:underline"
          >
            Privacy
          </Link>
          <Link 
            to="/terms" 
            className="hover:text-ink transition-colors underline-offset-4 hover:underline"
          >
            Terms
          </Link>
          <a 
            href={contactHref}
            target={contactEmail ? undefined : "_blank"}
            rel={contactEmail ? undefined : "noopener noreferrer"}
            className="hover:text-ink transition-colors underline-offset-4 hover:underline"
          >
            {contactLabel}
          </a>
        </nav>
      </div>
    </footer>
  );
}
