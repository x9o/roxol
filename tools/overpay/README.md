# Roxol Discord proof collector

Use Node.js 22 or later and Microsoft Edge on Windows. Run these commands from the repository root.

```powershell
node tools/overpay/sign-in.mjs
node tools/overpay/collect.mjs <discord-username> 75
node tools/overpay/collect.mjs --use-current-account --backfill 200
```

Sign in to the Discord alt in the dedicated Edge window and close it before collecting. The collector verifies the account and Rolimon's **#value-requests** channel. A regular collection rereads the latest 12 saved posts for edits and includes new posts.

Backfill starts at the oldest saved post and reads up to 200 older posts. You can supply a limit from 1 to 200. Backfill keeps the checkpoint used by regular collection. The command reports the number of posts and images saved and the date range reached.

If paging or an attachment download fails, rerun the same command. The saved post list updates only after the whole batch is ready, and posts are keyed by Discord message ID. A successful backfill moves the oldest saved post, so another successful invocation collects an earlier batch.

The dedicated Edge profile and collected evidence are stored under `%LOCALAPPDATA%\Roxol\overpay` by default. Set `ROXOL_OVERPAY_DIR` to use another local directory.
