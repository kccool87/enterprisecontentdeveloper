'use client';

import { useState, useRef } from 'react';
import InputSection, { AnalyzeRequestPayload } from '@/components/InputSection';
import AnalysisDashboard, { AnalysisResult, AppliedImprovement } from '@/components/AnalysisDashboard';
import ResultViewer from '@/components/ResultViewer';
import { CONTENT_TYPES, type ContentType } from '@/lib/contentTypes';

// 개선안 텍스트와 원문 문단의 단어 겹침 비율 (0~1)
const REPLACE_THRESHOLD = 0.28;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?()[\]]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function overlapRatio(paraTokens: string[], insertTokens: Set<string>): number {
  if (insertTokens.size === 0 || paraTokens.length === 0) return 0;
  const overlap = paraTokens.filter((w) => insertTokens.has(w)).length;
  return overlap / Math.min(paraTokens.length, insertTokens.size);
}

function findInsertionPoint(paragraphs: string[], insertText: string, field: string): number {
  const f = field.toLowerCase();
  if (/서론|도입|시작|첫/.test(f)) return Math.min(1, paragraphs.length);
  if (/결론|마무리|끝|마지막/.test(f)) return paragraphs.length;

  const queryWords = new Set(tokenize(`${insertText} ${field}`));
  let bestIdx = paragraphs.length;
  let bestScore = 0;

  paragraphs.forEach((para, i) => {
    const overlap = tokenize(para).filter((w) => queryWords.has(w)).length;
    if (overlap > bestScore) { bestScore = overlap; bestIdx = i + 1; }
  });

  return bestIdx;
}

// 각 개선안을 삽입(insert) 또는 교체(replace)로 분류
function resolveAppliedItems(
  lines: string[],
  appliedItems: AppliedImprovement[],
): { replacements: Map<number, string>; insertionMap: Map<number, string[]> } {
  const replacements = new Map<number, string>();
  const insertionMap = new Map<number, string[]>();
  const lineTokens = lines.map(tokenize);

  appliedItems.forEach((item) => {
    const insertWords = new Set(tokenize(item.text));

    // 교체 대상 탐색: 아직 교체 예정이 아닌 문단 중 겹침이 가장 높은 것
    let bestIdx = -1;
    let bestScore = 0;
    lineTokens.forEach((tokens, i) => {
      if (replacements.has(i)) return;
      const score = overlapRatio(tokens, insertWords);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    });

    if (bestScore >= REPLACE_THRESHOLD && bestIdx >= 0) {
      // 원문의 유사 문단을 개선안으로 교체
      replacements.set(bestIdx, item.text);
    } else {
      // 겹침 없음 → 기존 방식으로 삽입
      const insertIdx = findInsertionPoint(lines, item.text, item.field);
      if (!insertionMap.has(insertIdx)) insertionMap.set(insertIdx, []);
      insertionMap.get(insertIdx)!.push(item.text);
    }
  });

  return { replacements, insertionMap };
}

function buildPreviewHtml(content: string, appliedItems: AppliedImprovement[]): string {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return '<p>분석할 본문이 없습니다.</p>';

  const { replacements, insertionMap } = resolveAppliedItems(lines, appliedItems);

  let result = '';
  (insertionMap.get(0) ?? []).forEach((text) => {
    result += `<p><span class="diff-highlight">${text}</span></p>`;
  });
  lines.forEach((line, i) => {
    if (replacements.has(i)) {
      result += `<p><span class="diff-highlight">${replacements.get(i)}</span></p>`;
    } else {
      result += `<p>${line}</p>`;
    }
    (insertionMap.get(i + 1) ?? []).forEach((text) => {
      result += `<p><span class="diff-highlight">${text}</span></p>`;
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

  const { replacements, insertionMap } = resolveAppliedItems(lines, appliedItems);

  let body = '';
  (insertionMap.get(0) ?? []).forEach((text) => { body += `  <p>${text}</p>\n`; });
  lines.forEach((line, i) => {
    if (replacements.has(i)) {
      body += `  <p>${replacements.get(i)}</p>\n`;
    } else {
      body += `  <p>${line}</p>\n`;
    }
    (insertionMap.get(i + 1) ?? []).forEach((text) => { body += `  <p>${text}</p>\n`; });
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
  // GEO HTML 보존용 ref (재평가 시 복원)
  const geoHtmlRef = useRef('');
  // 재평가 중단용 refs
  const reevaluateAbortRef = useRef<AbortController | null>(null);
  const reevaluateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleResult = (nextPayload: AnalyzeRequestPayload, nextResult: AnalysisResult) => {
    setPayload(nextPayload);
    setResult(nextResult);
    setAppliedItems([]);
    setPreviewHtml(buildPreviewHtml(nextPayload.content, []));
    setHtmlCode(buildHtmlCode(nextPayload.content, []));
    setReevaluateCount(0);
    geoHtmlRef.current = ''; // 새 분석 시 GEO HTML 초기화

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
            geoHtmlRef.current = data.html; // GEO HTML 저장
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

  const clearReevaluateTimer = () => {
    if (reevaluateTimerRef.current) {
      clearInterval(reevaluateTimerRef.current);
      reevaluateTimerRef.current = null;
    }
  };

  const handleReevaluateStop = () => {
    clearReevaluateTimer();
    reevaluateAbortRef.current?.abort();
    setIsReevaluating(false);
    setReevaluateProgress(0);
  };

  const handleReevaluate = async () => {
    if (!payload || reevaluateCount >= 5) return;
    setIsReevaluating(true);
    setReevaluateProgress(0);

    const controller = new AbortController();
    reevaluateAbortRef.current = controller;

    const startTime = Date.now();
    reevaluateTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setReevaluateProgress(Math.min(90, (elapsed / 20000) * 100));
    }, 200);

    const cleanup = (success: boolean) => {
      clearReevaluateTimer();
      setReevaluateProgress(success ? 100 : 0);
    };

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.ok) {
        const nextResult: AnalysisResult = await response.json();
        cleanup(true);
        setTimeout(() => {
          setReevaluateProgress(0);
          setIsReevaluating(false);
          setResult(nextResult);
          setReevaluateCount((count) => count + 1);
          const savedGeoHtml = geoHtmlRef.current;
          if (savedGeoHtml) {
            setAppliedItems([]);
            setHtmlCode(savedGeoHtml);
            setPreviewHtml(stripArticleWrapper(savedGeoHtml));
          }
        }, 400);
      } else {
        cleanup(false);
        setIsReevaluating(false);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        clearReevaluateTimer();
        return; // handleReevaluateStop이 상태 처리 완료
      }
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
              maxReevaluate={5}
              isReevaluating={isReevaluating}
              reevaluateProgress={reevaluateProgress}
              onReevaluate={handleReevaluate}
              onReevaluateStop={handleReevaluateStop}
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
