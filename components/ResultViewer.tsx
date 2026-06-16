'use client';

import { useRef, useState } from 'react';

interface ResultViewerProps {
  /** 보완사항이 반영된 최종 HTML. 변경된 구간은 미리 <span class="diff-highlight">로 감싸져 있어야 함 */
  previewHtml: string;
  onPreviewHtmlChange: (html: string) => void;
  /** 워드프레스에 그대로 붙여넣을 수 있는 HTML 코드 */
  htmlCode: string;
  onHtmlCodeChange: (code: string) => void;
  reevaluateCount: number;
  maxReevaluate?: number;
  isReevaluating?: boolean;
  onReevaluate: () => void;
}

export default function ResultViewer({
  previewHtml,
  onPreviewHtmlChange,
  htmlCode,
  onHtmlCodeChange,
  reevaluateCount,
  maxReevaluate = 3,
  isReevaluating = false,
  onReevaluate,
}: ResultViewerProps) {
  const [previewCopied, setPreviewCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">최종 결과</h2>
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
        <div className="rounded-2xl border border-white/10 bg-[#161a2e] p-6 shadow-lg shadow-black/20">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">결과 미리보기</h3>
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
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => onPreviewHtmlChange(e.currentTarget.innerHTML)}
            className="prose prose-sm prose-invert max-w-none rounded-lg border border-transparent p-2 outline-none transition focus:border-[#8c49ff]/40 focus:bg-white/[0.03] [&_.diff-highlight]:rounded [&_.diff-highlight]:bg-[#8c49ff]/25 [&_.diff-highlight]:px-1 [&_.diff-highlight]:py-0.5"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>

        {/* 코드 블록 카드 */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#161a2e] shadow-lg shadow-black/20">
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
            className="h-[360px] w-full resize-none bg-[#0f1224] p-4 font-mono text-xs leading-relaxed text-gray-100 outline-none"
          />
        </div>
      </div>
    </div>
  );
}
