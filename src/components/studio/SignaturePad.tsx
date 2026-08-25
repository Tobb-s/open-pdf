'use client';

import { useRef, useState } from 'react';
import { Check, Eraser } from 'lucide-react';

interface SignaturePadProps {
  clearLabel: string;
  useLabel: string;
  padLabel: string;
  onCreate: (bytes: Uint8Array, width: number, height: number) => void;
}

const WIDTH = 700;
const HEIGHT = 210;

export default function SignaturePad({ clearLabel, useLabel, padLabel, onCreate }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const pointFor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  };

  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = pointFor(event);
    const context = canvas?.getContext('2d');
    if (!canvas || !point || !context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.strokeStyle = '#172554';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const point = pointFor(event);
    const context = canvas?.getContext('2d');
    if (!point || !context) return;
    context.lineTo(point.x, point.y);
    context.stroke();
    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
    }
  };

  const finish = () => {
    drawingRef.current = false;
    canvasRef.current?.getContext('2d')?.closePath();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    hasInkRef.current = false;
    setHasInk(false);
  };

  const create = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      void blob.arrayBuffer().then((buffer) => onCreate(new Uint8Array(buffer), WIDTH, HEIGHT));
    }, 'image/png');
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label={padLabel}
        className="aspect-[10/3] w-full rounded-lg border bg-white shadow-inner"
        style={{ touchAction: 'none' }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          className="flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" /> {clearLabel}
        </button>
        <button
          type="button"
          onClick={create}
          disabled={!hasInk}
          className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:bg-gray-300"
        >
          <Check className="h-4 w-4" /> {useLabel}
        </button>
      </div>
    </div>
  );
}
