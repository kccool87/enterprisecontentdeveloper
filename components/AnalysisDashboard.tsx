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

const METRIC_COLORS: Record<keyof AnalysisScores, string> = {
  total: '#8c49ff',
  quality: '#2dd4bf',
  seo: '#f5a623',
  geo: '#38bdf8',
};

const PASS_THRESHOLD = 90;

function CircularScore({
  label,
  score,
  color,
  isLow,
}: {
  label: string;
  score: number;
  color: string;
  isLow: boolean;
}) {
  const size = 88;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, score));
  const offset = circumference - (circumference * clamped) / 100;

  return (
    <div
      className={`flex flex-col items-center rounded-xl border p-4 ${
        isLow ? 'border-white/15 bg-white/[0.04]' : 'border-white/5 bg-white/[0.02]'
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
        {isLow && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: `${color}26`, color }}
          >
            개선 필요
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
  const [isExpanded, setIsExpanded] = useState(false);

  if (!result) {
    return (
      <div className="flex h-full min-h-[240px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[#161a2e] p-6 text-center text-sm text-gray-400 shadow-lg shadow-black/20">
        분석을 시작하면 결과가 여기에 표시됩니다.
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

  const applySingle = (index: number, item: ImprovementItem) => {
    const appliedItem: AppliedImprovement = { field: item.field, text: getText(index, item) };
    onApply([appliedItem]);
    setAppliedIndices((prev) => new Set(prev).add(index));
    setAppliedPayloads((prev) => ({ ...prev, [index]: appliedItem }));
  };

  const removeSingle = (index: number) => {
    const appliedItem = appliedPayloads[index];
    if (!appliedItem) return;
    onRemove([appliedItem]);
    setAppliedIndices((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    setAppliedPayloads((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const toggleApply = (index: number, item: ImprovementItem) => {
    if (appliedIndices.has(index)) {
      removeSingle(index);
    } else {
      applySingle(index, item);
    }
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
  };

  const pendingCount = improvements.filter(
    (_, index) => selected.has(index) && !appliedIndices.has(index)
  ).length;

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-[#161a2e] p-6 shadow-lg shadow-black/20">
      <div className="mb-6">
        <span className="inline-block rounded-full bg-[#8c49ff] px-4 py-1.5 text-sm font-semibold text-white">
          분석 결과
        </span>
      </div>

      {/* 4개 지표 원형 차트 */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(METRIC_LABELS) as Array<keyof AnalysisScores>).map((key) => {
          const score = scores[key];
          const isLow = score < PASS_THRESHOLD;
          return (
            <CircularScore
              key={key}
              label={METRIC_LABELS[key]}
              score={score}
              color={METRIC_COLORS[key]}
              isLow={isLow}
            />
          );
        })}
      </div>

      {/* 개선 가이드 */}
      {improvements.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-lg py-2 text-sm font-semibold text-white transition hover:text-[#8c49ff]"
          >
            <span>보완/개선 가이드 ({improvements.length}개)</span>
            <span className="text-xs font-medium text-gray-400">
              {isExpanded ? '접기 ▲' : '펼치기 ▼'}
            </span>
          </button>

          {isExpanded && (
            <>
              <div className="mb-3 flex justify-end">
                {pendingCount > 0 ? (
                  <button
                    type="button"
                    onClick={applyAll}
                    className="shrink-0 rounded-lg bg-[#8c49ff] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#7a3ce6]"
                  >
                    보완사항 전체 일괄 반영 ({pendingCount})
                  </button>
                ) : appliedIndices.size > 0 ? (
                  <button
                    type="button"
                    onClick={cancelAll}
                    className="shrink-0 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-400/20"
                  >
                    전체 일괄 취소 ({appliedIndices.size})
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="shrink-0 cursor-not-allowed rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-gray-400"
                  >
                    보완사항 전체 일괄 반영
                  </button>
                )}
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
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-1 items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selected.has(index)}
                            onChange={() => toggleSelect(index)}
                            disabled={applied}
                            className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent text-[#8c49ff] focus:ring-[#8c49ff]"
                          />
                          <div className={`flex-1 ${applied ? 'text-gray-400' : 'text-gray-100'}`}>
                            <span
                              className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                                applied
                                  ? 'bg-white/5 text-gray-400'
                                  : 'bg-[#8c49ff]/15 text-[#8c49ff]'
                              }`}
                            >
                              {item.field}
                            </span>
                            <p className={`text-sm ${applied ? 'line-through' : 'text-gray-300'}`}>
                              {item.reason}
                            </p>
                            <p
                              className={`mt-1 text-sm font-medium ${
                                applied ? 'line-through' : 'text-white'
                              }`}
                            >
                              {item.suggestion}
                            </p>

                            <div className="mt-2">
                              <label className="mb-1 block text-xs font-medium text-gray-400">
                                삽입할 문장 (수정 가능)
                              </label>
                              <textarea
                                value={getText(index, item)}
                                onChange={(e) =>
                                  setEditedText((prev) => ({ ...prev, [index]: e.target.value }))
                                }
                                disabled={applied}
                                rows={2}
                                className="w-full resize-none rounded-lg border border-white/10 bg-[#0f1224] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/30 disabled:bg-white/[0.02] disabled:text-gray-400"
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleApply(index, item)}
                          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                            applied
                              ? 'border-white/15 text-gray-400 hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-300'
                              : 'border-[#8c49ff] text-[#8c49ff] hover:bg-[#8c49ff]/15'
                          }`}
                        >
                          {applied ? '반영됨 (취소)' : '반영하기'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
