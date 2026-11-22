'use client';

import React, { useState } from 'react';
import { Calculator, GripHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export function CalculatorPopover({
  mode,
  open,
  onClose,
}: {
  mode: 'basic' | 'scientific';
  open: boolean;
  onClose: () => void;
}) {
  const [display, setDisplay] = useState('0');
  const [expr, setExpr] = useState('');
  const [angleMode, setAngleMode] = useState<'DEG' | 'RAD'>('DEG');
  const [memory, setMemory] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  if (!open) return null;

  const toRad = (v: number) => (angleMode === 'DEG' ? (v * Math.PI) / 180 : v);

  const safeFormat = (num: number): string => {
    if (!Number.isFinite(num)) return 'Error';
    return String(Number(num.toPrecision(12)));
  };

  const appendToken = (tok: string) => {
    if (display === 'Error') {
      setDisplay(tok);
      return;
    }
    if (display === '0' && /^[0-9]$/.test(tok)) {
      setDisplay(tok);
    } else if (tok === '.' && display.includes('.')) {
      return;
    } else {
      setDisplay(display + tok);
    }
  };

  const pushBinaryOp = (op: string) => {
    if (display === 'Error') return;
    setExpr(`${expr}${display} ${op} `);
    setDisplay('0');
  };

  const evaluateAll = () => {
    try {
      const full = `${expr}${display}`;
      // Safe deterministic arithmetic parser without eval
      const sanitized = full.replace(/[^0-9+\-*/.^() ]/g, '');
      const tokens = sanitized
        .replace(/\^/g, '**')
        .match(/(\d+\.?\d*|\.\d+|\*\*|[+\-*/()])/g);
      if (!tokens || tokens.length === 0) return;

      const result = computeExpressionTokens(tokens);
      setDisplay(safeFormat(result));
      setExpr('');
    } catch {
      setDisplay('Error');
      setExpr('');
    }
  };

  const applyUnary = (fnName: string) => {
    const val = Number(display);
    if (!Number.isFinite(val)) return;
    let out = val;
    switch (fnName) {
      case 'sqrt':
        out = val < 0 ? NaN : Math.sqrt(val);
        break;
      case 'sq':
        out = val * val;
        break;
      case 'inv':
        out = val === 0 ? NaN : 1 / val;
        break;
      case 'neg':
        out = -val;
        break;
      case 'pct':
        out = val / 100;
        break;
      case 'sin':
        out = Math.sin(toRad(val));
        break;
      case 'cos':
        out = Math.cos(toRad(val));
        break;
      case 'tan':
        out = Math.tan(toRad(val));
        break;
      case 'ln':
        out = val <= 0 ? NaN : Math.log(val);
        break;
      case 'log':
        out = val <= 0 ? NaN : Math.log10(val);
        break;
      case 'exp':
        out = Math.exp(val);
        break;
      case 'fact': {
        if (val < 0 || !Number.isInteger(val) || val > 170) {
          out = NaN;
        } else {
          let f = 1;
          for (let i = 2; i <= val; i++) f *= i;
          out = f;
        }
        break;
      }
      default:
        break;
    }
    setDisplay(safeFormat(out));
  };

  return (
    <div
      role="dialog"
      aria-label={
        mode === 'scientific'
          ? 'GATE Scientific Calculator'
          : 'Basic Exam Calculator'
      }
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        setOffset({
          x: dragging.origX + (e.clientX - dragging.startX),
          y: dragging.origY + (e.clientY - dragging.startY),
        });
      }}
      onPointerUp={() => setDragging(null)}
      className="fixed right-4 top-16 z-50 w-[312px] sm:w-[340px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] chrome-no-select"
    >
      {/* Draggable Header */}
      <div
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDragging({
            startX: e.clientX,
            startY: e.clientY,
            origX: offset.x,
            origY: offset.y,
          });
        }}
        className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] rounded-t-xl cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-main)]">
          <Calculator className="w-4 h-4" aria-hidden="true" />
          <span>
            {mode === 'scientific' ? 'Scientific Calculator' : 'Calculator'}
          </span>
          <GripHorizontal
            className="w-3.5 h-3.5 text-[var(--text-muted)]"
            aria-hidden="true"
          />
        </div>
        <button
          type="button"
          aria-label="Close calculator"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)]"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* LCD Readout */}
      <div className="p-3 space-y-2.5">
        <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 py-2 text-end font-mono tabular-nums">
          <div className="min-h-[16px] text-[11px] text-[var(--text-muted)] truncate">
            {expr || (memory !== 0 ? `M = ${memory}` : '\u00A0')}
          </div>
          <div
            data-testid="calc-display"
            className="text-xl font-bold text-[var(--text-main)] truncate"
          >
            {display}
          </div>
        </div>

        {/* Memory + Angle Row */}
        <div className="grid grid-cols-5 gap-1 text-xs font-semibold tabular-nums">
          {mode === 'scientific' ? (
            <button
              type="button"
              onClick={() =>
                setAngleMode((m) => (m === 'DEG' ? 'RAD' : 'DEG'))
              }
              className="min-h-[36px] rounded border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)]"
            >
              {angleMode}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => applyUnary('pct')}
              className="min-h-[36px] rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
            >
              %
            </button>
          )}
          <button
            type="button"
            onClick={() => setMemory(0)}
            className="min-h-[36px] rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
          >
            MC
          </button>
          <button
            type="button"
            onClick={() => setDisplay(safeFormat(memory))}
            className="min-h-[36px] rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
          >
            MR
          </button>
          <button
            type="button"
            onClick={() => setMemory((m) => m + (Number(display) || 0))}
            className="min-h-[36px] rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
          >
            M+
          </button>
          <button
            type="button"
            onClick={() => setMemory((m) => m - (Number(display) || 0))}
            className="min-h-[36px] rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
          >
            M−
          </button>
        </div>

        {/* Scientific Row */}
        {mode === 'scientific' && (
          <div className="grid grid-cols-5 gap-1 text-xs font-semibold">
            {[
              { label: 'sin', action: () => applyUnary('sin') },
              { label: 'cos', action: () => applyUnary('cos') },
              { label: 'tan', action: () => applyUnary('tan') },
              { label: 'ln', action: () => applyUnary('ln') },
              { label: 'log', action: () => applyUnary('log') },
              { label: 'x²', action: () => applyUnary('sq') },
              { label: '√x', action: () => applyUnary('sqrt') },
              { label: 'xʸ', action: () => pushBinaryOp('^') },
              { label: '1/x', action: () => applyUnary('inv') },
              { label: 'n!', action: () => applyUnary('fact') },
              {
                label: 'π',
                action: () => setDisplay(safeFormat(Math.PI)),
              },
              {
                label: 'e',
                action: () => setDisplay(safeFormat(Math.E)),
              },
              { label: 'eˣ', action: () => applyUnary('exp') },
              { label: '%', action: () => applyUnary('pct') },
              { label: '±', action: () => applyUnary('neg') },
            ].map((b) => (
              <button
                key={b.label}
                type="button"
                onClick={b.action}
                className="min-h-[38px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-main)] hover:bg-[var(--bg-canvas)]"
              >
                {b.label}
              </button>
            ))}
          </div>
        )}

        {/* Standard Numeric & Operator Keypad */}
        <div className="grid grid-cols-4 gap-1.5 text-sm font-bold tabular-nums">
          <button
            type="button"
            onClick={() => {
              setDisplay('0');
              setExpr('');
            }}
            className="min-h-[42px] rounded-lg border border-[var(--border-subtle)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]"
          >
            AC
          </button>
          <button
            type="button"
            onClick={() =>
              setDisplay((d) => (d.length > 1 ? d.slice(0, -1) : '0'))
            }
            className="min-h-[42px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-main)]"
          >
            ⌫
          </button>
          <button
            type="button"
            onClick={() =>
              mode === 'basic' ? applyUnary('sqrt') : applyUnary('neg')
            }
            className="min-h-[42px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-main)]"
          >
            {mode === 'basic' ? '√' : '+/−'}
          </button>
          <button
            type="button"
            onClick={() => pushBinaryOp('/')}
            className="min-h-[42px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)]"
          >
            ÷
          </button>

          {['7', '8', '9'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => appendToken(d)}
              className="min-h-[42px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => pushBinaryOp('*')}
            className="min-h-[42px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)]"
          >
            ×
          </button>

          {['4', '5', '6'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => appendToken(d)}
              className="min-h-[42px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => pushBinaryOp('-')}
            className="min-h-[42px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)]"
          >
            −
          </button>

          {['1', '2', '3'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => appendToken(d)}
              className="min-h-[42px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => pushBinaryOp('+')}
            className="min-h-[42px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)]"
          >
            +
          </button>

          <button
            type="button"
            onClick={() => appendToken('0')}
            className="col-span-2 min-h-[42px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => appendToken('.')}
            className="min-h-[42px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-main)] hover:bg-[var(--bg-elevated)]"
          >
            .
          </button>
          <button
            type="button"
            onClick={evaluateAll}
            aria-label="Equals"
            className={cn(
              'min-h-[42px] rounded-lg bg-[var(--brand-primary)] text-[var(--brand-primary-ink)] hover:opacity-90'
            )}
          >
            =
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shunting-yard arithmetic evaluator (zero `eval()` / `new Function()` CSP safe).
 */
function computeExpressionTokens(tokens: string[]): number {
  const prec: Record<string, number> = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
    '**': 3,
  };
  const output: Array<number | string> = [];
  const ops: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^(\d+\.?\d*|\.\d+)$/.test(t)) {
      output.push(Number(t));
    } else if (
      t === '-' &&
      (i === 0 || ['+', '-', '*', '/', '**', '('].includes(tokens[i - 1]))
    ) {
      const next = tokens[i + 1];
      if (next && /^(\d+\.?\d*|\.\d+)$/.test(next)) {
        output.push(-Number(next));
        i++;
      }
    } else if (t in prec) {
      while (
        ops.length > 0 &&
        ops[ops.length - 1] in prec &&
        ((t !== '**' && prec[ops[ops.length - 1]] >= prec[t]) ||
          (t === '**' && prec[ops[ops.length - 1]] > prec[t]))
      ) {
        output.push(ops.pop()!);
      }
      ops.push(t);
    }
  }
  while (ops.length > 0) output.push(ops.pop()!);

  const stack: number[] = [];
  for (const item of output) {
    if (typeof item === 'number') {
      stack.push(item);
    } else {
      const b = stack.pop() ?? 0;
      const a = stack.pop() ?? 0;
      if (item === '+') stack.push(a + b);
      else if (item === '-') stack.push(a - b);
      else if (item === '*') stack.push(a * b);
      else if (item === '/') stack.push(b === 0 ? NaN : a / b);
      else if (item === '**') stack.push(Math.pow(a, b));
    }
  }
  return stack[0] ?? 0;
}
