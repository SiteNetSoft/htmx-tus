import * as tus from 'tus-js-client';

/** WeakMap tracking active uploads per element */
const activeUploads = new WeakMap();

/** Global defaults for function-valued options set via configure() */
const globalConfig = {};

/**
 * Set global defaults for function-valued tus options.
 * Accepted keys: httpStack, fileReader, urlStorage, fingerprint,
 * metadataForPartialUploads.
 */
function configure(options) {
  Object.assign(globalConfig, options);
}

/**
 * Parse a space/comma-separated list of integers (e.g. retry delays).
 */
function parseIntList(str) {
  if (!str) return undefined;
  return str.split(/[\s,]+/).map(Number).filter(Number.isFinite);
}

/**
 * Parse a JSON-ish or comma-separated key=value string into an object.
 * Accepts: "key1=val1, key2=val2" or a JSON string.
 */
function parseKeyValue(str) {
  if (!str) return undefined;
  str = str.trim();
  if (str.startsWith('{')) {
    try { return JSON.parse(str); } catch { /* fall through */ }
  }
  const result = {};
  str.split(/\s*,\s*/).forEach(pair => {
    const [k, ...rest] = pair.split('=');
    if (k) result[k.trim()] = rest.join('=').trim();
  });
  return result;
}

/**
 * Parse a boolean attribute value. Returns true for "true"/""(present),
 * false for "false", or the given defaultVal if the attribute is absent (null).
 */
function parseBool(val, defaultVal) {
  if (val == null) return defaultVal;
  return val !== 'false';
}

/**
 * Read tus configuration from data-tus-* attributes on the given element,
 * walking up the DOM to find inherited values.
 */
function getTusConfig(elt) {
  const attr = (name) => {
    let node = elt;
    while (node && node.getAttribute) {
      const val = node.getAttribute('data-tus-' + name);
      if (val != null) return val;
      node = node.parentElement;
    }
    return null;
  };

  const endpoint = attr('endpoint');
  if (!endpoint) return null;

  return {
    endpoint,
    chunkSize: attr('chunk-size') ? Number(attr('chunk-size')) : undefined,
    retryDelays: parseIntList(attr('retry-delays')),
    parallelUploads: attr('parallel') ? Number(attr('parallel')) : undefined,
    resume: parseBool(attr('resume'), true),
    metadata: parseKeyValue(attr('metadata')),
    headers: parseKeyValue(attr('headers')),
    uploadUrl: attr('upload-url') || undefined,
    uploadSize: attr('upload-size') ? Number(attr('upload-size')) : undefined,
    uploadDataDuringCreation: parseBool(attr('upload-data-during-creation'), false),
    overridePatchMethod: parseBool(attr('override-patch-method'), false),
    addRequestId: parseBool(attr('add-request-id'), false),
    uploadLengthDeferred: parseBool(attr('upload-length-deferred'), false),
    removeFingerprintOnSuccess: parseBool(attr('remove-fingerprint-on-success'), true),
    protocol: attr('protocol') || undefined,
    terminate: parseBool(attr('terminate'), false),
    autoResume: parseBool(attr('auto-resume'), false),
  };
}

/**
 * Dispatch a custom event on the element, bubbling, with detail payload.
 * Returns the event object for cancelable event inspection.
 */
function dispatch(elt, name, detail, cancelable) {
  const event = new CustomEvent(name, { bubbles: true, cancelable: !!cancelable, detail });
  elt.dispatchEvent(event);
  return event;
}

/**
 * Get all File objects from file inputs within the given element.
 */
function getFiles(elt) {
  const inputs = elt.matches('input[type="file"]')
    ? [elt]
    : Array.from(elt.querySelectorAll('input[type="file"]'));
  const files = [];
  for (const input of inputs) {
    if (input.files) {
      for (const file of input.files) {
        files.push({ file, input });
      }
    }
  }
  return files;
}

/**
 * Start a tus upload for a single file.
 * Returns the tus.Upload instance synchronously. When autoResume is enabled,
 * the upload start is deferred until findPreviousUploads resolves.
 */
function startUpload(elt, file, config, onComplete) {
  const metadata = { filename: file.name, filetype: file.type, ...config.metadata };

  const uploadOptions = {
    endpoint: config.endpoint,
    chunkSize: config.chunkSize,
    retryDelays: config.retryDelays ?? [0, 1000, 3000, 5000],
    parallelUploads: config.parallelUploads,
    metadata,
    headers: config.headers,
    storeFingerprintForResuming: config.resume,
    removeFingerprintOnSuccess: config.removeFingerprintOnSuccess,
    uploadUrl: config.uploadUrl,
    uploadSize: config.uploadSize,
    uploadDataDuringCreation: config.uploadDataDuringCreation,
    overridePatchMethod: config.overridePatchMethod,
    addRequestId: config.addRequestId,
    uploadLengthDeferred: config.uploadLengthDeferred,
    protocol: config.protocol,

    // Merge global config (function-valued options)
    ...globalConfig,

    onError(error) {
      dispatch(elt, 'tus:error', { file, error, upload });
    },

    onProgress(bytesUploaded, bytesTotal) {
      const progress = bytesTotal > 0 ? bytesUploaded / bytesTotal : 0;
      dispatch(elt, 'tus:progress', { file, bytesUploaded, bytesTotal, progress, upload });
    },

    onSuccess() {
      dispatch(elt, 'tus:success', { file, upload, uploadURL: upload.url });
      if (onComplete) onComplete(upload);
    },

    onChunkComplete(chunkSize, bytesAccepted, bytesTotal) {
      dispatch(elt, 'tus:chunk-complete', { file, chunkSize, bytesAccepted, bytesTotal, upload });
    },

    onUploadUrlAvailable() {
      dispatch(elt, 'tus:upload-url-available', { file, upload, uploadURL: upload.url });
    },

    onBeforeRequest(req) {
      dispatch(elt, 'tus:before-request', { file, upload, request: req });
    },

    onAfterResponse(req, res) {
      dispatch(elt, 'tus:after-response', { file, upload, request: req, response: res });
    },

    onShouldRetry(error, retryAttempt, options) {
      const event = dispatch(elt, 'tus:should-retry', { file, upload, error, retryAttempt }, true);
      if (event.defaultPrevented) return false;
      return null;
    },
  };

  // Remove undefined keys so tus-js-client uses its own defaults
  for (const key of Object.keys(uploadOptions)) {
    if (uploadOptions[key] === undefined) {
      delete uploadOptions[key];
    }
  }

  const upload = new tus.Upload(file, uploadOptions);

  dispatch(elt, 'tus:start', { file, upload });

  if (config.autoResume && typeof upload.findPreviousUploads === 'function') {
    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads && previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
        dispatch(elt, 'tus:resume', { file, upload, previousUpload: previousUploads[0] });
      }
      upload.start();
    });
  } else {
    upload.start();
  }

  return upload;
}

/**
 * After all files finish uploading, optionally trigger an htmx AJAX request.
 */
function triggerCompletion(elt, uploads) {
  const completeUrl = elt.getAttribute('data-tus-complete-url');
  const method = elt.getAttribute('hx-post') ? 'POST'
    : elt.getAttribute('hx-put') ? 'PUT'
    : completeUrl ? 'POST'
    : null;

  const url = completeUrl
    || elt.getAttribute('hx-post')
    || elt.getAttribute('hx-put');

  if (url && method && typeof htmx !== 'undefined') {
    const uploadURLs = uploads.map(u => u.url);
    htmx.ajax(method, url, {
      source: elt,
      values: { tusUploadURLs: JSON.stringify(uploadURLs) },
    });
  }
}

/**
 * Register the tus extension with htmx.
 */
htmx.defineExtension('tus', {
  onEvent(name, evt) {
    if (name === 'htmx:configRequest') {
      const elt = evt.detail.elt;
      const config = getTusConfig(elt);
      if (!config) return;

      const fileEntries = getFiles(elt);
      if (fileEntries.length === 0) return;

      // Prevent the default htmx request — we handle the upload via tus
      evt.preventDefault();

      const uploads = [];
      let completed = 0;

      for (const { file } of fileEntries) {
        const upload = startUpload(elt, file, config, (u) => {
          completed++;
          if (completed === fileEntries.length) {
            triggerCompletion(elt, uploads);
          }
        });
        uploads.push(upload);
      }

      activeUploads.set(elt, uploads);
    }

    if (name === 'htmx:beforeCleanupElement') {
      const elt = evt.detail.elt || evt.target;
      const uploads = activeUploads.get(elt);
      if (uploads) {
        const terminate = parseBool(
          elt.getAttribute && elt.getAttribute('data-tus-terminate'),
          false,
        );
        uploads.forEach(u => u.abort(terminate));
        activeUploads.delete(elt);
      }
    }
  },
});

export { activeUploads, configure, tus };
