# Business Card OCR Upgrade Proposal

## Current Flow

The app already has a functional business-card OCR path:

- Browser prepares up to three image candidates in `app/static/app.js`.
- The server posts the selected image to `/v1/chat/completions` in `cardOcrChatBody`.
- `reasoning_effort` is disabled for the OCR request.
- Local Tesseract is used for orientation/transcript fallback when enabled.
- E2E coverage verifies chat-completions routing, retry behavior, local OCR fallback, and live OCR
  when `RUN_LIVE_OCR_E2E=1`.

That architecture is better than a single raw image upload, but it can be made more reliable and
easier to debug.

## Problems To Fix

1. The OCR model contract is too loosely coupled to response validation. The prompt asks for JSON
   fields, but the code still needs stronger normalization for partial or malformed responses.

2. The browser crop pipeline is good, but the server does not receive enough structured evidence
   about which crop won. Debug logs have metadata, but successful saved leads do not preserve a
   compact OCR provenance record.

3. The local OCR fallback is only used after selected upstream failures. It should also be used as
   supplemental context when Tesseract confidence is high, not only as a rescue path.

4. There is no explicit comparison between `/v1/chat/completions` and `/v1/responses`. Current
   evidence favors chat completions for image OCR stability through the provider, but this should be
   tested deliberately before changing routes.

5. The live OCR test is opt-in and expensive, so regressions can sit unnoticed unless the mock tests
   cover the exact failure shape.

## Proposed Upgrade

### 1. Keep Chat Completions For Business Cards

Do not migrate this OCR path to `/v1/responses` yet. The current chat-completions route is proven in
this app and matches the working provider path:

- Use `messages[].content[]`.
- Send the image as `{ "type": "image_url", "image_url": { "url": dataUrl } }`.
- Keep `reasoning_effort: null` unless provider behavior changes.

Responses API can be tested in parallel behind a local-only experiment, but it should not replace
the production OCR path until it passes the same image fixtures and live gateway tests.

### 2. Add A Strict OCR Normalization Layer

Create a small server-side normalizer after model output parsing:

- Trim and collapse whitespace.
- Normalize common email and phone OCR mistakes.
- Reject placeholder fields such as `"unknown"`, `"n/a"`, or repeated prompt labels.
- Move websites, LinkedIn URLs, and ambiguous extra text into `notes`.
- Preserve raw model JSON separately in debug logs, not in the saved lead object.

Expected output shape should remain:

```json
{
  "name": "",
  "company": "",
  "role": "",
  "email": "",
  "phone": "",
  "notes": ""
}
```

### 3. Use Local OCR As Supplemental Context

When Tesseract produces high-confidence text, send a combined request:

- Image candidate from the browser.
- Compact local OCR transcript.
- Orientation/crop metadata.

Prompt shape:

```text
Read this business card image. Use the local OCR transcript only as supporting evidence; trust the image when they conflict.
Return only JSON with name, company, role, email, phone, and notes.

Local OCR transcript:
...
```

This should reduce misses on emails and phone numbers without replacing vision OCR.

### 4. Persist OCR Provenance

For each scanned lead, store a compact non-image provenance object:

```json
{
  "ocrSource": "canvas_auto_edge_crop",
  "attemptIndex": 0,
  "outputWidth": 1400,
  "outputHeight": 820,
  "dataUrlCharacters": 900000,
  "localOcrUsed": true,
  "localOcrMeanConfidence": 82
}
```

Do not store full card images in normal lead records. Keep the current IndexedDB local image storage
behavior for user-local debugging.

### 5. Add Regression Fixtures

Add three committed small fixtures:

- Clean horizontal card.
- Rotated/skewed phone photo.
- Hard card with busy background or glare.

For each fixture, add a mocked gateway test that verifies:

- The image request uses `/v1/chat/completions`.
- `reasoning_effort` is null or omitted according to the final contract.
- Retry payloads are attempted in order.
- Local OCR transcript is included only when confidence is high enough.
- The normalized result preserves email/phone/name fields.

Keep live gateway OCR behind `RUN_LIVE_OCR_E2E=1`, but add one smoke fixture that can be run
manually before deploy.

## Implementation Plan

1. Add `normalizeOcrDraft(raw)` and focused unit tests.
2. Extend `tryLocalOcrOrientation` return data with a compact confidence summary.
3. Add `cardOcrVisionAndTranscriptBody(imageDataUrl, transcript)` for high-confidence local OCR
   cases.
4. Persist OCR provenance in the lead draft and saved lead record.
5. Add fixtures and E2E assertions for the upgraded request body.
6. Run normal E2E plus `RUN_LIVE_OCR_E2E=1` before merging.

## Risks

- Adding transcript context may bias the model toward Tesseract mistakes. Keep the prompt explicit
  that the image wins on conflicts.
- More fixture tests can slow E2E. Keep most coverage mocked and reserve live calls for opt-in
  validation.
- Storing provenance must not include full image data or personal contact details beyond the
  existing lead fields.

## Recommendation

Upgrade the existing chat-completions OCR pipeline rather than rewriting it around Responses API.
The highest-value change is combining the already-built browser crop candidates with high-confidence
local OCR transcript context and a stricter normalizer.
