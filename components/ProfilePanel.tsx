'use client';

import React from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import type { AssemblyBox, UserProfile } from '@/lib/types';
import { LogOut, User, PackageCheck, ScanBarcode } from 'lucide-react';

interface ProfilePanelProps {
  profile: UserProfile | null;
  fallbackLogin: string;
  boxes: AssemblyBox[];
}

export function ProfilePanel({
  profile,
  fallbackLogin,
  boxes,
}: ProfilePanelProps) {
  const completedBoxes = boxes.filter((b) => b.status === 'completed');
  const totalItems = boxes.reduce((sum, b) => sum + (b.itemsCount || 0), 0);

  async function handleSignOut() {
    await signOut(auth);
  }

  return (
    <div className="max-w-lg mx-auto space-y-3 sm:space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-4 sm:p-6">
        <div className="flex items-center gap-3 pb-3.5 sm:pb-5 border-b border-slate-100">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate leading-tight">
              {profile?.displayName || fallbackLogin}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 truncate leading-tight mt-0.5">
              Логин: <span className="font-mono">{profile?.login || fallbackLogin}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 py-3.5 sm:py-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5 sm:mb-1">
              <PackageCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Собрано коробок</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums leading-tight">
              {completedBoxes.length}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5 sm:mb-1">
              <ScanBarcode className="w-3.5 h-3.5 text-blue-700" />
              <span>Всего кодов</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums leading-tight">
              {totalItems}
            </div>
          </div>
        </div>

        <div className="pt-3.5 sm:pt-5">
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full min-h-[44px] sm:min-h-[48px] px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Выйти из аккаунта</span>
          </button>
        </div>
      </div>
    </div>
  );
}
