import { useState, useEffect } from 'react';

export function HeroDemo() {
  const [progress, setProgress] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      setProgress(100);
      return;
    }

    let start = Date.now();
    let duration = 2500; // 2.5 seconds to scan
    
    const animate = () => {
      let now = Date.now();
      let p = Math.min((now - start) / duration, 1);
      
      // Easing out
      const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
      setProgress(easeOut(p) * 100);

      if (p < 1) {
        requestAnimationFrame(animate);
      } else {
        // loop after a delay
        setTimeout(() => {
          if (!prefersReducedMotion) {
            start = Date.now();
            requestAnimationFrame(animate);
          }
        }, 2000);
      }
    };
    
    const rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [prefersReducedMotion]);

  const score = Math.floor(progress * 0.98); // reaches 98

  // Sample annotations that appear as the line sweeps past them
  const annotations = [
    { top: 20, time: '0:14', text: 'Visual Hierarchy' },
    { top: 45, time: '0:31', text: 'Low Contrast' },
    { top: 75, time: '0:45', text: 'Missing Alt Text' }
  ];

  return (
    <div className="relative w-full max-w-xs sm:max-w-sm mx-auto h-64 bg-paper border border-line rounded shadow-lg overflow-hidden flex flex-col mt-8 md:mt-0">
      {/* Fake browser header */}
      <div className="h-8 border-b border-line bg-paper/50 flex items-center px-3 gap-1.5 shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-line" />
        <div className="w-2.5 h-2.5 rounded-full bg-line" />
        <div className="w-2.5 h-2.5 rounded-full bg-line" />
        <div className="ml-4 h-4 bg-line/50 rounded flex-1 max-w-[120px]" />
      </div>
      
      {/* Fake website body */}
      <div className="relative flex-1 p-4 flex flex-col gap-4 overflow-hidden pointer-events-none">
        <div className="w-3/4 h-8 bg-line/30 rounded" />
        <div className="w-full h-24 bg-line/20 rounded" />
        <div className="flex gap-4">
          <div className="w-1/2 h-16 bg-line/20 rounded" />
          <div className="w-1/2 h-16 bg-line/20 rounded" />
        </div>
        
        {/* Annotations */}
        {annotations.map((ann, i) => {
          const isVisible = progress > ann.top;
          return (
            <div 
              key={i} 
              className={`absolute left-0 w-full flex items-center gap-2 px-4 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
              style={{ top: `${ann.top}%` }}
            >
              <div className="w-2 h-2 rounded-full bg-flag-warning shrink-0 shadow-[0_0_8px_rgba(161,102,24,0.6)]" />
              <div className="flex items-center bg-white border border-flag-warning rounded shadow-sm overflow-hidden">
                <span className="font-mono text-signal text-[10px] font-bold px-1.5 py-0.5 border-r border-flag-warning/30 bg-signal/5">
                  {ann.time}
                </span>
                <span className="text-flag-warning text-[10px] font-bold px-1.5 py-0.5">
                  {ann.text}
                </span>
              </div>
            </div>
          );
        })}

        {/* Scan line waveform */}
        <div 
          className="absolute left-0 w-full z-10 -translate-y-1/2"
          style={{ 
            top: `${progress}%`, 
            display: progress === 100 && prefersReducedMotion ? 'none' : 'block',
            opacity: progress > 99 ? 0 : 1,
            transition: 'opacity 0.3s'
          }}
        >
          <svg viewBox="0 0 384 30" className="w-full h-[30px] text-signal overflow-visible">
            <path 
              d="M -10 15 L 160 15 L 170 2 L 180 28 L 190 5 L 200 25 L 210 8 L 220 15 L 400 15" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinejoin="round" 
              strokeLinecap="round" 
            />
          </svg>
        </div>

        {/* Scanning highlight overlay */}
        <div 
          className="absolute left-0 top-0 w-full bg-signal/5 z-0"
          style={{ 
            height: `${progress}%`,
            display: prefersReducedMotion ? 'none' : 'block'
          }}
        />
      </div>

      {/* Floating score badge */}
      <div className={`absolute bottom-4 right-4 z-20 bg-white border border-line rounded-full px-3 py-1.5 shadow-md flex items-center gap-2 transition-transform duration-500 ${progress > 10 ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
        <div className="w-2 h-2 rounded-full bg-signal animate-pulse" style={{ animationPlayState: progress === 100 ? 'paused' : 'running' }} />
        <span className="font-mono text-sm font-bold text-ink">{score}/100</span>
      </div>
    </div>
  );
}
