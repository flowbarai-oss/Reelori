# FlowBar connection and acceptance

Use the overseas gateway `https://api.flowbarai.com/v1`. No domestic endpoint or automatic fallback is configured. Credentials are read by the local API only, from `REELORI_FLOWBAR_KEY` or `REELORI_FLOWBAR_KEY_FILE`. Restart the local service after changing credentials. Do not commit either credentials or the `data` directory.

FlowBar routes require a key created at the international [FlowBarAI site](https://flowbarai.com/); a domestic-site key is not automatically exchanged or routed. The local Settings page links both the international main site and [FlowBarAI GEN Studio](https://gen.flowbarai.com/). Key presence is reported separately for FlowBar, MiniMax, and Aliyun, but presence does not prove authorization; only an actual provider response can do that. No key is sent to the browser, project files, or backups.

Settings → Manage model routes can add, edit, enable, and disable routes for the existing FlowBar, MiniMax, and Aliyun adapters. The editor saves `data/flowbar.json` locally and takes effect without a restart. It does not add a new provider adapter, configure credentials, or prove a model ID works upstream. New routes start disabled; verify the exact ID, supported API shape, price cap, and expiry before enabling. A catalog change invalidates unsubmitted quotes. Existing remote jobs keep their records, while an unsubmitted reservation cannot run if its route or price has changed. Route IDs stay fixed after creation; disabled routes remain editable. The UI supports at most 10 routes.

`data/flowbar.json` shape:

```json
{
  "enabled": false,
  "routes": []
}
```

After verifying a route, enable it and add fields: `id`, `kind` (`image` or `video`), exact `model`, `size`, `upperMicros` (conservative USD reservation, one USD = 1000000), `pricingVersion`, and `expiresAt` (Unix milliseconds). Never invent a live model ID or treat catalog visibility as successful generation. Current adapter supports 1024x1024 images and 5-second 720*1280 / 1280*720 videos. Other specifications need adapter validation first.

Current API shapes: POST `/images/generations`; POST `/videos`; GET `/videos/{id}`; GET `/videos/{id}/content`. Relative to the fixed v1 base. Third-party image downloads use public-address checks and no Authorization header. Redirects do not forward gateway credentials.

The USD ledger is independent of simulated CNY costs. A successful media response does not prove an actual billed amount. A lost response or HTTP error keeps the reservation; the app does not silently retry. Use provider bill evidence to reconcile actual cost, including overruns. A restored project cannot run the original remote jobs.

2026-09-22 live evidence: one `doubao-seedream-4.0` image succeeded; `wan2.7-t2v` and `wan3.0-video` submissions each returned HTTP 401 without a task ID. Read-only queries authenticated but the test ID did not exist. C-Dance/H3 were absent from authenticated model results and public pricing on this gateway. No successful live video or actual billing reconciliation is claimed. Conservative total reservation: USD 2.30; confirmed actual charges remain unknown.

Still required: a usable video route with exact model/pricing evidence, full 3-shot video acceptance, deliberate single-shot redo, upstream bill reconciliation, and recovery through real task lifecycle. Other S5–S7 work can continue independently.

## MiniMax H3 direct route

User subsequently authorized a separate MiniMax credential file for H3. Set `REELORI_MINIMAX_KEY_FILE` or `REELORI_MINIMAX_KEY`. Route `provider` is immutable in the quote: `minimax` selects `https://api.minimax.io/v2`, while `minimax-cn` selects `https://api.minimax.cn/v2`. There is no automatic regional fallback and FlowBar credentials are never used for MiniMax. Existing quotes without `provider` remain FlowBar quotes.

H3 uses POST `/video_generation` with `model: MiniMax-H3`, text `content`, `duration: 5`, `resolution: 768P`, explicit `ratio`. Query GET `/query/video_generation/{id}` and require response task identity to match. Download the returned public HTTPS URL without the API key. Local media validation still applies. Known tasks automatically resume query-only recovery; unsent reservations and restored project copies never auto-submit.

The supplied key was rejected by the international MiniMax endpoint; the China official endpoint authenticated the read-only query and accepted the first real H3 task. This is independent of the overseas FlowBar account. Chinese official H3 pricing is CNY 0.50/output second, CNY 2.50 for the 5-second text-only test. Reserve USD 0.60 conservatively in the campaign budget and display the original currency in `billingNote`; this is not an actual USD charge or settled conversion. Reconciliation requires original bill plus conversion evidence. Never mix this with demo CNY.

Protocol and price sources checked 2026-09-22:
- https://platform.minimax.io/docs/api-reference/video-generation-v2-create
- https://platform.minimax.cn/docs/api-reference/video-generation-v2-query
- https://platform.minimax.cn/docs/guides/pricing-paygo

H3 live result: three distinct shots plus one deliberate redo succeeded. The redo left the original adopted candidate intact. All four videos retain pending billing reservations. The chosen three shots were rendered to a 15-second 1080x1920 / 24 fps / 360-frame MP4 with AAC source audio, gain 0.7. Independent ZIP CRC passed; assets are MP4, not mislabeled images. A portable backup restored all four jobs with recovery blocked and preserved adoption. Four H3 requests imply CNY 10.00 at the published rate, but no account billing statement was read: do not report this as confirmed payment. H3 USD reservations total 2.40; combined with FlowBar reservations, the campaign total is USD 4.70.
