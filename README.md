# htmx-ext-tus

An [HTMX](https://htmx.org/) extension for resumable file uploads via the [tus protocol](https://tus.io/).

## Installation

### Script tag (IIFE)

Load htmx first, then htmx-ext-tus. The tus-js-client is bundled in.

```html
<script src="https://unpkg.com/htmx.org@2"></script>
<script src="path/to/htmx-ext-tus.js"></script>
```

### npm (ESM)

```bash
npm install htmx-ext-tus tus-js-client htmx.org
```

```js
import 'htmx.org';
import 'htmx-ext-tus';
```

## Usage

Add `hx-ext="tus"` to a form (or ancestor) and set `data-tus-endpoint` to your tus server URL.

```html
<form hx-ext="tus" data-tus-endpoint="https://tusd.example.com/files/">
  <input type="file" name="upload" />
  <button type="submit">Upload</button>
</form>
```

When the form is submitted, htmx-ext-tus intercepts the request and uploads each file via tus instead. The normal htmx AJAX request is prevented.

### Multi-file uploads

Multiple file inputs are supported — each file gets its own tus upload:

```html
<form hx-ext="tus" data-tus-endpoint="https://tusd.example.com/files/">
  <input type="file" name="avatar" />
  <input type="file" name="document" />
  <button type="submit">Upload</button>
</form>
```

### Completion callback

To notify your server after all uploads finish, add `data-tus-complete-url` or a standard `hx-post`/`hx-put` attribute. htmx-ext-tus will issue an AJAX request to that URL with the upload URLs as a JSON array in the `tusUploadURLs` parameter.

```html
<form hx-ext="tus"
      data-tus-endpoint="https://tusd.example.com/files/"
      data-tus-complete-url="/api/uploads/done">
  <input type="file" name="upload" />
  <button type="submit">Upload</button>
</form>
```

## Attributes

All attributes are inherited — set them on a parent element to apply to all forms within.

| Attribute | tus-js-client option | Type | Default |
|---|---|---|---|
| `data-tus-endpoint` | `endpoint` | string | **(required)** |
| `data-tus-chunk-size` | `chunkSize` | number | tus-js-client default |
| `data-tus-retry-delays` | `retryDelays` | space/comma-separated ints | `0 1000 3000 5000` |
| `data-tus-parallel` | `parallelUploads` | number | 1 |
| `data-tus-resume` | `storeFingerprintForResuming` | boolean | `true` |
| `data-tus-metadata` | `metadata` | `key=value, ...` or JSON | — |
| `data-tus-headers` | `headers` | `key=value, ...` or JSON | — |
| `data-tus-upload-url` | `uploadUrl` | string | — |
| `data-tus-upload-size` | `uploadSize` | number | — |
| `data-tus-upload-data-during-creation` | `uploadDataDuringCreation` | boolean | `false` |
| `data-tus-override-patch-method` | `overridePatchMethod` | boolean | `false` |
| `data-tus-add-request-id` | `addRequestId` | boolean | `false` |
| `data-tus-upload-length-deferred` | `uploadLengthDeferred` | boolean | `false` |
| `data-tus-remove-fingerprint-on-success` | `removeFingerprintOnSuccess` | boolean | `true` |
| `data-tus-protocol` | `protocol` | string | `"tus-v1"` |
| `data-tus-terminate` | — | boolean | `false` |
| `data-tus-auto-resume` | — | boolean | `false` |
| `data-tus-complete-url` | — | string | — |

### Attribute notes

- **`data-tus-terminate`** — When `true`, cleanup (element removal) sends a DELETE request to the tus server to terminate the upload, rather than just aborting locally.
- **`data-tus-auto-resume`** — When `true`, the extension calls `findPreviousUploads()` before starting and automatically resumes the most recent incomplete upload for the same file. Dispatches a `tus:resume` event when resuming.
- **`data-tus-upload-url`** — Set this to resume a specific upload by URL (skips creation).
- **`data-tus-protocol`** — Protocol version string, e.g. `"tus-v1"` or `"ietf-draft-03"`.

## Events

All events bubble and include a `detail` object.

| Event | Detail | Cancelable | Description |
|---|---|---|---|
| `tus:start` | `{ file, upload }` | No | Upload is starting |
| `tus:progress` | `{ file, bytesUploaded, bytesTotal, progress, upload }` | No | Upload progress (0–1) |
| `tus:success` | `{ file, upload, uploadURL }` | No | Upload completed |
| `tus:error` | `{ file, error, upload }` | No | Upload failed |
| `tus:chunk-complete` | `{ file, chunkSize, bytesAccepted, bytesTotal, upload }` | No | A chunk was uploaded |
| `tus:upload-url-available` | `{ file, upload, uploadURL }` | No | Upload URL assigned by server |
| `tus:before-request` | `{ file, upload, request }` | No | Before each HTTP request |
| `tus:after-response` | `{ file, upload, request, response }` | No | After each HTTP response |
| `tus:should-retry` | `{ file, upload, error, retryAttempt }` | Yes | Retry decision — `preventDefault()` to skip retry |
| `tus:resume` | `{ file, upload, previousUpload }` | No | Resuming from a previous upload (auto-resume) |
| `tus:auto-resume-error` | `{ file, upload, error }` | No | `findPreviousUploads()` failed (upload still starts) |

### Progress bar example

```html
<form hx-ext="tus" data-tus-endpoint="/upload">
  <input type="file" name="file" />
  <progress id="prog" value="0" max="1"></progress>
  <button type="submit">Upload</button>
</form>

<script>
  document.querySelector('form').addEventListener('tus:progress', (e) => {
    document.getElementById('prog').value = e.detail.progress;
  });
</script>
```

### Chunk-level progress

For more reliable progress (especially with large chunk sizes), listen to `tus:chunk-complete`:

```html
<script>
  document.querySelector('form').addEventListener('tus:chunk-complete', (e) => {
    const { bytesAccepted, bytesTotal } = e.detail;
    console.log(`${bytesAccepted} / ${bytesTotal} bytes accepted by server`);
  });
</script>
```

### Error handling

```html
<script>
  document.querySelector('form').addEventListener('tus:error', (e) => {
    const { file, error } = e.detail;
    console.error(`Upload of ${file.name} failed:`, error.message);
  });
</script>
```

### Retry control

Use `tus:should-retry` to implement custom retry logic:

```html
<script>
  document.querySelector('form').addEventListener('tus:should-retry', (e) => {
    // Don't retry on 403 Forbidden
    if (e.detail.error.originalResponse?.getStatus() === 403) {
      e.preventDefault();
    }
  });
</script>
```

### Auto-resume

Enable automatic resumption of previous uploads for the same file:

```html
<form hx-ext="tus"
      data-tus-endpoint="/upload"
      data-tus-auto-resume="true">
  <input type="file" name="file" />
  <button type="submit">Upload</button>
</form>

<script>
  document.querySelector('form').addEventListener('tus:resume', (e) => {
    console.log('Resuming previous upload:', e.detail.previousUpload);
  });
</script>
```

### Programmatic upload control

Access the tus `Upload` instance via the `tus:start` event for full programmatic control:

```html
<script>
  document.querySelector('form').addEventListener('tus:start', (e) => {
    const upload = e.detail.upload;
    // upload.abort(), upload.findPreviousUploads(), etc.
  });
</script>
```

## JavaScript API

The extension exposes its API in two ways:

- **ESM** — `import { configure, resetConfig, activeUploads, tus } from 'htmx-ext-tus'`
- **IIFE / script tag** — `htmx.tus.configure(...)`, `htmx.tus.activeUploads`, etc.

### Script tag (IIFE)

When loaded via `<script>`, the API is available on the `htmx.tus` namespace:

```html
<script>
  // Configure function-valued options
  htmx.tus.configure({ httpStack: myCustomHttpStack });

  // Check tus support
  if (htmx.tus.isSupported) {
    console.log('tus uploads supported');
  }

  // Access active uploads
  const uploads = htmx.tus.activeUploads.get(formElement);
</script>
```

### `configure(options)`

Set global defaults for function-valued tus options that cannot be expressed as attributes.

```js
import { configure } from 'htmx-ext-tus';

configure({
  httpStack: myCustomHttpStack,
  fileReader: myCustomFileReader,
  urlStorage: myCustomUrlStorage,
  fingerprint: (file, options) => {
    return Promise.resolve(['tus', file.name, file.size].join('-'));
  },
});
```

Accepted keys: `httpStack`, `fileReader`, `urlStorage`, `fingerprint`, `metadataForPartialUploads`.

### `resetConfig()`

Clear all global defaults previously set via `configure()`.

```js
import { resetConfig } from 'htmx-ext-tus';

resetConfig(); // removes all configure() options
```

### `activeUploads`

A `WeakMap<Element, Upload[]>` tracking in-progress uploads per element. Useful for programmatic abort or inspection.

```js
import { activeUploads } from 'htmx-ext-tus';

const uploads = activeUploads.get(formElement);
if (uploads) {
  uploads.forEach(u => u.abort());
}
```

### `tus` re-export

The tus-js-client module is re-exported for convenience:

```js
import { tus } from 'htmx-ext-tus';

if (tus.isSupported) {
  console.log('tus uploads supported');
}

if (tus.canStoreURLs) {
  console.log('URL storage available for resumable uploads');
}
```

## Development

All commands run inside a Podman container — no local Node.js needed.

```bash
./dev.sh install       # Install dependencies
./dev.sh build         # Build dist/ bundles
./dev.sh test          # Run tests
./dev.sh test:watch    # Run tests in watch mode
./dev.sh dev           # Build in watch mode
./dev.sh shell         # Open a shell in the container
```

## License

Apache License 2.0
