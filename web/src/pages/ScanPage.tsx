import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import QrScanner from 'qr-scanner';
import { codeFromScan } from '@gear/shared';
import { Button, Field, Input, PageHeader } from '../components/ui';

export function ScanPage() {
  const video = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [hasFlash, setHasFlash] = useState(false);
  const scanner = useRef<QrScanner | null>(null);

  useEffect(() => {
    if (!video.current) return;
    let done = false;
    const s = new QrScanner(
      video.current,
      (result) => {
        if (done) return;
        const code = codeFromScan(result.data);
        if (!code) return;
        done = true;
        navigator.vibrate?.(60);
        navigate(`/q/${encodeURIComponent(code)}`);
      },
      { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8 },
    );
    scanner.current = s;
    s.start()
      .then(() => s.hasFlash().then(setHasFlash))
      .catch((e: unknown) =>
        setError(
          String(e).includes('NotAllowed') || String(e).includes('permission')
            ? 'Camera access was blocked. Allow camera access for this site in your browser settings, or type the code below.'
            : 'No camera available. Type the code from the label below.',
        ),
      );
    return () => {
      done = true;
      s.destroy();
      scanner.current = null;
    };
  }, [navigate]);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Scan gear" subtitle="Point the camera at a gear label’s QR code." />
      <div className="relative overflow-hidden rounded-xl bg-stone-900">
        <video ref={video} className="aspect-square w-full object-cover" muted playsInline />
        {error && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">{error}</div>}
      </div>
      {hasFlash && (
        <Button className="mt-3 w-full" onClick={() => scanner.current?.toggleFlash()}>
          Toggle flashlight
        </Button>
      )}
      <form
        className="mt-6 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const code = codeFromScan(manual);
          if (code) navigate(`/q/${encodeURIComponent(code)}`);
        }}
      >
        <Field label="Or enter a code" className="flex-1">
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="CG-XXXXXX" className="font-mono uppercase" />
        </Field>
        <Button type="submit" variant="primary">
          Look up
        </Button>
      </form>
    </div>
  );
}
