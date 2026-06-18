import { NextRequest, NextResponse } from 'next/server';
import { callAI, AIError } from '@/lib/aiClient';
import { HTML_TEMPLATE_EXAMPLE } from '@/lib/htmlTemplate';

const SYSTEM_PROMPT = `너는 LG U+ Enterprise 블로그의 워드프레스 HTML 퍼블리싱 전문가야. [참고 템플릿]은 실제 운영 중인 블로그가 사용하는 HTML 구조 스켈레톤이야. 이 템플릿의 구조와 패턴을 그대로 따라서 [실제 콘텐츠]를 이 형식의 완성된 HTML로 작성해.

규칙:
- 썸네일 이미지, 리드 인용구(blockquote.lead-quote), 목차(nav.toc + 앵커링크), h2 section 헤딩과 id, 강조용 인라인 span(style="color: #8c49ff;"와 em-purple/em-highlight 클래스), 핵심 3줄 요약(summary-box), 결론(conclusion-box, cost-compare), FAQ(내부 <style> 블록 + faq-wrap/faq-q/faq-a), CTA 이미지 링크, 관련 글 링크까지 템플릿의 구조를 모두 포함해서 작성해.
- 템플릿에 들어있는 예시 문장/내용은 절대 재사용하지 말고, 제공된 실제 콘텐츠를 기준으로 완전히 새로 작성해.
- 최상위 wrap div의 class명(예: xxx-post-wrap)은 실제 콘텐츠 주제에 맞는 영문 슬러그로 새로 짓고, em-purple/em-highlight/summary-box/conclusion-box/faq-wrap/faq-q/faq-a 같은 공용 클래스명과 인라인 style="color: #8c49ff;"는 템플릿과 동일하게 유지해.
- <img> 태그는 위치를 유지하되 src는 빈 문자열("")로 남기고, alt 텍스트만 실제 콘텐츠에 맞게 작성해.
- 목차(TOC)와 h2 섹션은 실제 콘텐츠의 분량과 흐름에 맞게 새로 구성해(섹션 개수는 템플릿과 다를 수 있음).
- FAQ는 실제 콘텐츠 주제에 맞는 질문 5~6개를 새로 만들어.
- CTA 버튼/관련 글 링크의 href는 "#"으로 남겨.
- 다른 설명이나 마크다운 코드블록 없이 완성된 HTML 코드만 응답해.`;

interface GenerateHtmlRequestBody {
  content: string;
  mainKeyword?: string;
  purpose?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateHtmlRequestBody = await request.json();
    const { content, mainKeyword, purpose } = body;

    if (!content) {
      return NextResponse.json({ error: 'content는 필수 입력값입니다.' }, { status: 400 });
    }

    const userPrompt = `[메인 키워드]
${mainKeyword || '없음'}

[글의 목적]
${purpose || '없음'}

[실제 콘텐츠]
${content}

[참고 템플릿]
${HTML_TEMPLATE_EXAMPLE}`;

    const text = await callAI({ systemPrompt: SYSTEM_PROMPT, userPrompt, json: false });

    const cleaned = text
      .trim()
      .replace(/^```(?:html)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    return NextResponse.json({ html: cleaned });
  } catch (error) {
    console.error('[generate-html] AI API 호출 실패:', error);

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
      { error: 'HTML 생성 요청 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
