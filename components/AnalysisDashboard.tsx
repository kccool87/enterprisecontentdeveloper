'use client';

import { useState } from 'react';

export interface AnalysisScores {
  total: number;
  quality: number;
  seo: number;
  geo: number;
}

export interface ImprovementItem {
  field: string;
  reason: string;
  suggestion: string;
  insertText: string;
}

export interface AnalysisResult {
  scores: AnalysisScores;
  improvements: ImprovementItem[];
}

export interface AppliedImprovement {
  field: string;
  text: string;
}

interface AnalysisDashboardProps {
  result: AnalysisResult | null;
  onApply: (items: AppliedImprovement[]) => void;
  onRemove: (items: AppliedImprovement[]) => void;
}

const METRIC_LABELS: Record<keyof AnalysisScores, string> = {
  total: '종합',
  quality: '완성도',
  seo: 'SEO',
  geo: 'GEO',
};

function getScoreColor(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 80) return '#f97316';
  return '#ef4444';
}

function getScoreBadge(
  score: number,
  isTotal: boolean,
): { text: string; bg: string; fg: string } | null {
  if (isTotal) {
    const ok = score >= 85;
    const c = ok ? '#22c55e' : '#ef4444';
    return { text: ok ? '발행 가능' : '발행 불가', bg: `${c}26`, fg: c };
  }
  if (score >= 90) return { text: '완성', bg: '#22c55e26', fg: '#22c55e' };
  if (score >= 85) return { text: '평균', bg: '#f9731626', fg: '#f97316' };
  if (score < 80) return { text: '미달', bg: '#ef444426', fg: '#ef4444' };
  return null;
}

function CircularScore({ label, score, isTotal = false }: { label: string; score: number; isTotal?: boolean }) {
  const size = 88;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, score));
  const offset = circumference - (circumference * clamped) / 100;
  const color = getScoreColor(score);
  const badge = getScoreBadge(score, isTotal);
  const isAlert = score < 80;

  return (
    <div
      className={`flex flex-col items-center rounded-xl border p-4 ${
        isAlert ? 'border-white/15 bg-white/[0.04]' : 'border-white/5 bg-white/[0.02]'
      }`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-white">{score}</span>
          <span className="text-[10px] text-gray-400">점</span>
        </div>
      </div>
      <div className="mt-2 flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-gray-300">{label}</p>
        {badge && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: badge.bg, color: badge.fg }}
          >
            {badge.text}
          </span>
        )}
      </div>
    </div>
  );
}

export default function AnalysisDashboard({ result, onApply, onRemove }: AnalysisDashboardProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [appliedIndices, setAppliedIndices] = useState<Set<number>>(new Set());
  const [appliedPayloads, setAppliedPayloads] = useState<Record<number, AppliedImprovement>>({});
  const [editedText, setEditedText] = useState<Record<number, string>>({});

  if (!result) {
    return (
      <div className="flex min-h-[600px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[#161a2e] p-6 text-center text-sm text-gray-500 shadow-lg shadow-black/20 lg:h-full lg:min-h-0">
        평가를 시작하면 결과가 여기에 표시됩니다.
      </div>
    );
  }

  const { scores, improvements } = result;

  const getText = (index: number, item: ImprovementItem) => editedText[index] ?? item.insertText;

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(improvements.map((_, i) => i)));
  };

  const applyAll = () => {
    const targets = improvements
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => selected.has(index) && !appliedIndices.has(index));
    if (targets.length === 0) return;
    const appliedItems = targets.map(({ item, index }) => ({
      index,
      appliedItem: { field: item.field, text: getText(index, item) } as AppliedImprovement,
    }));
    onApply(appliedItems.map(({ appliedItem }) => appliedItem));
    setAppliedIndices((prev) => {
      const next = new Set(prev);
      appliedItems.forEach(({ index }) => next.add(index));
      return next;
    });
    setAppliedPayloads((prev) => {
      const next = { ...prev };
      appliedItems.forEach(({ index, appliedItem }) => {
        next[index] = appliedItem;
      });
      return next;
    });
  };

  const cancelAll = () => {
    const items = Array.from(appliedIndices)
      .map((index) => appliedPayloads[index])
      .filter((item): item is AppliedImprovement => Boolean(item));
    if (items.length === 0) return;
    onRemove(items);
    setAppliedIndices(new Set());
    setAppliedPayloads({});
    setSelected(new Set());
  };

  const pendingCount = improvements.filter(
    (_, index) => selected.has(index) && !appliedIndices.has(index)
  ).length;

  return (
    <div className="flex min-h-[600px] w-full flex-col rounded-2xl border border-white/10 bg-[#161a2e] p-6 shadow-lg shadow-black/20 lg:h-full lg:min-h-0">
      <div className="mb-4 flex-shrink-0">
        <span className="inline-block rounded-full bg-lime-400 px-4 py-1.5 text-sm font-semibold text-gray-900">
          평가 결과
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">

        {/* 4개 지표 원형 차트 */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(METRIC_LABELS) as Array<keyof AnalysisScores>).map((key) => (
            <CircularScore
              key={key}
              label={METRIC_LABELS[key]}
              score={scores[key]}
              isTotal={key === 'total'}
            />
          ))}
        </div>

        {/* 개선 가이드 */}
        {improvements.length > 0 && (
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white">
                보완/개선 가이드 ({improvements.length}개)
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={selected.size === improvements.length}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  전체 선택
                </button>
                <button
                  type="button"
                  onClick={pendingCount > 0 ? applyAll : cancelAll}
                  disabled={pendingCount === 0 && appliedIndices.size === 0}
                  className="rounded-lg bg-[#8c49ff] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#7a3ce6] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-400"
                >
                  {pendingCount > 0
                    ? `선택 반영 (${pendingCount})`
                    : appliedIndices.size > 0
                    ? '선택 취소'
                    : '선택 반영'}
                </button>
              </div>
            </div>

            <ul className="space-y-2">
              {improvements.map((item, index) => {
                const applied = appliedIndices.has(index);
                return (
                  <li
                    key={index}
                    className={`rounded-xl border border-l-4 px-4 py-3 ${
                      applied
                        ? 'border-white/5 border-l-white/15 bg-white/[0.02]'
                        : 'border-white/10 border-l-[#8c49ff] bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(index)}
                        onChange={() => toggleSelect(index)}
                        className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent text-[#8c49ff] focus:ring-[#8c49ff]"
                      />
                      <div className={`flex-1 ${applied ? 'text-gray-500' : 'text-gray-100'}`}>
                        <span
                          className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            applied
                              ? 'bg-white/5 text-gray-500'
                              : 'bg-[#8c49ff]/15 text-[#8c49ff]'
                          }`}
                        >
                          {item.field}
                        </span>
                        <p className={`text-sm ${applied ? 'text-gray-500' : 'text-gray-300'}`}>
                          {item.reason}
                        </p>
                        <p
                          className={`mt-1 text-sm font-medium ${
                            applied ? 'text-gray-500' : 'text-white'
                          }`}
                        >
                          {item.suggestion}
                        </p>

                        <div className="mt-2">
                          <label className="mb-1 block text-xs font-medium text-gray-500">
                            삽입할 문장 (수정 가능)
                          </label>
                          <textarea
                            value={getText(index, item)}
                            onChange={(e) =>
                              setEditedText((prev) => ({ ...prev, [index]: e.target.value }))
                            }
                            disabled={applied}
                            rows={2}
                            className="w-full resize-none rounded-lg border border-white/10 bg-[#0f1224] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/30 disabled:bg-white/[0.02] disabled:text-gray-500"
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
