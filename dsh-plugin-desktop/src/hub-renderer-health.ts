/** Private launcher receipt: Host readiness alone never commits a generation. */
export class HubRendererHealth {
  private current: { generationId: string; promise: Promise<void>; resolve(): void; reject(cause: unknown): void } | undefined
  begin(generationId: string): void {
    this.current?.reject(new Error('Hub renderer generation superseded'))
    let resolve!: () => void, reject!: (cause: unknown) => void
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    void promise.catch(() => {})
    this.current = { generationId, promise, resolve, reject }
  }
  wait(generationId: string): Promise<void> {
    if (this.current?.generationId !== generationId) return Promise.reject(new Error('Hub renderer generation does not match launcher'))
    return this.current.promise
  }
  healthy(generationId: string): void {
    if (this.current?.generationId !== generationId) throw new Error('Hub renderer generation changed before health receipt')
    this.current.resolve()
  }
  fail(cause: unknown): void { this.current?.reject(cause); this.current = undefined }
}
