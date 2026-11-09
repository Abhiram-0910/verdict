import { useState, useEffect } from 'react';
import { Key, AlertCircle, Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

type ProviderName = 'gemini' | 'openai' | 'anthropic' | 'xai' | 'openrouter';

interface ModelInfo {
  id: string;
  displayName: string;
  supportsVision: boolean;
}

interface BYOKPanelProps {
  onChange: (data: {
    provider: ProviderName;
    apiKey: string;
    model: string;
    isValid: boolean;
  }) => void;
}

export function BYOKPanel({ onChange }: BYOKPanelProps) {
  const [provider, setProvider] = useState<ProviderName>('openai');
  const [apiKey, setApiKey] = useState('');
  const [debouncedKey, setDebouncedKey] = useState('');
  const [model, setModel] = useState('');
  const [modelsList, setModelsList] = useState<ModelInfo[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isColdStarting, setIsColdStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce API key
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKey(apiKey);
    }, 500);
    return () => clearTimeout(timer);
  }, [apiKey]);

  // Fetch models
  useEffect(() => {
    let active = true;

    async function fetchModels() {
      // OpenRouter doesn't require a key to fetch models, others do.
      // Require at least 20 chars for other providers so we don't flash errors while typing.
      if (provider !== 'openrouter' && debouncedKey.trim().length < 20) {
        if (active) {
          setModelsList([]);
          setError(null);
        }
        return;
      }

      let timer: ReturnType<typeof setTimeout>;
      if (active) {
        setIsLoading(true);
        setIsColdStarting(false);
        timer = setTimeout(() => setIsColdStarting(true), 4500);
        setError(null);
      }

      try {
        const res = await fetch(`${API_URL}/api/providers/models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            ...(debouncedKey.trim() ? { apiKey: debouncedKey.trim() } : {})
          })
        });

        if (!active) return;

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const reason = errData.error || 'UNKNOWN';
          let userFriendlyError = "An error occurred fetching models. Please check your key.";
          
          switch (reason) {
            case 'INVALID_API_KEY':
            case 'AUTH_FAILED': 
              userFriendlyError = "That key was rejected — check it's correct."; 
              break;
            case 'AI_RATE_LIMIT': 
              userFriendlyError = "This key is currently rate-limited."; 
              break;
            case 'FETCH_FAILED': 
              userFriendlyError = "Failed to reach the provider. Try again."; 
              break;
            case 'TIMEOUT': 
              userFriendlyError = "The provider took too long to respond."; 
              break;
            case 'BLOCKED': 
              userFriendlyError = "The request was blocked by the provider."; 
              break;
            case 'Bad Request':
              userFriendlyError = "API key is required for this provider.";
              break;
          }
          
          setModelsList([]);
          setError(userFriendlyError);
        } else {
          const data: ModelInfo[] = await res.json();
          setModelsList(data);
          setError(null);
          // Auto-select preferred model if current isn't in the list
          if (data.length > 0 && !data.some(m => m.id === model)) {
            const preferred = data.find(m => 
              m.id.includes('gpt-4o') || 
              m.id.includes('claude-3-5-sonnet') || 
              m.id.includes('gemini')
            );
            setModel(preferred ? preferred.id : data[0].id);
          }
        }
      } catch {
        if (active) {
          setModelsList([]);
          setError("Failed to connect to the server.");
        }
      } finally {
        if (timer!) clearTimeout(timer);
        if (active) {
          setIsLoading(false);
          setIsColdStarting(false);
        }
      }
    }

    fetchModels();

    return () => {
      active = false;
    };
  }, [provider, debouncedKey]);

  // Report changes upward
  useEffect(() => {
    const isKeyValid = debouncedKey.trim().length > 0;
    const isValid = !!(isKeyValid && model && modelsList.some(m => m.id === model) && !error);
    
    onChange({
      provider,
      apiKey: debouncedKey.trim(),
      model,
      isValid
    });
  }, [provider, debouncedKey, model, modelsList, error, onChange]);

  return (
    <div className="bg-white border border-line rounded p-5 mt-4 shadow-sm text-left animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="flex items-center gap-2 mb-5">
        <Key className="w-5 h-5 text-signal" aria-hidden="true" />
        <h2 className="text-base font-semibold text-ink font-display">Use your own API key</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <div>
          <label htmlFor="byok-provider" className="block text-sm font-medium text-ink/80 mb-1.5">
            Provider
          </label>
          <select 
            id="byok-provider"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ProviderName);
              setModel('');
              setModelsList([]);
            }}
            className="w-full bg-paper border border-line rounded px-3 py-2.5 text-ink text-sm transition-colors focus:border-signal"
          >
            <option value="openai" className="bg-white text-ink">OpenAI</option>
            <option value="anthropic" className="bg-white text-ink">Anthropic</option>
            <option value="gemini" className="bg-white text-ink">Google Gemini</option>
            <option value="openrouter" className="bg-white text-ink">OpenRouter</option>
            <option value="xai" className="bg-white text-ink">xAI (Grok)</option>
          </select>
        </div>
        
        <div>
          <label htmlFor="byok-api-key" className="block text-sm font-medium text-ink/80 mb-1.5">
            API Key
          </label>
          <input 
            id="byok-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider === 'openrouter' ? "Optional for free models..." : "sk-..."}
            className="w-full bg-paper border border-line rounded px-3 py-2.5 text-ink text-sm transition-colors placeholder:text-ink/40 focus:border-signal"
          />
        </div>
      </div>

      <div className="relative">
        <label htmlFor="byok-model" className="block text-sm font-medium text-ink/80 mb-1.5">
          Vision Model
        </label>
        <select 
          id="byok-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={isLoading || modelsList.length === 0}
          className="w-full bg-paper border border-line rounded px-3 py-2.5 text-ink text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed appearance-none focus:border-signal"
        >
          {modelsList.length === 0 && !isLoading && (
            <option value="" className="bg-white text-ink">{error ? '—' : 'Enter API key to load models...'}</option>
          )}
          {modelsList.map(m => (
            <option key={m.id} value={m.id} className="bg-white text-ink">{m.displayName}</option>
          ))}
        </select>
        {isLoading && (
          <div className="absolute right-3 top-[34px]">
            <Loader2 className="w-4 h-4 text-signal animate-spin" aria-hidden="true" />
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 text-flag-critical bg-flag-critical/10 px-4 py-3 rounded border border-flag-critical/20">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium leading-relaxed">{error}</span>
        </div>
      )}

      {/* Cold Start Indicator for BYOK */}
      {isColdStarting && !error && (
        <div className="mt-4 flex items-start gap-2 text-ink/70 bg-paper px-4 py-3 rounded border border-line animate-in fade-in duration-500">
          <Loader2 className="w-4 h-4 mt-0.5 animate-spin shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium leading-relaxed">Booting the analysis engine — first request after idle can take a moment.</span>
        </div>
      )}
    </div>
  );
}
