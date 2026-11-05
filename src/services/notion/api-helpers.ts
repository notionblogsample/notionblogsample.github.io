/**
 * Notion API 공통 헬퍼 모듈
 *
 * Notion API 호출의 중복을 제거하기 위한 헬퍼 함수들
 */

import { isNotionApiError } from '@/lib/errors';
import { NOTION_CONFIG } from './constants';

/**
 * 재시도 로직을 포함한 비동기 함수 실행 래퍼
 *
 * Notion API 호출 시 일시적인 네트워크 오류나 rate limiting을 처리하기 위해
 * exponential backoff 전략으로 재시도합니다.
 *
 * @param fn 실행할 비동기 함수
 * @param maxRetries 최대 재시도 횟수 (기본: 3)
 * @param delay 초기 지연 시간 (ms, 기본: 1000)
 * @returns 함수 실행 결과
 * @throws 마지막 시도에서 발생한 에러
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Notion API 에러인 경우 retryable 플래그 확인
      if (isNotionApiError(error)) {
        // retryable이 false면 재시도하지 않음
        if (!error.retryable) {
          throw error;
        }
      }

      // 마지막 시도가 아니면 대기 (exponential backoff)
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }

  throw lastError!;
}

export interface NotionApiOptions {
  apiKey: string;
  version?: string;
}

/**
 * Notion API 공통 fetch 래퍼 (Response 반환)
 *
 * Authorization 헤더와 Notion-Version을 자동으로 추가합니다.
 *
 * @param url Notion API URL
 * @param options Fetch options (apiKey 포함)
 * @returns Response 객체
 */
export async function notionFetch(
  url: string,
  options: RequestInit & { apiKey: string }
): Promise<Response> {
  const { apiKey, ...fetchOptions } = options;

  const request = {
    ...fetchOptions,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': NOTION_CONFIG.API_VERSION,
      ...fetchOptions.headers,
    },
  };

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, request);
    if (response.status !== 429 || attempt === 2) return response;

    // Retry the failed request after Notion's cooldown, without reloading the whole post.
    const retryAfter = Number(response.headers.get('retry-after'));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

