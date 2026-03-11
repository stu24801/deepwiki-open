'use client';

import React, { useState } from 'react';
import { FaWikipediaW, FaLock } from 'react-icons/fa';

interface LoginPageProps {
  onLoginSuccess: (code: string) => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter the access code.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        sessionStorage.setItem('deepwiki_auth_code', code);
        onLoginSuccess(code);
      } else {
        setError('Incorrect access code. Please try again.');
        setCode('');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen paper-texture">
      <div className="w-full max-w-sm mx-4">
        <div className="bg-[var(--card-bg)] rounded-lg shadow-custom border border-[var(--border-color)] p-8">
          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="bg-[var(--accent-primary)] p-3 rounded-lg mb-4">
              <FaWikipediaW className="text-3xl text-white" />
            </div>
            <h1 className="text-2xl font-bold text-[var(--accent-primary)] font-serif">DeepWiki</h1>
            <p className="text-sm text-[var(--muted)] mt-1">Enter access code to continue</p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="access-code"
                className="block text-sm font-medium text-[var(--foreground)] mb-2"
              >
                <FaLock className="inline mr-1.5 mb-0.5 text-[var(--accent-primary)]" />
                Access Code
              </label>
              <input
                id="access-code"
                type="password"
                value={code}
                onChange={(e) => { setCode(e.target.value); setError(null); }}
                placeholder="Enter your access code"
                autoFocus
                className="input-japanese block w-full px-4 py-2.5 border border-[var(--border-color)] rounded-lg bg-transparent text-[var(--foreground)] focus:outline-none focus:border-[var(--accent-primary)]"
                disabled={isLoading}
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn-japanese w-full py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isLoading ? 'Verifying...' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
