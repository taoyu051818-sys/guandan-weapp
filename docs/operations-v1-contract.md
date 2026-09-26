# Operations v1 contract

All endpoints use existing `{ok:true,data,error:null}` / error envelopes. Admin is independent of player Bearer authentication. Same-origin web UI under `/admin/`; no production credentials in the repo. No production deployment in this implementation turn.

## Records

- Announcement: `{id,title,content,status:'draft'|'published'|'archived',startsAt:number|null,endsAt:number|null,version:number,createdAt,updatedAt}`. Plain text. Title 1..80, content 1..4000. PATCH requires current version and full editable fields; publish/unpublish also uses PATCH. Starts/ends milliseconds, end must exceed start when both set.
- Feedback: `{id,userId,category:'bug'|'suggestion'|'other',content,status:'open'|'resolved',version,createdAt,updatedAt,replies:[{id,content,createdAt}]}`. Content 1..2000. Admin identity is audit-only, not exposed to players. Reply content 1..2000. User never supplies userId.
- Feature: `{id:'messages'|'feedback'|'membership',status:'open'|'closed'|'maintenance',title,detail,version,updatedAt}`. Messages/feedback default open; membership default closed and cannot become open before implementation. Title 1..40; detail 0..300. Feature failures are errors, not fake unopened responses.
- Message: `{id,kind:'announcement'|'feedback',title,content,createdAt,read:boolean}`. Only published/in-window announcements and the current player's feedback replies.
- Pagination: GET `?page=1&pageSize=20`, size max50. Lists return `{items,page,pageSize,total}`, messages additionally `unreadCount`.
- Audit: `{id,actorId,action,targetId,before,after,createdAt}`. Append-only through business transaction, no credentials or login tokens. Feedback snapshots contain identity/version/status/replyCount/updatedAt; only the current reply is appended under `after.reply`, not the full thread. The UTF-8 audit array is capped at 32 MiB; exceeding it rejects and rolls back the business mutation.

## Admin endpoints

- GET `/api/v1/admin/login-options` => `{totpRequired:boolean}` without login; contains no account data, is not cached and is 404 when admin is disabled. UI must load valid options before enabling login, with retry on failure.
- POST `/api/v1/admin/session` `{username,password,totp}` => `{admin:{id,role},csrfToken}` plus HttpOnly session cookie. Roles admin/operator/support. GET same path returns current session. POST `/api/v1/admin/logout` invalidates cookie/session. Only explicit non-production loopback password-only testing permits omitting `totp`; the client cannot choose or override this requirement.
- All authenticated POST/PATCH require `X-CSRF-Token`, exact configured Origin, and independent server role checks. Login verifies Origin too. Restrict development insecure cookies to explicit localhost mode.
- GET `/api/v1/admin/announcements` => list; POST same with `{title,content,startsAt,endsAt}` => `{announcement}` (always draft; do not send status/version); PATCH `/:id` with `{title,content,startsAt,endsAt,status,version}` => `{announcement}`. admin/operator.
- GET `/api/v1/admin/feedback` => list, optional status filter; POST `/:id/replies` `{version,content}` => `{feedback}`; PATCH `/:id` `{version,status}` => `{feedback}`. admin/operator/support.
- GET `/api/v1/admin/features` => `{items}`; PATCH `/:id` `{version,status,title,detail}` => `{feature}`. admin/operator.
- GET `/api/v1/admin/audit` => list. admin only.

## Player endpoints

- GET `/api/v1/messages` => message list. POST `/api/v1/messages/:id/read` => `{read:true}`. Require player Bearer. Enforce messages feature state server-side.
- GET `/api/v1/feedback` => own feedback list. POST same `{category,content}` + Idempotency-Key => `{feedback}`. Require player Bearer. Enforce feedback feature state server-side. Rate limit and input bounds.
- Existing GET `/api/v1/lobby/services/:id` extends `{title,detail}` with `id,status,version,updatedAt` from feature data; old clients still display text.

## Root-owned domain implementation

`server/platform/operations-service.js` exports OperationsService({store,now,createId}). Methods:
`getFeature(id)`, `listFeatures()`, `updateFeature(actor,id,body)`;
`listAnnouncements(query)`, `createAnnouncement(actor,body)`, `updateAnnouncement(actor,id,body)`;
`listFeedback(actor,query)`, `replyFeedback(actor,id,body)`, `updateFeedback(actor,id,body)`;
`listAudit(actor,query)`;
`listPlayerMessages(userId,query)`, `readPlayerMessage(userId,id)`, `listPlayerFeedback(userId,query)`, `submitFeedback(userId,body,idempotencyKey)`.
Actor `{id,role}`. listFeatures returns array; admin router wraps `{items}`. All other lists return pagination shape. Mutation methods return the bare record; router wraps per endpoint. Domain independently enforces admin roles.

HTTP integration can construct OperationsService using service.store/service.now/service.createId (same process/store). No second process may write the platform JSON file. Lazy additive `operations` state owns announcements/feedback/features/readReceipts/audit/idempotency; leave existing schema untouched.
