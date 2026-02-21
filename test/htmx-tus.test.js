import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('tus-js-client', () => {
  const MockUpload = vi.fn(function (file, options) {
    this.file = file;
    this.options = options;
    this.url = 'https://tus.example.com/files/abc123';
    this.start = vi.fn();
    this.abort = vi.fn();
    this.findPreviousUploads = vi.fn(() => Promise.resolve([]));
    this.resumeFromPreviousUpload = vi.fn();
  });
  return { Upload: MockUpload, default: { Upload: MockUpload } };
});

// Re-imported each beforeEach so mock references stay in sync after resetModules
let tus;
let activeUploads;
let configure;
let resetConfig;
let tusReExport;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const htmxMod = await import('htmx.org');
  globalThis.htmx = htmxMod.default;
  tus = await import('tus-js-client');
  const mod = await import('../src/index.js');
  activeUploads = mod.activeUploads;
  configure = mod.configure;
  resetConfig = mod.resetConfig;
  tusReExport = mod.tus;
});

afterEach(() => {
  document.body.innerHTML = '';
});

/** Helper: get the tus extension's onEvent handler from htmx internals */
function getTusExtension(elt) {
  const extensions = htmx._('getExtensions')(elt);
  return extensions.find(e => e.onEvent);
}

/** Helper: set up a form with a file and trigger configRequest */
function setupFormAndTrigger(attrs = '', file) {
  document.body.innerHTML = `
    <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload" ${attrs}>
      <input type="file" name="upload" />
    </form>
  `;

  const form = document.querySelector('form');
  const input = form.querySelector('input[type="file"]');
  const testFile = file || new File(['hello'], 'hello.txt', { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [testFile], writable: false });

  const tusExt = getTusExtension(form);
  const evt = {
    detail: { elt: form },
    preventDefault: vi.fn(),
  };
  tusExt.onEvent('htmx:configRequest', evt);

  return { form, input, tusExt, evt };
}

describe('htmx-tus extension', () => {
  it('registers the tus extension with htmx', () => {
    expect(globalThis.htmx).toBeDefined();
  });

  it('reads data-tus-* attributes', () => {
    document.body.innerHTML = `
      <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload"
            data-tus-chunk-size="5242880"
            data-tus-retry-delays="0 1000 3000"
            data-tus-resume="true">
        <input type="file" name="upload" />
      </form>
    `;
    const form = document.querySelector('form');
    expect(form.getAttribute('data-tus-endpoint')).toBe('https://tus.example.com/upload');
    expect(form.getAttribute('data-tus-chunk-size')).toBe('5242880');
    expect(form.getAttribute('data-tus-retry-delays')).toBe('0 1000 3000');
  });

  it('creates a tus.Upload when form is submitted with a file', () => {
    document.body.innerHTML = `
      <form hx-ext="tus" hx-post="/done"
            data-tus-endpoint="https://tus.example.com/upload">
        <input type="file" name="upload" />
      </form>
    `;

    const form = document.querySelector('form');
    const input = form.querySelector('input[type="file"]');

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], writable: false });

    const tusExt = getTusExtension(form);
    expect(tusExt).toBeDefined();

    tusExt.onEvent('htmx:configRequest', {
      detail: { elt: form },
      preventDefault: vi.fn(),
    });

    expect(tus.Upload).toHaveBeenCalledOnce();
    expect(tus.Upload.mock.calls[0][0]).toBe(file);
    expect(tus.Upload.mock.calls[0][1].endpoint).toBe('https://tus.example.com/upload');

    const instance = tus.Upload.mock.instances[0];
    expect(instance.start).toHaveBeenCalled();
  });

  it('aborts active uploads on cleanup', () => {
    document.body.innerHTML = `
      <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload">
        <input type="file" name="upload" />
      </form>
    `;

    const form = document.querySelector('form');
    const input = form.querySelector('input[type="file"]');

    const file = new File(['data'], 'data.bin', { type: 'application/octet-stream' });
    Object.defineProperty(input, 'files', { value: [file], writable: false });

    const tusExt = getTusExtension(form);
    expect(tusExt).toBeDefined();

    tusExt.onEvent('htmx:configRequest', {
      detail: { elt: form },
      preventDefault: vi.fn(),
    });

    // Verify the upload was actually created and tracked
    expect(tus.Upload).toHaveBeenCalledOnce();
    expect(activeUploads.has(form)).toBe(true);

    const instance = tus.Upload.mock.instances[0];

    tusExt.onEvent('htmx:beforeCleanupElement', {
      detail: { elt: form },
      target: form,
    });

    expect(instance.abort).toHaveBeenCalledWith(false);
  });

  describe('new attributes', () => {
    it('passes uploadDataDuringCreation to tus.Upload', () => {
      setupFormAndTrigger('data-tus-upload-data-during-creation="true"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.uploadDataDuringCreation).toBe(true);
    });

    it('passes overridePatchMethod to tus.Upload', () => {
      setupFormAndTrigger('data-tus-override-patch-method="true"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.overridePatchMethod).toBe(true);
    });

    it('passes addRequestId to tus.Upload', () => {
      setupFormAndTrigger('data-tus-add-request-id="true"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.addRequestId).toBe(true);
    });

    it('passes uploadLengthDeferred to tus.Upload', () => {
      setupFormAndTrigger('data-tus-upload-length-deferred="true"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.uploadLengthDeferred).toBe(true);
    });

    it('passes protocol to tus.Upload', () => {
      setupFormAndTrigger('data-tus-protocol="ietf-draft-03"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.protocol).toBe('ietf-draft-03');
    });

    it('passes uploadUrl to tus.Upload', () => {
      setupFormAndTrigger('data-tus-upload-url="https://tus.example.com/files/existing123"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.uploadUrl).toBe('https://tus.example.com/files/existing123');
    });

    it('passes uploadSize to tus.Upload', () => {
      setupFormAndTrigger('data-tus-upload-size="1048576"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.uploadSize).toBe(1048576);
    });

    it('configures removeFingerprintOnSuccess via attribute', () => {
      setupFormAndTrigger('data-tus-remove-fingerprint-on-success="false"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.removeFingerprintOnSuccess).toBe(false);
    });

    it('defaults removeFingerprintOnSuccess to true', () => {
      setupFormAndTrigger('');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.removeFingerprintOnSuccess).toBe(true);
    });

    it('boolean attributes default to false when absent', () => {
      setupFormAndTrigger('');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.uploadDataDuringCreation).toBe(false);
      expect(opts.overridePatchMethod).toBe(false);
      expect(opts.addRequestId).toBe(false);
      expect(opts.uploadLengthDeferred).toBe(false);
    });
  });

  describe('new events', () => {
    it('fires tus:chunk-complete event', () => {
      const { form } = setupFormAndTrigger('');
      const handler = vi.fn();
      form.addEventListener('tus:chunk-complete', handler);

      const opts = tus.Upload.mock.calls[0][1];
      opts.onChunkComplete(1024, 2048, 4096);

      expect(handler).toHaveBeenCalledOnce();
      const detail = handler.mock.calls[0][0].detail;
      expect(detail.chunkSize).toBe(1024);
      expect(detail.bytesAccepted).toBe(2048);
      expect(detail.bytesTotal).toBe(4096);
      expect(detail.upload).toBeDefined();
    });

    it('fires tus:upload-url-available event', () => {
      const { form } = setupFormAndTrigger('');
      const handler = vi.fn();
      form.addEventListener('tus:upload-url-available', handler);

      const opts = tus.Upload.mock.calls[0][1];
      opts.onUploadUrlAvailable();

      expect(handler).toHaveBeenCalledOnce();
      const detail = handler.mock.calls[0][0].detail;
      expect(detail.uploadURL).toBe('https://tus.example.com/files/abc123');
    });

    it('fires tus:before-request event', () => {
      const { form } = setupFormAndTrigger('');
      const handler = vi.fn();
      form.addEventListener('tus:before-request', handler);

      const mockReq = { getHeader: vi.fn() };
      const opts = tus.Upload.mock.calls[0][1];
      opts.onBeforeRequest(mockReq);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].detail.request).toBe(mockReq);
    });

    it('fires tus:after-response event', () => {
      const { form } = setupFormAndTrigger('');
      const handler = vi.fn();
      form.addEventListener('tus:after-response', handler);

      const mockReq = { getHeader: vi.fn() };
      const mockRes = { getStatus: vi.fn(() => 200) };
      const opts = tus.Upload.mock.calls[0][1];
      opts.onAfterResponse(mockReq, mockRes);

      expect(handler).toHaveBeenCalledOnce();
      const detail = handler.mock.calls[0][0].detail;
      expect(detail.request).toBe(mockReq);
      expect(detail.response).toBe(mockRes);
    });

    it('fires tus:should-retry as cancelable event', () => {
      const { form } = setupFormAndTrigger('');
      const opts = tus.Upload.mock.calls[0][1];

      // Without canceling — should return null (use tus default)
      const result = opts.onShouldRetry(new Error('network'), 0, {});
      expect(result).toBeNull();
    });

    it('prevents retry when tus:should-retry is canceled', () => {
      const { form } = setupFormAndTrigger('');
      form.addEventListener('tus:should-retry', (e) => {
        e.preventDefault();
      });

      const opts = tus.Upload.mock.calls[0][1];
      const result = opts.onShouldRetry(new Error('network'), 0, {});
      expect(result).toBe(false);
    });

    it('fires tus:start with upload instance', () => {
      document.body.innerHTML = `
        <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload">
          <input type="file" name="upload" />
        </form>
      `;
      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const handler = vi.fn();
      form.addEventListener('tus:start', handler);

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      expect(handler).toHaveBeenCalledOnce();
      const detail = handler.mock.calls[0][0].detail;
      expect(detail.upload).toBeDefined();
      expect(detail.file).toBe(file);
    });
  });

  describe('configure() API', () => {
    it('merges configure() options into Upload constructor', () => {
      const mockHttpStack = { createRequest: vi.fn() };
      configure({ httpStack: mockHttpStack });

      setupFormAndTrigger('');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.httpStack).toBe(mockHttpStack);

      // Clean up global config
      resetConfig();
    });

    it('re-exports tus module', () => {
      expect(tusReExport).toBeDefined();
      expect(tusReExport.Upload).toBeDefined();
    });
  });

  describe('auto-resume', () => {
    it('calls findPreviousUploads and resumeFromPreviousUpload when data-tus-auto-resume is set', async () => {
      const previousUpload = { uploadUrl: 'https://tus.example.com/files/prev123', size: 1024 };

      document.body.innerHTML = `
        <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload"
              data-tus-auto-resume="true">
          <input type="file" name="upload" />
        </form>
      `;

      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      // Override findPreviousUploads to return a result
      tus.Upload.mockImplementation(function (f, opts) {
        this.file = f;
        this.options = opts;
        this.url = 'https://tus.example.com/files/abc123';
        this.start = vi.fn();
        this.abort = vi.fn();
        this.findPreviousUploads = vi.fn(() => Promise.resolve([previousUpload]));
        this.resumeFromPreviousUpload = vi.fn();
      });

      const resumeHandler = vi.fn();
      form.addEventListener('tus:resume', resumeHandler);

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      // Wait for the async auto-resume flow
      await vi.waitFor(() => {
        const instance = tus.Upload.mock.instances[0];
        expect(instance.findPreviousUploads).toHaveBeenCalled();
        expect(instance.resumeFromPreviousUpload).toHaveBeenCalledWith(previousUpload);
        expect(instance.start).toHaveBeenCalled();
      });

      expect(resumeHandler).toHaveBeenCalledOnce();
      expect(resumeHandler.mock.calls[0][0].detail.previousUpload).toBe(previousUpload);
    });

    it('starts normally when no previous uploads found', async () => {
      // Reset mockImplementation from previous test
      tus.Upload.mockImplementation(function (f, opts) {
        this.file = f;
        this.options = opts;
        this.url = 'https://tus.example.com/files/abc123';
        this.start = vi.fn();
        this.abort = vi.fn();
        this.findPreviousUploads = vi.fn(() => Promise.resolve([]));
        this.resumeFromPreviousUpload = vi.fn();
      });

      document.body.innerHTML = `
        <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload"
              data-tus-auto-resume="true">
          <input type="file" name="upload" />
        </form>
      `;

      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      await vi.waitFor(() => {
        const instance = tus.Upload.mock.instances[0];
        expect(instance.findPreviousUploads).toHaveBeenCalled();
        expect(instance.resumeFromPreviousUpload).not.toHaveBeenCalled();
        expect(instance.start).toHaveBeenCalled();
      });
    });
  });

  describe('triggerCompletion', () => {
    it('calls htmx.ajax after all uploads succeed', () => {
      htmx.ajax = vi.fn();

      document.body.innerHTML = `
        <form hx-ext="tus" hx-post="/done"
              data-tus-endpoint="https://tus.example.com/upload">
          <input type="file" name="upload" />
        </form>
      `;

      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      const opts = tus.Upload.mock.calls[0][1];
      opts.onSuccess();

      expect(htmx.ajax).toHaveBeenCalledOnce();
      expect(htmx.ajax).toHaveBeenCalledWith('POST', '/done', expect.objectContaining({
        source: form,
        values: { tusUploadURLs: JSON.stringify(['https://tus.example.com/files/abc123']) },
      }));
    });

    it('inherits complete-url from parent element', () => {
      htmx.ajax = vi.fn();

      document.body.innerHTML = `
        <div data-tus-complete-url="/complete" hx-ext="tus">
          <form data-tus-endpoint="https://tus.example.com/upload">
            <input type="file" name="upload" />
          </form>
        </div>
      `;

      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      const opts = tus.Upload.mock.calls[0][1];
      opts.onSuccess();

      expect(htmx.ajax).toHaveBeenCalledOnce();
      expect(htmx.ajax).toHaveBeenCalledWith('POST', '/complete', expect.anything());
    });
  });

  describe('multi-file uploads', () => {
    it('creates multiple Upload instances for multiple files', () => {
      document.body.innerHTML = `
        <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload">
          <input type="file" name="upload1" />
          <input type="file" name="upload2" />
        </form>
      `;

      const form = document.querySelector('form');
      const inputs = form.querySelectorAll('input[type="file"]');
      const file1 = new File(['a'], 'a.txt', { type: 'text/plain' });
      const file2 = new File(['b'], 'b.txt', { type: 'text/plain' });
      Object.defineProperty(inputs[0], 'files', { value: [file1], writable: false });
      Object.defineProperty(inputs[1], 'files', { value: [file2], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      expect(tus.Upload).toHaveBeenCalledTimes(2);
      expect(tus.Upload.mock.calls[0][0]).toBe(file1);
      expect(tus.Upload.mock.calls[1][0]).toBe(file2);

      const tracked = activeUploads.get(form);
      expect(tracked).toHaveLength(2);
    });

    it('calls triggerCompletion only after all files complete', () => {
      htmx.ajax = vi.fn();

      document.body.innerHTML = `
        <form hx-ext="tus" hx-post="/done"
              data-tus-endpoint="https://tus.example.com/upload">
          <input type="file" name="upload1" />
          <input type="file" name="upload2" />
        </form>
      `;

      const form = document.querySelector('form');
      const inputs = form.querySelectorAll('input[type="file"]');
      const file1 = new File(['a'], 'a.txt', { type: 'text/plain' });
      const file2 = new File(['b'], 'b.txt', { type: 'text/plain' });
      Object.defineProperty(inputs[0], 'files', { value: [file1], writable: false });
      Object.defineProperty(inputs[1], 'files', { value: [file2], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      const opts1 = tus.Upload.mock.calls[0][1];
      const opts2 = tus.Upload.mock.calls[1][1];

      // First file completes — should not trigger yet
      opts1.onSuccess();
      expect(htmx.ajax).not.toHaveBeenCalled();

      // Second file completes — now trigger
      opts2.onSuccess();
      expect(htmx.ajax).toHaveBeenCalledOnce();
    });

    it('calls triggerCompletion when one upload errors and one succeeds', () => {
      htmx.ajax = vi.fn();

      document.body.innerHTML = `
        <form hx-ext="tus" hx-post="/done"
              data-tus-endpoint="https://tus.example.com/upload">
          <input type="file" name="upload1" />
          <input type="file" name="upload2" />
        </form>
      `;

      const form = document.querySelector('form');
      const inputs = form.querySelectorAll('input[type="file"]');
      const file1 = new File(['a'], 'a.txt', { type: 'text/plain' });
      const file2 = new File(['b'], 'b.txt', { type: 'text/plain' });
      Object.defineProperty(inputs[0], 'files', { value: [file1], writable: false });
      Object.defineProperty(inputs[1], 'files', { value: [file2], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      const opts1 = tus.Upload.mock.calls[0][1];
      const opts2 = tus.Upload.mock.calls[1][1];

      // First file errors
      opts1.onError(new Error('network'));
      expect(htmx.ajax).not.toHaveBeenCalled();

      // Second file succeeds — triggerCompletion should fire
      opts2.onSuccess();
      expect(htmx.ajax).toHaveBeenCalledOnce();
    });
  });

  describe('attribute inheritance', () => {
    it('child element inherits data-tus-endpoint from parent', () => {
      document.body.innerHTML = `
        <div data-tus-endpoint="https://tus.example.com/upload" hx-ext="tus">
          <form>
            <input type="file" name="upload" />
          </form>
        </div>
      `;

      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      expect(tus.Upload).toHaveBeenCalledOnce();
      expect(tus.Upload.mock.calls[0][1].endpoint).toBe('https://tus.example.com/upload');
    });
  });

  describe('missing endpoint', () => {
    it('does not create upload when no endpoint is set', () => {
      document.body.innerHTML = `
        <form hx-ext="tus">
          <input type="file" name="upload" />
        </form>
      `;

      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const tusExt = getTusExtension(form);
      const evt = {
        detail: { elt: form },
        preventDefault: vi.fn(),
      };
      tusExt.onEvent('htmx:configRequest', evt);

      expect(tus.Upload).not.toHaveBeenCalled();
      expect(evt.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('parsing helpers via attributes', () => {
    it('parses retry-delays with commas', () => {
      setupFormAndTrigger('data-tus-retry-delays="0,1000,3000"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.retryDelays).toEqual([0, 1000, 3000]);
    });

    it('parses retry-delays with spaces', () => {
      setupFormAndTrigger('data-tus-retry-delays="0 1000 3000"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.retryDelays).toEqual([0, 1000, 3000]);
    });

    it('parses single retry delay value', () => {
      setupFormAndTrigger('data-tus-retry-delays="5000"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.retryDelays).toEqual([5000]);
    });

    it('parses JSON metadata', () => {
      setupFormAndTrigger('data-tus-metadata=\'{"key1":"val1","key2":"val2"}\'');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.metadata.key1).toBe('val1');
      expect(opts.metadata.key2).toBe('val2');
    });

    it('parses key=value metadata', () => {
      setupFormAndTrigger('data-tus-metadata="key1=val1, key2=val2"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.metadata.key1).toBe('val1');
      expect(opts.metadata.key2).toBe('val2');
    });

    it('treats NaN chunk-size as undefined (uses tus default)', () => {
      setupFormAndTrigger('data-tus-chunk-size="notanumber"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.chunkSize).toBeUndefined();
    });

    it('treats NaN upload-size as undefined', () => {
      setupFormAndTrigger('data-tus-upload-size="invalid"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.uploadSize).toBeUndefined();
    });

    it('treats NaN parallel as undefined', () => {
      setupFormAndTrigger('data-tus-parallel="abc"');
      const opts = tus.Upload.mock.calls[0][1];
      expect(opts.parallelUploads).toBeUndefined();
    });
  });

  describe('auto-resume error handling', () => {
    it('starts upload even if findPreviousUploads rejects', async () => {
      tus.Upload.mockImplementation(function (f, opts) {
        this.file = f;
        this.options = opts;
        this.url = 'https://tus.example.com/files/abc123';
        this.start = vi.fn();
        this.abort = vi.fn();
        this.findPreviousUploads = vi.fn(() => Promise.reject(new Error('storage error')));
        this.resumeFromPreviousUpload = vi.fn();
      });

      document.body.innerHTML = `
        <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload"
              data-tus-auto-resume="true">
          <input type="file" name="upload" />
        </form>
      `;

      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      await vi.waitFor(() => {
        const instance = tus.Upload.mock.instances[0];
        expect(instance.start).toHaveBeenCalled();
      });
    });
  });

  describe('resetConfig()', () => {
    it('clears all configure() state', () => {
      const mockHttpStack = { createRequest: vi.fn() };
      configure({ httpStack: mockHttpStack });

      setupFormAndTrigger('');
      let opts = tus.Upload.mock.calls[0][1];
      expect(opts.httpStack).toBe(mockHttpStack);

      resetConfig();

      // Trigger a new upload after reset
      document.body.innerHTML = `
        <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload">
          <input type="file" name="upload" />
        </form>
      `;
      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      // httpStack should no longer be present
      opts = tus.Upload.mock.calls[1][1];
      expect(opts.httpStack).toBeUndefined();
    });
  });

  describe('terminate on cleanup', () => {
    it('calls abort(true) when data-tus-terminate is set', () => {
      document.body.innerHTML = `
        <form hx-ext="tus" data-tus-endpoint="https://tus.example.com/upload"
              data-tus-terminate="true">
          <input type="file" name="upload" />
        </form>
      `;

      const form = document.querySelector('form');
      const input = form.querySelector('input[type="file"]');
      const file = new File(['data'], 'data.bin', { type: 'application/octet-stream' });
      Object.defineProperty(input, 'files', { value: [file], writable: false });

      const tusExt = getTusExtension(form);
      tusExt.onEvent('htmx:configRequest', {
        detail: { elt: form },
        preventDefault: vi.fn(),
      });

      const instance = tus.Upload.mock.instances[0];

      tusExt.onEvent('htmx:beforeCleanupElement', {
        detail: { elt: form },
        target: form,
      });

      expect(instance.abort).toHaveBeenCalledWith(true);
    });

    it('calls abort(false) when data-tus-terminate is not set', () => {
      const { form, tusExt } = setupFormAndTrigger('');
      const instance = tus.Upload.mock.instances[0];

      tusExt.onEvent('htmx:beforeCleanupElement', {
        detail: { elt: form },
        target: form,
      });

      expect(instance.abort).toHaveBeenCalledWith(false);
    });
  });
});
