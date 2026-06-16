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
}

export interface AnalysisResult {
  scores: AnalysisScores;
  improvements: ImprovementItem[];
}

interface AnalysisDashboardProps {
  result: AnalysisResult | null;
  onApply: (fields: string[]) => void;
}

const METRIC_LABELS: Record<keyof AnalysisScores, string> = {
  total: '종합',
  quality: '완성도',
  seo: 'SEO',
  geo: 'GEO',
};

const PASS_THRESHOLD = 90;

export default function AnalysisDashboard({ result, onApply }: AnalysisDashboardProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [appliedFields, setAppliedFields] = useState<Set<string>>(new Set());

  if (!result) {
    return (
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-400 shadow-sm sm:p-8">
        분석을 시작하면 결과가 여기에 표시됩니다.
      </div>
    );
  }

  const { scores, improvements } = result;

  const toggleSelect = (field: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const applySingle = (field: string) => {
    onApply([field]);
    setAppliedFields((prev) => new Set(prev).add(field));
  };

  const applyAll = () => {
    const fields = improvements
      .map((item) => item.field)
      .filter((field) => selected.has(field) && !appliedFields.has(field));
    if (fields.length === 0) return;
    onApply(fields);
    setAppliedFields((prev) => {
      const next = new Set(prev);
      fields.forEach((field) => next.add(field));
      return next;
    });
  };

  const pendingCount = improvements.filter(
    (item) => selected.has(item.field) && !appliedFields.has(item.field)
  ).length;

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">분석 결과</h2>
        <button
          type="button"
          onClick={applyAll}
          disabled={pendingCount === 0}
          className="shrink-0 rounded-lg bg-[#8c49ff] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#7a3ce6] disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          보완사항 전체 일괄 반영{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
      </div>

      {/* 4개 지표 프로그레스 바 */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(Object.keys(METRIC_LABELS) as Array<keyof AnalysisScores>).map((key) => {
          const score = scores[key];
          const isLow = score < PASS_THRESHOLD;
          return (
            <div key={key} className={`rounded-xl p-4 ${isLow ? 'bg-[#f4ddff]' : 'bg-gray-50'}`}>
              <p className="mb-2 text-sm font-medium text-gray-600">{METRIC_LABELS[key]}</p>
              <p className="mb-2 text-xl font-bold text-gray-900">{score}점</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/70">
                <div
                  className="h-full rounded-full bg-[#8c49ff] transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 개선 가이드 */}
      {improvements.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-900">보완/개선 가이드</h3>
          <ul className="space-y-2">
            {improvements.map((item) => {
              const applied = appliedFields.has(item.field);
              return (
                <li key={item.field} className="rounded-xl bg-[#f4ddff] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex flex-1 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.field)}
                        onChange={() => toggleSelect(item.field)}
                        disabled={applied}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-[#8c49ff] focus:ring-[#8c49ff]"
                      />
                      <span className={applied ? 'text-gray-400 line-through' : 'text-gray-800'}>
                        <span className="mb-1 inline-block rounded-full bg-[#8c49ff]/10 px-2 py-0.5 text-xs font-medium text-[#8c49ff]">
                          {item.field}
                        </span>
                        <span className="block text-sm text-gray-600">{item.reason}</span>
                        <span className="mt-1 block text-sm font-medium text-gray-900">
                          {item.suggestion}
                        </span>
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => applySingle(item.field)}
                      disabled={applied}
                      className="shrink-0 rounded-lg border border-[#8c49ff] px-3 py-1.5 text-xs font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/10 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                    >
                      {applied ? '반영됨' : '반영하기'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
