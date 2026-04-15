import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

export function SiteModal({ title, subtitle = '', onClose, children, maxWidth = 'max-w-2xl' }) {
  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
      <div className={`w-full ${maxWidth} overflow-hidden rounded-[28px] border border-zinc-800 bg-[#0b0c0d]/95 shadow-[0_30px_120px_rgba(0,0,0,0.6)]`}>
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4 md:px-6">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-black uppercase tracking-[0.16em] text-white">{title}</h3>
            {subtitle ? <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-zinc-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-zinc-800 p-2 text-zinc-400 transition-all hover:border-zinc-700 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[calc(90vh-84px)] overflow-y-auto px-5 py-5 md:px-6 md:py-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  tone = 'cyan',
}) {
  const toneClasses =
    tone === 'danger'
      ? 'border-red-500/35 bg-red-500/10 text-red-300 hover:bg-red-500/20'
      : tone === 'warning'
        ? 'border-yellow-500/35 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20'
        : 'border-cyan-500/35 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20';

  return (
    <SiteModal title={title} subtitle="Confirm action" onClose={onClose} maxWidth="max-w-xl">
      <div className="flex items-start gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="mt-0.5 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3 text-yellow-300">
          <AlertTriangle size={18} />
        </div>
        <p className="text-sm leading-relaxed text-zinc-300">{body}</p>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] transition-colors ${toneClasses}`}
        >
          {confirmLabel}
        </button>
      </div>
    </SiteModal>
  );
}

export function ImageLightbox({ src, alt = '', subtitle = '', onClose }) {
  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[88vh] max-w-[94vw] items-center justify-center"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-2 -top-2 z-10 rounded-full border border-zinc-700 bg-[#0b0c0d] p-2 text-zinc-300 shadow-[0_12px_40px_rgba(0,0,0,0.45)] transition-colors hover:border-zinc-500 hover:text-white"
          aria-label="Close image preview"
        >
          <X size={16} />
        </button>
        {subtitle ? (
          <div className="absolute left-3 top-3 z-10 rounded-full border border-zinc-700 bg-black/70 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-300 backdrop-blur">
            {subtitle}
          </div>
        ) : null}
        <div className="overflow-hidden rounded-[24px] border border-zinc-800 bg-black shadow-[0_30px_120px_rgba(0,0,0,0.75)]">
          <img src={src} alt={alt} className="max-h-[86vh] max-w-[94vw] object-contain" />
        </div>
      </div>
    </div>
  );
}
