'use client';

import { useState } from 'react';
import InputSection, { AnalyzeRequestPayload } from '@/components/InputSection';
import AnalysisDashboard, { AnalysisResult, AppliedImprovement } from '@/components/AnalysisDashboard';
import ResultViewer from '@/components/ResultViewer';
import { CONTENT_TYPES, type ContentType } from '@/lib/contentTypes';

function buildHtmlCode(content: string, appliedItems: AppliedImprovement[]): string {
  const paragraphs = content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => `  <p>${line}</p>`)
    .join('\n');

  const insertedParagraphs = appliedItems.map((item) => `  <p>${item.text}</p>`).join('\n');

  const body = [paragraphs, insertedParagraphs].filter(Boolean).join('\n');

  return `<article>\n${body}\n</article>`;
}

function buildPreviewHtml(content: string, appliedItems: AppliedImprovement[]): string {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  const original =
    lines.length > 0
      ? lines.map((line) => `<p>${line}</p>`).join('')
      : '<p>분석할 본문이 없습니다.</p>';

  const inserted = appliedItems
    .map((item) => `<p><span class="diff-highlight">${item.text}</span></p>`)
    .join('');

  return original + inserted;
}

export default function Home() {
  const [contentType, setContentType] = useState<ContentType>(CONTENT_TYPES[0].id);
  const [payload, setPayload] = useState<AnalyzeRequestPayload | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [appliedItems, setAppliedItems] = useState<AppliedImprovement[]>([]);
  const [previewHtml, setPreviewHtml] = useState('');
  const [htmlCode, setHtmlCode] = useState('');
  const [reevaluateCount, setReevaluateCount] = useState(0);
  const [isReevaluating, setIsReevaluating] = useState(false);

  const handleResult = (nextPayload: AnalyzeRequestPayload, nextResult: AnalysisResult) => {
    setPayload(nextPayload);
    setResult(nextResult);
    setAppliedItems([]);
    setPreviewHtml(buildPreviewHtml(nextPayload.content, []));
    setHtmlCode(buildHtmlCode(nextPayload.content, []));
    setReevaluateCount(0);
  };

  const handleApply = (items: AppliedImprovement[]) => {
    const merged = [...appliedItems, ...items];
    setAppliedItems(merged);
    if (payload) {
      setPreviewHtml(buildPreviewHtml(payload.content, merged));
      setHtmlCode(buildHtmlCode(payload.content, merged));
    }
  };

  const handleRemove = (items: AppliedImprovement[]) => {
    const remaining = appliedItems.filter((existing) => !items.includes(existing));
    setAppliedItems(remaining);
    if (payload) {
      setPreviewHtml(buildPreviewHtml(payload.content, remaining));
      setHtmlCode(buildHtmlCode(payload.content, remaining));
    }
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
    <div
      className="min-h-screen bg-[#0b0d1a]"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 900px 900px at 95% 0%, rgba(214,38,159,0.30), transparent 60%), ' +
          'radial-gradient(ellipse 1000px 1000px at 100% 45%, rgba(140,73,255,0.28), transparent 60%), ' +
          'radial-gradient(ellipse 800px 800px at 85% 90%, rgba(214,38,159,0.16), transparent 60%)',
        backgroundAttachment: 'fixed',
      }}
    >
      <header className="flex items-center gap-3 border-b border-white/10 bg-[#11142b] px-6 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#8c49ff] text-sm font-bold text-white">
          U+
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">U+ Content Developer</h1>
          <p className="text-xs text-gray-400">
            SEO/GEO 분석을 기반으로 블로그 콘텐츠를 진단하고 개선합니다.
          </p>
        </div>
      </header>

      <main className="w-full px-6 py-8">
        {/* 콘텐츠 유형 선택 */}
        <div className="mb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            콘텐츠 유형 선택
          </p>
          <div className="flex flex-wrap gap-3">
            {CONTENT_TYPES.map((type) => {
              const isActive = contentType === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setContentType(type.id)}
                  title={type.description}
                  style={{
                    backgroundColor: type.color,
                    color: type.textColor,
                    boxShadow: isActive ? `0 0 0 2px #0b0d1a, 0 0 0 4px ${type.color}` : undefined,
                  }}
                  className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
                    isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  {type.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_1fr_1.6fr]">
          <InputSection contentType={contentType} onResult={handleResult} />

          <AnalysisDashboard result={result} onApply={handleApply} onRemove={handleRemove} />

          {payload ? (
            <ResultViewer
              previewHtml={previewHtml}
              onPreviewHtmlChange={setPreviewHtml}
              htmlCode={htmlCode}
              onHtmlCodeChange={setHtmlCode}
              mainKeyword={payload.keywords.main}
              purpose={payload.purpose}
              reevaluateCount={reevaluateCount}
              isReevaluating={isReevaluating}
              onReevaluate={handleReevaluate}
            />
          ) : (
            <div className="flex h-full min-h-[240px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[#161a2e] p-6 text-center text-sm text-gray-400 shadow-lg shadow-black/20">
              보완사항을 반영하면 최종 결과가 여기에 표시됩니다.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
