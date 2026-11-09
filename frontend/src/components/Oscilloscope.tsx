interface OscilloscopeProps {
  className?: string;
}

export function Oscilloscope({ className = '' }: OscilloscopeProps) {
  return (
    <div className={`relative w-64 h-24 bg-paper border border-line rounded p-2 overflow-hidden flex items-center justify-center ${className}`}>
      {/* Background Graticule Grid */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: 'linear-gradient(to right, #2955A3 1px, transparent 1px), linear-gradient(to bottom, #2955A3 1px, transparent 1px)',
          backgroundSize: '16px 16px'
        }}
      />
      {/* Waveform Line */}
      <svg viewBox="0 0 240 60" className="w-full h-full text-signal overflow-visible relative z-10" fill="none">
        <path 
          d="M 0 30 L 70 30 L 85 8 L 100 52 L 115 15 L 130 45 L 145 30 L 240 30" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          className="opacity-90"
        />
        <circle cx="115" cy="15" r="3" fill="#FAFAFA" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {/* Live sweep highlight bar */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-signal/15 to-transparent w-16 animate-[sweep_2.5s_ease-in-out_infinite]" />
    </div>
  );
}
