import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT =
  '너는 B2B 블로그 콘텐츠 전문가야. 제공된 콘텐츠를 분석해서 다음 JSON 형식으로만 응답해: { "scores": { "total": number, "quality": number, "seo": number, "geo": number }, "improvements": [{ "field": string, "reason": string, "suggestion": string }] }';

interface AnalyzeRequestBody {
  keywords: {
    main: string;
    sub: string[];
    longTail: string[];
  };
  purpose: string;
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequestBody = await request.json();
    const { keywords, purpose, content } = body;

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

    const userPrompt = `
[메인 키워드]
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

    const result = await model.generateContent(userPrompt);
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
    return NextResponse.json(
      { error: '분석 요청 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
