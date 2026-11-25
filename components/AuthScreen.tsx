'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import {
  auth,
  db,
  firebaseProjectId,
  normalizeLoginToEmail,
  extractLoginFromEmail,
  handleFirestoreError,
  OperationType,
} from '@/lib/firebase';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';

interface AuthScreenProps {
  onAuthenticated?: () => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [needsConsoleSetup, setNeedsConsoleSetup] = useState(false);

  async function ensureUserProfile(uid: string, userLogin: string, name: string) {
    const userRef = doc(db, 'users', uid);
    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid,
          login: userLogin.slice(0, 64),
          displayName: (name || userLogin).slice(0, 80),
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorText(null);
    setNeedsConsoleSetup(false);

    const trimmedLogin = login.trim();
    if (trimmedLogin.length < 2) {
      setErrorText('Введите логин (минимум 2 символа).');
      return;
    }
    if (password.length < 6) {
      setErrorText('Пароль должен содержать не менее 6 символов.');
      return;
    }

    const email = normalizeLoginToEmail(trimmedLogin);
    if (!email || email.startsWith('@')) {
      setErrorText('Логин должен содержать латинские буквы или цифры.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await ensureUserProfile(
          cred.user.uid,
          trimmedLogin,
          cred.user.displayName || trimmedLogin
        );
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const finalName = displayName.trim() || trimmedLogin;
        await updateProfile(cred.user, { displayName: finalName });
        await ensureUserProfile(cred.user.uid, trimmedLogin, finalName);
      }
      onAuthenticated?.();
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: string }).code)
          : '';

      if (code === 'auth/operation-not-allowed') {
        setNeedsConsoleSetup(true);
        setErrorText(
          'В проекте Firebase ещё не включён вход по логину/паролю (Email/Password).'
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setErrorText('Неверный логин или пароль. Проверьте данные или зарегистрируйтесь.');
      } else if (code === 'auth/email-already-in-use') {
        setErrorText('Оператор с таким логином уже существует. Переключитесь на «Вход».');
      } else if (code === 'auth/weak-password') {
        setErrorText('Слишком простой пароль. Используйте минимум 6 символов.');
      } else if (code === 'auth/too-many-requests') {
        setErrorText('Слишком много попыток входа. Подождите немного и попробуйте снова.');
      } else {
        setErrorText(
          err instanceof Error ? err.message : 'Не удалось выполнить авторизацию.'
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setErrorText(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      const fallbackLogin = extractLoginFromEmail(cred.user.email);
      await ensureUserProfile(
        cred.user.uid,
        fallbackLogin,
        cred.user.displayName || fallbackLogin
      );
      onAuthenticated?.();
    } catch (err: unknown) {
      setErrorText(
        err instanceof Error ? err.message : 'Ошибка авторизации через Google.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9] flex flex-col justify-center px-3 py-4 sm:px-6 sm:py-8">
      <div className="w-full max-w-md mx-auto">
        <div className="mb-3 sm:mb-6 flex items-center gap-2.5 sm:gap-3">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 p-1.5 shadow-xs">
            <Image
              src="/assets/aistudio/icon_b7e68eaf.png"
              alt="Ю-Терм. Маркировка"
              width={32}
              height={32}
              referrerPolicy="no-referrer"
              className="w-7 h-7 sm:w-8 sm:h-8 object-contain"
            />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 leading-tight">
              Ю-Терм. Маркировка
            </h1>
            <p className="text-xs text-slate-500 leading-tight mt-0.5">
              Сборка коробок · Data Matrix Честный ЗНАК
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-xs">
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl mb-3.5 sm:mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorText(null);
              }}
              className={`min-h-[42px] sm:min-h-[44px] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorText(null);
              }}
              className={`min-h-[42px] sm:min-h-[44px] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-2.5 sm:space-y-4">
            <div>
              <label
                htmlFor="operator-login"
                className="block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-1.5"
              >
                Логин оператора
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="operator-login"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="sklad_01 или ivanov@company.ru"
                  className="w-full min-h-[44px] sm:min-h-[48px] pl-9 sm:pl-10 pr-3 sm:pr-4 bg-white border border-slate-300 rounded-xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
                  required
                />
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label
                  htmlFor="operator-name"
                  className="block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-1.5"
                >
                  Имя / ФИО (для реестра)
                </label>
                <input
                  id="operator-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Алексей Смирнов"
                  className="w-full min-h-[44px] sm:min-h-[48px] px-3 sm:px-4 bg-white border border-slate-300 rounded-xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="operator-password"
                className="block text-xs sm:text-sm font-medium text-slate-700 mb-1 sm:mb-1.5"
              >
                Пароль
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="operator-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                  className="w-full min-h-[44px] sm:min-h-[48px] pl-9 sm:pl-10 pr-11 sm:pr-12 bg-white border border-slate-300 rounded-xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {errorText && (
              <div className="p-2.5 sm:p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs sm:text-sm text-red-800 space-y-1.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <span className="leading-snug">{errorText}</span>
                </div>

                {needsConsoleSetup && (
                  <div className="pt-1.5 border-t border-red-200 text-xs text-red-900 space-y-1">
                    <p className="font-semibold">
                      Как включить вход по логину и паролю:
                    </p>
                    <ol className="list-decimal pl-4 space-y-0.5">
                      <li>Откройте Firebase Console (Authentication → Sign-in method).</li>
                      <li>Нажмите «Добавить провайдера» → «Адрес эл. почты и пароль».</li>
                      <li>Включите первый переключатель и сохраните изменения.</li>
                    </ol>
                    <a
                      href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/providers`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:underline pt-1"
                    >
                      <span>Открыть настройки Firebase Auth</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] sm:min-h-[48px] px-4 py-2.5 sm:py-3 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <span>
                {loading
                  ? 'Выполняется вход...'
                  : mode === 'login'
                    ? 'Войти в терминал'
                    : 'Создать аккаунт и войти'}
              </span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <div className="my-3 sm:my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-400">или</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleSignIn}
            className="w-full min-h-[44px] px-4 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-sm font-medium rounded-xl transition-colors"
          >
            Войти через Google
          </button>
        </div>
      </div>
    </div>
  );
}
