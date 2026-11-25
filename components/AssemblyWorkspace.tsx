'use client';

import React, { useRef, useState } from 'react';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import {
  parseBoxQrCode,
  parseDataMatrix,
  formatCodeForDisplay,
  formatTimestampRu,
  formatTimeOnlyRu,
  generateSafeId,
  hashCodeToId,
  playScanFeedback,
} from '@/lib/datamatrix';
import type { AssemblyBox, ScannedItem, ScanFormat } from '@/lib/types';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import {
  Package,
  PackageCheck,
  QrCode,
  ScanBarcode,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
} from 'lucide-react';

interface AssemblyWorkspaceProps {
  userUid: string;
  operatorLogin: string;
  boxes: AssemblyBox[];
  activeBoxId: string | null;
  onSelectActiveBox: (boxId: string | null) => void;
  activeBoxItems: ScannedItem[];
  onBoxCompleted: (boxId: string) => void;
}

interface ScanBanner {
  type: 'success' | 'duplicate' | 'error';
  title: string;
  subtitle?: string;
}

export function AssemblyWorkspace({
  userUid,
  operatorLogin,
  boxes,
  activeBoxId,
  onSelectActiveBox,
  activeBoxItems,
  onBoxCompleted,
}: AssemblyWorkspaceProps) {
  const [scannerOpen, setScannerOpen] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [scanBanner, setScanBanner] = useState<ScanBanner | null>(null);
  const [confirmEmptyFinish, setConfirmEmptyFinish] = useState(false);
  const scanLockRef = useRef(false);

  const activeBox = boxes.find((b) => b.id === activeBoxId) || null;
  const openBoxes = boxes.filter((b) => b.status === 'assembling');

  async function handleBoxQrDetected(rawCode: string) {
    if (busyAction || scanLockRef.current) return;
    const { boxCode, boxNumber } = parseBoxQrCode(rawCode);
    if (!boxCode || !boxNumber) {
      playScanFeedback('error');
      setScanBanner({
        type: 'error',
        title: 'Пустой QR-код коробки',
        subtitle: 'Повторите сканирование этикетки коробки.',
      });
      return;
    }

    // Resume existing open box if same QR code
    const existingOpen = openBoxes.find((b) => b.boxCode === boxCode);
    if (existingOpen) {
      playScanFeedback('success');
      setScanBanner({
        type: 'success',
        title: `Продолжена сборка коробки № ${existingOpen.boxNumber}`,
        subtitle: `Уже внутри: ${existingOpen.itemsCount} шт.`,
      });
      onSelectActiveBox(existingOpen.id);
      return;
    }

    scanLockRef.current = true;
    setBusyAction(true);
    const newBoxId = generateSafeId('box');
    const path = `boxes/${newBoxId}`;
    try {
      await setDoc(doc(db, 'boxes', newBoxId), {
        id: newBoxId,
        boxCode,
        boxNumber,
        operatorId: userUid,
        operatorLogin: operatorLogin.slice(0, 64) || 'operator',
        status: 'assembling',
        itemsCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      playScanFeedback('success');
      setScanBanner({
        type: 'success',
        title: `Открыта коробка № ${boxNumber}`,
        subtitle: 'Теперь считывайте коды Data Matrix или QR с товаров.',
      });
      setScannerOpen(true);
      onSelectActiveBox(newBoxId);
    } catch (error) {
      playScanFeedback('error');
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      scanLockRef.current = false;
      setBusyAction(false);
    }
  }

  async function handleItemScanned(rawCode: string, format: ScanFormat) {
    if (!activeBox || activeBox.status !== 'assembling' || busyAction || scanLockRef.current) {
      return;
    }

    const parsed = parseDataMatrix(rawCode);
    if (!parsed.rawCode) return;

    const normalizedRaw = parsed.rawCode.trim();
    const { boxCode: scannedAsBoxCode, boxNumber: scannedAsBoxNumber } =
      parseBoxQrCode(rawCode);

    // Block re-scanning the current box QR code (or box number) as a product item
    const activeBoxCode = activeBox.boxCode.trim();
    const activeBoxNumber = activeBox.boxNumber.trim();
    const isCurrentBoxQr =
      normalizedRaw === activeBoxCode ||
      normalizedRaw === activeBoxNumber ||
      (Boolean(scannedAsBoxCode) && scannedAsBoxCode === activeBoxCode) ||
      (Boolean(scannedAsBoxNumber) && scannedAsBoxNumber === activeBoxCode);

    if (isCurrentBoxQr) {
      playScanFeedback('duplicate');
      setScanBanner({
        type: 'duplicate',
        title: 'Отсканирован QR-код текущей коробки',
        subtitle: `Коробка № ${activeBox.boxNumber} уже открыта. Считайте код с товара.`,
      });
      return;
    }

    // Also block scanning any other known box QR code as a product item
    const matchedOtherBox = boxes.find((b) => {
      if (b.id === activeBox.id) return false;
      const otherCode = b.boxCode.trim();
      return (
        normalizedRaw === otherCode ||
        (Boolean(scannedAsBoxCode) && scannedAsBoxCode === otherCode)
      );
    });

    if (matchedOtherBox) {
      playScanFeedback('duplicate');
      setScanBanner({
        type: 'duplicate',
        title: 'Отсканирован QR-код коробки',
        subtitle: `Код коробки № ${matchedOtherBox.boxNumber} нельзя добавить как штучный товар.`,
      });
      return;
    }

    const itemId = await hashCodeToId(parsed.rawCode);

    // Check duplicate in current box
    if (activeBoxItems.some((item) => item.id === itemId)) {
      playScanFeedback('duplicate');
      setScanBanner({
        type: 'duplicate',
        title: 'Товар уже в этой коробке',
        subtitle: parsed.gtin
          ? `GTIN ${parsed.gtin} · S/N ${parsed.serial || '—'}`
          : formatCodeForDisplay(parsed.rawCode).slice(0, 48),
      });
      return;
    }

    scanLockRef.current = true;
    setBusyAction(true);
    const itemPath = `boxes/${activeBox.id}/items/${itemId}`;
    try {
      const batch = writeBatch(db);
      const itemRef = doc(db, 'boxes', activeBox.id, 'items', itemId);
      const boxRef = doc(db, 'boxes', activeBox.id);

      batch.set(itemRef, {
        id: itemId,
        boxId: activeBox.id,
        operatorId: userUid,
        rawCode: parsed.rawCode,
        gtin: parsed.gtin,
        serial: parsed.serial,
        cryptoTail: parsed.cryptoTail,
        format,
        scannedAt: serverTimestamp(),
      });

      batch.update(boxRef, {
        itemsCount: increment(1),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
      playScanFeedback('success');
      setConfirmEmptyFinish(false);
      setScanBanner({
        type: 'success',
        title: parsed.isChestnyZnak
          ? 'Код Честный ЗНАК зафиксирован'
          : 'Товар добавлен в коробку',
        subtitle: parsed.gtin
          ? `GTIN ${parsed.gtin} · S/N ${parsed.serial || '—'}`
          : formatCodeForDisplay(parsed.rawCode).slice(0, 48),
      });
    } catch (error) {
      playScanFeedback('error');
      handleFirestoreError(error, OperationType.WRITE, itemPath);
    } finally {
      scanLockRef.current = false;
      setBusyAction(false);
    }
  }

  async function handleRemoveItem(item: ScannedItem) {
    if (!activeBox || activeBox.status !== 'assembling' || busyAction) return;
    setBusyAction(true);
    const itemPath = `boxes/${activeBox.id}/items/${item.id}`;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'boxes', activeBox.id, 'items', item.id));
      batch.update(doc(db, 'boxes', activeBox.id), {
        itemsCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setScanBanner({
        type: 'duplicate',
        title: 'Позиция удалена из коробки',
        subtitle: item.gtin
          ? `GTIN ${item.gtin} · S/N ${item.serial || '—'}`
          : formatCodeForDisplay(item.rawCode).slice(0, 40),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, itemPath);
    } finally {
      setBusyAction(false);
    }
  }

  async function handleDiscardEmptyBox() {
    if (!activeBox || activeBoxItems.length > 0 || busyAction) return;
    setBusyAction(true);
    const path = `boxes/${activeBox.id}`;
    try {
      await deleteDoc(doc(db, 'boxes', activeBox.id));
      setScanBanner(null);
      onSelectActiveBox(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    } finally {
      setBusyAction(false);
    }
  }

  async function handleFinishAssembly() {
    if (!activeBox || activeBox.status !== 'assembling' || busyAction) return;
    if (activeBoxItems.length === 0 && !confirmEmptyFinish) {
      setConfirmEmptyFinish(true);
      return;
    }

    setBusyAction(true);
    const path = `boxes/${activeBox.id}`;
    try {
      await updateDoc(doc(db, 'boxes', activeBox.id), {
        status: 'completed',
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      playScanFeedback('success');
      setConfirmEmptyFinish(false);
      setScanBanner(null);
      const finishedId = activeBox.id;
      onSelectActiveBox(null);
      onBoxCompleted(finishedId);
    } catch (error) {
      playScanFeedback('error');
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setBusyAction(false);
    }
  }

  // --- STEP 1: NO ACTIVE BOX -> SCAN BOX QR CODE ---
  if (!activeBox) {
    return (
      <div className="space-y-2.5 sm:space-y-5">
        <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-3 sm:p-6">
          <div className="flex items-center sm:items-start gap-2.5 sm:gap-3 mb-2.5 sm:mb-4">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              <QrCode className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                Шаг 1. Отсканируйте QR-код коробки
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 leading-snug mt-0.5">
                Наведите камеру на этикетку коробки или введите её номер.
              </p>
            </div>
          </div>

          <BarcodeScanner
            key="scanner-box-qr"
            mode="box-qr"
            continuous={false}
            active={true}
            onDetected={(code) => handleBoxQrDetected(code)}
            placeholder="Номер или QR коробки (напр. BOX-2026-0041)"
            manualLabel="Номер или QR-код коробки"
          />
        </div>

        {openBoxes.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-3 sm:p-5">
            <div className="flex items-baseline justify-between gap-2 mb-1.5 sm:mb-2.5">
              <h3 className="text-sm sm:text-base font-semibold text-slate-900 leading-tight">
                Незавершённые коробки
              </h3>
              <span className="text-[11px] sm:text-xs text-slate-500">
                Нажмите для продолжения
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {openBoxes.map((box) => (
                <button
                  key={box.id}
                  type="button"
                  onClick={() => {
                    setScanBanner(null);
                    onSelectActiveBox(box.id);
                  }}
                  className="w-full min-h-[48px] py-1.5 sm:py-2.5 flex items-center justify-between gap-2.5 text-left hover:bg-slate-50 rounded-xl px-2 -mx-2 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate leading-tight">
                        Коробка № {box.boxNumber}
                      </p>
                      <p className="text-[11px] sm:text-xs text-slate-500 truncate tabular-nums leading-tight mt-0.5">
                        {box.itemsCount} шт. · {formatTimestampRu(box.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- STEP 2: ACTIVE BOX ASSEMBLY -> SCAN DATA MATRIX CODES ---
  return (
    <div className="space-y-2 sm:space-y-4">
      {/* Active Box Summary Header */}
      <div className="bg-white border border-slate-200 rounded-xl sm:rounded-2xl px-3 py-2 sm:p-4">
        <div className="flex items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setScanBanner(null);
                  setConfirmEmptyFinish(false);
                  onSelectActiveBox(null);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 min-h-[44px] -my-2.5 pr-1.5 shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Сменить</span>
              </button>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <h2 className="text-base sm:text-xl font-bold text-slate-900 truncate leading-tight">
                Коробка № {activeBox.boxNumber}
              </h2>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 truncate leading-tight">
              QR: <span className="font-mono">{activeBox.boxCode}</span> ·{' '}
              {formatTimestampRu(activeBox.createdAt)}
            </p>
          </div>

          <div className="text-right shrink-0 flex items-baseline gap-1 sm:block">
            <div className="text-xl sm:text-3xl font-bold text-blue-700 tabular-nums leading-none">
              {activeBoxItems.length}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500 sm:mt-0.5 leading-none">
              шт.
            </div>
          </div>
        </div>

        {activeBoxItems.length === 0 && (
          <div className="mt-1.5 pt-1.5 sm:mt-2.5 sm:pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
            <span className="text-[11px] sm:text-xs text-slate-500 leading-tight truncate">
              Пусто — отсканируйте первый товар
            </span>
            <button
              type="button"
              disabled={busyAction}
              onClick={handleDiscardEmptyBox}
              className="text-[11px] sm:text-xs font-medium text-red-700 hover:text-red-800 px-2 min-h-[44px] -my-2.5 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap shrink-0 flex items-center"
            >
              Отменить коробку
            </button>
          </div>
        )}
      </div>

      {/* Scan Feedback Banner */}
      {scanBanner && (
        <div
          role="status"
          className={`px-3 py-2 sm:p-3.5 rounded-xl border flex items-center gap-2 ${
            scanBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : scanBanner.type === 'duplicate'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {scanBanner.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-700 shrink-0" />
          ) : (
            <AlertTriangle
              className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 ${
                scanBanner.type === 'duplicate' ? 'text-amber-700' : 'text-red-700'
              }`}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-semibold leading-tight">
              {scanBanner.title}
            </p>
            {scanBanner.subtitle && (
              <p className="text-[11px] sm:text-xs font-mono opacity-85 truncate leading-tight mt-0.5">
                {scanBanner.subtitle}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Main Responsive Split on Tablet/Desktop: Scanner + Items List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-4 items-start">
        {/* Scanner Panel */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-2.5 sm:p-4">
          <button
            type="button"
            onClick={() => setScannerOpen((prev) => !prev)}
            className="w-full min-h-[44px] -my-1.5 flex items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <ScanBarcode className="w-4 h-4 sm:w-5 sm:h-5 text-blue-700 shrink-0" />
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900 leading-tight truncate">
                  Шаг 2. Сканирование Data Matrix товара
                </h3>
                <p className="hidden sm:block text-xs text-slate-500 leading-tight mt-0.5">
                  Непрерывный режим с защитой от дублей
                </p>
              </div>
            </div>
            {scannerOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
            )}
          </button>

          {scannerOpen && (
            <div className="mt-2 sm:mt-3">
              <BarcodeScanner
                key={`scanner-item-${activeBox.id}`}
                mode="item-datamatrix"
                continuous={true}
                active={scannerOpen}
                onDetected={(code, fmt) => handleItemScanned(code, fmt)}
                placeholder="Вставьте код Data Matrix (01...21...)"
                manualLabel="Штучный код Data Matrix"
              />
            </div>
          )}
        </div>

        {/* Scanned Items List */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 flex flex-col">
          <div className="flex items-center justify-between gap-2 pb-1.5 sm:pb-2.5 border-b border-slate-100">
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900 leading-tight">
              Состав коробки ({activeBoxItems.length})
            </h3>
            <span className="text-[11px] sm:text-xs text-slate-500 tabular-nums leading-tight">
              Последние сверху
            </span>
          </div>

          {activeBoxItems.length === 0 ? (
            <div className="py-3 sm:py-8 text-center">
              <ScanBarcode className="w-6 h-6 sm:w-8 sm:h-8 text-slate-300 mx-auto mb-1 sm:mb-2" />
              <p className="text-xs sm:text-sm text-slate-500 leading-snug">
                Отсканируйте Data Matrix или QR-код товара камерой
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[168px] sm:max-h-[380px] overflow-y-auto -mx-1 px-1">
              {activeBoxItems.map((item, idx) => {
                const itemNumber = activeBoxItems.length - idx;
                return (
                  <div
                    key={item.id}
                    className="py-1.5 sm:py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[11px] sm:text-xs text-slate-500 leading-tight">
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          #{itemNumber}
                        </span>
                        {item.gtin ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-700">
                              GTIN {item.gtin}
                            </span>
                          </>
                        ) : null}
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {formatTimeOnlyRu(item.scannedAt)}
                        </span>
                      </div>

                      {item.serial && (
                        <p className="text-[11px] sm:text-xs text-slate-700 mt-0.5 font-mono truncate leading-tight">
                          S/N: {item.serial}
                        </p>
                      )}

                      <p className="text-[11px] sm:text-xs font-mono text-slate-500 break-all mt-0.5 leading-tight">
                        {formatCodeForDisplay(item.rawCode)}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={() => handleRemoveItem(item)}
                      aria-label="Удалить код из коробки"
                      className="min-w-[44px] min-h-[44px] -my-1.5 -mr-1.5 rounded-xl text-slate-400 hover:text-red-700 hover:bg-red-50 flex items-center justify-center shrink-0 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Complete Assembly CTA */}
          <div className="pt-2 mt-1.5 sm:pt-3.5 sm:mt-2 border-t border-slate-100 space-y-1.5 sm:space-y-2">
            {confirmEmptyFinish && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 leading-snug">
                В коробке ещё нет товаров. Нажмите кнопку ещё раз, чтобы всё равно завершить сборку.
              </div>
            )}
            <button
              type="button"
              disabled={busyAction}
              onClick={handleFinishAssembly}
              className="w-full min-h-[44px] sm:min-h-[48px] px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-400 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <PackageCheck className="w-4 h-4 sm:w-5 sm:h-5" />
              <span>
                {confirmEmptyFinish
                  ? 'Подтвердить завершение пустой коробки'
                  : 'Завершить сборку'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
