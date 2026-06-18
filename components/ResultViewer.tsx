'use client';

import { useRef, useState, type FocusEvent } from 'react';

interface ResultViewerProps {
  previewHtml: string;
  onPreviewHtmlChange: (html: string) => void;
  htmlCode: string;
  onHtmlCodeChange: (code: string) => void;
  mainKeyword?: string;
  purpose?: string;
  reevaluateCount: number;
  maxReevaluate?: number;
  isReevaluating?: boolean;
  reevaluateProgress?: number;
  isInitializing?: boolean;
  isInitializingProgress?: number;
  onReevaluate: () => void;
}

function stripDiffHighlight(html: string): string {
  return html.replace(/<span class="diff-highlight">(.*?)<\/span>/g, '$1');
}

function stripArticleWrapper(html: string): string {
  return html.replace(/^<article>\s*/i, '').replace(/\s*<\/article>\s*$/i, '');
}

const INSTRUCTION_ESTIMATED_SECONDS = 15;

export default function ResultViewer({
  previewHtml,
  onPreviewHtmlChange,
  htmlCode,
  onHtmlCodeChange,
  reevaluateCount,
  maxReevaluate = 3,
  isReevaluating = false,
  reevaluateProgress = 0,
  isInitializing = false,
  isInitializingProgress = 0,
  onReevaluate,
}: ResultViewerProps) {
  const [previewCopied, setPreviewCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [isApplyingInstruction, setIsApplyingInstruction] = useState(false);
  const [instructionProgress, setInstructionProgress] = useState(0);
  const [instructionError, setInstructionError] = useState<string | null>(null);
  const [showHtmlModal, setShowHtmlModal] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const reevaluateDisabled = isReevaluating || reevaluateCount >= maxReevaluate;

  const handleCopyPreview = async () => {
    await navigator.clipboard.writeText(previewRef.current?.innerText ?? '');
    setPreviewCopied(true);
    setTimeout(() => setPreviewCopied(false), 2000);
  };

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(htmlCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handlePreviewBlur = (e: FocusEvent<HTMLDivElement>) => {
    const rawHtml = e.currentTarget.innerHTML;
    onPreviewHtmlChange(rawHtml);
    const cleaned = stripDiffHighlight(rawHtml);
    onHtmlCodeChange(`<article>\n${cleaned}\n</article>`);
  };

  const handlePreviewPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      document.execCommand('insertHTML', false, `<img src="${src}" style="max-width:100%;height:auto;border-radius:8px;margin:8px 0;" />`);
    };
    reader.readAsDataURL(file);
  };

  const handleApplyInstruction = async () => {
    if (!instruction.trim() || isApplyingInstruction) return;
    setIsApplyingInstruction(true);
    setInstructionProgress(0);
    setInstructionError(null);

    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setInstructionProgress(Math.min(90, (elapsed / (INSTRUCTION_ESTIMATED_SECONDS * 1000)) * 100));
    }, 200);

    const cleanup = (success: boolean) => {
      clearInterval(timer);
      if (success) {
        setInstructionProgress(100);
      } else {
        setInstructionProgress(0);
        setIsApplyingInstruction(false);
      }
    };

    try {
      const response = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: htmlCode, instruction: instruction.trim() }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? '코드 수정 요청에 실패했습니다.');
      }

      const data: { html: string } = await response.json();
      cleanup(true);

      setTimeout(() => {
        setInstructionProgress(0);
        setIsApplyingInstruction(false);
        onHtmlCodeChange(data.html);
        onPreviewHtmlChange(stripArticleWrapper(data.html));
        setInstruction('');
      }, 400);
    } catch (err) {
      cleanup(false);
      setInstructionError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    }
  };

  const instructionRemainingSeconds =
    instructionProgress > 0 && instructionProgress < 90
      ? Math.max(1, Math.round(INSTRUCTION_ESTIMATED_SECONDS * (1 - instructionProgress / 100)))
      : null;

  return (
    <>
      <div className="flex min-h-[600px] w-full flex-col rounded-2xl border border-white/10 bg-[#161a2e] p-6 shadow-lg shadow-black/20 lg:h-full lg:min-h-0">
        <div className="mb-3 flex flex-shrink-0 items-center justify-between">
          <span className="inline-block rounded-full bg-lime-400 px-4 py-1.5 text-sm font-semibold text-gray-900">
            최종 결과
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-gray-400 transition hover:border-white/40 hover:text-white"
            >
              RESET
            </button>
            <button
              type="button"
              onClick={onReevaluate}
              disabled={reevaluateDisabled}
              className="rounded-lg border border-[#8c49ff] px-4 py-2 text-sm font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-gray-400"
            >
              {isReevaluating ? '재평가 중...' : `재평가 (${reevaluateCount}/${maxReevaluate})`}
            </button>
          </div>
        </div>

        {/* 재평가 진행 로딩바 (red→orange→yellow→green gradient) */}
        {isReevaluating && (
          <div className="mb-3 flex-shrink-0">
            <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
              <span>재평가 중... {Math.round(reevaluateProgress)}%</span>
              <span>
                {reevaluateProgress < 90
                  ? `예상 ${Math.max(1, Math.round(20 * (1 - reevaluateProgress / 100)))}초 남음`
                  : '완료 대기 중...'}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${reevaluateProgress}%`,
                  background: 'linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e)',
                }}
              />
            </div>
          </div>
        )}

        {isInitializing ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5">
            <div className="relative h-24 w-24">
              {/* 배경 링 */}
              <div className="absolute inset-0 rounded-full" style={{ border: '5px solid rgba(255,255,255,0.08)' }} />
              {/* 그래디언트 스피너 링 */}
              <div
                className="absolute inset-0 animate-spin rounded-full"
                style={{
                  background: 'conic-gradient(from 0deg, #ef4444 0%, #f97316 25%, #eab308 50%, #22c55e 75%, transparent 100%)',
                  WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), black calc(100% - 5px))',
                  mask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), black calc(100% - 5px))',
                }}
              />
              {/* 중앙 진행률 */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-white">{Math.round(isInitializingProgress)}%</span>
              </div>
            </div>
            <p className="text-sm text-gray-400">GEO 최적화 HTML 생성 중...</p>
          </div>
        ) : (
        <div className="min-h-0 flex-1">
          <div className="grid h-full grid-cols-1 gap-6 lg:grid-cols-2">

            {/* 결과 미리보기 카드 */}
            <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-white/10 p-4">
                <span className="rounded-full bg-[#8c49ff] px-3 py-1 text-xs font-semibold text-white">결과 미리보기</span>
                <button
                  type="button"
                  onClick={handleCopyPreview}
                  className="rounded-lg border border-[#8c49ff] px-3 py-1.5 text-xs font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/15"
                >
                  {previewCopied ? '복사 완료' : '전체 복사'}
                </button>
              </div>
              <div
                key={previewHtml}
                ref={previewRef}
                contentEditable={!isInitializing}
                suppressContentEditableWarning
                onBlur={handlePreviewBlur}
                onPaste={handlePreviewPaste}
                className="min-h-0 flex-1 overflow-y-auto p-4 prose prose-sm prose-invert max-w-none rounded-b-xl outline-none [&_.diff-highlight]:rounded [&_.diff-highlight]:bg-[#8c49ff]/25 [&_.diff-highlight]:px-1 [&_.diff-highlight]:py-0.5 [&_.diff-highlight]:text-violet-200 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded"
                dangerouslySetInnerHTML={{ __html: isInitializing ? '<p style="color:#6b7280;font-size:13px;">GEO 최적화 HTML 생성 중...</p>' : previewHtml }}
              />
            </div>

            {/* HTML 코드 카드 */}
            <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#8c49ff] px-3 py-1 text-xs font-semibold text-white">
                    HTML
                  </span>
                  {isInitializing && (
                    <span className="text-xs text-gray-400 animate-pulse">GEO 최적화 생성 중...</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHtmlModal(true)}
                    disabled={isInitializing}
                    className="rounded-lg bg-[#8c49ff] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#7a3ce6] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-400"
                  >
                    PREVIEW
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    disabled={isInitializing}
                    className="rounded-lg border border-[#8c49ff] px-3 py-1.5 text-xs font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-gray-400"
                  >
                    {codeCopied ? '복사 완료' : '전체 복사'}
                  </button>
                </div>
              </div>

              {isInitializing ? (
                <div className="flex flex-1 items-center justify-center gap-3 p-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#8c49ff] border-t-transparent" />
                  <span className="text-sm text-gray-400">GEO 최적화 HTML 생성 중...</span>
                </div>
              ) : (
                <textarea
                  value={htmlCode}
                  onChange={(e) => onHtmlCodeChange(e.target.value)}
                  spellCheck={false}
                  className="min-h-0 flex-1 w-full resize-none bg-[#0f1224] p-4 font-mono text-xs leading-relaxed text-gray-100 outline-none"
                />
              )}

              <div className="flex-shrink-0 border-t border-white/10 p-4">
                <label className="mb-2 block text-xs font-medium text-gray-400">
                  코드에 반영할 명령 입력
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApplyInstruction();
                    }}
                    placeholder="예: CTA 버튼 문구를 '무료 상담 신청'으로 바꿔줘"
                    disabled={isApplyingInstruction || isInitializing}
                    className="flex-1 rounded-lg border border-white/10 bg-[#0f1224] px-3 py-2 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/30 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={handleApplyInstruction}
                    disabled={!instruction.trim() || isApplyingInstruction || isInitializing}
                    className="shrink-0 rounded-lg bg-[#8c49ff] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#7a3ce6] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-400"
                  >
                    {isApplyingInstruction ? '반영 중...' : '반영'}
                  </button>
                </div>

                {/* 반영 진행 로딩바 */}
                {isApplyingInstruction && (
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between text-xs text-gray-400">
                      <span>반영 중... {Math.round(instructionProgress)}%</span>
                      <span>
                        {instructionRemainingSeconds !== null
                          ? `예상 ${instructionRemainingSeconds}초 남음`
                          : '완료 대기 중...'}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${instructionProgress}%`, background: 'linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e)' }}
                      />
                    </div>
                  </div>
                )}

                {instructionError && <p className="mt-2 text-xs text-red-400">{instructionError}</p>}
              </div>
            </div>

          </div>
        </div>
        )}
      </div>

      {/* HTML PREVIEW 모달 */}
      {showHtmlModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowHtmlModal(false); }}
        >
          <div className="flex h-[92vh] w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
              <span className="text-base font-semibold text-gray-900">HTML PREVIEW</span>
              <button
                type="button"
                onClick={() => setShowHtmlModal(false)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100"
              >
                닫기
              </button>
            </div>
            <iframe
              srcDoc={`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:24px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px;line-height:1.7;color:#222}img{max-width:100%;height:auto}h1,h2,h3{line-height:1.3}a{color:#8c49ff}</style></head><body>${htmlCode}</body></html>`}
              className="flex-1 w-full border-none"
              sandbox="allow-same-origin"
              title="HTML Preview"
            />
          </div>
        </div>
      )}
    </>
  );
}
