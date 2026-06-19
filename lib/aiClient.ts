import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';

export class AIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: 'gemini',
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

export async function callAI({ systemPrompt, userPrompt, json }: AICallOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AIError('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.', 500, 'gemini');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      ...(json ? { responseMimeType: 'application/json', maxOutputTokens: 8192 } : { maxOutputTokens: 65536 }),
    },
  });

  const toAIError = (e: GoogleGenerativeAIFetchError) => {
    const status = e.status ?? 502;
    let message: string;
    if (status === 429) message = 'Gemini API 일일 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
    else if (status === 503) message = 'Gemini 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.';
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
