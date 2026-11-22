/// <reference lib="webworker" />

import type { ExamSet } from '../exam/types';

export interface ExamShardWorkerRequest {
  type: 'SHARD_EXAM_PACK';
  requestId: string;
  buffer: ArrayBuffer;
  expectedSetIds?: string[];
}

export interface ShardedExamSetSlice {
  setId: string;
  title: string;
  duration: number;
  totalQuestions: number;
  totalMarks: number;
  byteSize: number;
  buffer: ArrayBuffer;
}

export type ExamShardWorkerResponse =
  | {
      type: 'SHARD_SUCCESS';
      requestId: string;
      slices: ShardedExamSetSlice[];
    }
  | {
      type: 'SHARD_ERROR';
      requestId: string;
      message: string;
    };

function extractExamSetsArray(parsed: unknown): ExamSet[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (item): item is ExamSet => Boolean(item && typeof item === 'object')
    );
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const candidateArray = obj.sets ?? obj.examSets ?? obj.mocktests ?? obj.data;
    if (Array.isArray(candidateArray)) {
      return candidateArray.filter(
        (item): item is ExamSet => Boolean(item && typeof item === 'object')
      );
    }
    if (Array.isArray(obj.sections)) {
      return [parsed as ExamSet];
    }
  }
  return [];
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<ExamShardWorkerRequest>) => {
  const payload = event.data;
  if (!payload || payload.type !== 'SHARD_EXAM_PACK') return;

  try {
    const rawText = new TextDecoder('utf-8').decode(payload.buffer);
    const parsed = JSON.parse(rawText) as unknown;
    const rawSets = extractExamSetsArray(parsed);

    if (rawSets.length === 0) {
      ctx.postMessage({
        type: 'SHARD_ERROR',
        requestId: payload.requestId,
        message:
          'Downloaded exam pack payload did not contain any valid mock sets.',
      } satisfies ExamShardWorkerResponse);
      return;
    }

    const expectedIds = Array.isArray(payload.expectedSetIds)
      ? payload.expectedSetIds
      : [];
    const encoder = new TextEncoder();
    const slices: ShardedExamSetSlice[] = [];
    const transferables: Transferable[] = [];

    rawSets.forEach((examSet, idx) => {
      const rawId =
        typeof examSet.id === 'string' && examSet.id.trim()
          ? examSet.id.trim()
          : '';
      // Align with catalog MocktestTitles ID at the same index if rawId isn't already in expectedIds
      const alignedSetId =
        rawId && (expectedIds.length === 0 || expectedIds.includes(rawId))
          ? rawId
          : expectedIds[idx] || rawId || `exam_set_${idx + 1}`;

      const normalizedSet: ExamSet = {
        ...examSet,
        id: alignedSetId,
      };
      const bytes = encoder.encode(JSON.stringify(normalizedSet));
      const sliceBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );

      slices.push({
        setId: alignedSetId,
        title:
          typeof normalizedSet.title === 'string' && normalizedSet.title.trim()
            ? normalizedSet.title.trim()
            : `Mock Set ${idx + 1}`,
        duration: Math.max(1, Number(normalizedSet.duration) || 60),
        totalQuestions: Math.max(0, Number(normalizedSet.totalQuestions) || 0),
        totalMarks: Math.max(0, Number(normalizedSet.totalMarks) || 0),
        byteSize: sliceBuffer.byteLength,
        buffer: sliceBuffer,
      });
      transferables.push(sliceBuffer);
    });

    if (slices.length === 0) {
      ctx.postMessage({
        type: 'SHARD_ERROR',
        requestId: payload.requestId,
        message: 'No valid ExamSet records could be extracted from pack JSON.',
      } satisfies ExamShardWorkerResponse);
      return;
    }

    ctx.postMessage(
      {
        type: 'SHARD_SUCCESS',
        requestId: payload.requestId,
        slices,
      } satisfies ExamShardWorkerResponse,
      transferables
    );
  } catch (err) {
    ctx.postMessage({
      type: 'SHARD_ERROR',
      requestId: payload.requestId,
      message:
        err instanceof Error
          ? err.message
          : 'Failed to parse and shard exam pack JSON in worker.',
    } satisfies ExamShardWorkerResponse);
  }
};
