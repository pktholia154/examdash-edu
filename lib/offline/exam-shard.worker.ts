/// <reference lib="webworker" />

import type { ExamSet } from '../exam/types';

export interface ExamShardWorkerRequest {
  type: 'SHARD_EXAM_PACK';
  requestId: string;
  buffer: ArrayBuffer;
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

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<ExamShardWorkerRequest>) => {
  const payload = event.data;
  if (!payload || payload.type !== 'SHARD_EXAM_PACK') return;

  try {
    const rawText = new TextDecoder('utf-8').decode(payload.buffer);
    const parsed = JSON.parse(rawText) as unknown;

    if (!Array.isArray(parsed) || parsed.length === 0) {
      ctx.postMessage({
        type: 'SHARD_ERROR',
        requestId: payload.requestId,
        message: 'Downloaded exam pack payload did not contain any valid mock sets.',
      } satisfies ExamShardWorkerResponse);
      return;
    }

    const encoder = new TextEncoder();
    const slices: ShardedExamSetSlice[] = [];
    const transferables: Transferable[] = [];

    parsed.forEach((rawSet, idx) => {
      if (!rawSet || typeof rawSet !== 'object') return;
      const examSet = rawSet as ExamSet;
      const safeSetId =
        typeof examSet.id === 'string' && examSet.id.trim()
          ? examSet.id.trim()
          : `exam_set_${idx + 1}`;
      const normalizedSet: ExamSet = {
        ...examSet,
        id: safeSetId,
      };
      const bytes = encoder.encode(JSON.stringify(normalizedSet));
      const sliceBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );

      slices.push({
        setId: safeSetId,
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
