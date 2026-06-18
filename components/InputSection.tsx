'use client';

import { useState, useRef, KeyboardEvent } from 'react';
import type { AnalysisResult } from './AnalysisDashboard';
import { CONTENT_TYPES, type ContentType } from '@/lib/contentTypes';

export interface AnalyzeRequestPayload {
  keywords: {
    main: string;
    sub: string[];
    longTail: string[];
  };
  purpose: string;
  content: string;
  contentType: ContentType;
}

interface InputSectionProps {
  contentType: ContentType;
  onContentTypeChange: (type: ContentType) => void;
  onResult: (payload: AnalyzeRequestPayload, result: AnalysisResult) => void;
}

function useTagInput() {
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState('');

  const addFromText = (text: string, currentTags: string[]) => {
    const parts = text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const next = [...currentTags];
    parts.forEach((p) => {
      if (!next.includes(p)) next.push(p);
    });
    return next;
  };

  const add = () => {
    if (!input.trim()) return;
    setTags((prev) => addFromText(input, prev));
    setInput('');
  };

  const remove = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes(',')) return;
    e.preventDefault();
    setTags((prev) => addFromText(input + text, prev));
    setInput('');
  };

  return { tags, input, setInput, add, remove, handleKeyDown, handlePaste };
}

interface TagInputFieldProps {
  label: string;
  placeholder: string;
  tags: string[];
  input: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onAdd: () => void;
  onRemove: (tag: string) => void;
  required?: boolean;
  tagVariant?: 'purple' | 'lavender';
}

function TagInputField({
  label,
  placeholder,
  tags,
  input,
  onInputChange,
  onKeyDown,
  onPaste,
  onAdd,
  onRemove,
  required,
  tagVariant = 'purple',
}: TagInputFieldProps) {
  const isLavender = tagVariant === 'lavender';
  const tagBg = isLavender ? 'bg-violet-900/30' : 'bg-[#8c49ff]/15';
  const tagText = isLavender ? 'text-violet-300' : 'text-[#8c49ff]';
  const tagClose = isLavender
    ? 'text-violet-300/60 hover:text-violet-300'
    : 'text-[#8c49ff]/60 hover:text-[#8c49ff]';

  return (
    <div className="mb-5">
      <label className="mb-1.5 block text-sm font-medium text-gray-300">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-white/10 bg-[#0f1224] px-3 py-2 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/30"
        />
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-[#8c49ff] px-4 py-2 text-sm font-medium text-[#8c49ff] transition hover:bg-[#8c49ff]/15"
        >
          추가
        </button>
      </div>

      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${tagBg} ${tagText}`}
            >
              {tag}
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`${tag} 삭제`}
                className={tagClose}
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

const ESTIMATED_SECONDS = 20;

export default function InputSection({ contentType, onContentTypeChange, onResult }: InputSectionProps) {
  const mainKeyword = useTagInput();
  const subKeywords = useTagInput();
  const longTailKeywords = useTagInput();
  const [purpose, setPurpose] = useState('');
  const [hasContent, setHasContent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canSubmit = mainKeyword.tags.length > 0 && hasContent && !isLoading;

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleContentInput = () => {
    setHasContent(!!contentRef.current?.innerText?.trim());
  };

  const handleContentPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
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

  // 평가 중단
  const handleStop = () => {
    clearTimer();
    abortControllerRef.current?.abort();
    setIsLoading(false);
    setIsPaused(true);
    // progress는 현재 값에서 멈춤 (frozen)
  };

  // 평가 시작 / 재시작
  const handleSubmit = async () => {
    if (!canSubmit) return;

    const content = contentRef.current?.innerText ?? '';
    const payload: AnalyzeRequestPayload = {
      keywords: {
        main: mainKeyword.tags.join(', '),
        sub: subKeywords.tags,
        longTail: longTailKeywords.tags,
      },
      purpose: purpose.trim(),
      content,
      contentType,
    };

    setError(null);
    setIsPaused(false);
    setIsLoading(true);
    setProgress(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setProgress(Math.min(90, (elapsed / (ESTIMATED_SECONDS * 1000)) * 100));
    }, 200);

    const cleanup = (success: boolean) => {
      clearTimer();
      if (success) {
        setProgress(100);
      } else {
        setProgress(0);
        setIsLoading(false);
      }
    };

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? '분석 요청에 실패했습니다.');
      }

      const result: AnalysisResult = await response.json();
      cleanup(true);

      setTimeout(() => {
        setProgress(0);
        setIsLoading(false);
        onResult(payload, result);
      }, 400);
    } catch (err) {
      // AbortError: handleStop이 이미 상태 처리 완료
      if (err instanceof Error && err.name === 'AbortError') {
        clearTimer();
        return;
      }
      cleanup(false);
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    }
  };

  const remainingSeconds =
    progress > 0 && progress < 90
      ? Math.max(1, Math.round(ESTIMATED_SECONDS * (1 - progress / 100)))
      : null;

  return (
    <div className="flex min-h-[600px] w-full flex-col rounded-2xl border border-white/10 bg-[#161a2e] p-6 shadow-lg shadow-black/20 lg:h-full lg:min-h-0">

      {/* 상단 고정 뱃지 */}
      <span className="mb-3 block flex-shrink-0 rounded-full bg-lime-400 px-4 py-1.5 text-center text-sm font-semibold text-gray-900">
        INPUT YOUR CONTENT
      </span>

      {/* 스크롤 영역 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">

        <div className="flex-shrink-0">
          {/* 콘텐츠 유형 선택 */}
          <div className="mb-6">
            <p className="mb-2.5 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
              콘텐츠 유형 선택
            </p>
            <div className="flex gap-2">
              {CONTENT_TYPES.map((type) => {
                const isActive = contentType === type.id;
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => onContentTypeChange(type.id)}
                    title={type.description}
                    style={{
                      backgroundColor: isActive ? type.color : 'transparent',
                      color: isActive ? type.textColor : '#9ca3af',
                      borderColor: isActive ? type.color : 'rgba(255,255,255,0.15)',
                    }}
                    className="flex-1 rounded-full border py-2 text-xs font-semibold transition hover:opacity-90"
                  >
                    {type.label}
                  </button>
                );
              })}
            </div>
          </div>

          <TagInputField
            label="메인 키워드"
            placeholder="키워드 입력 후 Enter 또는 쉼표로 구분"
            tags={mainKeyword.tags}
            input={mainKeyword.input}
            onInputChange={mainKeyword.setInput}
            onKeyDown={mainKeyword.handleKeyDown}
            onPaste={mainKeyword.handlePaste}
            onAdd={mainKeyword.add}
            onRemove={mainKeyword.remove}
            required
            tagVariant="lavender"
          />

          <TagInputField
            label="서브 키워드"
            placeholder="키워드 입력 후 Enter 또는 쉼표로 구분"
            tags={subKeywords.tags}
            input={subKeywords.input}
            onInputChange={subKeywords.setInput}
            onKeyDown={subKeywords.handleKeyDown}
            onPaste={subKeywords.handlePaste}
            onAdd={subKeywords.add}
            onRemove={subKeywords.remove}
            tagVariant="lavender"
          />

          <TagInputField
            label="롱테일 키워드"
            placeholder="키워드 입력 후 Enter 또는 쉼표로 구분"
            tags={longTailKeywords.tags}
            input={longTailKeywords.input}
            onInputChange={longTailKeywords.setInput}
            onKeyDown={longTailKeywords.handleKeyDown}
            onPaste={longTailKeywords.handlePaste}
            onAdd={longTailKeywords.add}
            onRemove={longTailKeywords.remove}
            tagVariant="lavender"
          />

          {/* 목적 */}
          <div className="mb-4">
            <label htmlFor="purpose" className="mb-1.5 block text-sm font-medium text-gray-300">
              목적
            </label>
            <input
              id="purpose"
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="예: 리드 생성, 브랜드 인지도 향상"
              className="w-full rounded-lg border border-white/10 bg-[#0f1224] px-3 py-2 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/30"
            />
          </div>

          {/* 콘텐츠 본문 라벨 */}
          <label className="mb-1.5 block text-sm font-medium text-gray-300">
            콘텐츠 본문<span className="ml-0.5 text-red-400">*</span>
          </label>
        </div>

        {/* 본문 입력 — 버튼 위까지 늘어나는 flex-1 */}
        <div
          ref={contentRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleContentInput}
          onPaste={handleContentPaste}
          data-placeholder="평가할 콘텐츠를 입력하세요. (이미지 붙여넣기 가능)"
          className="flex-1 min-h-[140px] w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0f1224] px-3 py-2 text-sm text-white outline-none transition focus:border-[#8c49ff] focus:ring-2 focus:ring-[#8c49ff]/30 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded"
        />

      </div>

      {/* 하단 고정 영역 */}

      {/* 에러 */}
      {error && <p className="mt-3 flex-shrink-0 text-sm text-red-400">{error}</p>}

      {/* 중단 메시지 */}
      {isPaused && !isLoading && (
        <p className="mt-3 flex-shrink-0 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
          ⏸ 평가가 중단되어있습니다. 평가 시작 버튼을 눌러 재시작하세요.
        </p>
      )}

      {/* 로딩바 — 분석 중 or 중단(frozen) */}
      {(isLoading || isPaused) && (
        <div className="mt-3 flex-shrink-0">
          <div className="mb-1.5 flex items-center justify-between text-xs text-gray-400">
            <span>
              {isLoading
                ? `분석 중... ${Math.round(progress)}%`
                : `중단됨 ${Math.round(progress)}%`}
            </span>
            <span>
              {isLoading && remainingSeconds !== null
                ? `예상 ${remainingSeconds}초 남음`
                : isLoading
                ? '완료 대기 중...'
                : '—'}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                background: isLoading
                  ? 'linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e)'
                  : 'linear-gradient(to right, #6b7280, #9ca3af)', // 중단 시 회색
              }}
            />
          </div>
        </div>
      )}

      {/* 버튼 2개 */}
      <div className="mt-3 flex flex-shrink-0 gap-2">
        {/* 평가 중단 (빨간색, 분석 중일 때만 활성) */}
        <button
          type="button"
          onClick={handleStop}
          disabled={!isLoading}
          className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition
            bg-red-600 text-white hover:bg-red-500
            disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
        >
          평가 중단
        </button>

        {/* 평가 시작 / 재시작 (초록색) */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition
            bg-[#22c55e] text-white hover:bg-[#16a34a]
            disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-400"
        >
          {isPaused ? '재시작' : '평가 시작'}
        </button>
      </div>

    </div>
  );
}
