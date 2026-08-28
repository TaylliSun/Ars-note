import { buildDesignQualityReport } from '../../electron/designWritingQuality';
import type { DesignQualityAuditRequest } from '../utils/designQualityAuditCache';

interface AuditWorkerRequest {
  id: number;
  request: DesignQualityAuditRequest;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AuditWorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  const { id, request } = event.data;
  try {
    const report = buildDesignQualityReport(
      request.filePath,
      request.content,
      request.options,
    );
    scope.postMessage({ id, ok: true, report });
  } catch (reason) {
    scope.postMessage({
      id,
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    });
  }
};
