'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  InvertedLuminanceSource,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import {
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  ImagePlus,
  Keyboard,
  RefreshCw,
} from 'lucide-react';

export type ScannerMode = 'box-qr' | 'item-datamatrix';

interface BarcodeScannerProps {
  mode: ScannerMode;
  continuous?: boolean;
  active?: boolean;
  onDetected: (rawCode: string, format: 'DATA_MATRIX' | 'QR_CODE' | 'MANUAL') => void;
  placeholder?: string;
  manualLabel?: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): BarcodeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

function createZxingReader(mode: ScannerMode): MultiFormatReader {
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>();
  const formats =
    mode === 'box-qr'
      ? [BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.CODE_128]
      : [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE];
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  return reader;
}

function decodeCanvasWithZxing(
  canvas: HTMLCanvasElement,
  reader: MultiFormatReader
): { text: string; format: 'DATA_MATRIX' | 'QR_CODE' } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return null;

  const imageData = ctx.getImageData(0, 0, width, height);
  const rgba = imageData.data;
  const luminances = new Uint8ClampedArray(width * height);

  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    luminances[p] = ((rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8) & 0xff;
  }

  const source = new RGBLuminanceSource(luminances, width, height);

  const tryDecode = (lumSource: RGBLuminanceSource | InvertedLuminanceSource) => {
    try {
      const bitmap = new BinaryBitmap(new HybridBinarizer(lumSource));
      const result = reader.decodeWithState(bitmap);
      const text = result.getText();
      if (text) {
        const fmt =
          result.getBarcodeFormat() === BarcodeFormat.DATA_MATRIX
            ? 'DATA_MATRIX'
            : 'QR_CODE';
        return { text, format: fmt as 'DATA_MATRIX' | 'QR_CODE' };
      }
    } catch {
      // NotFoundException on normal frames
    }
    return null;
  };

  return tryDecode(source) || tryDecode(new InvertedLuminanceSource(source));
}

export function BarcodeScanner({
  mode,
  continuous = false,
  active = true,
  onDetected,
  placeholder,
  manualLabel,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const zxingReaderRef = useRef<MultiFormatReader | null>(null);
  const nativeDetectorRef = useRef<BarcodeDetectorLike | null>(null);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const [cameraState, setCameraState] = useState<
    'starting' | 'ready' | 'denied' | 'unavailable' | 'paused'
  >('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [scanPulse, setScanPulse] = useState(false);

  const emitCode = useCallback(
    (code: string, format: 'DATA_MATRIX' | 'QR_CODE' | 'MANUAL') => {
      const cleaned = code.trim();
      if (!cleaned) return;
      const now = Date.now();

      if (
        continuous &&
        lastScanRef.current.code === cleaned &&
        now - lastScanRef.current.time < 1800
      ) {
        return;
      }
      lastScanRef.current = { code: cleaned, time: now };
      setScanPulse(true);
      setTimeout(() => setScanPulse(false), 350);
      onDetectedRef.current(cleaned, format);
    },
    [continuous]
  );

  const stopMediaTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    zxingReaderRef.current = createZxingReader(mode);
    nativeDetectorRef.current = null;

    if (typeof window !== 'undefined' && 'BarcodeDetector' in window && window.BarcodeDetector) {
      const detectorClass = window.BarcodeDetector;
      if (detectorClass.getSupportedFormats) {
        detectorClass
          .getSupportedFormats()
          .then((supported) => {
            const desired =
              mode === 'box-qr'
                ? ['qr_code', 'data_matrix', 'code_128'].filter((f) =>
                    supported.includes(f)
                  )
                : ['data_matrix', 'qr_code'].filter((f) => supported.includes(f));
            if (desired.length > 0) {
              nativeDetectorRef.current = new detectorClass({ formats: desired });
            }
          })
          .catch(() => {
            nativeDetectorRef.current = null;
          });
      }
    }
  }, [mode]);

  useEffect(() => {
    if (!active) {
      stopMediaTracks();
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;
    let frameTick = 0;

    async function startStream() {
      await Promise.resolve();
      if (cancelled) return;

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setCameraState('unavailable');
        setCameraError(
          'Камера недоступна в текущем браузере. Используйте ручной ввод или загрузку фото.'
        );
        return;
      }

      setCameraState('starting');
      setCameraError(null);
      setTorchOn(false);
      setTorchSupported(false);
      stopMediaTracks();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        const track = stream.getVideoTracks()[0];
        if (track && typeof track.getCapabilities === 'function') {
          const caps = track.getCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
          };
          setTorchSupported(Boolean(caps.torch));
        }

        setCameraState('ready');

        const scanLoop = async () => {
          if (cancelled) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
            frameTick++;

            // 1. Try native BarcodeDetector first when supported
            if (nativeDetectorRef.current) {
              try {
                const detected = await nativeDetectorRef.current.detect(v);
                if (detected.length > 0 && detected[0].rawValue) {
                  const fmt =
                    detected[0].format === 'data_matrix'
                      ? 'DATA_MATRIX'
                      : 'QR_CODE';
                  emitCode(detected[0].rawValue, fmt);
                  if (!continuous) return;
                }
              } catch {
                // Fall back to ZXing below
              }
            }

            // 2. Run ZXing on centered ROI canvas
            if ((!nativeDetectorRef.current || frameTick % 3 === 0) && zxingReaderRef.current) {
              const canvas = canvasRef.current;
              if (canvas) {
                const vw = v.videoWidth;
                const vh = v.videoHeight;
                const cropSize = Math.min(vw, vh, 640);
                const sx = Math.max(0, Math.floor((vw - cropSize) / 2));
                const sy = Math.max(0, Math.floor((vh - cropSize) / 2));
                const targetSize = Math.min(cropSize, 520);

                canvas.width = targetSize;
                canvas.height = targetSize;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(
                    v,
                    sx,
                    sy,
                    cropSize,
                    cropSize,
                    0,
                    0,
                    targetSize,
                    targetSize
                  );
                  const res = decodeCanvasWithZxing(canvas, zxingReaderRef.current);
                  if (res) {
                    emitCode(res.text, res.format);
                    if (!continuous) return;
                  }
                }
              }
            }
          }

          if (!cancelled) {
            timerId = window.setTimeout(scanLoop, 140);
          }
        };

        timerId = window.setTimeout(scanLoop, 200);
      } catch (err: unknown) {
        if (cancelled) return;
        const name =
          typeof err === 'object' && err !== null && 'name' in err
            ? String((err as { name: string }).name)
            : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraState('denied');
          setCameraError(
            'Доступ к камере запрещён. Разрешите камеру в настройках браузера или введите код вручную.'
          );
        } else {
          setCameraState('unavailable');
          setCameraError(
            'Не удалось запустить камеру. Используйте загрузку фото или ручной ввод кода.'
          );
        }
      }
    }

    startStream();

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      stopMediaTracks();
    };
  }, [active, facingMode, continuous, emitCode, stopMediaTracks]);

  const effectiveCameraState = active ? cameraState : 'paused';

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const bitmap = await createImageBitmap(file);

      if (nativeDetectorRef.current) {
        try {
          const found = await nativeDetectorRef.current.detect(bitmap);
          if (found.length > 0 && found[0].rawValue) {
            emitCode(
              found[0].rawValue,
              found[0].format === 'data_matrix' ? 'DATA_MATRIX' : 'QR_CODE'
            );
            bitmap.close();
            return;
          }
        } catch {
          // Continue with ZXing
        }
      }

      const canvas = document.createElement('canvas');
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const reader = zxingReaderRef.current || createZxingReader(mode);
        const res = decodeCanvasWithZxing(canvas, reader);
        if (res) {
          emitCode(res.text, res.format);
          bitmap.close();
          return;
        }
      }
      bitmap.close();
      setCameraError('Код на фото не распознан. Попробуйте снять ближе и резче.');
    } catch {
      setCameraError('Не удалось обработать изображение.');
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualValue.trim()) return;
    emitCode(manualValue.trim(), 'MANUAL');
    setManualValue('');
  }

  return (
    <div className="space-y-2 sm:space-y-3">
      <div className="relative w-full h-[184px] sm:h-auto sm:aspect-video sm:max-h-[320px] bg-slate-950 rounded-xl sm:rounded-2xl overflow-hidden border border-slate-200">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder Reticle */}
        {effectiveCameraState === 'ready' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className={`w-32 h-32 sm:w-48 sm:h-48 relative transition-transform duration-150 ${
                scanPulse ? 'scale-95' : 'scale-100'
              }`}
            >
              <span
                className={`absolute top-0 left-0 w-6 h-6 sm:w-7 sm:h-7 border-t-[3px] border-l-[3px] rounded-tl-lg ${
                  scanPulse ? 'border-emerald-400' : 'border-white'
                }`}
              />
              <span
                className={`absolute top-0 right-0 w-6 h-6 sm:w-7 sm:h-7 border-t-[3px] border-r-[3px] rounded-tr-lg ${
                  scanPulse ? 'border-emerald-400' : 'border-white'
                }`}
              />
              <span
                className={`absolute bottom-0 left-0 w-6 h-6 sm:w-7 sm:h-7 border-b-[3px] border-l-[3px] rounded-bl-lg ${
                  scanPulse ? 'border-emerald-400' : 'border-white'
                }`}
              />
              <span
                className={`absolute bottom-0 right-0 w-6 h-6 sm:w-7 sm:h-7 border-b-[3px] border-r-[3px] rounded-br-lg ${
                  scanPulse ? 'border-emerald-400' : 'border-white'
                }`}
              />
            </div>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-slate-950/75 text-white text-[11px] sm:text-xs font-medium rounded-lg whitespace-nowrap">
              {mode === 'box-qr'
                ? 'Наведите на QR-код коробки'
                : 'Наведите на Data Matrix товара'}
            </div>
          </div>
        )}

        {/* Camera Toolbar Overlay */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? 'Выключить фонарик' : 'Включить фонарик'}
              className={`min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center transition-colors ${
                torchOn
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-950/70 text-white hover:bg-slate-900'
              }`}
            >
              {torchOn ? (
                <FlashlightOff className="w-5 h-5" />
              ) : (
                <Flashlight className="w-5 h-5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              setFacingMode((prev) =>
                prev === 'environment' ? 'user' : 'environment'
              )
            }
            aria-label="Переключить камеру"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-950/70 text-white hover:bg-slate-900 flex items-center justify-center transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Распознать с фото"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-950/70 text-white hover:bg-slate-900 flex items-center justify-center transition-colors"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoUpload}
            className="hidden"
          />
        </div>

        {/* Starting / Error Fallback Overlay */}
        {effectiveCameraState !== 'ready' && (
          <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center p-3 text-center text-white">
            {effectiveCameraState === 'starting' ? (
              <>
                <Camera className="w-7 h-7 text-blue-400 mb-1.5" />
                <p className="text-xs sm:text-sm font-medium">Запуск камеры смартфона...</p>
              </>
            ) : (
              <>
                <CameraOff className="w-7 h-7 text-slate-400 mb-1.5" />
                <p className="text-xs sm:text-sm text-slate-200 max-w-xs mb-2 leading-snug">
                  {cameraError || 'Камера на паузе'}
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[44px] px-3.5 py-2 bg-white text-slate-900 text-xs font-semibold rounded-xl flex items-center gap-1.5"
                >
                  <ImagePlus className="w-4 h-4" />
                  <span>Сфотографировать код</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Manual / Bluetooth HID Scanner Input */}
      <form onSubmit={handleManualSubmit} className="flex items-center gap-1.5 sm:gap-2">
        <div className="relative flex-1 min-w-0">
          <Keyboard className="w-4 h-4 text-slate-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder={
              placeholder ||
              (mode === 'box-qr'
                ? 'Или введите номер / QR коробки (напр. BOX-104)'
                : 'Или отсканируйте внешним сканером / введите код')
            }
            aria-label={manualLabel || 'Ручной ввод кода'}
            className="w-full min-h-[44px] pl-8 sm:pl-9 pr-2.5 sm:pr-3 bg-white border border-slate-300 rounded-xl text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-xs sm:placeholder:text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
          />
        </div>
        <button
          type="submit"
          disabled={!manualValue.trim()}
          className="min-h-[44px] px-3.5 sm:px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs sm:text-sm font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0"
        >
          Добавить
        </button>
      </form>
    </div>
  );
}
