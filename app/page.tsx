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

// contentEditable innerHTML에서 <img> 태그만 추출
function extractImgTags(html: string): string {
  return (html.match(/<img\b[^>]*>/gi) ?? []).join('\n');
}

// GEO HTML의 첫 번째 <p> 바로 앞에 이미지 삽입
function injectImagesIntoGeoHtml(geoHtml: string, imgHtml: string): string {
  if (!imgHtml) return geoHtml;
  return geoHtml.replace(/(<p[ >])/, `${imgHtml}\n$1`);
}

// GEO HTML에 개선안을 </article> 직전에 삽입 (diff-highlight로 구별 표시)
function applyImprovementsToGeoHtml(geoHtml: string, items: AppliedImprovement[]): string {
  if (items.length === 0) return geoHtml;
  const additions = items.map((i) => `<p><span class="diff-highlight">${i.text}</span></p>`).join('\n');
  if (/<\/article>/i.test(geoHtml)) {
    return geoHtml.replace(/<\/article>/i, `${additions}\n</article>`);
  }
  return geoHtml + '\n' + additions;
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [reevaluateCount, setReevaluateCount] = useState(0);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [reevaluateProgress, setReevaluateProgress] = useState(0);
  const [isGeneratingGeoHtml, setIsGeneratingGeoHtml] = useState(false);
  const [htmlGenProgress, setHtmlGenProgress] = useState(0);
  const [geoHtmlError, setGeoHtmlError] = useState<string | null>(null);
  // GEO HTML 보존용 ref (재평가 시 복원)
  const geoHtmlRef = useRef('');
  // 원본 이미지 HTML 보존용 ref
  const contentHtmlRef = useRef('');
  // 재평가 중단용 refs
  const reevaluateAbortRef = useRef<AbortController | null>(null);
  const reevaluateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 현재 generate-html에 쓸 payload ref (재시도용)
  const geoPayloadRef = useRef<AnalyzeRequestPayload | null>(null);

  const triggerGeoHtmlGeneration = (currentPayload: AnalyzeRequestPayload) => {
    geoPayloadRef.current = currentPayload;
    setGeoHtmlError(null);
    setIsGeneratingGeoHtml(true);
    setHtmlGenProgress(0);

    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setHtmlGenProgress(Math.min(90, (elapsed / 20000) * 100));
    }, 200);

    void (async () => {
      try {
        const response = await fetch('/api/generate-html', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: currentPayload.content,
            mainKeyword: currentPayload.keywords.main,
            purpose: currentPayload.purpose,
          }),
        });
        if (response.ok) {
          const data: { html: string } = await response.json();
          clearInterval(timer);
          setHtmlGenProgress(100);
          setTimeout(() => {
            const imgHtml = extractImgTags(contentHtmlRef.current);
            const finalHtml = injectImagesIntoGeoHtml(data.html, imgHtml);
            geoHtmlRef.current = finalHtml;
            setHtmlCode(finalHtml);
            setPreviewHtml(stripArticleWrapper(finalHtml));
            setIsGeneratingGeoHtml(false);
            setHtmlGenProgress(0);
          }, 400);
        } else {
          const errorData: { error?: string } | null = await response.json().catch(() => null);
          clearInterval(timer);
          setHtmlGenProgress(0);
          setIsGeneratingGeoHtml(false);
          setGeoHtmlError(errorData?.error ?? 'GEO 템플릿 생성에 실패했습니다.');
        }
      } catch {
        clearInterval(timer);
        setHtmlGenProgress(0);
        setIsGeneratingGeoHtml(false);
        setGeoHtmlError('GEO 템플릿 생성 중 네트워크 오류가 발생했습니다.');
      }
    })();
  };

  const handleGeoHtmlRetry = () => {
    if (geoPayloadRef.current) triggerGeoHtmlGeneration(geoPayloadRef.current);
  };

  const handleResult = (nextPayload: AnalyzeRequestPayload, nextResult: AnalysisResult, contentHtml: string) => {
    setPayload(nextPayload);
    setResult(nextResult);
    setAppliedItems([]);
    setPreviewHtml(buildPreviewHtml(nextPayload.content, []));
    setHtmlCode(buildHtmlCode(nextPayload.content, []));
    setReevaluateCount(0);
    geoHtmlRef.current = '';
    contentHtmlRef.current = contentHtml;
    triggerGeoHtmlGeneration(nextPayload);
  };

  const handleApply = (items: AppliedImprovement[]) => {
    const merged = [...appliedItems, ...items];
    setAppliedItems(merged);
    const geo = geoHtmlRef.current;
    if (geo) {
      // GEO HTML 구조를 유지하면서 개선안 삽입
      const updated = applyImprovementsToGeoHtml(geo, merged);
      setPreviewHtml(stripArticleWrapper(updated));
      setHtmlCode(updated);
    } else if (payload) {
      setPreviewHtml(buildPreviewHtml(payload.content, merged));
      setHtmlCode(buildHtmlCode(payload.content, merged));
    }
  };

  const handleRemove = (items: AppliedImprovement[]) => {
    const remaining = appliedItems.filter((existing) => !items.includes(existing));
    setAppliedItems(remaining);
    const geo = geoHtmlRef.current;
    if (geo) {
      const updated = applyImprovementsToGeoHtml(geo, remaining);
      setPreviewHtml(stripArticleWrapper(updated));
      setHtmlCode(updated);
    } else if (payload) {
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
          setAppliedItems([]);
          const savedGeoHtml = geoHtmlRef.current;
          if (savedGeoHtml) {
            setHtmlCode(savedGeoHtml);
            setPreviewHtml(stripArticleWrapper(savedGeoHtml));
          } else if (payload) {
            // GEO HTML 생성 실패 시 텍스트 기반 HTML로 복원
            setPreviewHtml(buildPreviewHtml(payload.content, []));
            setHtmlCode(buildHtmlCode(payload.content, []));
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
        <div className="relative lg:h-full">
          {/* 로딩 외곽 border 빔 — 세 카드 영역을 시계방향으로 순환 */}
          {(isAnalyzing || isReevaluating || isGeneratingGeoHtml) && (
            <div
              className="pointer-events-none absolute rounded-2xl"
              style={{ inset: '-2px', overflow: 'hidden', zIndex: 0 }}
            >
              {/* conic-gradient 회전 → 시계방향 빔 효과 */}
              <div
                style={{
                  position: 'absolute',
                  inset: '-150%',
                  background:
                    'conic-gradient(from 0deg, transparent 0%, transparent 50%, #6b21ff 62%, #8c49ff 70%, #E60073 78%, #8c49ff 86%, transparent 93%)',
                  animation: 'borderSpin 1.2s linear infinite',
                }}
              />
              {/* 내부 마스크 — border 선만 보이도록 내부 덮음 */}
              <div
                style={{
                  position: 'absolute',
                  inset: '2px',
                  borderRadius: '14px',
                  background: '#0b0d1a',
                }}
              />
            </div>
          )}
        <div className="relative z-[1] grid grid-cols-1 gap-6 lg:h-full lg:grid-cols-[1fr_1fr_1.6fr] lg:items-stretch">
          <InputSection
            contentType={contentType}
            onContentTypeChange={setContentType}
            onResult={handleResult}
            onLoadingChange={setIsAnalyzing}
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
              geoHtmlError={geoHtmlError}
              onGeoHtmlRetry={handleGeoHtmlRetry}
            />
          ) : (
            <div className="flex min-h-[600px] w-full items-center justify-center rounded-2xl border border-white/10 bg-[#161a2e] p-6 text-center text-sm text-gray-500 shadow-lg shadow-black/20 lg:h-full lg:min-h-0">
              보완사항을 반영하면 최종 결과가 여기에 표시됩니다.
            </div>
          )}
        </div>
        </div>
      </main>
    </div>
  );
}
