'use client';

import { useRef, useState, type FocusEvent } from 'react';

interface ResultViewerProps {
  /** 보완사항이 반영된 최종 HTML. 변경된 구간은 미리 <span class="diff-highlight">로 감싸져 있어야 함 */
  previewHtml: string;
  onPreviewHtmlChange: (html: string) => void;
  /** 워드프레스에 그대로 붙여넣을 수 있는 HTML 코드 */
  htmlCode: string;
  onHtmlCodeChange: (code: string) => void;
  mainKeyword?: string;
  purpose?: string;
  reevaluateCount: number;
  maxReevaluate?: number;
  isReevaluating?: boolean;
  onReevaluate: () => void;
}

function stripDiffHighlight(html: string): string {
  return html.replace(/<span class="diff-highlight">(.*?)<\/span>/g, '$1');
}

function stripArticleWrapper(html: string): string {
  return html.replace(/^<article>\s*/i, '').replace(/\s*<\/article>\s*$/i, '');
}

export default function ResultViewer({
  previewHtml,
  onPreviewHtmlChange,
  htmlCode,
  onHtmlCodeChange,
  mainKeyword,
  purpose,
  reevaluateCount,
  maxReevaluate = 3,
  isReevaluating = false,
  onReevaluate,
}: ResultViewerProps) {
  const [previewCopied, setPreviewCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [isApplyingInstruction, setIsApplyingInstruction] = useState(false);
  const [instructionError, setInstructionError] = useState<string | null>(null);
  const [isGeneratingHtml, setIsGeneratingHtml] = useState(false);
  const [generateHtmlError, setGenerateHtmlError] = useState<string | null>(null);
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

  const handleGenerateHtml = async () => {
    if (isGeneratingHtml) return;
    setIsGeneratingHtml(true);
    setGenerateHtmlError(null);
    try {
      const content = previewRef.current?.innerText ?? '';
      const response = await fetch('/api/generate-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mainKeyword, purpose }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? 'HTML 생성 요청에 실패했습니다.');
      }

      const data: { html: string } = await response.json();
      onHtmlCodeChange(data.html);
      onPreviewHtmlChange(stripArticleWrapper(data.html));
    } catch (err) {
      setGenerateHtmlError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsGeneratingHtml(false);
    }
  };

  const handleApplyInstruction = async () => {
    if (!instruction.trim() || isApplyingInstruction) return;
    setIsApplyingInstruction(true);
    setInstructionError(null);
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
      onHtmlCodeChange(data.html);
      onPreviewHtmlChange(stripArticleWrapper(data.html));
      setInstruction('');
    } catch (err) {
      setInstructionError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsApplyingInstruction(false);
    }
  };

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-[#161a2e] p-6 shadow-lg shadow-black/20">
      <div className="mb-6 flex items-center justify-between">
        <span className="inline-block rounded-full bg-[#8c49ff] px-4 py-1.5 text-sm font-semibold text-white">
          최종 결과
        </span>
        <button
          type="button"
          onClick={onReevaluate}
          disabled={reevaluateDisabled}
          className="rounded-lg border border-[#8c49ff] px-4 py-2 text-sm font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-gray-400"
        >
          {isReevaluating ? '재평가 중...' : `재평가 (${reevaluateCount}/${maxReevaluate})`}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 결과물 미리보기 카드 */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">결과 미리보기</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleGenerateHtml}
                disabled={isGeneratingHtml}
                className="rounded-lg bg-[#8c49ff] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#7a3ce6] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-400"
              >
                {isGeneratingHtml ? '생성 중...' : 'HTML 생성하기'}
              </button>
              <button
                type="button"
                onClick={handleCopyPreview}
                className="rounded-lg border border-[#8c49ff] px-3 py-1.5 text-xs font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/15"
              >
                {previewCopied ? '복사 완료' : '전체 복사'}
              </button>
            </div>
          </div>
          <div
            key={previewHtml}
            ref={previewRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={handlePreviewBlur}
            className="prose prose-sm prose-invert max-w-none rounded-lg border border-transparent p-2 outline-none transition focus:border-[#8c49ff]/40 focus:bg-white/[0.03] [&_.diff-highlight]:rounded [&_.diff-highlight]:bg-[#8c49ff]/25 [&_.diff-highlight]:px-1 [&_.diff-highlight]:py-0.5"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
          {generateHtmlError && <p className="mt-2 text-xs text-red-400">{generateHtmlError}</p>}
        </div>

        {/* 코드 블록 카드 */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="rounded-full bg-[#8c49ff] px-3 py-1 text-xs font-semibold text-white">
              HTML
            </span>
            <button
              type="button"
              onClick={handleCopyCode}
              className="rounded-lg border border-[#8c49ff] px-3 py-1.5 text-xs font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/15"
            >
              {codeCopied ? '복사 완료' : '전체 복사'}
            </button>
          </div>
          <textarea
            value={htmlCode}
            onChange={(e) => onHtmlCodeChange(e.target.value)}
            spellCheck={false}
            className="h-[300px] w-full resize-none bg-[#0f1224] p-4 font-mono text-xs leading-relaxed text-gray-100 outline-none"
          />
          <div className="border-t border-white/10 p-4">
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
                disabled={isApplyingInstruction}
                className="flex-1 rounded-lg border border-white/10 bg-[#0f1224] px-3 py-2 text-sm text-white outline-none transition placeholder:text-gray-400 focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/30"
              />
              <button
                type="button"
                onClick={handleApplyInstruction}
                disabled={!instruction.trim() || isApplyingInstruction}
                className="shrink-0 rounded-lg bg-[#8c49ff] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#7a3ce6] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-400"
              >
                {isApplyingInstruction ? '반영 중...' : '반영'}
              </button>
            </div>
            {instructionError && <p className="mt-2 text-xs text-red-400">{instructionError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
