'use client';

import { useState } from 'react';
import InputSection, { AnalyzeRequestPayload } from '@/components/InputSection';
import AnalysisDashboard, { AnalysisResult, AppliedImprovement } from '@/components/AnalysisDashboard';
import ResultViewer from '@/components/ResultViewer';
import { CONTENT_TYPES, type ContentType } from '@/lib/contentTypes';

function findInsertionPoint(paragraphs: string[], insertText: string, field: string): number {
  const f = field.toLowerCase();
  if (/서론|도입|시작|첫/.test(f)) return Math.min(1, paragraphs.length);
  if (/결론|마무리|끝|마지막/.test(f)) return paragraphs.length;

  const queryWords = new Set(
    `${insertText} ${field}`
      .toLowerCase()
      .replace(/[.,!?()[\]]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );

  let bestIdx = paragraphs.length;
  let bestScore = 0;

  paragraphs.forEach((para, i) => {
    const paraWords = para
      .toLowerCase()
      .replace(/[.,!?()[\]]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
    const overlap = paraWords.filter((w) => queryWords.has(w)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestIdx = i + 1;
    }
  });

  return bestIdx;
}

function buildPreviewHtml(content: string, appliedItems: AppliedImprovement[]): string {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return '<p>분석할 본문이 없습니다.</p>';

  const insertionMap = new Map<number, AppliedImprovement[]>();
  appliedItems.forEach((item) => {
    const idx = findInsertionPoint(lines, item.text, item.field);
    if (!insertionMap.has(idx)) insertionMap.set(idx, []);
    insertionMap.get(idx)!.push(item);
  });

  let result = '';
  (insertionMap.get(0) ?? []).forEach((item) => {
    result += `<p><span class="diff-highlight">${item.text}</span></p>`;
  });
  lines.forEach((line, i) => {
    result += `<p>${line}</p>`;
    (insertionMap.get(i + 1) ?? []).forEach((item) => {
      result += `<p><span class="diff-highlight">${item.text}</span></p>`;
    });
  });

  return result;
}

function stripArticleWrapper(html: string): string {
  return html.replace(/^<article>\s*/i, '').replace(/\s*<\/article>\s*$/i, '');
}

function buildHtmlCode(content: string, appliedItems: AppliedImprovement[]): string {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return '<article></article>';

  const insertionMap = new Map<number, AppliedImprovement[]>();
  appliedItems.forEach((item) => {
    const idx = findInsertionPoint(lines, item.text, item.field);
    if (!insertionMap.has(idx)) insertionMap.set(idx, []);
    insertionMap.get(idx)!.push(item);
  });

  let body = '';
  (insertionMap.get(0) ?? []).forEach((item) => { body += `  <p>${item.text}</p>\n`; });
  lines.forEach((line, i) => {
    body += `  <p>${line}</p>\n`;
    (insertionMap.get(i + 1) ?? []).forEach((item) => { body += `  <p>${item.text}</p>\n`; });
  });

  return `<article>\n${body}</article>`;
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
  const [reevaluateProgress, setReevaluateProgress] = useState(0);
  const [isGeneratingGeoHtml, setIsGeneratingGeoHtml] = useState(false);
  const [htmlGenProgress, setHtmlGenProgress] = useState(0);

  const handleResult = (nextPayload: AnalyzeRequestPayload, nextResult: AnalysisResult) => {
    setPayload(nextPayload);
    setResult(nextResult);
    setAppliedItems([]);
    setPreviewHtml(buildPreviewHtml(nextPayload.content, []));
    setHtmlCode(buildHtmlCode(nextPayload.content, []));
    setReevaluateCount(0);

    void (async () => {
      setIsGeneratingGeoHtml(true);
      setHtmlGenProgress(0);

      const startTime = Date.now();
      const timer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        setHtmlGenProgress(Math.min(90, (elapsed / 20000) * 100));
      }, 200);

      try {
        const response = await fetch('/api/generate-html', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: nextPayload.content,
            mainKeyword: nextPayload.keywords.main,
            purpose: nextPayload.purpose,
          }),
        });
        if (response.ok) {
          const data: { html: string } = await response.json();
          clearInterval(timer);
          setHtmlGenProgress(100);
          setTimeout(() => {
            setHtmlCode(data.html);
            setPreviewHtml(stripArticleWrapper(data.html));
            setIsGeneratingGeoHtml(false);
            setHtmlGenProgress(0);
          }, 400);
        } else {
          clearInterval(timer);
          setHtmlGenProgress(0);
          setIsGeneratingGeoHtml(false);
        }
      } catch {
        clearInterval(timer);
        setHtmlGenProgress(0);
        setIsGeneratingGeoHtml(false);
      }
    })();
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
    setReevaluateProgress(0);

    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setReevaluateProgress(Math.min(90, (elapsed / 20000) * 100));
    }, 200);

    const cleanup = (success: boolean) => {
      clearInterval(timer);
      setReevaluateProgress(success ? 100 : 0);
    };

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const nextResult: AnalysisResult = await response.json();
        cleanup(true);
        setTimeout(() => {
          setReevaluateProgress(0);
          setIsReevaluating(false);
          setResult(nextResult);
          setReevaluateCount((count) => count + 1);
        }, 400);
      } else {
        cleanup(false);
        setIsReevaluating(false);
      }
    } catch {
      cleanup(false);
      setIsReevaluating(false);
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0b0d1a]">
      <header className="flex flex-shrink-0 justify-center px-7 pt-10 pb-6">
        <div className="flex flex-col">
          <h1
            className="text-[58px] leading-none"
            style={{ fontFamily: "'Permanent Marker', cursive" }}
          >
            <span style={{ color: '#E60073' }}>U+</span>
            <span className="text-white"> Enterprise CONTENT LAB</span>
          </h1>
          <p
            className="mt-1 text-right text-xs font-normal tracking-wide text-white/50"
            style={{ fontFamily: "'Noto Sans', sans-serif" }}
          >
            Content LAB v1.0.0 © 2026 KHC.
          </p>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-6 py-6 lg:overflow-hidden">
        <div className="grid grid-cols-1 gap-6 lg:h-full lg:grid-cols-[1fr_1fr_1.6fr] lg:items-stretch">
          <InputSection
            contentType={contentType}
            onContentTypeChange={setContentType}
            onResult={handleResult}
          />

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
              reevaluateProgress={reevaluateProgress}
              onReevaluate={handleReevaluate}
              isInitializing={isGeneratingGeoHtml}
              isInitializingProgress={htmlGenProgress}
            />
          ) : (
            <div className="flex min-h-[600px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[#161a2e] p-6 text-center text-sm text-gray-500 shadow-lg shadow-black/20 lg:h-full lg:min-h-0">
              보완사항을 반영하면 최종 결과가 여기에 표시됩니다.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
