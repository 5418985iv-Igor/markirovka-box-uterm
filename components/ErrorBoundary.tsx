'use client';

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = error.message || 'Произошла непредвиденная ошибка приложения.';
    try {
      const parsed = JSON.parse(error.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed && typeof parsed.error === 'string') {
        message = `Ошибка доступа к базе данных (${parsed.operationType || 'операция'} ${parsed.path || ''}): ${parsed.error}`;
      }
    } catch {
      // Keep raw error message
    }
    return { hasError: true, message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="w-11 h-11 rounded-xl bg-red-50 text-red-700 flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 mb-2">
              Сбой работы терминала
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed mb-5 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Обновить страницу</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
