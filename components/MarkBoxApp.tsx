'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import {
  auth,
  db,
  extractLoginFromEmail,
  handleFirestoreError,
  OperationType,
  testConnection,
} from '@/lib/firebase';
import type { AssemblyBox, ScannedItem, UserProfile } from '@/lib/types';
import { AuthScreen } from '@/components/AuthScreen';
import { AssemblyWorkspace } from '@/components/AssemblyWorkspace';
import { BoxRegistry } from '@/components/BoxRegistry';
import { ProfilePanel } from '@/components/ProfilePanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  ScanBarcode,
  ClipboardList,
  User,
  Loader2,
} from 'lucide-react';

type ActiveTab = 'assembly' | 'registry' | 'profile';

function MarkBoxShell() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('assembly');
  const [boxes, setBoxes] = useState<AssemblyBox[]>([]);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
  const [activeBoxItems, setActiveBoxItems] = useState<ScannedItem[]>([]);
  const [selectedRegistryBoxId, setSelectedRegistryBoxId] = useState<string | null>(
    null
  );

  useEffect(() => {
    testConnection();
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfile(null);
        setBoxes([]);
        setActiveBoxId(null);
        setActiveBoxItems([]);
        setSelectedRegistryBoxId(null);
      }
    });
    return () => unsub();
  }, []);

  // Load user profile & operator boxes when authenticated
  useEffect(() => {
    if (!user) return;

    const userPath = `users/${user.uid}`;
    const unsubProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, userPath);
      }
    );

    const boxesPath = 'boxes';
    const boxesQuery = query(
      collection(db, 'boxes'),
      where('operatorId', '==', user.uid)
    );
    const unsubBoxes = onSnapshot(
      boxesQuery,
      (snapshot) => {
        const list: AssemblyBox[] = snapshot.docs.map(
          (d) => d.data() as AssemblyBox
        );
        list.sort(
          (a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0)
        );
        setBoxes(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, boxesPath);
      }
    );

    return () => {
      unsubProfile();
      unsubBoxes();
    };
  }, [user]);

  // Subscribe to scanned items of the active box being assembled
  useEffect(() => {
    if (!user || !activeBoxId) {
      return;
    }

    const itemsPath = `boxes/${activeBoxId}/items`;
    const itemsQuery = query(
      collection(db, 'boxes', activeBoxId, 'items'),
      where('operatorId', '==', user.uid)
    );

    const unsub = onSnapshot(
      itemsQuery,
      (snapshot) => {
        const list: ScannedItem[] = snapshot.docs.map(
          (d) => d.data() as ScannedItem
        );
        list.sort(
          (a, b) => (b.scannedAt?.seconds ?? 0) - (a.scannedAt?.seconds ?? 0)
        );
        setActiveBoxItems(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, itemsPath);
      }
    );

    return () => unsub();
  }, [user, activeBoxId]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin text-blue-700" />
          <span>Загрузка терминала...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const operatorLogin =
    profile?.login || extractLoginFromEmail(user.email);

  const completedCount = boxes.filter((b) => b.status === 'completed').length;

  function handleSelectActiveBox(nextId: string | null) {
    if (!nextId) {
      setActiveBoxItems([]);
    }
    setActiveBoxId(nextId);
  }

  function handleBoxCompleted(finishedBoxId: string) {
    setSelectedRegistryBoxId(finishedBoxId);
    setActiveTab('registry');
  }

  function handleResumeBox(boxId: string) {
    setActiveBoxId(boxId);
    setActiveTab('assembly');
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-900 flex flex-col">
      {/* Compact Top App Bar (44px mobile / 56px desktop) */}
      <header className="sticky top-0 z-30 h-11 md:h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto h-full px-3 md:px-4 flex items-center justify-between gap-4 md:gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('assembly')}
            className="flex items-center gap-2 text-sm md:text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 min-h-[44px]"
          >
            <Image
              src="/assets/aistudio/icon_b7e68eaf.png"
              alt="Ю-Терм. Маркировка"
              width={22}
              height={22}
              referrerPolicy="no-referrer"
              className="w-5 h-5 md:w-6 md:h-6 object-contain shrink-0"
            />
            <span>Ю-Терм. Маркировка</span>
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('assembly')}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'assembly'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Сборка коробки
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('registry')}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'registry'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Реестр ({completedCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'profile'
                  ? 'border-blue-700 text-blue-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Оператор: {operatorLogin}
            </button>
          </nav>

          {/* Mobile Single Contextual Right Action */}
          <button
            type="button"
            onClick={() => setActiveTab('registry')}
            className="md:hidden min-h-[44px] px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 rounded-lg whitespace-nowrap shrink-0 tabular-nums flex items-center"
          >
            Реестр ({completedCount})
          </button>
        </div>
      </header>

      {/* Main Scrollable Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-2.5 pt-2 pb-16 md:px-4 md:py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeTab === 'assembly' && (
              <AssemblyWorkspace
                userUid={user.uid}
                operatorLogin={operatorLogin}
                boxes={boxes}
                activeBoxId={activeBoxId}
                onSelectActiveBox={handleSelectActiveBox}
                activeBoxItems={activeBoxItems}
                onBoxCompleted={handleBoxCompleted}
              />
            )}

            {activeTab === 'registry' && (
              <BoxRegistry
                userUid={user.uid}
                boxes={boxes}
                selectedBoxId={selectedRegistryBoxId}
                onSelectBox={setSelectedRegistryBoxId}
                onResumeBox={handleResumeBox}
              />
            )}

            {activeTab === 'profile' && (
              <ProfilePanel
                profile={profile}
                fallbackLogin={operatorLogin}
                boxes={boxes}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Fixed Bottom Thumb Navigation (52px) */}
      <nav
        aria-label="Основная навигация"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-[52px] bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 items-center"
      >
        <button
          type="button"
          onClick={() => setActiveTab('assembly')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
            activeTab === 'assembly' ? 'text-blue-700' : 'text-slate-500'
          }`}
        >
          <ScanBarcode className="w-[18px] h-[18px]" />
          <span className="text-[10px] font-medium tracking-tight leading-none">Сборка</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('registry')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
            activeTab === 'registry' ? 'text-blue-700' : 'text-slate-500'
          }`}
        >
          <ClipboardList className="w-[18px] h-[18px]" />
          <span className="text-[10px] font-medium tracking-tight leading-none">Реестр</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${
            activeTab === 'profile' ? 'text-blue-700' : 'text-slate-500'
          }`}
        >
          <User className="w-[18px] h-[18px]" />
          <span className="text-[10px] font-medium tracking-tight leading-none">Профиль</span>
        </button>
      </nav>
    </div>
  );
}

export function MarkBoxApp() {
  return (
    <ErrorBoundary>
      <MarkBoxShell />
    </ErrorBoundary>
  );
}
