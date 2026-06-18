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

    // 서버 과부하(503) → 1회 재시도
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
 * Gemini를 우선 호출하고, 429(할당량 초과) 시 OpenAI로 자동 전환.
 * OpenAI도 429라면 다시 Gemini 에러를 throw.
 */
export async function callAI(options: AICallOptions): Promise<string> {
  let geminiError: AIError | null = null;

  try {
    return await callGemini(options);
  } catch (error) {
    if (error instanceof AIError && error.status === 429) {
      console.warn('[aiClient] Gemini 할당량 초과 → OpenAI로 전환');
      geminiError = error;
    } else {
      throw error;
    }
  }

  // OpenAI fallback
  try {
    return await callOpenAI(options);
  } catch (error) {
    if (error instanceof AIError && error.status === 429) {
      console.warn('[aiClient] OpenAI 할당량 초과 → 두 API 모두 한도 초과');
      throw new AIError(
        'Gemini와 OpenAI 모두 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
        429,
        'both',
      );
    }
    throw error;
  }

  // TypeScript 만족용 (도달 불가)
  throw geminiError;
}
