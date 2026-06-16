import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { getContentTypeMeta, type ContentType } from '@/lib/contentTypes';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYSTEM_PROMPT =
  '너는 B2B 블로그 콘텐츠 전문가야. 제공된 콘텐츠를 분석해서 다음 JSON 형식으로만 응답해: { "scores": { "total": number, "quality": number, "seo": number, "geo": number }, "improvements": [{ "field": string, "reason": string, "suggestion": string, "insertText": string }] } insertText에는 해당 개선사항을 해결하기 위해 본문에 그대로 삽입할 수 있는 완성된 한국어 문장(또는 문단)을 작성해. 콘텐츠 유형과 참고 예시가 주어지면, 그 유형의 목적과 예시의 구조·톤을 기준으로 평가에 반영해.';

interface AnalyzeRequestBody {
  keywords: {
    main: string;
    sub: string[];
    longTail: string[];
  };
  purpose: string;
  content: string;
  contentType?: ContentType;
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequestBody = await request.json();
    const { keywords, purpose, content, contentType } = body;

    if (!content || !keywords?.main || !purpose) {
      return NextResponse.json(
        { error: 'keywords.main, purpose, content는 필수 입력값입니다.' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { responseMimeType: 'application/json' },
    });

    const contentTypeMeta = contentType ? getContentTypeMeta(contentType) : null;

    const userPrompt = `
${
  contentTypeMeta
    ? `[콘텐츠 유형]\n${contentTypeMeta.label} - ${contentTypeMeta.description}\n\n[참고 예시 콘텐츠 (이 유형의 모범 사례)]\n${contentTypeMeta.referenceExample}\n\n`
    : ''
}[메인 키워드]
${keywords.main}

[서브 키워드]
${keywords.sub?.join(', ') || '없음'}

[롱테일 키워드]
${keywords.longTail?.join(', ') || '없음'}

[글의 목적]
${purpose}

[분석할 콘텐츠]
${content}
`.trim();

    let result;
    try {
      result = await model.generateContent(userPrompt);
    } catch (error) {
      const isOverloaded = error instanceof GoogleGenerativeAIFetchError && error.status === 503;
      if (!isOverloaded) throw error;
      await sleep(1500);
      result = await model.generateContent(userPrompt);
    }
    const text = result.response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: 'Gemini 응답을 JSON으로 파싱하지 못했습니다.', raw: text },
        { status: 502 }
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('[analyze] Gemini API 호출 실패:', error);

    if (error instanceof GoogleGenerativeAIFetchError) {
      if (error.status === 429) {
        return NextResponse.json(
          { error: 'Gemini API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' },
          { status: 429 }
        );
      }
      if (error.status === 503) {
        return NextResponse.json(
          { error: 'Gemini 서버가 현재 혼잡합니다. 잠시 후 다시 시도해주세요.' },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: `Gemini API 호출 중 오류가 발생했습니다. (status: ${error.status ?? '알 수 없음'})` },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: '분석 요청 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
