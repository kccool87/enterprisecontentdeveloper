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

  const toAIError = (e: GoogleGenerativeAIFetchError) =>
    new AIError(e.message || 'Gemini API 오류', e.status ?? 502, 'gemini');

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
  if (!apiKey) throw new AIError('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.', 500, 'openai');

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
    throw new AIError(
      (err as { error?: { message?: string } }).error?.message || 'OpenAI API 오류',
      response.status,
      'openai',
    );
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
    // 둘 다 실패 — 가장 의미 있는 에러 우선
    const errors = [geminiResult, openaiResult]
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as unknown);

    const quotaErr = errors.find((e) => e instanceof AIError && e.status === 429);
    if (quotaErr) throw quotaErr;

    const aiErr = errors.find((e) => e instanceof AIError);
    if (aiErr) throw aiErr;

    throw new AIError('두 API 모두 응답에 실패했습니다.', 502, 'both');
  }

  if (succeeded.length === 1) {
    const provider = geminiResult.status === 'fulfilled' ? 'Gemini' : 'OpenAI';
    console.log(`[aiClient] ${provider}만 성공 — 해당 결과 사용`);
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
