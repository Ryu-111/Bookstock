import type { DecodeHintType } from '@zxing/library';
import {
  cameraErrorMessage,
  nativeDetectorClass,
  pickIsbn,
  rawValues,
} from './barcode.js';

export interface ScanHandle {
  /** 読み取りとカメラを止める。何度呼んでもよい。 */
  stop(): void;
  /** 使っている読み取り方式 */
  engine: 'native' | 'zxing';
}

export class CameraError extends Error {}

const INTERVAL_MS = 200;

async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new CameraError(cameraErrorMessage({ name: 'Unsupported' }));
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
  } catch (error) {
    throw new CameraError(cameraErrorMessage(error));
  }
}

/**
 * カメラを開き、ISBNを1つ読み取ったら onIsbn を呼んで止まる。
 * BarcodeDetector（EAN-13対応）があれば使い、なければ@zxing/browserを読み込む。
 */
export async function startScan(
  video: HTMLVideoElement,
  onIsbn: (isbn: string) => void,
): Promise<ScanHandle> {
  const stream = await openCamera();
  let stopped = false;
  const cleanups: (() => void)[] = [
    () => stream.getTracks().forEach((t) => t.stop()),
    () => {
      video.srcObject = null;
    },
  ];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cleanups.forEach((fn) => fn());
  };
  const found = (isbn: string) => {
    if (stopped) return;
    stop();
    onIsbn(isbn);
  };

  try {
    const Native = await nativeDetectorClass();
    if (Native) {
      const detector = new Native({ formats: ['ean_13'] });
      video.srcObject = stream;
      await video.play();
      const timer = setInterval(() => {
        if (stopped || video.readyState < 2) return;
        detector
          .detect(video)
          .then((results) => {
            const isbn = pickIsbn(rawValues(results));
            if (isbn) found(isbn);
          })
          .catch(() => undefined); // 1フレームの失敗は次のフレームで再試行する
      }, INTERVAL_MS);
      cleanups.unshift(() => clearInterval(timer));
      return { stop, engine: 'native' };
    }

    const [{ BrowserMultiFormatOneDReader }, zxing] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);
    const hints = new Map<DecodeHintType, unknown>([
      [zxing.DecodeHintType.POSSIBLE_FORMATS, [zxing.BarcodeFormat.EAN_13]],
    ]);
    const reader = new BrowserMultiFormatOneDReader(hints, {
      delayBetweenScanAttempts: INTERVAL_MS,
    });
    const controls = await reader.decodeFromStream(stream, video, (result) => {
      const isbn = result ? pickIsbn([result.getText()]) : null;
      if (isbn) found(isbn);
    });
    cleanups.unshift(() => controls.stop());
    if (stopped) controls.stop();
    return { stop, engine: 'zxing' };
  } catch (error) {
    stop();
    throw error instanceof CameraError
      ? error
      : new CameraError('バーコードの読み取りを開始できませんでした');
  }
}
