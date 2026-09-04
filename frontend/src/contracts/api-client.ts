import type { ApiErrorDetail, ApiErrorResponse } from './v05.types'

export class ApiClientError extends Error {
  readonly status: number
  readonly detail: ApiErrorDetail

  constructor(
    status: number,
    detail: ApiErrorDetail,
  ) {
    super(detail.message)
    this.name = 'ApiClientError'
    this.status = status
    this.detail = detail
  }

  get code(): string {
    return this.detail.code
  }

  get retryable(): boolean {
    return this.detail.retryable
  }

  get details(): Record<string, unknown> | null {
    return this.detail.details
  }

  get requestId(): string {
    return this.detail.requestId
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(input, init)
  const body = await response.json()

  if (!response.ok) {
    throw new ApiClientError(response.status, (body as ApiErrorResponse).error)
  }

  return body as T
}
