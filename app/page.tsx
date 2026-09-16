'use client';

import { useState, useEffect } from 'react';

const ALL_CURRENCIES = ['USD', 'GBP', 'JPY', 'EUR', 'AUD', 'CAD', 'CHF', 'NZD'];

export default function Home() {
  const [currencies, setCurrencies] = useState<string[]>(['USD', 'GBP', 'JPY']);
  const [highImpact, setHighImpact] = useState(true);
  const [medImpact, setMedImpact] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  const toggleCurrency = (cur: string) => {
    setCurrencies(prev =>
      prev.includes(cur) ? prev.filter(c => c !== cur) : [...prev, cur]
    );
  };

  const impacts = [
    highImpact ? 'High' : null,
    medImpact ? 'Medium' : null,
  ].filter(Boolean).join(',');

  const queryParams = `currencies=${currencies.join(',')}&impacts=${impacts}`;
  const httpsUrl = `${baseUrl}/api/calendar?${queryParams}`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');

  const copyToClipboard = () => {
    navigator.clipboard.writeText(httpsUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
      <div className="max-w-xl w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Economic Calendar Feed</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Subscribe directly on your iOS Calendar for automated 5-minute news alerts.
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">
            Folder Impact
          </label>
          <div className="flex gap-4">
            <button
              onClick={() => setHighImpact(!highImpact)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                highImpact
                  ? 'bg-red-950/40 border-red-500/60 text-red-300'
                  : 'bg-neutral-800/40 border-neutral-700 text-neutral-500'
              }`}
            >
              🔴 High Impact (Red)
            </button>
            <button
              onClick={() => setMedImpact(!medImpact)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                medImpact
                  ? 'bg-amber-950/40 border-amber-500/60 text-amber-300'
                  : 'bg-neutral-800/40 border-neutral-700 text-neutral-500'
              }`}
            >
              🟠 Medium Impact (Orange)
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">
            Currencies
          </label>
          <div className="grid grid-cols-4 gap-2">
            {ALL_CURRENCIES.map(curr => {
              const active = currencies.includes(curr);
              return (
                <button
                  key={curr}
                  onClick={() => toggleCurrency(curr)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium border transition ${
                    active
                      ? 'bg-blue-950/40 border-blue-500/60 text-blue-300'
                      : 'bg-neutral-800/40 border-neutral-700 text-neutral-500'
                  }`}
                >
                  {curr}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-neutral-800 space-y-3">
          <a
            href={webcalUrl}
            className="w-full flex items-center justify-center py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium transition text-center shadow-lg shadow-blue-600/20"
          >
            Add to iOS Calendar
          </a>

          <div className="flex items-center gap-2">
            <input
              readOnly
              value={httpsUrl}
              className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-neutral-400 font-mono truncate"
            />
            <button
              onClick={copyToClipboard}
              className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-xs font-medium rounded-lg text-neutral-200 transition shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}