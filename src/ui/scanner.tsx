import { useEffect, useRef, useState } from 'preact/hooks';
import { CameraError, startScan } from '../scanner/camera.js';
import type { ScanHandle } from '../scanner/camera.js';

/** カメラでISBNのバーコードを読み取る。読み取るか閉じると onClose が呼ばれる。 */
export function Scanner({
  onIsbn,
  onClose,
}: {
  onIsbn: (isbn: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  const [engine, setEngine] = useState<ScanHandle['engine']>();

  useEffect(() => {
    let handle: ScanHandle | undefined;
    let cancelled = false;
    if (!video.current) return;
    startScan(video.current, (isbn) => {
      onIsbn(isbn);
      onClose();
    })
      .then((h) => {
        if (cancelled) h.stop();
        else {
          handle = h;
          setEngine(h.engine);
        }
      })
      .catch((e: unknown) =>
        setError(
          e instanceof CameraError ? e.message : 'カメラを開始できませんでした',
        ),
      );
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, []);

  return (
    <section aria-label="バーコード読み取り" class="scanner">
      <p>本の裏表紙の、978または979で始まるバーコードを枠に入れてください。</p>
      <video ref={video} playsInline muted autoPlay width={320} />
      {engine && (
        <small>
          読み取り方式: {engine === 'native' ? 'ブラウザ標準' : 'zxing'}
        </small>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={onClose}>
        閉じる
      </button>
    </section>
  );
}
