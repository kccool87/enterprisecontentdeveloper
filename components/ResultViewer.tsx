'use client';

import { useState } from 'react';

interface ResultViewerProps {
  /** 보완사항이 반영된 최종 HTML. 변경된 구간은 미리 <span class="diff-highlight">로 감싸져 있어야 함 */
  previewHtml: string;
  /** 워드프레스에 그대로 붙여넣을 수 있는 HTML 코드 */
  htmlCode: string;
  reevaluateCount: number;
  maxReevaluate?: number;
  isReevaluating?: boolean;
  onReevaluate: () => void;
}

export default function ResultViewer({
  previewHtml,
  htmlCode,
  reevaluateCount,
  maxReevaluate = 3,
  isReevaluating = false,
  onReevaluate,
}: ResultViewerProps) {
  const [copied, setCopied] = useState(false);
  const reevaluateDisabled = isReevaluating || reevaluateCount >= maxReevaluate;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(htmlCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">최종 결과</h2>
        <button
          type="button"
          onClick={onReevaluate}
          disabled={reevaluateDisabled}
          className="rounded-lg border border-[#8c49ff] px-4 py-2 text-sm font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/10 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
        >
          {isReevaluating ? '재평가 중...' : `재평가 (${reevaluateCount}/${maxReevaluate})`}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 좌측: 결과물 미리보기 카드 */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">결과 미리보기</h3>
          <div
            className="prose prose-sm max-w-none text-gray-800 [&_.diff-highlight]:rounded [&_.diff-highlight]:bg-[#f4ddff] [&_.diff-highlight]:px-1 [&_.diff-highlight]:py-0.5"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>

        {/* 우측: 코드 블록 카드 */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="rounded-full bg-[#8c49ff] px-3 py-1 text-xs font-semibold text-white">
              HTML
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-[#8c49ff] px-3 py-1.5 text-xs font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/10"
            >
              {copied ? '복사 완료' : '전체 복사'}
            </button>
          </div>
          <pre className="max-h-[480px] overflow-auto bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
            <code className="font-mono">{htmlCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
