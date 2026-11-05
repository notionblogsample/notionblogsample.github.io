/**
 * 공통 블록 로더 모듈
 *
 * Notion 블록을 재귀적으로 가져오는 공통 로직
 * getPostBySlug, getAboutPage 등에서 재사용
 */

import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { withCache, CACHE_KEYS } from '@/lib/cache';
import { NOTION_CONFIG, NOTION_ENDPOINTS, CACHE_TTL } from './constants';
import { logger } from '@/lib/logger';
import { notionFetch } from './api-helpers';

/**
 * 블록 로더 옵션
 */
export interface BlockLoaderOptions {
  /** Notion API 키 */
  apiKey: string;
  /** synced_block 지원 여부 (기본값: true) */
  enableSyncedBlocks?: boolean;
  /** child_database 지원 여부 (기본값: true) */
  enableChildDatabases?: boolean;
  /** NotionClient API (child_database 쿼리에 필요) */
  notionClient?: {
    queryDatabase: (databaseId: string, pageSize: number) => Promise<any[]>;
    getDatabaseSchema: (databaseId: string) => Promise<string[]>;
  };
}

/**
 * 재사용 가능한 블록 로더
 *
 * Notion 페이지의 블록들을 재귀적으로 가져옵니다.
 * - 자식 블록 자동 로딩
 * - synced_block 지원
 * - child_database 지원
 * - 캐싱 적용
 *
 * @param blockId 블록 ID (페이지 ID 또는 블록 ID)
 * @param options 블록 로더 옵션
 * @returns 블록 배열
 */
export async function fetchBlocksRecursively(
  blockId: string,
  options: BlockLoaderOptions
): Promise<BlockObjectResponse[]> {
  const {
    apiKey,
    enableSyncedBlocks = true,
    enableChildDatabases = true,
    notionClient
  } = options;

  const cacheKey = CACHE_KEYS.POST_BLOCKS(blockId);
  const cachedBlocks = await withCache(
    cacheKey,
    async () => {
      // Notion API로 블록 가져오기 (페이지네이션 지원)
      let blocks: BlockObjectResponse[] = [];
      let hasMore = true;
      let startCursor: string | undefined;

      while (hasMore) {
        const url = new URL(`${NOTION_CONFIG.BASE_URL}/${NOTION_ENDPOINTS.blockChildren(blockId)}`);
        url.searchParams.append('page_size', '100'); // 최대값 사용
        if (startCursor) {
          url.searchParams.append('start_cursor', startCursor);
        }

        const blocksResponse = await notionFetch(url.toString(), {
          apiKey,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': NOTION_CONFIG.API_VERSION,
          },
        });

        if (!blocksResponse.ok) {
          const errorBody = await blocksResponse.text();

          // 400 에러이고 unsupported block type인 경우 경고만 출력하고 빈 배열 반환
          if (blocksResponse.status === 400 && errorBody.includes('is not supported via the API')) {
            logger.warn(`[WARN] Skipping unsupported block type for blockId ${blockId}`);
            logger.warn(`[WARN] Error:`, errorBody);
            return [];
          }

          // 다른 에러는 throw
          throw new Error(`Notion blocks API returned ${blocksResponse.status} for block ${blockId}: ${errorBody}`);
        }

        const blocksData = await blocksResponse.json();
        const pageBlocks = (blocksData.results || []) as BlockObjectResponse[];
        blocks = blocks.concat(pageBlocks);

        // 페이지네이션 처리
        hasMore = blocksData.has_more || false;
        startCursor = blocksData.next_cursor || undefined;

        // 무한 루프 방지: 최대 1000개 블록까지만 가져오기 (페이지 10개)
        if (blocks.length >= 1000) {
          logger.warn(`[WARN] Block limit reached (1000 blocks) for blockId ${blockId}`);
          hasMore = false;
        }
      }

      // 하위 블록을 순서대로 읽어 Notion 요청이 한꺼번에 몰리지 않도록 합니다.
      for (const block of blocks) {
        // synced_block 특별 처리
        if (enableSyncedBlocks && block.type === 'synced_block' && 'type' in block) {
          try {
            const syncedBlock = (block as any).synced_block;

            // 참조 블록인 경우 (synced_from이 있음)
            if (syncedBlock?.synced_from?.block_id) {
              const sourceBlockId = syncedBlock.synced_from.block_id;
              // 원본 블록의 자식을 가져옴
              const children = await fetchBlocksRecursively(sourceBlockId, options);
              (block as any).children = children;
            }
            // 원본 블록인 경우 (synced_from이 null)
            else if (block.has_children) {
              const children = await fetchBlocksRecursively(block.id, options);
              (block as any).children = children;
            }
          } catch (error) {
            logger.warn(`[WARN] Failed to fetch synced_block children for ${block.id}:`, error);
          }
        }
        // 일반 블록의 자식 처리
        else if (block.has_children && 'type' in block) {
          const children = await fetchBlocksRecursively(block.id, options);
          // 블록 타입에 따라 children 저장
          const blockType = block.type;
          const blockData = (block as Record<string, unknown>)[blockType];
          if (blockData && typeof blockData === 'object') {
            (blockData as Record<string, unknown>).children = children;
          }
        }

        // child_database 블록 처리
        if (enableChildDatabases && block.type === 'child_database' && 'type' in block && notionClient) {
          try {
            // 데이터베이스 ID는 블록 ID와 동일
            const databaseId = block.id;
            const [databaseRows, propertyNames] = await Promise.all([
              notionClient.queryDatabase(databaseId, 100),
              notionClient.getDatabaseSchema(databaseId)
            ]);

            // 데이터베이스 데이터를 블록에 저장
            const blockData = (block as Record<string, unknown>)[block.type];
            if (blockData && typeof blockData === 'object') {
              (blockData as Record<string, unknown>).database_rows = databaseRows;
              (blockData as Record<string, unknown>).property_names = propertyNames;
            }
          } catch (error) {
            logger.warn(`[WARN] Failed to fetch child_database data for ${block.id}:`, error);
          }
        }
      }

      return blocks;
    },
    CACHE_TTL.POST_DETAIL
  );

  return cachedBlocks;
}
