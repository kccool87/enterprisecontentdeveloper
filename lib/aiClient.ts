import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';

export class AIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: 'gemini' | 'openai' | 'both',
  ) {
    super(message);
    this.name = 'AIError';
  }
}

export interface AICallOptions {
  systemPrompt: string;
  userPrompt: string;
  json?: boolean;
}

type ImprovementItem = {
  field: string;
  reason: string;
  suggestion: string;
  insertText: string;
};

type AnalysisJson = {
  scores: { total: number; quality: number; seo: number; geo: number };
  improvements: ImprovementItem[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini({ systemPrompt, userPrompt, json }: AICallOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AIError('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.', 500, 'gemini');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
    ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  });

  const toAIError = (e: GoogleGenerativeAIFetchError) => {
    // 원본 에러는 서버 로그에만 남기고, 클라이언트에는 친화적 메시지 전달
    const status = e.status ?? 502;
    let message: string;
    if (status === 429) message = 'Gemini API 일일 사용량 한도를 초과했습니다.';
    else if (status === 503) message = 'Gemini 서버가 일시적으로 과부하 상태입니다.';
    else message = `Gemini API 오류 (${status})`;
    console.warn('[Gemini]', status, e.message?.substring(0, 200));
    return new AIError(message, status, 'gemini');
  };

  const generate = () => model.generateContent(userPrompt);

  try {
    const result = await generate();
    return result.response.text();
  } catch (error) {
    if (!(error instanceof GoogleGenerativeAIFetchError)) throw error;
    if (error.status !== 503) throw toAIError(error);

    // 503 과부하 → 1회 재시도
    await sleep(1500);
    try {
      const result = await generate();
      return result.response.text();
    } catch (retryError) {
      if (retryError instanceof GoogleGenerativeAIFetchError) throw toAIError(retryError);
      throw retryError;
    }
  }
}

async function callOpenAI({ systemPrompt, userPrompt, json }: AICallOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[OpenAI] OPENAI_API_KEY 환경변수가 없습니다. .env.local 또는 Vercel 환경변수를 확인하세요.');
    throw new AIError('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.', 500, 'openai');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const rawMsg = (err as { error?: { message?: string } }).error?.message || '';
    const status = response.status;
    let message: string;
    if (status === 429) message = 'OpenAI API 사용량 한도를 초과했습니다.';
    else if (status === 401) message = 'OpenAI API 키가 유효하지 않습니다.';
    else if (status === 402) message = 'OpenAI 크레딧이 부족합니다.';
    else message = `OpenAI API 오류 (${status})`;
    console.warn('[OpenAI]', status, rawMsg.substring(0, 200));
    throw new AIError(message, status, 'openai');
  }

  const data = await response.json() as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

/**
 * 두 API 결과 중 더 풍부한(긴) HTML/텍스트를 반환.
 */
function selectBestText(a: string, b: string): string {
  return a.length >= b.length ? a : b;
}

/**
 * 분석 JSON 병합:
 * - 점수: 양쪽 평균
 * - 개선안: 동일 field는 insertText가 더 상세한 쪽 유지, 나머지 항목 합산
 */
function mergeAnalysisJson(text1: string, text2: string): string {
  try {
    const r1 = JSON.parse(text1) as AnalysisJson;
    const r2 = JSON.parse(text2) as AnalysisJson;

    const avg = (a: number, b: number) => Math.round((a + b) / 2);
    const scores = {
      total:   avg(r1.scores.total,   r2.scores.total),
      quality: avg(r1.scores.quality, r2.scores.quality),
      seo:     avg(r1.scores.seo,     r2.scores.seo),
      geo:     avg(r1.scores.geo,     r2.scores.geo),
    };

    // field 기준으로 합산 — 같은 field면 insertText가 더 긴 쪽 채택
    const map = new Map<string, ImprovementItem>();
    for (const item of [...(r1.improvements ?? []), ...(r2.improvements ?? [])]) {
      const prev = map.get(item.field);
      if (!prev || (item.insertText?.length ?? 0) > (prev.insertText?.length ?? 0)) {
        map.set(item.field, item);
      }
    }

    console.log(
      `[aiClient] 두 모델 결과 병합 완료 — 점수: ${JSON.stringify(scores)}, 개선안: ${map.size}개`
    );

    return JSON.stringify({ scores, improvements: Array.from(map.values()) });
  } catch {
    // 파싱 실패 시 더 긴 원문 반환
    return selectBestText(text1, text2);
  }
}

/**
 * Gemini + OpenAI 동시 호출 후 최선의 결과 반환.
 * - 둘 다 성공 → JSON은 병합, HTML은 더 풍부한 쪽 선택
 * - 하나만 성공 → 해당 결과 사용
 * - 둘 다 실패 → 가장 의미 있는 에러 throw
 */
export async function callAI(options: AICallOptions): Promise<string> {
  console.log('[aiClient] Gemini + OpenAI 동시 호출 시작');

  const [geminiResult, openaiResult] = await Promise.allSettled([
    callGemini(options),
    callOpenAI(options),
  ]);

  const succeeded = [geminiResult, openaiResult].filter(
    (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled',
  );

  if (succeeded.length === 0) {
    const geminiErr = geminiResult.status === 'rejected' ? (geminiResult.reason as unknown) : null;
    const openaiErr = openaiResult.status === 'rejected' ? (openaiResult.reason as unknown) : null;
    const geminiStatus = geminiErr instanceof AIError ? geminiErr.status : '?';
    const openaiStatus = openaiErr instanceof AIError ? openaiErr.status : '?';

    console.error(`[aiClient] 두 API 모두 실패 — Gemini: ${geminiStatus}, OpenAI: ${openaiStatus}`);

    // 둘 다 할당량 초과
    if (geminiStatus === 429 && openaiStatus === 429) {
      throw new AIError(
        'Gemini와 OpenAI 모두 사용량 한도를 초과했습니다. 내일 다시 시도하거나 API 플랜을 확인해주세요.',
        429, 'both',
      );
    }

    // Gemini 할당량 초과 + OpenAI 키/크레딧 문제
    if (geminiStatus === 429 && (openaiStatus === 401 || openaiStatus === 402 || openaiStatus === 500)) {
      throw new AIError(
        'Gemini 일일 한도 초과 + OpenAI API 키 또는 크레딧 문제가 발생했습니다. OpenAI 설정을 확인해주세요.',
        429, 'both',
      );
    }

    // 일반 실패
    const primary = geminiErr instanceof AIError ? geminiErr : openaiErr instanceof AIError ? openaiErr : null;
    if (primary instanceof AIError) throw primary;

    throw new AIError('AI API 호출에 실패했습니다. 잠시 후 다시 시도해주세요.', 502, 'both');
  }

  if (succeeded.length === 1) {
    const provider = geminiResult.status === 'fulfilled' ? 'Gemini' : 'OpenAI';
    const failedProvider = provider === 'Gemini' ? 'OpenAI' : 'Gemini';
    const failedResult = geminiResult.status === 'rejected' ? geminiResult : openaiResult;
    const failedErr = failedResult.status === 'rejected' ? failedResult.reason : null;
    const failedStatus = failedErr instanceof AIError ? failedErr.status : '?';
    console.warn(`[aiClient] ${failedProvider} 실패(${failedStatus}) → ${provider} 결과 사용`);
    return succeeded[0].value;
  }

  // 둘 다 성공
  const [a, b] = succeeded.map((r) => r.value);
  if (options.json) {
    return mergeAnalysisJson(a, b);
  }
  const best = selectBestText(a, b);
  console.log(`[aiClient] HTML 선택 — ${a.length >= b.length ? 'Gemini' : 'OpenAI'} (${best.length}자)`);
  return best;
}
