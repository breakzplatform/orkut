import { AppBskyFeedLike } from "@atproto/api";
import { Firehose } from "@skyware/firehose";
import { label } from "./label.js";
import { DID } from "./constants.js";
import fs from "node:fs";

const CURSOR_FILE = "cursor.txt";
const PERSIST_MS = 30_000;
// No commit on the whole-network firehose for this long => the socket is
// half-open / dead. The library's own autoReconnect is a message-driven
// watchdog that permanently disarms itself after one fruitless reconnect
// (skyware 0.3.2), so we disable it and supervise the connection here.
const STALL_MS = 45_000;
const STALL_CHECK_MS = 15_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

const readCursor = (): string => {
  try {
    return fs.readFileSync(CURSOR_FILE, "utf8").trim();
  } catch {
    return "";
  }
};

const writeCursor = (seq: string, sync = false) => {
  if (!seq) return;
  if (sync) {
    try {
      fs.writeFileSync(CURSOR_FILE, seq);
    } catch (err) {
      console.error(err);
    }
    return;
  }
  fs.writeFile(CURSOR_FILE, seq, (err) => {
    if (err) console.error(err);
  });
};

let lastSeq = readCursor();
let attempts = 0;
let reconnecting = false;
let lastSeenSeq = lastSeq;

const connect = () => {
  reconnecting = false;
  const startCursor = lastSeq;
  if (startCursor) console.log(`Firehose connecting at cursor ${startCursor}`);

  const firehose = new Firehose({
    cursor: startCursor,
    autoReconnect: false,
  });

  let persistID: NodeJS.Timeout | undefined;
  let stallID: NodeJS.Timeout | undefined;

  const teardownAndReconnect = (why: string) => {
    if (reconnecting) return;
    reconnecting = true;
    if (persistID) clearInterval(persistID);
    if (stallID) clearInterval(stallID);
    writeCursor(lastSeq, true);
    firehose.removeAllListeners();
    try {
      firehose.close();
    } catch {
      /* socket may already be gone */
    }
    const delay = Math.min(
      BACKOFF_BASE_MS * 2 ** attempts,
      BACKOFF_MAX_MS,
    );
    attempts += 1;
    console.log(`Firehose ${why}; reconnecting in ${delay}ms`);
    setTimeout(connect, delay);
  };

  firehose.on("open", () => {
    attempts = 0;
    console.log("Firehose connected");
    persistID = setInterval(() => writeCursor(lastSeq), PERSIST_MS);
    stallID = setInterval(() => {
      if (lastSeq && lastSeq === lastSeenSeq) {
        teardownAndReconnect("stalled (no events)");
      }
      lastSeenSeq = lastSeq;
    }, STALL_CHECK_MS);
  });

  firehose.on("commit", (commit) => {
    lastSeq = `${commit.seq}`;
    commit.ops.forEach(async (op) => {
      if (op.action !== "delete" && AppBskyFeedLike.isRecord(op.record)) {
        const uri = op.record.subject.uri;
        if (uri.includes(DID) && uri.includes("app.bsky.feed.post")) {
          await label(commit.repo, uri.split("/").pop()!).catch((err) =>
            console.error(err),
          );
        }
      }
    });
  });

  firehose.on("error", ({ cursor, error }) => {
    console.log(`Firehose parse error at cursor ${cursor}:`, error);
  });

  firehose.on("websocketError", ({ error }) => {
    teardownAndReconnect(`websocket error: ${error?.message ?? error}`);
  });

  firehose.on("close", () => {
    teardownAndReconnect("closed");
  });

  firehose.start();
};

process.on("SIGTERM", () => {
  writeCursor(lastSeq, true);
  process.exit(0);
});
process.on("SIGINT", () => {
  writeCursor(lastSeq, true);
  process.exit(0);
});

connect();
