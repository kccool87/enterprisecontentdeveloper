'use client';

import { useState } from 'react';
import InputSection, { AnalyzeRequestPayload } from '@/components/InputSection';
import AnalysisDashboard, { AnalysisResult } from '@/components/AnalysisDashboard';
import ResultViewer from '@/components/ResultViewer';

type Step = 'input' | 'analysis' | 'result';

function buildHtmlCode(content: string, appliedFields: Set<string>): string {
  const paragraphs = content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `  <p>${line}</p>`)
    .join('\n');

  const summaryBlock =
    appliedFields.size > 0
      ? '  <div class="summary"><strong>핵심 요약:</strong> 이 글은 독자가 찾는 답변을 빠르게 제공합니다.</div>\n'
      : '';

  return `<article>\n${summaryBlock}${paragraphs}\n</article>`;
}

function buildPreviewHtml(content: string, appliedFields: Set<string>): string {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return '<p>분석할 본문이 없습니다.</p>';
  }

  return lines
    .map((line, index) => {
      const isChanged = appliedFields.size > 0 && index === 0;
      return isChanged ? `<p><span class="diff-highlight">${line}</span></p>` : `<p>${line}</p>`;
    })
    .join('');
}

export default function Home() {
  const [step, setStep] = useState<Step>('input');
  const [payload, setPayload] = useState<AnalyzeRequestPayload | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [appliedFields, setAppliedFields] = useState<Set<string>>(new Set());
  const [reevaluateCount, setReevaluateCount] = useState(0);
  const [isReevaluating, setIsReevaluating] = useState(false);

  const handleResult = (nextPayload: AnalyzeRequestPayload, nextResult: AnalysisResult) => {
    setPayload(nextPayload);
    setResult(nextResult);
    setAppliedFields(new Set());
    setReevaluateCount(0);
    setStep('analysis');
  };

  const handleApply = (fields: string[]) => {
    setAppliedFields((prev) => {
      const next = new Set(prev);
      fields.forEach((field) => next.add(field));
      return next;
    });
  };

  const handleReevaluate = async () => {
    if (!payload || reevaluateCount >= 3) return;
    setIsReevaluating(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const nextResult: AnalysisResult = await response.json();
        setResult(nextResult);
        setReevaluateCount((count) => count + 1);
      }
    } finally {
      setIsReevaluating(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">B2B 블로그 최적화 도구</h1>
        <p className="mt-1 text-sm text-gray-500">
          SEO/GEO 분석을 기반으로 블로그 콘텐츠를 진단하고 개선합니다.
        </p>
      </header>

      <InputSection onResult={handleResult} />

      {step !== 'input' && result && (
        <section>
          <AnalysisDashboard result={result} onApply={handleApply} />
          {step === 'analysis' && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setStep('result')}
                className="rounded-lg bg-[#8c49ff] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7a3ce6]"
              >
                최종 결과 확인하기
              </button>
            </div>
          )}
        </section>
      )}

      {step === 'result' && payload && (
        <ResultViewer
          previewHtml={buildPreviewHtml(payload.content, appliedFields)}
          htmlCode={buildHtmlCode(payload.content, appliedFields)}
          reevaluateCount={reevaluateCount}
          isReevaluating={isReevaluating}
          onReevaluate={handleReevaluate}
        />
      )}
    </main>
  );
}
