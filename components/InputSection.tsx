'use client';

import { useState, KeyboardEvent } from 'react';
import type { AnalysisResult } from './AnalysisDashboard';

export interface AnalyzeRequestPayload {
  keywords: {
    main: string;
    sub: string[];
    longTail: string[];
  };
  purpose: string;
  content: string;
}

interface InputSectionProps {
  onResult: (payload: AnalyzeRequestPayload, result: AnalysisResult) => void;
}

function useTagInput() {
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setInput('');
  };

  const remove = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    }
  };

  return { tags, input, setInput, add, remove, handleKeyDown };
}

interface TagInputFieldProps {
  label: string;
  placeholder: string;
  tags: string[];
  input: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onAdd: () => void;
  onRemove: (tag: string) => void;
}

function TagInputField({
  label,
  placeholder,
  tags,
  input,
  onInputChange,
  onKeyDown,
  onAdd,
  onRemove,
}: TagInputFieldProps) {
  return (
    <div className="mb-6">
      <label className="mb-2 block text-sm font-medium text-gray-700">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/20"
        />
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-[#8c49ff] px-4 py-2 text-sm font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/10"
        >
          추가
        </button>
      </div>

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1.5 rounded-full bg-[#8c49ff]/10 px-3 py-1 text-sm font-medium text-[#8c49ff]"
            >
              {tag}
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`${tag} 삭제`}
                className="text-[#8c49ff]/70 hover:text-[#8c49ff]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function InputSection({ onResult }: InputSectionProps) {
  const [mainKeyword, setMainKeyword] = useState('');
  const [purpose, setPurpose] = useState('');
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subKeywords = useTagInput();
  const longTailKeywords = useTagInput();

  const canSubmit = mainKeyword.trim() && purpose.trim() && content.trim() && !isLoading;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const payload: AnalyzeRequestPayload = {
      keywords: {
        main: mainKeyword.trim(),
        sub: subKeywords.tags,
        longTail: longTailKeywords.tags,
      },
      purpose: purpose.trim(),
      content,
    };

    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? '분석 요청에 실패했습니다.');
      }

      const result: AnalysisResult = await response.json();
      onResult(payload, result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">블로그 콘텐츠 입력</h2>
      <p className="mb-6 text-sm text-gray-500">분석할 키워드와 목적, 원문을 입력해 주세요.</p>

      {/* 메인 키워드 */}
      <div className="mb-6">
        <label htmlFor="main-keyword" className="mb-2 block text-sm font-medium text-gray-700">
          메인 키워드
        </label>
        <input
          id="main-keyword"
          type="text"
          value={mainKeyword}
          onChange={(e) => setMainKeyword(e.target.value)}
          placeholder="예: 클라우드 보안"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/20"
        />
      </div>

      <TagInputField
        label="서브 키워드"
        placeholder="키워드 입력 후 Enter"
        tags={subKeywords.tags}
        input={subKeywords.input}
        onInputChange={subKeywords.setInput}
        onKeyDown={subKeywords.handleKeyDown}
        onAdd={subKeywords.add}
        onRemove={subKeywords.remove}
      />

      <TagInputField
        label="롱테일 키워드"
        placeholder="키워드 입력 후 Enter"
        tags={longTailKeywords.tags}
        input={longTailKeywords.input}
        onInputChange={longTailKeywords.setInput}
        onKeyDown={longTailKeywords.handleKeyDown}
        onAdd={longTailKeywords.add}
        onRemove={longTailKeywords.remove}
      />

      {/* 목적 */}
      <div className="mb-6">
        <label htmlFor="purpose" className="mb-2 block text-sm font-medium text-gray-700">
          목적
        </label>
        <input
          id="purpose"
          type="text"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="예: 리드 생성, 브랜드 인지도 향상"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/20"
        />
      </div>

      {/* 원문 입력 */}
      <div className="mb-6">
        <label htmlFor="content-input" className="mb-2 block text-sm font-medium text-gray-700">
          블로그 원문
        </label>
        <textarea
          id="content-input"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="분석할 블로그 본문을 입력하세요."
          rows={10}
          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/20"
        />
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-lg bg-[#8c49ff] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7a3ce6] disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {isLoading ? '분석 중...' : '평가 시작'}
      </button>
    </div>
  );
}
