import { NextRequest, NextResponse } from 'next/server';
import { callAI, AIError } from '@/lib/aiClient';
import { getContentTypeMeta, type ContentType } from '@/lib/contentTypes';

const SYSTEM_PROMPT = `너는 B2B 블로그 콘텐츠 전략 전문가야. 제공된 콘텐츠를 분석해서 반드시 아래 JSON 형식으로만 응답해:
{ "scores": { "total": number, "quality": number, "seo": number, "geo": number }, "improvements": [{ "field": string, "reason": string, "suggestion": string, "insertText": string }] }

모든 점수는 0~100점 정수로 산정해. total은 quality·seo·geo의 가중 평균(각 33%)이야.

━━━ 완성도(quality) 평가 기준 ━━━
아래 4개 항목을 각 25점 만점으로 채점 후 합산해:
1. 체류시간 (25점): 분량·구성·흥미 유발 요소가 독자 이탈을 막기에 충분한가 (평균 블로그 3분 이상 체류 가능성)
2. 가독성 (25점): 문장 길이, 단락 구분, 소제목 활용, 전문용어 해설이 적절한가
3. 정독율 (25점): 핵심 메시지가 명확하고 서론→본론→결론 논리 흐름이 자연스러운가
4. 콘텐츠 깊이 (25점): 표면 정보를 넘어 데이터·사례·인사이트·비교 등 심층 정보가 포함되는가

━━━ SEO(seo) 평가 기준 ━━━
아래 4개 항목을 종합해 네이버·구글 상위 노출 가능성을 점수화해:
1. 키워드 반영도: 메인/서브/롱테일 키워드가 제목·소제목·본문에 자연스럽게 포함되어 있는가
2. 검색 의도 부합: 실제 고객이 입력할 법한 쿼리(구어체·질문형 포함)를 콘텐츠가 직접 해결하는가
3. 경쟁 키워드 포함 여부: 검색량 높고 포털 경쟁에서 콘텐츠 품질로 우위 확보 가능한 키워드를 활용하는가
4. 구조적 SEO 최적화: 적절한 헤딩 계층(H2/H3), 목록·표 활용, 요약 가능한 서두 단락 구성 여부

반드시 improvements 배열에 field가 "SEO 추천 키워드"인 항목을 1~2개 포함해:
- reason에는 현재 콘텐츠에서 누락된 고검색량 키워드와 이유를 기술
- suggestion에는 구체적인 추천 키워드 목록과 삽입 전략을 기술
- insertText에는 해당 추천 키워드를 자연스럽게 포함한 삽입 가능 문장을 작성

━━━ GEO(geo) 평가 기준 ━━━
아래 4개 항목을 종합해 ChatGPT·Gemini·Claude·Perplexity 등 주요 LLM AI에서 인용·참조될 가능성을 점수화해:
1. EEAT 신뢰도: Experience(실제 경험·사례), Expertise(전문 용어·정확한 수치), Authoritativeness(출처·브랜드 권위), Trustworthiness(균형 잡힌 시각·사실 기반)가 콘텐츠에 드러나는가
2. AI 인용 가능성: LLM이 관련 질문에 답할 때 이 글을 참조할 만큼 명확하고 사실 기반의 단언적 정보를 담는가
3. 구조적 AI 최적화: 질문-답변 형식, 정의문, 리스트, 비교표 등 AI 파싱에 유리한 구조가 포함되는가
4. 브랜드 인용 밀도: LG U+ 또는 관련 서비스·솔루션명이 자연스럽게 반복 노출되는가

━━━ improvements 작성 규칙 ━━━
- field: 개선 항목명 (예: "체류시간 개선", "SEO 추천 키워드", "EEAT 강화" 등)
- reason: 현재 콘텐츠의 구체적 문제점
- suggestion: 실행 가능한 구체적 개선 방법
- insertText: 본문에 바로 삽입 가능한 완성된 한국어 문장 또는 문단 (최소 2~3문장 이상)

콘텐츠 유형과 참고 예시가 주어지면 그 유형의 목적·구조·톤을 평가에 반영해.`;

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

    if (!content || !keywords?.main) {
      return NextResponse.json(
        { error: 'keywords.main, content는 필수 입력값입니다.' },
        { status: 400 }
      );
    }

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

    const text = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, json: true });

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: 'AI 응답을 JSON으로 파싱하지 못했습니다.', raw: text },
        { status: 502 }
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('[analyze] AI API 호출 실패:', error);

    if (error instanceof AIError) {
      if (error.status === 429) {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
      if (error.status === 500) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    return NextResponse.json(
      { error: '분석 요청 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
