"use client";

import { useRef, useState } from "react";
import type { SignatureStrokes } from "@/lib/admin/report-signature";

function normalize(strokes: SignatureStrokes): SignatureStrokes {
  return strokes.map((stroke) => stroke.map(([x, y]) => [
    Number((x / 600).toFixed(4)),
    Number((y / 180).toFixed(4)),
  ]));
}

export function SignaturePad({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value?: SignatureStrokes | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [strokes, setStrokes] = useState<SignatureStrokes>(() =>
    (value ?? []).map((stroke) => stroke.map(([x, y]) => [x * 600, y * 180])),
  );
  const [drawing, setDrawing] = useState(false);
  const points = useRef<Array<[number, number]>>([]);

  function point(event: React.PointerEvent<SVGSVGElement>): [number, number] {
    const rect = svgRef.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(600, ((event.clientX - rect.left) / rect.width) * 600)),
      Math.max(0, Math.min(180, ((event.clientY - rect.top) / rect.height) * 180)),
    ];
  }

  function begin(event: React.PointerEvent<SVGSVGElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    points.current = [point(event)];
    setDrawing(true);
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (!drawing) return;
    event.preventDefault();
    const existingPoints = strokes.reduce((total, stroke) => total + stroke.length, 0);
    if (existingPoints >= 2000) return;
    points.current = [...points.current, point(event)].slice(-2000);
    setStrokes((current) => {
      const next = current.slice();
      next[next.length - 1] = points.current;
      return next;
    });
  }

  function end() {
    if (!drawing) return;
    setDrawing(false);
    points.current = [];
  }

  function clear() {
    setStrokes([]);
    points.current = [];
    setDrawing(false);
  }

  const serialized = JSON.stringify(normalize(strokes));

  return (
    <fieldset className="grid gap-2">
      <legend className="text-[11px] font-semibold text-soft">{label} signature <span className="font-normal">(optional)</span></legend>
      <input type="hidden" name={name} value={serialized} />
      <svg
        ref={svgRef}
        viewBox="0 0 600 180"
        role="img"
        aria-label={`Draw ${label.toLowerCase()} signature in this box`}
        className="h-32 w-full touch-none rounded-lg border border-line bg-white"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <path d="M12 150 H588" stroke="#dce0e4" strokeWidth="2" />
        {strokes.map((stroke, index) => stroke.length > 0 && (
          <polyline
            key={index}
            points={stroke.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke="#17202a"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-soft">Draw with a finger, stylus, or mouse.</span>
        <button type="button" onClick={clear} className="rounded border border-line px-2.5 py-1 text-[10px] font-bold text-ink hover:bg-mist">Clear</button>
      </div>
    </fieldset>
  );
}

export function SignatureDisplay({
  strokes,
  label,
}: {
  strokes?: SignatureStrokes | null;
  label: string;
}) {
  if (!strokes?.length) return <p className="text-[11px] text-soft">{label}: Not signed</p>;
  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-bold text-soft">{label} signature</span>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" role="img" aria-label={`${label} signature`} className="h-16 w-full max-w-sm rounded border border-line bg-white">
        {strokes.map((stroke, index) => stroke.length > 0 && (
          <polyline
            key={index}
            points={stroke.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none"
            stroke="#17202a"
            strokeWidth="0.006"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}
