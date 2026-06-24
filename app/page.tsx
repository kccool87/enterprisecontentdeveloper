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

function stripDiffHighlight(html: string): string {
  return html.replace(/<span class="diff-highlight">([\s\S]*?)<\/span>/g, '$1');
}

// GEO HTML 템플릿의 빈 src 이미지 (AI 추천 슬롯)를 제거
function removeEmptyImgTags(html: string): string {
  // <a href="#"><img src="" .../></a> 형태 먼저 제거
  let result = html.replace(/<a\b[^>]*>\s*<img\b[^>]*?\bsrc=(?:""|'')[^>]*\/?>\s*<\/a>/gi, '');
  // 단독 빈 src img 태그 제거
  result = result.replace(/<img\b[^>]*?\bsrc=(?:""|'')[^>]*\/?>/gi, '');
  return result;
}

interface ImageWithContext {
  tag: string;       // 실제 삽입할 <img> 태그 (alt 업데이트 포함)
  posRatio: number;  // 원본 콘텐츠 텍스트 기준 위치 비율 (0.0~1.0)
}

// contentEditable innerHTML에서 <img> 태그를 텍스트 위치 비율과 함께 추출
function extractImagesWithContext(contentHtml: string): ImageWithContext[] {
  const imgRe = /<img\b[^>]*\/?>/gi;
  const results: ImageWithContext[] = [];
  let match: RegExpExecArray | null;

  // 전체 평문 길이 (위치 비율 계산 기준)
  const totalText = htmlToText(contentHtml);
  const totalLen = totalText.length || 1;

  while ((match = imgRe.exec(contentHtml)) !== null) {
    const tag = match[0];
    const pos = match.index;

    // img 앞까지의 평문 길이로 위치 비율 계산
    const textBefore = htmlToText(contentHtml.slice(0, pos));
    const posRatio = Math.min(textBefore.length / totalLen, 1);

    results.push({ tag, posRatio });
  }

  return results;
}

// alt가 없는 이미지를 Gemini 비전으로 분석해 ALT 태그 생성 (base64 data URL만 처리)
async function generateAltsForUserImages(images: ImageWithContext[]): Promise<ImageWithContext[]> {
  return Promise.all(
    images.map(async (img) => {
      // 이미 의미 있는 alt가 있으면 유지
      const altM = /\balt=["']([^"']*)["']/i.exec(img.tag);
      if (altM?.[1]?.trim()) return img;

      // base64 data URL인 이미지만 Gemini 분석
      const srcM = /\bsrc=["'](data:image\/[^"']+)["']/i.exec(img.tag);
      if (!srcM) return img;

      try {
        const res = await fetch('/api/generate-alt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrl: srcM[1] }),
        });
        if (!res.ok) return img;
        const data: { altText?: string } = await res.json();
        const altText = data.altText?.trim();
        if (!altText) return img;

        const safeAlt = altText.replace(/"/g, '&quot;');
        const updatedTag = altM
          ? img.tag.replace(/\balt=["'][^"']*["']/i, `alt="${safeAlt}"`)
          : img.tag.replace(/\/?>$/, ` alt="${safeAlt}">`);
        return { ...img, tag: updatedTag };
      } catch {
        return img;
      }
    })
  );
}

// GEO HTML을 h2 섹션 단위로 분할해 원본 위치 비율에 따라 이미지를 삽입
function injectImagesIntoGeoHtml(geoHtml: string, images: ImageWithContext[]): string {
  if (images.length === 0) return geoHtml;

  // h2 섹션 경계 수집
  const h2Positions: number[] = [];
  const h2Re = /<h2\b[^>]*>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = h2Re.exec(geoHtml)) !== null) h2Positions.push(hm.index);

  // 섹션이 없으면 순서대로 첫 <p> 뒤에 삽입
  if (h2Positions.length === 0) {
    const allImgs = images.map((img) => img.tag).join('\n');
    return geoHtml.replace(/(<\/p>)/, `$1\n${allImgs}`);
  }

  const bounds = [0, ...h2Positions, geoHtml.length];
  const sections = bounds.slice(0, -1).map((start, i) => ({
    start,
    end: bounds[i + 1],
    plainText: htmlToText(geoHtml.slice(start, bounds[i + 1])),
  }));

  // FAQ 섹션 탐지 → 그 앞 섹션까지만 삽입 허용
  const faqIdx = sections.findIndex((s) =>
    /faq|자주\s*묻|질문/.test(s.plainText.slice(0, 100).toLowerCase())
  );
  const maxSection = faqIdx >= 1 ? faqIdx - 1 : sections.length - 1;

  // posRatio(원본 위치 비율)를 GEO 섹션 인덱스로 선형 매핑
  // 섹션 0은 도입부(h2 이전)이므로 본문 섹션(1~maxSection)에 우선 배분
  const insertions = new Map<number, string[]>();
  for (const img of images) {
    const bodyStart = Math.min(1, maxSection);
    const bodyCount = maxSection - bodyStart + 1;
    const target = bodyStart + Math.min(
      Math.floor(img.posRatio * bodyCount),
      bodyCount - 1,
    );
    if (!insertions.has(target)) insertions.set(target, []);
    insertions.get(target)!.push(img.tag);
  }

  // 각 섹션의 첫 번째 </p> 바로 뒤에 이미지 삽입
  let result = '';
  for (let i = 0; i < sections.length; i++) {
    const chunk = geoHtml.slice(sections[i].start, sections[i].end);
    const imgs = insertions.get(i);
    if (!imgs?.length) {
      result += chunk;
      continue;
    }
    const imgBlock = '\n' + imgs.join('\n') + '\n';
    const pEndIdx = chunk.indexOf('</p>');
    if (pEndIdx >= 0) {
      const at = pEndIdx + 4;
      result += chunk.slice(0, at) + imgBlock + chunk.slice(at);
    } else {
      const nbspM = /(\s*(?:&nbsp;\s*)+)$/i.exec(chunk);
      result += nbspM
        ? chunk.slice(0, nbspM.index) + imgBlock + chunk.slice(nbspM.index)
        : chunk + imgBlock;
    }
  }

  return result;
}

// HTML 태그·엔티티 제거 후 평문 반환
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 삽입 텍스트의 토큰 중 75% 이상이 이미 GEO HTML에 존재하면 중복으로 간주
function isDuplicate(geoHtml: string, insertText: string): boolean {
  const geoTokens = new Set(tokenize(htmlToText(geoHtml)));
  const ins = tokenize(insertText);
  if (ins.length === 0) return false;
  return ins.filter((t) => geoTokens.has(t)).length / ins.length > 0.75;
}

// GEO HTML을 h2 경계로 섹션 분할 후, 각 개선안을 맥락에 맞는 섹션 끝에 삽입
// - reason/suggestion 토큰 + h2 제목 가중치로 최적 섹션 결정
// - 중복 내용은 건너뜀
// - FAQ 섹션 이후에는 삽입하지 않음
function applyImprovementsToGeoHtml(geoHtml: string, items: AppliedImprovement[]): string {
  if (items.length === 0) return geoHtml;

  // h2 태그 시작 위치 수집
  const h2Positions: number[] = [];
  const h2Re = /<h2\b[^>]*>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = h2Re.exec(geoHtml)) !== null) h2Positions.push(hm.index);

  // 섹션 경계: [0, h2_1, h2_2, ..., end]
  const bounds = [0, ...h2Positions, geoHtml.length];

  // 각 섹션의 h2 제목 텍스트와 본문 텍스트를 추출
  const h2TitleRe = /<h2\b[^>]*>(.*?)<\/h2>/i;
  const sections = bounds.slice(0, -1).map((start, i) => {
    const chunk = geoHtml.slice(start, bounds[i + 1]);
    const h2M = h2TitleRe.exec(chunk);
    return {
      start,
      end: bounds[i + 1],
      h2Text: h2M ? htmlToText(h2M[1]) : '',
      plainText: htmlToText(chunk),
    };
  });

  // FAQ 섹션 인덱스 탐지 → 그 앞 섹션까지만 삽입 허용
  const faqIdx = sections.findIndex((s) =>
    /faq|자주\s*묻|질문/.test(s.plainText.slice(0, 100).toLowerCase())
  );
  const maxSection = faqIdx >= 1 ? faqIdx - 1 : sections.length - 1;

  // 개선안별 최적 섹션 결정
  const insertions = new Map<number, string[]>();

  for (const item of items) {
    if (isDuplicate(geoHtml, item.text)) continue;

    const field = item.field.toLowerCase();
    let target = 0;

    if (/서론|도입|시작|소개|배경|개요/.test(field)) {
      target = 0;
    } else if (/결론|마무리/.test(field)) {
      const ci = sections
        .slice(0, maxSection + 1)
        .findIndex((s) => /결론|마무리/.test(s.h2Text + s.plainText.slice(0, 80)));
      target = ci >= 0 ? ci : maxSection;
    } else {
      // field + reason + suggestion을 모두 합친 컨텍스트 토큰으로 섹션 매칭
      // → reason/suggestion에 "서론", "본론", "결론" 등 위치 단서가 담겨 있음
      const contextText = [item.field, item.reason ?? '', item.suggestion ?? '', item.text]
        .join(' ');
      const contextTokens = new Set(tokenize(contextText));

      let best = -1;
      sections.slice(0, maxSection + 1).forEach((sec, idx) => {
        // h2 제목 매칭에 3배 가중치 부여 (제목이 섹션 주제를 대표)
        const h2Score = overlapRatio(tokenize(sec.h2Text), contextTokens) * 3;
        const bodyScore = overlapRatio(tokenize(sec.plainText), contextTokens);
        const total = h2Score + bodyScore;
        if (total > best) { best = total; target = idx; }
      });

      // 겹침이 거의 없으면 첫 번째 본문 섹션으로 fallback
      if (best < 0.05) target = sections.length > 1 ? 1 : 0;
    }

    target = Math.min(target, maxSection);
    if (!insertions.has(target)) insertions.set(target, []);
    insertions.get(target)!.push(
      `<p><span class="diff-highlight">${item.text}</span></p>`
    );
  }

  if (insertions.size === 0) return geoHtml;

  // 각 섹션 끝 (&nbsp; 패딩 앞)에 삽입 후 재조립
  let result = '';
  for (let i = 0; i < sections.length; i++) {
    const chunk = geoHtml.slice(sections[i].start, sections[i].end);
    const adds = insertions.get(i);
    if (!adds?.length) {
      result += chunk;
    } else {
      const m = /(\s*(&nbsp;\s*)+)$/i.exec(chunk);
      if (m) {
        result +=
          chunk.slice(0, m.index) + '\n' + adds.join('\n') + '\n' + chunk.slice(m.index);
      } else {
        result += chunk + '\n' + adds.join('\n');
      }
    }
  }

  return result;
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
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [imagePlaceholder, setImagePlaceholder] = useState(false); // AI 생성 불가로 SVG 플레이스홀더 사용 여부
  // GEO HTML 보존용 ref (재평가 시 복원)
  const geoHtmlRef = useRef('');
  // 원본 이미지 HTML 보존용 ref
  const contentHtmlRef = useRef('');
  // 재평가 중단용 refs
  const reevaluateAbortRef = useRef<AbortController | null>(null);
  const reevaluateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 현재 generate-html에 쓸 payload ref (재시도용)
  const geoPayloadRef = useRef<AnalyzeRequestPayload | null>(null);

  // GEO HTML 내 빈 src img 태그에 AI 이미지 순차 생성 후 주입
  const generateImagesForEmptyTags = async (initialHtml: string) => {
    // src="" 또는 src='' 이고 alt 텍스트가 있는 img 태그 수집
    const emptyImgRe = /<img\b[^>]*?\bsrc=(?:""|'')[^>]*\/?>/gi;
    const tags: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = emptyImgRe.exec(initialHtml)) !== null) {
      const tag = m[0];
      const altM = /\balt=["']([^"']+)["']/.exec(tag);
      if (altM?.[1]) tags.push(tag);
    }
    if (tags.length === 0) return;

    setIsGeneratingImages(true);
    setImagePlaceholder(false);
    let html = initialHtml;
    let usedPlaceholder = false;

    for (const tag of tags) {
      const altM = /\balt=["']([^"']+)["']/.exec(tag);
      if (!altM?.[1]) continue;
      try {
        const res = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alt: altM[1] }),
        });
        if (!res.ok) continue;
        const data: { imageDataUrl?: string; isPlaceholder?: boolean } = await res.json();
        if (!data.imageDataUrl) continue;

        if (data.isPlaceholder) usedPlaceholder = true;

        // src="" 또는 src='' 를 생성된 이미지 dataURL로 교체
        const updatedTag = tag.replace(/\bsrc=(?:""|'')/, `src="${data.imageDataUrl}"`);
        html = html.replace(tag, updatedTag);
        geoHtmlRef.current = html;
        setHtmlCode(html);
        setPreviewHtml(stripArticleWrapper(html));
      } catch {
        // 개별 이미지 실패는 건너뜀
      }
    }

    setIsGeneratingImages(false);
    if (usedPlaceholder) setImagePlaceholder(true);
  };

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
            const userImages = extractImagesWithContext(contentHtmlRef.current);
            // 사용자 이미지 위치 반영 후, 있으면 빈 src 플레이스홀더 제거
            const injected = injectImagesIntoGeoHtml(data.html, userImages);
            const finalHtml = userImages.length > 0
              ? removeEmptyImgTags(injected)
              : injected;
            geoHtmlRef.current = finalHtml;
            setHtmlCode(finalHtml);
            setPreviewHtml(stripArticleWrapper(finalHtml));
            setIsGeneratingGeoHtml(false);
            setHtmlGenProgress(0);

            if (userImages.length === 0) {
              // 사용자 이미지 없음 → AI 추천 이미지 자동 생성
              void generateImagesForEmptyTags(finalHtml);
            } else {
              // 사용자 이미지 있음 → Gemini 비전으로 ALT 태그 분석 후 HTML 갱신
              void generateAltsForUserImages(userImages).then((updatedImages) => {
                const hasChanges = updatedImages.some((img, i) => img.tag !== userImages[i].tag);
                if (!hasChanges) return;
                const updatedInjected = injectImagesIntoGeoHtml(data.html, updatedImages);
                const updatedHtml = removeEmptyImgTags(updatedInjected);
                geoHtmlRef.current = updatedHtml;
                setHtmlCode(updatedHtml);
                setPreviewHtml(stripArticleWrapper(updatedHtml));
              });
            }
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

    // 현재 적용된 개선안을 GEO HTML 베이스에 확정 → 재평가 후에도 유지됨
    if (appliedItems.length > 0 && geoHtmlRef.current) {
      const improved = applyImprovementsToGeoHtml(geoHtmlRef.current, appliedItems);
      geoHtmlRef.current = stripDiffHighlight(improved);
    }

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

    // 적용된 개선안이 있으면 해당 텍스트까지 포함해 재평가 정확도 향상
    const reevalContent =
      appliedItems.length > 0
        ? [payload.content, ...appliedItems.map((i) => i.text)].join('\n\n')
        : payload.content;
    const reevalPayload = { ...payload, content: reevalContent };

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reevalPayload),
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
          {(isAnalyzing || isReevaluating || isGeneratingGeoHtml || isGeneratingImages) && (
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
            onReset={() => window.location.reload()}
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
              isGeneratingImages={isGeneratingImages}
              imagePlaceholder={imagePlaceholder}
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
