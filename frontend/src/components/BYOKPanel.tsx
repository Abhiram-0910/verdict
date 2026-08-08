import React, { useState, useEffect, useRef } from 'react';
import { Key, AlertCircle, Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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
          // If we had a model selected but key is wiped, we are invalid.
        }
        return;
      }

      if (active) {
        setIsLoading(true);
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
      } catch (err) {
        if (active) {
          setModelsList([]);
          setError("Failed to connect to the server.");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    fetchModels();

    return () => {
      active = false;
    };
  }, [provider, debouncedKey]);

  // Report changes upward
  useEffect(() => {
    // A key is always required to actually run an audit, even for OpenRouter.
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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mt-4 shadow-xl text-left animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="flex items-center gap-2 mb-4">
        <Key className="w-5 h-5 text-indigo-400" />
        <h3 className="text-sm font-semibold text-slate-200">Use your own API key</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Provider</label>
          <select 
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ProviderName);
              setModel('');
              setModelsList([]);
            }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Google Gemini</option>
            <option value="openrouter">OpenRouter</option>
            <option value="xai">xAI (Grok)</option>
          </select>
        </div>
        
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">API Key</label>
          <input 
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider === 'openrouter' ? "Optional for free models..." : "sk-..."}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600"
          />
        </div>
      </div>

      <div className="relative">
        <label className="block text-xs font-medium text-slate-400 mb-1">Vision Model</label>
        <select 
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={isLoading || modelsList.length === 0}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50 appearance-none"
        >
          {modelsList.length === 0 && !isLoading && (
            <option value="">{error ? '—' : 'Enter API key to load models...'}</option>
          )}
          {modelsList.map(m => (
            <option key={m.id} value={m.id}>{m.displayName}</option>
          ))}
        </select>
        {isLoading && (
          <div className="absolute right-3 top-7">
            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 text-rose-400 bg-rose-950/30 px-3 py-2 rounded-lg border border-rose-900/50">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="text-xs font-medium leading-relaxed">{error}</span>
        </div>
      )}
    </div>
  );
}
