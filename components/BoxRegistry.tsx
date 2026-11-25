'use client';

import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import {
  formatCodeForDisplay,
  formatTimestampRu,
  formatTimeOnlyRu,
} from '@/lib/datamatrix';
import type { AssemblyBox, ScannedItem } from '@/lib/types';
import {
  Search,
  PackageCheck,
  Package,
  Copy,
  Check,
  Download,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
} from 'lucide-react';

interface BoxRegistryProps {
  userUid: string;
  boxes: AssemblyBox[];
  selectedBoxId: string | null;
  onSelectBox: (boxId: string | null) => void;
  onResumeBox: (boxId: string) => void;
}

export function BoxRegistry({
  userUid,
  boxes,
  selectedBoxId,
  onSelectBox,
  onResumeBox,
}: BoxRegistryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'assembling'>('all');
  const [selectedItems, setSelectedItems] = useState<ScannedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const selectedBox = boxes.find((b) => b.id === selectedBoxId) || null;

  useEffect(() => {
    if (!selectedBoxId || !userUid) {
      return;
    }

    let active = true;
    const path = `boxes/${selectedBoxId}/items`;
    const q = query(
      collection(db, 'boxes', selectedBoxId, 'items'),
      where('operatorId', '==', userUid)
    );

    const startTimer = window.setTimeout(() => {
      if (active) setLoadingItems(true);
    }, 0);

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (!active) return;
        window.clearTimeout(startTimer);
        const list: ScannedItem[] = snapshot.docs.map((d) => d.data() as ScannedItem);
        list.sort((a, b) => (a.scannedAt?.seconds ?? 0) - (b.scannedAt?.seconds ?? 0));
        setSelectedItems(list);
        setLoadingItems(false);
      },
      (error) => {
        window.clearTimeout(startTimer);
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => {
      active = false;
      window.clearTimeout(startTimer);
      unsub();
    };
  }, [selectedBoxId, userUid]);

  const filteredBoxes = boxes.filter((box) => {
    if (statusFilter !== 'all' && box.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      box.boxNumber.toLowerCase().includes(q) ||
      box.boxCode.toLowerCase().includes(q) ||
      box.operatorLogin.toLowerCase().includes(q)
    );
  });

  const visibleItems = selectedItems.filter((item) => {
    if (!itemFilter.trim()) return true;
    const q = itemFilter.trim().toLowerCase();
    return (
      item.rawCode.toLowerCase().includes(q) ||
      item.gtin.toLowerCase().includes(q) ||
      item.serial.toLowerCase().includes(q)
    );
  });

  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard blocked in non-HTTPS contexts
    }
  }

  async function copyAllCodes() {
    if (selectedItems.length === 0) return;
    try {
      await navigator.clipboard.writeText(
        selectedItems.map((i) => i.rawCode).join('\n')
      );
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      // Ignore
    }
  }

  function downloadCsvRegistry() {
    if (!selectedBox) return;
    const header = [
      '№ п/п',
      'Номер коробки',
      'QR-код коробки',
      'Статус',
      'Оператор',
      'GTIN',
      'Серийный номер',
      'Код Data Matrix (полный)',
      'Время сканирования',
    ];

    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;

    const rows = selectedItems.map((item, index) => [
      String(index + 1),
      selectedBox.boxNumber,
      selectedBox.boxCode,
      selectedBox.status === 'completed' ? 'Сборка завершена' : 'В сборке',
      selectedBox.operatorLogin,
      item.gtin || '',
      item.serial || '',
      item.rawCode,
      formatTimestampRu(item.scannedAt),
    ]);

    const csvContent =
      '\uFEFF' +
      [header, ...rows].map((row) => row.map(escapeCsv).join(';')).join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeBoxName = selectedBox.boxNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
    link.download = `reestr_korobka_${safeBoxName}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 sm:gap-4 items-start">
      {/* Left Column: Boxes Registry List */}
      <div
        className={`lg:col-span-5 bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-3 sm:p-4 ${
          selectedBox ? 'hidden lg:block' : 'block'
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
            Реестр коробок
          </h2>
          <span className="text-xs text-slate-500 tabular-nums">
            Всего: {boxes.length}
          </span>
        </div>

        {/* Search Input */}
        <div className="relative mb-2 sm:mb-3">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по номеру или QR коробки..."
            className="w-full min-h-[42px] sm:min-h-[44px] pl-9 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-700"
          />
        </div>

        {/* Segmented Filter */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl mb-2 sm:mb-3">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`min-h-[38px] text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              statusFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Все
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('completed')}
            className={`min-h-[38px] text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              statusFilter === 'completed'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Готовые
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('assembling')}
            className={`min-h-[38px] text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              statusFilter === 'assembling'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            В сборке
          </button>
        </div>

        {filteredBoxes.length === 0 ? (
          <div className="py-8 sm:py-12 text-center">
            <FileSpreadsheet className="w-7 h-7 sm:w-8 sm:h-8 text-slate-300 mx-auto mb-1.5 sm:mb-2" />
            <p className="text-xs sm:text-sm text-slate-500">
              {boxes.length === 0
                ? 'Собранных коробок пока нет'
                : 'По вашему запросу коробки не найдены'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-[calc(100dvh-250px)] lg:max-h-[560px] overflow-y-auto -mx-2 px-2">
            {filteredBoxes.map((box) => {
              const isSelected = box.id === selectedBoxId;
              const isDone = box.status === 'completed';
              return (
                <button
                  key={box.id}
                  type="button"
                  onClick={() => {
                    setItemFilter('');
                    onSelectBox(box.id);
                  }}
                  className={`w-full min-h-[48px] sm:min-h-[56px] py-1.5 sm:py-2.5 px-2 rounded-xl flex items-center justify-between gap-2.5 text-left transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ${
                        isDone
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {isDone ? (
                        <PackageCheck className="w-4 h-4" />
                      ) : (
                        <Package className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate leading-tight">
                        Коробка № {box.boxNumber}
                      </p>
                      <p className="text-[11px] sm:text-xs text-slate-500 truncate tabular-nums leading-tight mt-0.5">
                        {isDone ? 'Завершена' : 'В сборке'} · {box.itemsCount} шт. ·{' '}
                        {formatTimestampRu(
                          isDone ? box.completedAt || box.updatedAt : box.updatedAt
                        )}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Column: Selected Box Registry Detail */}
      <div
        className={`lg:col-span-7 bg-white border border-slate-200 rounded-xl sm:rounded-2xl p-3 sm:p-6 ${
          selectedBox ? 'block' : 'hidden lg:block'
        }`}
      >
        {!selectedBox ? (
          <div className="py-20 text-center">
            <PackageCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              Выберите коробку из реестра
            </h3>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              Здесь отобразится номер коробки, дата сборки и полный перечень отсканированных кодов Data Matrix.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 sm:space-y-4">
            {/* Mobile Back Button */}
            <button
              type="button"
              onClick={() => onSelectBox(null)}
              className="lg:hidden inline-flex items-center gap-1 text-xs sm:text-sm font-medium text-blue-700 min-h-[44px] -my-2 pr-2"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>К списку коробок</span>
            </button>

            {/* Box Registry Header */}
            <div className="pb-2.5 sm:pb-4 border-b border-slate-200">
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium mb-0.5 leading-tight">
                    {selectedBox.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <PackageCheck className="w-3.5 h-3.5" />
                        <span>Сборка завершена</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <Package className="w-3.5 h-3.5" />
                        <span>В процессе сборки</span>
                      </span>
                    )}
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-500 truncate">
                      {selectedBox.operatorLogin}
                    </span>
                  </div>
                  <h2 className="text-base sm:text-xl font-bold text-slate-900 break-words leading-tight">
                    Коробка № {selectedBox.boxNumber}
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 leading-tight truncate">
                    QR: <span className="font-mono">{selectedBox.boxCode}</span>
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums leading-none">
                    {selectedItems.length}
                  </div>
                  <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5 leading-none">
                    кодов
                  </div>
                </div>
              </div>

              <div className="mt-1.5 sm:mt-2.5 text-[11px] sm:text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-tight">
                <span>Начата: {formatTimestampRu(selectedBox.createdAt)}</span>
                {selectedBox.completedAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      Завершена: {formatTimestampRu(selectedBox.completedAt)}
                    </span>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-2.5 sm:mt-3.5 flex flex-wrap items-center gap-1.5 sm:gap-2">
                {selectedBox.status === 'assembling' && (
                  <button
                    type="button"
                    onClick={() => onResumeBox(selectedBox.id)}
                    className="min-h-[44px] px-3 sm:px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                  >
                    Продолжить сборку
                  </button>
                )}

                <button
                  type="button"
                  disabled={selectedItems.length === 0}
                  onClick={downloadCsvRegistry}
                  className="min-h-[44px] px-3 sm:px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span>Скачать CSV</span>
                </button>

                <button
                  type="button"
                  disabled={selectedItems.length === 0}
                  onClick={copyAllCodes}
                  className="min-h-[44px] px-3 sm:px-4 py-2 bg-white hover:bg-slate-50 disabled:opacity-50 border border-slate-300 text-slate-800 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  {copiedAll ? (
                    <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-700" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  )}
                  <span>
                    {copiedAll ? 'Скопировано' : 'Копировать все'}
                  </span>
                </button>
              </div>
            </div>

            {/* Filter Inside Box */}
            {selectedItems.length > 0 && (
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={itemFilter}
                  onChange={(e) => setItemFilter(e.target.value)}
                  placeholder="Фильтр по GTIN, S/N или Data Matrix..."
                  className="w-full min-h-[40px] sm:min-h-[42px] pl-9 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-700"
                />
              </div>
            )}

            {/* Data Matrix Codes List */}
            {loadingItems ? (
              <div className="py-6 sm:py-10 text-center text-xs sm:text-sm text-slate-500">
                Загрузка перечня кодов Data Matrix...
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="py-6 sm:py-10 text-center text-xs sm:text-sm text-slate-500">
                {selectedItems.length === 0
                  ? 'В этой коробке нет отсканированных кодов'
                  : 'Совпадений не найдено'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[calc(100dvh-340px)] min-h-[180px] lg:max-h-[460px] overflow-y-auto">
                {visibleItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="py-1.5 sm:py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[11px] sm:text-xs text-slate-500 leading-tight">
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {idx + 1}.
                        </span>
                        {item.gtin && (
                          <span className="font-mono text-slate-800">
                            GTIN {item.gtin}
                          </span>
                        )}
                        {item.serial && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-700">
                              S/N {item.serial}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {formatTimeOnlyRu(item.scannedAt)}
                        </span>
                      </div>

                      <p className="mt-0.5 text-[11px] sm:text-xs font-mono text-slate-600 break-all leading-tight">
                        {formatCodeForDisplay(item.rawCode)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => copyText(item.rawCode, item.id)}
                      aria-label="Скопировать код Data Matrix"
                      className="min-w-[44px] min-h-[44px] -my-1.5 -mr-1.5 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center shrink-0 transition-colors"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-4 h-4 text-emerald-700" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
