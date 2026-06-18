import Anthropic from '@anthropic-ai/sdk';

export class AIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly provider: 'claude',
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AIError('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.', 500, 'claude');

  const client = new Anthropic({ apiKey });
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';

  // JSON 모드: 응답이 반드시 JSON만 포함하도록 시스템 프롬프트 강화
  const effectiveSystemPrompt = json
    ? `${systemPrompt}\n\n반드시 유효한 JSON만 응답하세요. 마크다운 코드블록(\`\`\`)이나 JSON 외 텍스트를 절대 포함하지 마세요.`
    : systemPrompt;

  const run = async () => {
    const message = await client.messages.create({
      model,
      max_tokens: 8192,
      system: effectiveSystemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = message.content[0];
    if (!block || block.type !== 'text') {
      throw new AIError('예상치 못한 Claude 응답 형식입니다.', 502, 'claude');
    }

    let text = block.text.trim();

    // JSON 모드: 혹시 남은 마크다운 코드 펜스 제거
    if (json) {
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    }

    return text;
  };

  try {
    return await run();
  } catch (error) {
    if (error instanceof AIError) throw error;

    if (error instanceof Anthropic.APIError) {
      const status = error.status ?? 502;
      let message: string;

      if (status === 529) {
        // 과부하 → 1회 재시도
        console.warn('[Claude] 529 Overloaded — 재시도 중...');
        await sleep(1500);
        try {
          return await run();
        } catch (retryError) {
          if (retryError instanceof Anthropic.APIError) {
            throw new AIError(
              'Claude 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.',
              retryError.status ?? 529,
              'claude',
            );
          }
          throw retryError;
        }
      }

      if (status === 400) message = 'Claude API 요청 오류 (400) — 모델 ID 또는 요청 형식을 확인하세요.';
      else if (status === 401) message = 'Claude API 키가 유효하지 않습니다.';
      else if (status === 429) message = 'Claude API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
      else message = `Claude API 오류 (${status})`;

      console.warn('[Claude]', status, error.message?.substring(0, 200));
      throw new AIError(message, status, 'claude');
    }

    throw error;
  }
}
